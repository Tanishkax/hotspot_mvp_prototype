"""Monthly MODIS -> VIIRS-equivalent harmonisation for hotspot COUNTS (and FRP).

Method (see docs/methodology.md):
  * VIIRS S-NPP is the reference sensor (as in the upstream fire_harmonise.py).
  * The scaling ratio is the RATIO OF SUMS  sum(VIIRS) / sum(MODIS)  over all overlap cell-months in a
    1-degree latitude band. Unlike the upstream median-of-pairs, this keeps cell-months where only one
    sensor detected fire, which is what a regional TOTAL needs. The upstream estimator is reported alongside.
  * Bands with too little evidence fall back to the national ratio.
  * Fusion is SENSOR SWITCHING, never summing: VIIRS where it has complete months, scaled MODIS before.
"""
import numpy as np
import pandas as pd


def band_of(lat, band_deg=1.0):
    return (np.floor(np.asarray(lat) / band_deg) * band_deg).astype(float)


def ratio_of_sums_by_band(cm, modis_col, viirs_col, band_col="band", min_pairs=30, min_modis=200):
    """Per-band ratio sum(V)/sum(M) with an evidence requirement; returns DataFrame indexed by band."""
    g = cm.groupby(band_col)
    both = cm[(cm[modis_col] > 0) & (cm[viirs_col] > 0)].groupby(band_col).size()
    t = pd.DataFrame({"modis_sum": g[modis_col].sum(), "viirs_sum": g[viirs_col].sum()})
    t["n_pairs"] = both.reindex(t.index).fillna(0).astype(int)
    t["n_cell_months"] = g.size()
    enough = (t["n_pairs"] >= min_pairs) & (t["modis_sum"] >= min_modis)
    t["ratio"] = np.where(enough, t["viirs_sum"] / t["modis_sum"].replace(0, np.nan), np.nan)
    t["median_pair_ratio"] = (cm[(cm[modis_col] > 0) & (cm[viirs_col] > 0)]
                              .assign(r=lambda x: x[viirs_col] / x[modis_col])
                              .groupby(band_col)["r"].median()).reindex(t.index)
    return t


def global_ratio(cm, modis_col, viirs_col):
    m = cm[modis_col].sum()
    return float(cm[viirs_col].sum() / m) if m > 0 else np.nan


def apply_ratio(modis_values, bands, ratio_table, fallback):
    r = pd.Series(np.asarray(bands)).map(ratio_table["ratio"]).fillna(fallback).to_numpy()
    return np.asarray(modis_values, dtype=float) * r, r


def fuse(cm, month_source, ratios, fallbacks):
    """Return harmonised value per cell-month row.

    cm: cell-month rows with columns m (month index), band, T, A, V (counts or FRP).
    month_source: dict month index -> 'V' | 'TA' | 'T' | None.
    ratios/fallbacks: dicts keyed by 'TA' and 'T'.
    """
    src = cm["m"].map(month_source)
    out = np.full(len(cm), np.nan)
    v = src == "V"
    out[v.to_numpy()] = cm.loc[v, "V"].to_numpy()
    for key, modis in (("TA", cm["T"] + cm["A"]), ("T", cm["T"])):
        sel = (src == key).to_numpy()
        if sel.any():
            out[sel], _ = apply_ratio(modis[sel], cm.loc[sel, "band"], ratios[key], fallbacks[key])
    return out


def agreement_metrics(pred, obs):
    """Agreement between harmonised MODIS (pred) and VIIRS (obs). Correlation is on log1p values."""
    pred = np.asarray(pred, float); obs = np.asarray(obs, float)
    ok = np.isfinite(pred) & np.isfinite(obs)
    pred, obs = pred[ok], obs[ok]
    if len(pred) < 3:
        return {"n": int(len(pred))}
    lp, lo = np.log1p(pred), np.log1p(obs)
    both = (pred > 0) & (obs > 0)
    return {
        "n": int(len(pred)),
        "pearson_r_log1p": float(np.corrcoef(lp, lo)[0, 1]),
        "pearson_r": float(np.corrcoef(pred, obs)[0, 1]),
        "mean_bias": float(np.mean(pred - obs)),
        "percent_bias": float(100 * (pred.sum() - obs.sum()) / obs.sum()) if obs.sum() else None,
        "mae": float(np.mean(np.abs(pred - obs))),
        "median_ratio_obs_over_pred": float(np.median(obs[both] / pred[both])) if both.any() else None,
        "mean_obs": float(obs.mean()),
    }
