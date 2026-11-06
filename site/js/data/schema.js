// Validation of external data at the network boundary.

export class DataError extends Error {}

function need(cond, msg) {
  if (!cond) throw new DataError(msg);
}

export function validateManifest(m) {
  need(m && typeof m === 'object', 'manifest is not an object');
  need(typeof m.schema === 'string' && m.schema.startsWith('1.'), `unsupported schema ${m.schema}`);
  need(Number.isInteger(m.base_year), 'manifest.base_year missing');
  const mo = m.months;
  need(mo && Array.isArray(mo.m) && mo.m.length > 0, 'manifest.months missing');
  for (const k of ['source', 'complete', 'missing_days']) {
    need(Array.isArray(mo[k]) && mo[k].length === mo.m.length, `manifest.months.${k} length mismatch`);
  }
  need(mo.m.every((x, i) => x === i), 'manifest.months.m must be 0..n-1');
  need(Array.isArray(m.tiles) && m.tiles.length > 0, 'manifest.tiles missing');
  for (const t of m.tiles) need(typeof t.id === 'string' && Array.isArray(t.bbox) && t.bbox.length === 4, 'bad tile entry');
  need(m.coverage && /^\d{4}-\d{2}$/.test(m.coverage.start) && /^\d{4}-\d{2}$/.test(m.coverage.end), 'manifest.coverage invalid');
  return m;
}

export function validateTile(t, nMonths) {
  need(t && t.cells && t.rec, 'tile missing cells/rec');
  const nc = t.cells.id.length;
  need(t.cells.lat.length === nc && t.cells.lon.length === nc, `tile ${t.tile}: cell arrays mismatch`);
  const n = t.rec.c.length;
  for (const k of ['m', 'h', 'f', 'mo', 'vi']) need(Array.isArray(t.rec[k]) && t.rec[k].length === n, `tile ${t.tile}: rec.${k} length mismatch`);
  for (let i = 0; i < n; i++) {
    const c = t.rec.c[i];
    const m = t.rec.m[i];
    if (!(c >= 0 && c < nc && m >= 0 && m < nMonths && t.rec.h[i] >= 0)) {
      throw new DataError(`tile ${t.tile}: invalid record ${i}`);
    }
  }
  for (let i = 0; i < nc; i++) {
    const la = t.cells.lat[i]; const lo = t.cells.lon[i];
    need(la >= -90 && la <= 90 && lo >= -180 && lo <= 180, `tile ${t.tile}: invalid coordinate`);
  }
  return t;
}
