# HotSpot Sync — project memory

**Objective.** A static GitHub Pages site for exploring harmonised MODIS and VIIRS fire hotspot activity across India (NASA Space Apps 2026). Core loop: select a region and period → calendar heatmap, KPIs, historical comparison, anomalies, seasonal insights, validation, exports.

## Stack and architecture

- Frontend: vanilla ES modules, no build step. Leaflet, Leaflet.draw, Turf, ECharts and fonts are **vendored** in `site/vendor/` (globals `L`, `turf`, `echarts`).
- Data: static JSON in `site/data/`, made offline by Python in `pipeline/`.
- Flow: FIRMS CSV → `build_dataset.py` → `manifest.json` + `cells.json` + `tiles/tYY_XXX.json` (5° tiles of 0.25° cells) → `DataStore` (cached fetch) → `selectCellsInTile` → `aggregateMonthly` → `buildSeries` → analytics → charts.
- Pure modules (unit tested, no DOM): `site/js/analytics/*`, `geo/selection.js`, `data/schema.js`, `data/loader.js`, `export/csv.js` (except the download helpers).
- DOM / chart modules: `ui/*`, `charts/*`, `main.js` (state + wiring). `window.hotspotSync` exposes `{state, ctx, charts}` for e2e tests. `ctx.renders` increments after each render.
- **Tabs** (`ui/tabs.js`): four panels, Explore, Insights, Validation and Methodology, in one page. The URL is `#/<tab>?r=YYYY-MM,YYYY-MM&k=h|f&b=w,s,e,n` (or `&p=lon lat;…`) via `ui/hash.js`; legacy `#r=…` links open Explore. Tab links always carry the full state, so navigation is a plain hash change (`hashchange` → `goTab`), and Back/Forward work.
- `render()` draws the shared chrome (context bar, tab links, downloads), then **only the active tab** (`renderExplore` / `renderInsights` / `renderValidation`). Switching tabs re-renders that tab, so charts never initialise at zero size. The map re-fits on `mapApi.refresh()` when Explore is shown, because a fit requested while hidden is deferred.
- Content ownership (no duplication): Explore has the map, controls, KPIs, calendar and a month-in-context panel. Insights has the full comparison, anomalies, seasonal insights and annual trends. Validation has the sensor explainer, a raw-vs-harmonised chart for the selection, and the holdout and upstream FRP panels. Methodology has text from the manifest.

## Data definitions (do not blur these)

- `h` = harmonised hotspot **count** (VIIRS-equivalent); `f` = harmonised FRP (MW, summed); `mo` / `vi` = raw MODIS (T+A) / raw VIIRS counts.
- Month index `m` = months since Jan 2000 (`manifest.base_year`). `manifest.months.source[m]` ∈ `T`, `TA`, `V`, or `null` (no data). `complete[m]` is false for outage months.
- Within coverage, an absent cell-month record = 0 detections. Outside coverage = no data. Series status: `nodata | incomplete | zero | ok`.
- Fusion is sensor switching, never summing. Terra-only (`T`) months are not scored and not used as baselines.
- Anomaly statuses: `high | low | normal | insufficient | incomplete | lowconf | nodata`. Constants live in `site/js/config.js`.
- `pipeline/fire_harmonise.py` must stay byte-identical to `project-inputs/fire_harmonise.py` (a test enforces this).

## Commands

```bash
python3 -m http.server 8000 --directory site      # run
npm test                                         # JS unit tests
python3 -m pytest -q tests/python                # pipeline + dataset tests
node tests/e2e/smoke.mjs [--shots DIR]           # browser e2e (needs playwright)
./data/raw/download.sh && python3 pipeline/build_dataset.py && python3 pipeline/build_validation.py   # rebuild data
```

## Conventions

- GeoJSON is `[lon, lat]`. Leaflet is `[lat, lng]`. Convert only in `ui/map.js`.
- Use relative paths only (`./data/`, `vendor/...`). The site is served under `/hotspot_mvp_prototype/`.
- Never hard-code analytical results in the UI. All text is computed from data or the manifest.
- Keep new analytics pure and add a node test with a hand-checkable fixture (`tests/js/fixtures.mjs`).
- Dark theme tokens are in `site/css/styles.css :root`. Chart colours are in `charts/theme.js` (Viridis for magnitude; MODIS blue, VIIRS orange, harmonised aqua).
- Raw data (`data/raw/*.csv`, ~750 MB) and `data/derived/` are git-ignored.

## Deployment

`.github/workflows/pages.yml` runs the tests on push to `main`, then uploads `site/` to Pages. The repository needs **Settings → Pages → Source: GitHub Actions**.

See `PROGRESS.md` for status and next steps, and `docs/methodology.md` for the science.
