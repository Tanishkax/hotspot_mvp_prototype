"""Build the frontend dataset (site/data) from NASA FIRMS India archives.

Usage:  python pipeline/build_dataset.py [--raw data/raw] [--out site/data]
Output: manifest.json, cells.json, tiles/<tile>.json, validation/real_harmonisation.json
"""
import argparse
import calendar
import datetime as dt
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import firms  # noqa: E402
import harmonise_counts as hc  # noqa: E402

BASE_YEAR = 2000
SCHEMA_VERSION = "1.0.0"
INCOMPLETE_MISSING_DAYS = 2      # month is incomplete when >= 2 (equivalent) days of data are missing
FIT_SPLIT_YEAR = 2019            # holdout: fit < 2019, evaluate >= 2019
# Documented outages that the automatic rule cannot see (a long gap distorts its own rolling window).
# Terra MODIS: power-supply anomaly, no data 2001-06-15 .. 2001-07-03 (MODIS Terra data outage record).
KNOWN_OUTAGES = {"T": [("2001-06-15", "2001-07-03")]}


def ym(m):
    return int(BASE_YEAR + m // 12), int(m % 12 + 1)


def load_detections(raw):
    out = []
    for sensor, pat in (("MODIS", "modis_*_India.csv"), ("VIIRS", "viirs-snpp_*_India.csv")):
        paths = sorted(glob.glob(os.path.join(raw, pat)))
        if not paths:
            raise SystemExit(f"No {sensor} files in {raw}; run data/raw/download.sh")
        d = firms.read_firms(paths)
        n0 = len(d)
        d = firms.filter_detections(d, sensor)
        d["sat"] = firms.satellite_code(d, sensor)
        print(f"{sensor}: {n0:,} rows -> {len(d):,} after filters")
        out.append(d[["latitude", "longitude", "acq_date", "sat", "frp"]])
    return pd.concat(out, ignore_index=True)


def month_table(det, last_m):
    spans = {s: (det.loc[det.sat == s, "acq_date"].min(), det.loc[det.sat == s, "acq_date"].max()) for s in "TAV"}
    start, end = min(v[0] for v in spans.values()), max(v[1] for v in spans.values())
    daily = det.groupby(["acq_date", "sat"]).size().unstack().reindex(columns=list("TAV"))
    miss = firms.missing_days(daily, start, end)
    for s, ranges in KNOWN_OUTAGES.items():
        for a, b in ranges:
            miss.loc[(miss.index >= a) & (miss.index <= b), s] = True
    for s, (a, b) in spans.items():                      # outside its operating span a satellite is not "missing"
        miss.loc[(miss.index < a) | (miss.index > b), s] = False
    miss_m = (miss.groupby(firms.month_index(miss.index, BASE_YEAR)).sum()
              .reindex(range(0, last_m + 1), fill_value=0).astype(int))
    a_start = firms.month_index([spans["A"][0]], BASE_YEAR)[0]
    v_start = firms.month_index([spans["V"][0]], BASE_YEAR)[0]
    t_start = firms.month_index([spans["T"][0]], BASE_YEAR)[0]
    rows = []
    for m in range(0, last_m + 1):
        y, mo = ym(m)
        ndays = calendar.monthrange(y, mo)[1]
        first_v = spans["V"][0].year == y and spans["V"][0].month == mo and spans["V"][0].day > 1
        first_a = spans["A"][0].year == y and spans["A"][0].month == mo and spans["A"][0].day > 1
        if m < t_start:
            src, missing = None, ndays
        elif m > v_start or (m == v_start and not first_v):
            src, missing = "V", int(miss_m.at[m, "V"])
        elif m > a_start or (m == a_start and not first_a):
            src, missing = "TA", (int(miss_m.at[m, "T"]) + int(miss_m.at[m, "A"])) / 2
        else:
            src, missing = "T", int(miss_m.at[m, "T"])
        rows.append({"m": m, "year": y, "month": mo, "source": src, "days": ndays,
                     "missing_days": float(missing),
                     "complete": bool(src is not None and missing < INCOMPLETE_MISSING_DAYS),
                     "V_missing": int(miss_m.at[m, "V"]), "T_missing": int(miss_m.at[m, "T"]),
                     "A_missing": int(miss_m.at[m, "A"])})
    return pd.DataFrame(rows), spans


def cell_months(det):
    r, c = firms.cell_index(det.latitude, det.longitude)
    det = det.assign(row=r, col=c, m=firms.month_index(det.acq_date, BASE_YEAR))
    cnt = det.groupby(["row", "col", "m", "sat"]).size().unstack(fill_value=0).reindex(columns=list("TAV"), fill_value=0)
    frp = det.groupby(["row", "col", "m", "sat"])["frp"].sum().unstack(fill_value=0).reindex(columns=list("TAV"), fill_value=0)
    frp.columns = [f"{c}f" for c in frp.columns]
    cm = cnt.join(frp).reset_index()
    lat, lon = firms.cell_centre(cm.row, cm.col)
    cm["lat"], cm["lon"] = lat, lon
    cm["band"] = hc.band_of(cm["lat"])
    return cm


def fit_ratios(ov):
    """Ratio tables for counts and FRP, Terra+Aqua and Terra-only."""
    ov = ov.assign(TA=ov["T"] + ov["A"], TAf=ov["Tf"] + ov["Af"])
    res = {}
    for metric, (ta, t, v) in {"count": ("TA", "T", "V"), "frp": ("TAf", "Tf", "Vf")}.items():
        res[metric] = {
            "TA": hc.ratio_of_sums_by_band(ov, ta, v), "T": hc.ratio_of_sums_by_band(ov, t, v),
            "fallback": {"TA": hc.global_ratio(ov, ta, v), "T": hc.global_ratio(ov, t, v)},
        }
    return res


def holdout(cm, months, overlap_ok):
    """Fit ratios on overlap years < FIT_SPLIT_YEAR, evaluate harmonised MODIS vs VIIRS on later years."""
    ov = cm[cm.m.isin(overlap_ok)]
    year = BASE_YEAR + ov.m // 12
    fit, test = ov[year < FIT_SPLIT_YEAR], ov[year >= FIT_SPLIT_YEAR].copy()
    r = fit_ratios(fit)["count"]
    test["pred"], _ = hc.apply_ratio(test["T"] + test["A"], test["band"], r["TA"], r["fallback"]["TA"])
    test["raw"] = test["T"] + test["A"]
    out = {"fit_years": [int(year.min()), FIT_SPLIT_YEAR - 1], "test_years": [FIT_SPLIT_YEAR, int(year.max())],
           "levels": {}}
    out["levels"]["cell_month_0.25deg"] = {"harmonised": hc.agreement_metrics(test.pred, test.V),
                                           "raw": hc.agreement_metrics(test.raw, test.V)}
    test["r1"], test["c1"] = np.floor(test.lat), np.floor(test.lon)
    g1 = test.groupby(["r1", "c1", "m"])[["pred", "raw", "V"]].sum().reset_index()
    out["levels"]["cell_month_1deg"] = {"harmonised": hc.agreement_metrics(g1.pred, g1.V),
                                        "raw": hc.agreement_metrics(g1.raw, g1.V)}
    gn = test.groupby("m")[["pred", "raw", "V"]].sum().reset_index()
    out["levels"]["national_month"] = {"harmonised": hc.agreement_metrics(gn.pred, gn.V),
                                       "raw": hc.agreement_metrics(gn.raw, gn.V)}
    # scatter sample (1-degree cell-months where both sensors detected fire, as in the reference figure)
    pos = g1[(g1.raw > 0) & (g1.V > 0)]
    s = pos.sample(min(2500, len(pos)), random_state=42)
    out["scatter_1deg"] = {"modis_raw": s.raw.astype(int).tolist(), "modis_harmonised": s.pred.round(1).tolist(),
                           "viirs": s.V.astype(int).tolist(), "n_total_pairs": int(len(pos))}
    out["national_series"] = {"m": gn.m.astype(int).tolist(), "modis_raw": gn.raw.astype(int).tolist(),
                              "modis_harmonised": gn.pred.round(0).tolist(), "viirs": gn.V.astype(int).tolist()}
    return out


def yearly_ratio(cm, overlap_ok):
    ov = cm[cm.m.isin(overlap_ok)]
    g = ov.assign(year=BASE_YEAR + ov.m // 12).groupby("year")[["T", "A", "V"]].sum()
    return {"year": g.index.astype(int).tolist(),
            "ratio_TA": (g["V"] / (g["T"] + g["A"])).round(3).tolist(), "ratio_T": (g["V"] / g["T"]).round(3).tolist(),
            "viirs": g["V"].astype(int).tolist(), "modis_TA": (g["T"] + g["A"]).astype(int).tolist()}


def table_json(t):
    return [{"band": float(b), "lat_range": [float(b), float(b) + 1], "n_cell_months": int(r.n_cell_months),
             "n_pairs": int(r.n_pairs), "modis_sum": float(round(r.modis_sum, 1)), "viirs_sum": float(round(r.viirs_sum, 1)),
             "ratio": None if pd.isna(r.ratio) else round(float(r.ratio), 4),
             "upstream_median_pair_ratio": None if pd.isna(r.median_pair_ratio) else round(float(r.median_pair_ratio), 4)}
            for b, r in t.iterrows()]


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--out", default="site/data")
    a = ap.parse_args()

    det = load_detections(a.raw)
    last_m = int(firms.month_index([det.acq_date.max()], BASE_YEAR)[0])
    months, spans = month_table(det, last_m)
    cm = cell_months(det)
    print(f"cell-months: {len(cm):,}; cells: {cm[['row', 'col']].drop_duplicates().shape[0]:,}")

    # Overlap months usable for ratio fitting: VIIRS era, and all three satellites complete
    mt = months.set_index("m")
    overlap_ok = mt[(mt.source == "V") & (mt.V_missing < INCOMPLETE_MISSING_DAYS)
                    & (mt.T_missing < INCOMPLETE_MISSING_DAYS) & (mt.A_missing < INCOMPLETE_MISSING_DAYS)].index
    ratios = fit_ratios(cm[cm.m.isin(overlap_ok)])
    src = mt["source"].to_dict()
    cm["h"] = hc.fuse(cm, src, {k: ratios["count"][k] for k in ("TA", "T")}, ratios["count"]["fallback"])
    cmf = cm.rename(columns={"T": "Tc", "A": "Ac", "V": "Vc", "Tf": "T", "Af": "A", "Vf": "V"})
    cm["hf"] = hc.fuse(cmf, src, {k: ratios["frp"][k] for k in ("TA", "T")}, ratios["frp"]["fallback"])
    cm = cm[cm.h.notna()]

    # ---- tiles ----
    cm["cell_id"] = firms.cell_id(cm.row, cm.col)
    cm["tile"] = firms.tile_id(cm.lat, cm.lon)
    tiles_meta = []
    tdir = os.path.join(a.out, "tiles")
    if os.path.isdir(tdir):
        for f in glob.glob(os.path.join(tdir, "*.json")):
            os.remove(f)
    for tid, t in cm.groupby("tile"):
        cells = t.drop_duplicates("cell_id").sort_values("cell_id")[["cell_id", "lat", "lon"]].reset_index(drop=True)
        idx = pd.Series(cells.index, index=cells.cell_id)
        t = t.sort_values(["m", "cell_id"])
        obj = {"schema": SCHEMA_VERSION, "tile": tid,
               "cells": {"id": cells.cell_id.tolist(), "lat": cells.lat.round(3).tolist(), "lon": cells.lon.round(3).tolist()},
               "rec": {"c": t.cell_id.map(idx).astype(int).tolist(), "m": t.m.astype(int).tolist(),
                       "h": t.h.round(1).tolist(), "f": t.hf.round(1).tolist(),
                       "mo": (t["T"] + t["A"]).astype(int).tolist(), "vi": t["V"].astype(int).tolist()}}
        size = write_json(os.path.join(tdir, f"{tid}.json"), obj)
        la, lo = [int(x) for x in tid[1:].split("_")]
        tiles_meta.append({"id": tid, "bbox": [lo, la, lo + firms.TILE_DEG, la + firms.TILE_DEG],
                           "cells": len(cells), "records": len(t), "bytes": size})

    # ---- cells index (map layer) ----
    full = [int(y) for y in sorted(months.year.unique()) if (months[(months.year == y)].source.notna().all())]
    cy = cm[(BASE_YEAR + cm.m // 12).isin(full)].groupby("cell_id").agg(lat=("lat", "first"), lon=("lon", "first"),
                                                                         tile=("tile", "first"), h=("h", "sum"))
    allc = cm.groupby("cell_id").agg(lat=("lat", "first"), lon=("lon", "first"), tile=("tile", "first"))
    allc["mean_annual"] = (cy.h / len(full)).reindex(allc.index).fillna(0).round(2)
    write_json(os.path.join(a.out, "cells.json"),
               {"schema": SCHEMA_VERSION, "years_for_mean": [full[0], full[-1]], "id": allc.index.tolist(),
                "lat": allc.lat.round(3).tolist(), "lon": allc.lon.round(3).tolist(),
                "tile": allc.tile.tolist(), "mean_annual": allc.mean_annual.tolist()})

    # ---- validation ----
    val = {"generated": dt.date.today().isoformat(), "kind": "real",
           "description": "NASA FIRMS MODIS (Terra+Aqua) vs VIIRS S-NPP, India, monthly hotspot counts, holdout evaluation",
           "holdout": holdout(cm, months, overlap_ok), "yearly_ratio": yearly_ratio(cm, overlap_ok),
           "ratio_tables": {"count_TA": table_json(ratios["count"]["TA"]), "count_T": table_json(ratios["count"]["T"])},
           "fallback": ratios["count"]["fallback"]}
    write_json(os.path.join(a.out, "validation", "real_harmonisation.json"), val)

    # ---- manifest ----
    first_m = int(months[months.source.notna()].m.min())
    fy, fm = ym(first_m); ly, lm = ym(last_m)
    manifest = {
        "schema": SCHEMA_VERSION, "generated": dt.date.today().isoformat(), "dataset": "real",
        "title": "Harmonised monthly fire hotspot counts, India (NASA FIRMS MODIS + VIIRS S-NPP)",
        "base_year": BASE_YEAR, "grid_deg": firms.GRID_DEG, "tile_deg": firms.TILE_DEG,
        "coverage": {"start": f"{fy}-{fm:02d}", "end": f"{ly}-{lm:02d}",
                     "bbox": [float(cm.lon.min() - .125), float(cm.lat.min() - .125), float(cm.lon.max() + .125), float(cm.lat.max() + .125)],
                     "years": list(range(BASE_YEAR, int(ly) + 1)), "n_cells": int(len(allc)), "n_records": int(len(cm))},
        "months": {"m": months.m.tolist(), "source": [s if isinstance(s, str) else None for s in months.source],
                   "missing_days": months.missing_days.tolist(), "complete": months.complete.tolist()},
        "sensor_spans": {k: [v[0].date().isoformat(), v[1].date().isoformat()] for k, v in spans.items()},
        "tiles": tiles_meta,
        "ratios": {"count": {"fallback_TA": round(ratios["count"]["fallback"]["TA"], 4),
                             "fallback_T": round(ratios["count"]["fallback"]["T"], 4)},
                   "frp": {"fallback_TA": round(ratios["frp"]["fallback"]["TA"], 4),
                           "fallback_T": round(ratios["frp"]["fallback"]["T"], 4)}},
        "metrics": {
            "h": {"label": "Harmonised hotspot count", "unit": "hotspots",
                  "definition": "Vegetation-fire detections (nominal/high confidence) per cell-month in VIIRS S-NPP-equivalent units. VIIRS months: VIIRS count. Earlier months: MODIS count x latitude-band ratio."},
            "f": {"label": "Harmonised fire radiative power", "unit": "MW (summed)",
                  "definition": "Sum of per-detection FRP per cell-month, VIIRS-equivalent (MODIS scaled by latitude-band FRP ratio). FRP sums are an energy proxy, not counts."},
            "mo": {"label": "MODIS raw count", "unit": "hotspots", "definition": "Terra+Aqua detections, unscaled."},
            "vi": {"label": "VIIRS S-NPP raw count", "unit": "hotspots", "definition": "VIIRS S-NPP 375 m detections, unscaled."}},
        "filters": {"type": "0 (presumed vegetation fire) only", "modis_confidence": f">= {firms.MODIS_MIN_CONF}",
                    "viirs_confidence": "nominal or high (drops 'l')"},
        "semantics": {"absent_record": "Within a covered month, a cell with no record had zero detected hotspots (FIRMS archives list every detection). This is 'no detection', which can also mean cloud/smoke obscuration.",
                      "source_null": "Month outside satellite coverage: no data, not zero.",
                      "incomplete": f"Month with >= {INCOMPLETE_MISSING_DAYS} days of satellite outage (detected from cross-sensor evidence); shown but excluded from baselines."},
        "provenance": {"source": "NASA FIRMS yearly country archives (India)",
                       "urls": ["https://firms.modaps.eosdis.nasa.gov/data/country/modis/<year>/modis_<year>_India.csv",
                                "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/<year>/viirs-snpp_<year>_India.csv"],
                       "citation": "NASA FIRMS: MODIS Collection 6.1 (MCD14ML) and VIIRS 375 m (VNP14IMGTDL_NRT/VNP14IMG) active fire products. https://earthdata.nasa.gov/firms",
                       "pipeline": "pipeline/build_dataset.py"},
    }
    write_json(os.path.join(a.out, "manifest.json"), manifest)
    tot = sum(t["bytes"] for t in tiles_meta)
    print(f"tiles: {len(tiles_meta)}, {tot/1e6:.1f} MB total, largest {max(t['bytes'] for t in tiles_meta)/1e6:.2f} MB")
    print("fallback ratios", ratios["count"]["fallback"], ratios["frp"]["fallback"])
    print(json.dumps(val["holdout"]["levels"], indent=1)[:3000])
    print(months[~months.complete & months.source.notna()][["year", "month", "source", "missing_days"]].to_string())


if __name__ == "__main__":
    main()
