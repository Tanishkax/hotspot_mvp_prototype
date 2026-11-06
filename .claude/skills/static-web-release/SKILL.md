---
name: static-web-release
description: Use when preparing, testing or deploying the HotSpot Sync static site to GitHub Pages — asset paths, vendored libraries, performance, responsive and browser checks, and the Pages workflow.
---

# Static web release

1. **Paths.** Everything is relative (`./data/`, `vendor/…`, `assets/…`). Never use a leading `/`. The e2e test serves `site/` under `/hotspot_mvp_prototype/` to catch path bugs. `site/.nojekyll` must exist.
2. **Dependencies.** Libraries are vendored and pinned: Leaflet 1.9.4, Leaflet.draw 1.0.4, ECharts 5.6.0, Turf 7.2.0, plus woff2 fonts. To upgrade, `npm pack <pkg>@<ver>` and copy `dist` files. No CDN is needed at runtime except basemap tiles (Esri dark grey canvas, OpenStreetMap; no API key). CARTO tiles now show an "API key required" watermark, so do not use them.
3. **Checks before release.**
   - `npm test && python3 -m pytest -q tests/python && node tests/e2e/smoke.mjs --shots <dir>`
   - The e2e test asserts: no console errors or failed requests, all interactions, CSV and PNG downloads, no horizontal scroll on iPhone 13, and hash restore.
   - Look at the screenshots (desktop calendar, validation, mobile). Tests do not check visual quality.
4. **Performance.** All-India loads 27 tiles (~8.5 MB raw, ~2 MB gzipped on Pages) once; tiles are cached. Validation JSON (~1 MB) loads lazily on scroll. Keep the initial payload (manifest + cells) small.
5. **Deploy.** Push `main`; `.github/workflows/pages.yml` tests, then deploys `site/`. Repository setting: Pages → Source = GitHub Actions. Do not claim the URL is live until you have fetched it and seen the page.
