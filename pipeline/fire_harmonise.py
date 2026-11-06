"""MODIS-VIIRS harmonisation + anomaly detection (MVP).

ASSUMPTIONS (choices we made, NOT validated results):
 - VIIRS is the reference sensor; MODIS is scaled to VIIRS-equivalent units.
 - Ratio = median of per-cell-week VIIRS/MODIS, using only weeks where BOTH sensors
   have a record. Ratio may differ by latitude band; too few pairs -> global fallback.
 - Absent rows are treated as missing, NOT as zero.
 - Baseline = same week-of-year +-2 weeks, from OTHER years only, on a log1p scale.
"""
import warnings
import numpy as np
import pandas as pd

REQUIRED = ["date", "cell_id", "latitude", "longitude", "sensor", "activity"]


# ---------- loading (kept separate from processing) ----------
def load_weekly(path):
    d = pd.read_csv(path, parse_dates=["date"])
    missing = [c for c in REQUIRED if c not in d.columns]
    assert not missing, f"Missing columns: {missing}"
    return d

def load_many(paths):
    """Combine several files, e.g. one MODIS file + one VIIRS file."""
    return pd.concat([load_weekly(p) for p in paths], ignore_index=True)


# ---------- calibration ----------
def make_wide(df_long):
    return df_long.pivot_table(index=["cell_id", "date"], columns="sensor", values="activity")

def estimate_ratio(wide_df, min_activity=1e-6):
    both = wide_df.dropna(subset=["MODIS", "VIIRS"])
    both = both[(both["MODIS"] > min_activity) & (both["VIIRS"] > min_activity)]
    return {"n_pairs": len(both),
            "ratio_of_sums": both["VIIRS"].sum() / both["MODIS"].sum(),
            "median_ratio": (both["VIIRS"] / both["MODIS"]).median()}

def make_group_map(df_long, band_deg=1.0):
    """Map each cell_id to a latitude band label."""
    lat = df_long.drop_duplicates("cell_id").set_index("cell_id")["latitude"]
    edges = np.arange(np.floor(lat.min()), np.ceil(lat.max()) + band_deg, band_deg)
    return pd.cut(lat, bins=edges, include_lowest=True).astype(str)

def estimate_ratio_by_group(wide_df, group_map, min_pairs=30):
    both = wide_df.dropna(subset=["MODIS", "VIIRS"]).reset_index()
    both = both[(both["MODIS"] > 0) & (both["VIIRS"] > 0)]
    both["group"] = both["cell_id"].map(group_map)
    rows = []
    for g, sub in both.groupby("group"):
        n = len(sub)
        r = (sub["VIIRS"] / sub["MODIS"]).median() if n >= min_pairs else np.nan
        rows.append({"group": g, "n_pairs": n, "ratio": r})
    return pd.DataFrame(rows).set_index("group")

def harmonise_by_group(df_long, ratios, group_map, fallback_ratio):
    out = df_long.copy()
    grp = out["cell_id"].map(group_map)
    r = grp.map(ratios["ratio"]).fillna(fallback_ratio)
    out["ratio_used"] = np.where(out["sensor"] == "MODIS", r, 1.0)
    out["activity_harmonised"] = out["activity"] * out["ratio_used"]
    return out


# ---------- baselines and anomalies ----------
def add_time_columns(h):
    h = h.copy()
    h["logv"] = np.log1p(h["activity_harmonised"])
    h["year"] = h["date"].dt.year
    h["woy"] = np.minimum((h["date"].dt.dayofyear - 1) // 7 + 1, 52).astype("int64")
    return h

def build_baseline(hist, half_window=2, min_samples=4):
    parts = []
    for off in range(-half_window, half_window + 1):
        p = hist[["cell_id", "sensor", "woy", "logv"]].copy()
        p["woy"] = ((p["woy"] - 1 + off) % 52 + 1).astype("int64")
        parts.append(p)
    pooled = pd.concat(parts)
    b = (pooled.groupby(["cell_id", "sensor", "woy"])["logv"]
               .agg(["mean", "std", "count"]).reset_index())
    b.columns = ["cell_id", "sensor", "woy", "base_mean", "base_std", "base_n"]
    b.loc[b["base_n"] < min_samples, ["base_mean", "base_std"]] = np.nan
    return b

def score_anomalies(h, half_window=2, min_samples=4, min_std=0.05):
    """Z-score each row against a baseline built from the OTHER years only."""
    out = []
    for yr in sorted(h["year"].unique()):
        b = build_baseline(h[h["year"] != yr], half_window, min_samples)
        t = h[h["year"] == yr].merge(b, on=["cell_id", "sensor", "woy"], how="left")
        ok = t["base_std"] >= min_std
        t["z"] = np.where(ok, (t["logv"] - t["base_mean"]) / t["base_std"], np.nan)
        out.append(t)
    return pd.concat(out, ignore_index=True)


# ---------- export + full pipeline ----------
def export_for_frontend(scored, path, z_threshold=3.0):
    e = scored.copy()
    e["flag"] = e["z"] > z_threshold
    e["baseline_activity"] = np.expm1(e["base_mean"])
    e["upper_band"] = np.expm1(e["base_mean"] + z_threshold * e["base_std"])
    e = e.rename(columns={"activity": "activity_raw", "z": "z_score"})
    cols = ["date", "cell_id", "latitude", "longitude", "sensor", "activity_raw",
            "activity_harmonised", "ratio_used", "baseline_activity", "upper_band",
            "z_score", "flag"]
    e = e[cols].sort_values(["date", "cell_id", "sensor"])
    e.to_csv(path, index=False)
    return e

def run_pipeline(data, out_path="fire_anomalies.csv", band_deg=1.0,
                 min_pairs=30, z_threshold=3.0):
    assert {"MODIS", "VIIRS"} <= set(data["sensor"].unique()), \
        "Need BOTH MODIS and VIIRS rows (check the files are not duplicates)"
    wide = make_wide(data)
    global_ratio = estimate_ratio(wide)["median_ratio"]
    group_map = make_group_map(data, band_deg)
    ratios = estimate_ratio_by_group(wide, group_map, min_pairs)
    harm = harmonise_by_group(data, ratios, group_map, global_ratio)
    h = add_time_columns(harm)
    if h["year"].nunique() < 2:
        warnings.warn("Only one year of data: baselines need at least 2 years.")
    scored = score_anomalies(h)
    e = export_for_frontend(scored, out_path, z_threshold)
    return {"global_ratio": global_ratio, "group_ratios": ratios,
            "scored": scored, "export": e}
