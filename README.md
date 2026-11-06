# HotSpot Sync — India Fire Activity Explorer

NASA Space Apps Challenge 2026 · MODIS and VIIRS Fire Activity Explorer.

HotSpot Sync turns NASA FIRMS satellite fire detections from MODIS (Terra and Aqua) and VIIRS (Suomi-NPP) into one harmonised monthly record of fire activity across India, from **November 2000 to December 2025**. Draw any region to:

- see its year-by-month **burning calendar**
- compare a month with its **historical median**
- find **anomalous months**
- read **seasonal and critical-period** summaries
- inspect **harmonisation validation** on real data
- **download** the results as CSV, GeoJSON or PNG

It is a fully static site (HTML, CSS, vanilla ES modules, Leaflet, Leaflet.draw, Turf.js and Apache ECharts) built for GitHub Pages.

> Target URL: `https://tanishkax.github.io/hotspot_mvp_prototype/`. It is live only once the Pages workflow below has run.

## Run locally

```bash
python3 -m http.server 8000 --directory site
```

Then open <http://localhost:8000/>. No build step is needed. All libraries and fonts are vendored in `site/vendor/`; only the basemap tiles (CARTO) load from the network.

## Tests

```bash
npm test                                  # JavaScript unit tests (node:test), no install needed
pip install -r pipeline/requirements.txt
python3 -m pytest -q tests/python         # pipeline + dataset integrity
npm i --no-save playwright && npx playwright install chromium
node tests/e2e/smoke.mjs                  # browser end-to-end (serves site/ under /hotspot_mvp_prototype/)
```

## Rebuild the data

```bash
./data/raw/download.sh                    # ~750 MB of NASA FIRMS India archives (MODIS 2000-2025, VIIRS S-NPP 2012-2025)
python3 pipeline/profile_raw.py           # writes docs/data_profile.md
python3 pipeline/build_dataset.py         # site/data/manifest.json, cells.json, tiles/*.json, validation/real_harmonisation.json
python3 pipeline/build_validation.py      # site/data/validation/{real,synthetic}_weekly_frp.json (runs upstream fire_harmonise.py)
```

## Deploy to GitHub Pages

1. Push `main` to `github.com/Tanishkax/hotspot_mvp_prototype`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs all tests and then publishes `site/`.

All asset paths are relative, so the site works under the `/hotspot_mvp_prototype/` project path.

## Repository layout

| Path | Contents |
|---|---|
| `site/` | The deployable static website (`index.html`, `css/`, `js/`, `data/`, `vendor/`, `assets/`) |
| `site/js/analytics/` | Pure analytics: aggregation, anomalies, comparison, seasonal, summary |
| `site/js/geo/`, `site/js/data/`, `site/js/export/` | Selection geometry, data loading and validation, CSV |
| `site/js/charts/`, `site/js/ui/` | ECharts renderers, map, DOM rendering, URL state |
| `pipeline/` | Offline Python data preparation; `fire_harmonise.py` is the supplied upstream pipeline, unchanged |
| `project-inputs/` | Supplied assets (upstream code, README, synthetic CSV, reference figures) |
| `docs/` | `methodology.md`, `data_profile.md` |
| `tests/` | `js/` unit, `python/` pipeline, `e2e/` browser |

## Data and method in brief

- **Metric.** *Harmonised hotspot count*: vegetation-fire detections per 0.25° cell-month in VIIRS-equivalent units. FRP (MW, summed) is offered as a separate metric and is never labelled as a count.
- **Harmonisation.** VIIRS is the reference. Before VIIRS, MODIS is scaled by a per-1°-latitude-band ratio of sums, Σ VIIRS / Σ MODIS. One source is used per month, so nothing is double counted.
- **Missing data.** "No data" (before coverage), "observed zero" and "incomplete" (detected satellite outage) are kept distinct everywhere.
- **Anomalies.** Robust modified z-score on log counts against the same calendar month in other years: |z| ≥ 3.5, at least 5 reference years, and a noise guard.
- **Validation.** On held-out years 2019–2025, harmonised MODIS reproduces VIIRS totals within +3.6% (raw MODIS: −82%), with national monthly r = 0.99.

See [`docs/methodology.md`](docs/methodology.md) for full details and limitations. **These results have not been independently validated against ground truth.**

## Credits

- Fire data: NASA FIRMS (MODIS C6.1, VIIRS 375 m). Basemaps © Esri, HERE, Garmin, © OpenStreetMap contributors.
- Libraries: Leaflet (BSD-2), Leaflet.draw (MIT), Turf.js (MIT), Apache ECharts (Apache-2.0). Fonts: Inter and Space Grotesk (OFL).
