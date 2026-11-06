"""Validation datasets for the frontend.

1. SYNTHETIC: the supplied fire_anomalies_SYNTHETIC.csv (output of the upstream pipeline on synthetic data).
2. REAL weekly FRP: the upstream fire_harmonise.run_pipeline (unchanged) applied to real FIRMS data,
   aggregated to 1-degree cell-weeks for the MODIS/VIIRS overlap period.

Usage: python pipeline/build_validation.py [--raw data/raw] [--out site/data/validation]
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import build_dataset as bd  # noqa: E402
import fire_harmonise as fh  # noqa: E402
import harmonise_counts as hc  # noqa: E402

Z = 3.0


def lower_band(base, upper, z=Z):
    """Upstream exports baseline and upper = expm1(mean + z*sd); recover the symmetric lower bound."""
    lb, lu = np.log1p(base), np.log1p(upper)
    sd = (lu - lb) / z
    return np.clip(np.expm1(lb - z * sd), 0, None)


def pairs_and_metrics(e):
    w = e.pivot_table(index=["cell_id", "date"], columns="sensor", values=["activity_raw", "activity_harmonised"])
    w = w.dropna()
    raw_m, harm_m, v = w[("activity_raw", "MODIS")], w[("activity_harmonised", "MODIS")], w[("activity_raw", "VIIRS")]
    return raw_m, harm_m, v


def series_for_cells(e, cells, sensor="VIIRS"):
    out = {}
    for cid in cells:
        s = e[(e.cell_id == cid) & (e.sensor == sensor)].sort_values("date")
        lo = lower_band(s.baseline_activity, s.upper_band)
        out[cid] = {"lat": float(s.latitude.iloc[0]), "lon": float(s.longitude.iloc[0]),
                    "date": s.date.dt.strftime("%Y-%m-%d").tolist(),
                    "activity": s.activity_harmonised.round(2).tolist(),
                    "baseline": [None if pd.isna(x) else round(float(x), 2) for x in s.baseline_activity],
                    "upper": [None if pd.isna(x) else round(float(x), 2) for x in s.upper_band],
                    "lower": [None if pd.isna(x) else round(float(x), 2) for x in lo],
                    "z": [None if pd.isna(x) else round(float(x), 2) for x in s.z_score],
                    "flag": s.flag.astype(bool).tolist()}
    return out


def package(e, kind, description, cells, ratios=None, sample=2500):
    raw_m, harm_m, v = pairs_and_metrics(e)
    idx = np.random.default_rng(42).permutation(len(v))[:sample]
    scored = e[e.z_score.notna()]
    obj = {"kind": kind, "description": description, "metric": "FRP (MW, summed per cell-week)",
           "n_rows": int(len(e)), "n_cells": int(e.cell_id.nunique()),
           "date_range": [e.date.min().strftime("%Y-%m-%d"), e.date.max().strftime("%Y-%m-%d")],
           "metrics": {"raw": hc.agreement_metrics(raw_m, v), "harmonised": hc.agreement_metrics(harm_m, v)},
           "scatter": {"modis_raw": raw_m.iloc[idx].round(2).tolist(), "modis_harmonised": harm_m.iloc[idx].round(2).tolist(),
                       "viirs": v.iloc[idx].round(2).tolist(), "n_total_pairs": int(len(v))},
           "anomaly_summary": {"n_scored": int(len(scored)), "n_flagged": int(scored.flag.sum()),
                               "flag_rate": float(scored.flag.mean()) if len(scored) else None,
                               "n_unscored": int(e.z_score.isna().sum()), "z_threshold": Z},
           "cells": series_for_cells(e, cells)}
    if ratios is not None:
        obj["group_ratios"] = [{"group": str(g), "n_pairs": int(r.n_pairs), "ratio": None if pd.isna(r.ratio) else round(float(r.ratio), 4)}
                               for g, r in ratios.iterrows()]
    return obj


def synthetic(path):
    e = pd.read_csv(path, parse_dates=["date"])
    e["flag"] = e["flag"].astype(bool)
    cells = sorted(e.cell_id.unique())
    return package(e, "synthetic", "Supplied synthetic test output of fire_harmonise.py (planted ratios 1.8 south / 1.4 north, planted 4x spikes). Code check only - NOT scientific validation.", cells)


def real_weekly(raw, derived_dir, n_cells=30):
    det = bd.load_detections(raw)
    det = det[det.acq_date >= "2012-02-01"]
    det["sensor"] = np.where(det.sat == "V", "VIIRS", "MODIS")
    det["date"] = det.acq_date.dt.to_period("W-SUN").dt.start_time
    det["la"], det["lo"] = np.floor(det.latitude), np.floor(det.longitude)
    w = det.groupby(["la", "lo", "date", "sensor"])["frp"].sum().reset_index()
    w["cell_id"] = [f"N{int(a):02d}E{int(o):03d}" for a, o in zip(w.la, w.lo)]
    w["latitude"], w["longitude"] = w.la + 0.5, w.lo + 0.5
    w = w.rename(columns={"frp": "activity"})[fh.REQUIRED]
    os.makedirs(derived_dir, exist_ok=True)
    res = fh.run_pipeline(w, out_path=os.path.join(derived_dir, "fire_anomalies_REAL_weekly_frp.csv"))
    e = res["export"]
    # cells with the most scored VIIRS weeks
    v = e[(e.sensor == "VIIRS") & e.z_score.notna()]
    top = v.groupby("cell_id").size().sort_values(ascending=False).head(n_cells).index.tolist()
    obj = package(e, "real", "Upstream fire_harmonise.run_pipeline (unchanged) on NASA FIRMS India, weekly FRP per 1-degree cell, Feb 2012 - Dec 2025.",
                  sorted(top), ratios=res["group_ratios"])
    obj["global_ratio"] = float(res["global_ratio"])
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw")
    ap.add_argument("--synthetic", default="project-inputs/fire_anomalies_SYNTHETIC.csv")
    ap.add_argument("--out", default="site/data/validation")
    ap.add_argument("--derived", default="data/derived")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name, obj in (("synthetic_weekly_frp.json", synthetic(a.synthetic)),
                      ("real_weekly_frp.json", real_weekly(a.raw, a.derived))):
        path = os.path.join(a.out, name)
        with open(path, "w") as f:
            json.dump(obj, f, separators=(",", ":"), allow_nan=False)
        print(name, f"{os.path.getsize(path)/1e3:.0f} KB", json.dumps(obj["metrics"]), obj["anomaly_summary"])


if __name__ == "__main__":
    main()
