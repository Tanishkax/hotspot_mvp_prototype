---
name: geospatial-frontend
description: Use when working on HotSpot Sync's map, drawing tools, region selection, GeoJSON handling, manual bounds or polygon input, URL state, or anything that turns a geometry into selected grid cells (site/js/ui/map.js, site/js/geo/selection.js, site/js/ui/hash.js, main.js applySelection).
---

# Geospatial frontend

- **Coordinate order.** GeoJSON and Turf use `[lon, lat]`; Leaflet uses `[lat, lng]`. Convert only in `ui/map.js`. Leaflet's `layer.toGeoJSON()` already returns `[lon, lat]`. Typed input (`parsePolygonText`) is `lat, lon` per line and becomes `[lon, lat]`.
- **One selection at a time.** A new draw clears the old one. `feature.properties.kind` is `rectangle` or `polygon`; rectangles skip the Turf test (bbox test only).
- **Selection rule.** A cell centre inside the shape, boundary inclusive (`selectCellsInTile`), with a bbox prefilter before `turf.booleanPointInPolygon`. This is a centroid approximation and the UI must keep disclosing it.
- **Loading.** `tilesForBBox(manifest.tiles, bbox)` → `DataStore.tiles()` (promise cache, retries after failure). Guard races with `ctx.token`.
- **Map cell layer.** Draws `cells.json` as canvas rectangles. `highlight(mask)` takes a mask over `cells.json` order (computed with the same `selectCellsInTile`).
- **Validation.** `validateBounds` (numeric, ordered, overlaps the India extent). Polygons need ≥ 3 vertices, and `turf.kinks` rejects self-intersections.
- **URL hash.** `#/<tab>?r=YYYY-MM,YYYY-MM&k=h|f&b=w,s,e,n` or `&p=lon lat;...`. Legacy hashes without `/<tab>` open Explore. Decoded values are re-validated.
- **Hidden tabs.** The map lives in the Explore panel. Any fit requested while it is hidden (`clientWidth === 0`) is deferred, and `mapApi.refresh()` applies it when Explore is shown. Always call `refresh()` after unhiding the map.
- **Tests.** Add pure cases to `tests/js/geo_export.test.mjs`, including a swapped-order check. Mouse drawing is covered in `tests/e2e/smoke.mjs`.
