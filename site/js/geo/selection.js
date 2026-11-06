// Geographic selection: validation, GeoJSON construction and cell filtering.
// GeoJSON positions are ALWAYS [longitude, latitude].

export const INDIA_LIMITS = { south: 5, north: 38, west: 66, east: 99 };

/** Bounding box [west, south, east, north] of a GeoJSON Feature/Polygon. */
export function geometryBBox(feature) {
  const geom = feature.type === 'Feature' ? feature.geometry : feature;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < w) w = lon; if (lon > e) e = lon;
      if (lat < s) s = lat; if (lat > n) n = lat;
    }
  }
  return [w, s, e, n];
}

export function bboxIntersects(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** Closed rectangle polygon from [west, south, east, north]. */
export function bboxToFeature(bbox, props = {}) {
  const [w, s, e, n] = bbox;
  return {
    type: 'Feature',
    properties: { kind: 'rectangle', ...props },
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  };
}

/** Validate manual bounds. Inputs may be strings. Returns { ok, errors, bbox }. */
export function validateBounds(input, limits = INDIA_LIMITS) {
  const errors = [];
  const v = {};
  for (const k of ['south', 'north', 'west', 'east']) {
    const raw = input[k];
    const x = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
    if (raw === '' || raw == null || !Number.isFinite(x)) errors.push(`${k} must be a number`);
    v[k] = x;
  }
  if (errors.length) return { ok: false, errors };
  if (v.south < -90 || v.north > 90) errors.push('latitude must be within -90..90');
  if (v.west < -180 || v.east > 180) errors.push('longitude must be within -180..180');
  if (v.south >= v.north) errors.push('south must be less than north');
  if (v.west >= v.east) errors.push('west must be less than east');
  if (!errors.length && (v.north < limits.south || v.south > limits.north || v.east < limits.west || v.west > limits.east)) {
    errors.push(`bounds do not overlap the India data extent (${limits.south}..${limits.north}N, ${limits.west}..${limits.east}E)`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, bbox: [v.west, v.south, v.east, v.north] };
}

/**
 * Parse polygon vertices typed as "lat, lon" pairs, one per line (or separated by ';').
 * Returns { ok, errors, feature } with GeoJSON [lon, lat] order and a closed ring.
 */
export function parsePolygonText(text) {
  const parts = String(text).split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
  const errors = [];
  const ring = [];
  parts.forEach((p, i) => {
    const nums = p.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length !== 2 || nums.some((x) => !Number.isFinite(x))) {
      errors.push(`line ${i + 1}: expected "lat, lon"`);
      return;
    }
    const [lat, lon] = nums;
    if (lat < -90 || lat > 90) errors.push(`line ${i + 1}: latitude ${lat} out of range`);
    if (lon < -180 || lon > 180) errors.push(`line ${i + 1}: longitude ${lon} out of range`);
    ring.push([lon, lat]);
  });
  if (!errors.length) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
    if (ring.length < 4) errors.push('a polygon needs at least 3 distinct vertices');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, feature: { type: 'Feature', properties: { kind: 'polygon' }, geometry: { type: 'Polygon', coordinates: [ring] } } };
}

/** Tiles (from manifest) whose bbox intersects the selection bbox; all tiles if bbox is null. */
export function tilesForBBox(tilesMeta, bbox) {
  if (!bbox) return tilesMeta.map((t) => t.id);
  return tilesMeta.filter((t) => bboxIntersects(t.bbox, bbox)).map((t) => t.id);
}

/**
 * Mask of tile cells whose CENTRE lies in the selection (centroid-in-polygon approximation).
 * feature null = whole dataset. Points exactly on the boundary count as inside.
 */
export function selectCellsInTile(tile, feature, turf) {
  const { lat, lon } = tile.cells;
  const mask = new Uint8Array(lat.length);
  if (!feature) { mask.fill(1); return mask; }
  const bb = geometryBBox(feature);
  const isRect = feature.properties && feature.properties.kind === 'rectangle';
  for (let i = 0; i < lat.length; i++) {
    const x = lon[i]; const y = lat[i];
    if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
    mask[i] = isRect ? 1 : (turf.booleanPointInPolygon([x, y], feature) ? 1 : 0);
  }
  return mask;
}

export function areaKm2(feature, turf) {
  return feature ? turf.area(feature) / 1e6 : null;
}
