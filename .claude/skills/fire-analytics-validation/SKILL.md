---
name: fire-analytics-validation
description: Use when changing or interpreting HotSpot Sync statistics — monthly aggregation, historical median comparison, anomaly detection, seasonal shares, trends, KPIs — or the MODIS/VIIRS validation charts and scientific limitations text.
---

# Fire analytics and validation

## Invariants
- Work on the region series from `buildSeries` (statuses `nodata | incomplete | zero | ok`). `isComplete` = ok|zero. `isBaselineEligible` = complete and not Terra-only.
- **Baselines exclude the target year**, use only eligible months, and use the whole archive (not the date filter).
- **Anomaly** (`analytics/anomaly.js`): modified z on log1p; scale = max(1.4826·MAD, 1.2533·meanAD if MAD = 0, 0.25); flag at |z| ≥ 3.5 with an absolute difference ≥ 10 hotspots / 50 MW; fewer than 5 refs → `insufficient`. Never label an unscored month "normal".
- **Comparison**: skip incomplete latest months (and say so). Percentage change only when the median > 0. "Latest available month" ≠ "current month".
- **Seasonal shares** use the per-calendar-month *mean*. The trend is Theil–Sen over complete VIIRS-only years (no sensor mixing).
- **FRP is not a count.** Keep units (`METRICS` in `config.js`).
- Weekly FRP z-scores from the upstream pipeline are validation material. Do not merge them into monthly anomalies.

## Validation material
- `site/data/validation/real_harmonisation.json`: holdout (fit 2012–2018, test 2019–2025) metrics at 0.25°, 1° and national levels, a scatter sample, the yearly ratio, and band ratio tables (ours and upstream median-of-pairs).
- `real_weekly_frp.json` / `synthetic_weekly_frp.json`: upstream `run_pipeline` outputs. Synthetic must always be labelled "code check only".
- Report only statistics that exist in these files. Do not invent accuracy claims; there is no ground-truth validation.

## Tests
Fixtures with hand-checkable answers live in `tests/js/analytics.test.mjs`. Add one for every new rule before changing UI text.
