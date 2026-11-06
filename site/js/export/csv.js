// CSV generation (pure) and browser download helpers.
import { inRange } from '../analytics/time.js';

export function csvEscape(v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

const SOURCE_LABEL = { V: 'VIIRS S-NPP', TA: 'MODIS Terra+Aqua (scaled)', T: 'MODIS Terra (scaled)' };

const num = (x, d = 1) => (x == null ? null : Number(x.toFixed(d)));

/** Region-level monthly rows within the range. total_hotspots is empty for no-data months. */
export function aggregateRows(seriesH, seriesF, range, scores) {
  const rows = [];
  for (let m = range[0]; m <= range[1]; m++) {
    const p = seriesH[m];
    if (!p) continue;
    const s = scores ? scores[m] : null;
    rows.push({
      year: p.year,
      month: p.month,
      total_hotspots: num(p.value),
      frp_mw: seriesF ? num(seriesF[m].value) : null,
      modis_raw_count: p.modisRaw,
      viirs_raw_count: p.viirsRaw,
      source: p.source ? SOURCE_LABEL[p.source] : '',
      data_status: p.status,
      outage_days: p.source ? p.missingDays : null,
      anomaly_status: s ? s.status : '',
      robust_z: s && s.z != null ? num(s.z, 2) : null,
      baseline_median: s && s.median != null ? num(s.median) : null,
    });
  }
  return rows;
}

export const AGGREGATE_HEADERS = ['year', 'month', 'total_hotspots', 'frp_mw', 'modis_raw_count', 'viirs_raw_count',
  'source', 'data_status', 'outage_days', 'anomaly_status', 'robust_z', 'baseline_median'];

export const CELL_HEADERS = ['year', 'month', 'cell_id', 'latitude', 'longitude', 'count_harmonised', 'frp_harmonised_mw',
  'modis_raw_count', 'viirs_raw_count'];

/** Cell-level rows (only cell-months with a record: absent = zero detections in covered months). */
export function cellRows(tiles, masks, range, baseYear) {
  const rows = [];
  for (const t of tiles) {
    const mask = masks.get(t.tile);
    if (!mask) continue;
    const r = t.rec;
    for (let i = 0; i < r.c.length; i++) {
      if (!mask[r.c[i]] || !inRange(r.m[i], range)) continue;
      const c = r.c[i];
      rows.push({
        year: baseYear + Math.floor(r.m[i] / 12), month: (r.m[i] % 12) + 1, cell_id: t.cells.id[c],
        latitude: t.cells.lat[c], longitude: t.cells.lon[c], count_harmonised: r.h[i], frp_harmonised_mw: r.f[i],
        modis_raw_count: r.mo[i], viirs_raw_count: r.vi[i],
      });
    }
  }
  rows.sort((a, b) => a.year - b.year || a.month - b.month || (a.cell_id < b.cell_id ? -1 : a.cell_id > b.cell_id ? 1 : 0));
  return rows;
}

export function exportFileName(kind, startYM, endYM, ext = 'csv') {
  const clean = (s) => String(s).replace(/[^0-9A-Za-z-]/g, '');
  return `hotspot-sync_${clean(kind)}_${clean(startYM)}_to_${clean(endYM)}.${ext}`;
}

export function downloadText(text, filename, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  downloadURL(URL.createObjectURL(blob), filename, true);
}

export function downloadURL(url, filename, revoke = false) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000);
}
