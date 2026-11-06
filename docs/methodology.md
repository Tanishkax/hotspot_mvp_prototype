# Methodology

HotSpot Sync turns NASA FIRMS active-fire detections into a consistent monthly record of fire activity across India, then analyses any region a user draws. This document is the reference for every number on the site. The site's *Methodology and limitations* section summarises it.

## 1. Data

| Item | Value |
|---|---|
| Source | NASA FIRMS yearly country archives for India (`firms.modaps.eosdis.nasa.gov/data/country/...`) |
| MODIS | Collection 6.1, Terra (from 2000-11-01) + Aqua (from 2002-07-04), 1 km |
| VIIRS | Suomi-NPP 375 m (from 2012-01-20) |
| Period | 2000-11 to 2025-12 (302 months) |
| Kept | `type = 0` (presumed vegetation fire); MODIS confidence ≥ 30; VIIRS confidence nominal/high |
| Dropped | static land sources (type 2: industry, gas flares), volcano, offshore, low confidence |

Rows: MODIS 1,845,989 → 1,703,813 kept, and VIIRS 8,223,393 → 5,956,328 kept (see `docs/data_profile.md`).

The archives list detections only. There are no zero rows.

## 2. Gridding and aggregation

Detections are binned by pixel centre into **0.25° cells** (~27 km), anchored at the lower-left corner (`N2650E07725` = 26.50–26.75°N, 77.25–77.50°E). Counts and summed FRP are then aggregated per cell, month and satellite (Terra / Aqua / VIIRS). Overall: 4,619 cells and 399,044 cell-month records.

## 3. Harmonisation of counts (MODIS → VIIRS-equivalent)

VIIRS is the reference sensor, as in the supplied `fire_harmonise.py`. For each **1° latitude band**:

    ratio_band = Σ VIIRS / Σ MODIS     over all overlap cell-months in the band

The overlap is Feb 2012–Dec 2025, using only months in which no satellite had an outage.

- A band needs ≥ 30 cell-months with both sensors > 0 and ≥ 200 MODIS detections. Otherwise it falls back to the national ratio (Terra+Aqua 5.60). 27 of 30 bands have their own ratio.
- A separate **Terra-only** ratio (national 19.3) is used before Aqua existed (Nov 2000–Jul 2002). Terra's morning overpass misses much of the afternoon burning.
- FRP uses the same procedure with its own ratios.

**Why not the upstream median of pairs?** The upstream estimator takes the median of VIIRS/MODIS over cell-weeks where *both* sensors detected fire. That ignores the many cells where only VIIRS detected fire, and the median of a skewed ratio is not the ratio of totals. The site shows regional *totals*, which need a ratio of sums. Run on real weekly FRP, the upstream method gives harmonised totals **+32% above VIIRS**. The ratio of sums on counts gives **+3.6%** on held-out years. Both estimators are reported per band on the validation chart.

## 4. Sensor fusion (no double counting)

Each month takes its value from exactly one source:

| Months | Source of `count_harmonised` |
|---|---|
| 2000-11 … 2002-07 | Terra × Terra-only band ratio |
| 2002-08 … 2012-01 | (Terra + Aqua) × band ratio |
| 2012-02 … 2025-12 | VIIRS S-NPP count (unchanged) |

MODIS and VIIRS are never summed. Raw MODIS and raw VIIRS counts are still published per record for transparency.

## 5. Missing data semantics

| State | Meaning | Display |
|---|---|---|
| observed zero | covered month, no detection in the selection | slate cell |
| no data | before satellite coverage | hatched, never 0 |
| incomplete | ≥ 2 days of satellite outage in the month | value shown with hatching; excluded from baselines and comparisons |
| Terra-only estimate | before Aqua | value shown; not scored and not used as a reference |

**Outage detection.** A satellite-day counts as missing when the satellite has zero detections over all of India, while the 75th percentile of its daily counts in a centred 31-day window is ≥ 10. The documented Terra outage of 2001-06-15 to 2001-07-03 is added explicitly, because a long gap distorts its own rolling window. The rule finds 16 incomplete months, including S-NPP July–August 2022 and July 2024.

## 6. Geographic selection

A cell is selected when its **centre** lies inside the user's rectangle or polygon (`turf.booleanPointInPolygon`, with boundary points included). Only tiles whose bbox intersects the selection are loaded. GeoJSON uses `[longitude, latitude]` throughout.

## 7. Historical comparison

The target is the latest **complete** month in the period, or the month the user clicks. It is compared with the median of the same calendar month across all *other* baseline-eligible years: complete, not Terra-only, same selection. At least 5 years are required. The comparison reports the absolute difference, the percentage difference (only when the median > 0), and the percentile rank. If the period's last month is incomplete, the app compares the most recent complete month and says so.

## 8. Monthly anomalies

This is a modified z-score (Iglewicz & Hoaglin) on `log(1 + value)`:

    z = (log1p(x) − median(log1p(refs))) / max(1.4826·MAD, [1.2533·meanAD if MAD = 0], 0.25)

- `refs` are the same calendar month in other baseline-eligible years. The target year is excluded. Refs are taken from the whole archive, so flags do not depend on the date filter.
- A month is flagged when |z| ≥ 3.5 **and** |x − median| ≥ 10 hotspots (50 MW for FRP), with ≥ 5 reference years.
- Otherwise the month is *normal*. If any of these preconditions is not met, it is *not scored*, never silently called normal.

The weekly FRP z > 3 anomalies from the upstream pipeline are a separate product. They are shown in the validation section and never mixed into monthly counts.

## 9. Seasonal analysis

For each calendar month the app takes the **mean** over complete months in the period. Shares are mean_m / Σ mean, so periods with uneven month coverage are not biased. Seasons follow the IMD definition: Winter Jan–Feb, Pre-monsoon Mar–May, Monsoon Jun–Sep, Post-monsoon Oct–Dec. The critical period is the 3-month window (wrapping Dec→Jan) with the largest share. The trend is a Theil–Sen slope over complete **VIIRS-only** years (≥ 5), so it never crosses the sensor boundary.

## 10. Validation (real holdout)

Ratios were fitted on 2012–2018 and evaluated on 2019–2025:

| Level | n | r (log1p) raw → harm. | Total bias raw → harm. | MAE raw → harm. |
|---|---|---|---|---|
| 0.25° cell-month | 140,537 | 0.748 → 0.693 | −82.0% → +3.6% | 15.7 → 11.3 |
| 1° cell-month | 17,950 | 0.876 → 0.849 | −82.0% → +3.6% | 121.7 → 57.4 |
| All-India month | 67 | 0.992 → 0.992 | −82.0% → +3.6% | 32,537 → 4,857 |

Harmonisation removes the level bias and roughly halves the error at regional scale. Cell-level agreement is limited: correlation on log1p *drops* slightly because a constant ratio inflates small-count noise. Monthly values for individual 0.25° cells before 2012 should therefore be read as indicative. The VIIRS/MODIS ratio varies by year (about 5.1–6.0), which reflects inter-annual and orbital-drift effects that a single ratio cannot capture.

## 11. Known limitations

The limitations of the upstream pipeline are preserved:

- tested on synthetic data only;
- median-of-pairs bias;
- latitude bands mixing regions;
- absence ≠ zero for weekly files;
- small baselines with false alarms of about 2.5–3% on synthetic data.

Additional limitations:

- No ground-truth validation. Detections are not burned area, and cloud, smoke, canopy and small fires reduce detection.
- Values before 2012 are model-based estimates. Terra-only months are the least certain.
- Centroid selection is accurate to about half a cell at region edges.
- The India extent follows the FIRMS country subset. Basemap borders are not authoritative.
