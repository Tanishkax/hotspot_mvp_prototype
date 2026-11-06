# MODIS-VIIRS Harmonisation + Anomaly Detection (MVP)

**Status: tested on SYNTHETIC data only. No scientific validation has been done yet.**

## Run on real data

    import fire_harmonise as fh
    data = fh.load_many(["modis_file.csv", "viirs_file.csv"])  # date, cell_id, latitude, longitude, sensor, activity
    res = fh.run_pipeline(data, out_path="fire_anomalies.csv")

Needs MODIS and VIIRS for the SAME cells and weeks, and at least 2 years of data for baselines.

## Output columns (fire_anomalies.csv)
- activity_raw: summed FRP (MW) per cell-week, as received
- activity_harmonised: MODIS scaled to VIIRS-equivalent; VIIRS unchanged
- ratio_used: scaling factor applied (1.0 for VIIRS)
- baseline_activity / upper_band: typical value and z>3 ceiling, in MW
- z_score: distance from baseline in log units (empty = no baseline, NOT zero)
- flag: True when z_score > 3

## Assumptions (choices we made, not validated)
- VIIRS is the reference sensor.
- Ratio = median per-cell-week VIIRS/MODIS from weeks where both sensors have a record.
- One ratio per 1-degree latitude band; too few pairs falls back to the global ratio.
- Absent rows are treated as missing, not as zero fire.
- Baseline = same week-of-year +-2 weeks, other years only, log1p scale.

## Known limitations
- A latitude band can mix regions with different true ratios (the 22-23 band in the test).
- Ratio uses only weeks where BOTH sensors detected fire; VIIRS-only detections are excluded, which probably biases the ratio.
- Real files contain only detection weeks, so "no row" cannot separate no fire from no coverage or cloud.
- With 2 years, each baseline has about 5 samples; spikes in one year inflate the other year's baseline.
- z > 3 on small baselines gave about 2.5% false alarms in the synthetic test.

## What the synthetic test showed (code check only)
- Recovered planted ratios (1.8 south, 1.4 north) per latitude band.
- Flagged 85% of planted 4x spikes.
