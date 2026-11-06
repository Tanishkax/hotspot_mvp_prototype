# Progress

## Status (2026-11-06)
- [x] Repository and data audit (empty repo; supplied assets in `project-inputs/`; real NASA FIRMS India archives downloaded)
- [x] Pipeline: profile → filter → 0.25° monthly grid → band-ratio harmonisation → sensor-switch fusion → 5° tiles + manifest
- [x] Validation data: real holdout (counts), upstream weekly FRP pipeline on real + synthetic data
- [x] Frontend: map + draw/edit/delete, presets, bounds and polygon entry, period controls, metric toggle, calendar heatmap, KPIs, comparison, anomalies, seasonal insights, annual chart, validation charts, methodology, CSV/GeoJSON/PNG export, share link, table view
- [x] Tests: 26 JS unit tests, 13 Python tests, 48-check Playwright e2e (desktop + mobile)
- [x] Docs, CLAUDE.md, skills, Pages workflow
- [x] Deployed to GitHub Pages: https://tanishkax.github.io/hotspot_mvp_prototype/ (verified with the e2e suite against the live URL)
- [x] Basemap moved to key-free Esri dark canvas and OpenStreetMap (CARTO watermarks public sites)
- [x] UI restructured into four tabs with a shared selection, a context bar and deep links; visual redesign (layered elevation, refined typography); month-in-context panel; raw-vs-harmonised chart for the selection
- [ ] Optional: AI assistant. **Excluded at the user's request.**

## Next ideas (optional)
- Compare two regions side by side; place search; per-cell detail popup on the map.
- Time-varying (per-year) MODIS ratios to address orbital drift; burned-area cross-check.
