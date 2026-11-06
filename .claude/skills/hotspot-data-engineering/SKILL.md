---
name: hotspot-data-engineering
description: Use when changing HotSpot Sync's offline data pipeline (pipeline/*.py) or the JSON in site/data — FIRMS inputs, filters, gridding, MODIS/VIIRS harmonisation, monthly aggregation, tile partitioning, manifest fields, provenance or missing-data semantics.
---

# HotSpot data engineering

## Inputs
- NASA FIRMS yearly country CSVs in `data/raw/` (git-ignored, from `data/raw/download.sh`). MODIS columns are `latitude, longitude, acq_date, satellite (Terra|Aqua), confidence (0-100), frp, type`. VIIRS has `confidence` in `l|n|h` and `satellite = N`.
- Rows are **detections only**. Profile with `python3 pipeline/profile_raw.py`; never load raw CSVs into context.

## Rules that must hold
1. Filters (`firms.py`): `type == 0`, MODIS conf ≥ 30, VIIRS not `l`.
2. Grid: 0.25° cells, lower-left-anchored id `N{lat*100:04}E{lon*100:05}`, centre = corner + 0.125. Tiles: 5°, id `tLL_LLL`.
3. Harmonisation (`harmonise_counts.py`): VIIRS is the reference; ratio = Σ V / Σ M per 1° latitude band on complete overlap months; national fallback; separate Terra-only ratio before Aqua (2002-07-04).
4. Fusion: one source per month (`T` → `TA` → `V`). **Never sum MODIS and VIIRS.** In VIIRS months, `h == vi`.
5. Semantics: absent record within coverage = 0 detections. `source = null` = no data. `complete = false` = outage month (rule in `firms.missing_days` plus `KNOWN_OUTAGES`).
6. `pipeline/fire_harmonise.py` is upstream and must stay unchanged. Reuse it (see `build_validation.py`); never edit it.

## Changing the schema
- Bump `SCHEMA_VERSION` in `build_dataset.py`. Update `site/js/data/schema.js` (it rejects malformed input) and `tests/python/test_pipeline.py::test_manifest_and_tiles_are_consistent`.
- Tile record arrays are columnar (`c, m, h, f, mo, vi`) and must have equal lengths. Keep the total tile size modest (currently ~8.5 MB raw for all of India).

## Verify
`python3 pipeline/build_dataset.py && python3 pipeline/build_validation.py && python3 -m pytest -q tests/python`
