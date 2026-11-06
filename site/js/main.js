// HotSpot Sync — application wiring (state, data flow, rendering).
import { aggregateMonthly, buildSeries } from './analytics/aggregate.js';
import { scoreSeries } from './analytics/anomaly.js';
import { compareToHistory } from './analytics/compare.js';
import { annualTotals, monthlyProfile, peakWindow, seasonShares, viirsTrend } from './analytics/seasonal.js';
import { keyStats } from './analytics/summary.js';
import { MONTH_SHORT, indexToYM, labelYM, normaliseRange, parseYM, ymToIndex } from './analytics/time.js';
import { renderCalendar } from './charts/calendar.js';
import { renderAnnual, renderComparison, renderProfile } from './charts/insight-charts.js';
import { exportPNG } from './charts/theme.js';
import { CONFIG, METRICS } from './config.js';
import { DataStore } from './data/loader.js';
import { AGGREGATE_HEADERS, CELL_HEADERS, aggregateRows, cellRows, downloadText, exportFileName, toCSV } from './export/csv.js';
import {
  areaKm2, bboxToFeature, geometryBBox, parsePolygonText, selectCellsInTile, tilesForBBox, validateBounds,
} from './geo/selection.js';
import { decodeState, encodeState } from './ui/hash.js';
import { createMap } from './ui/map.js';
import { renderMethodology } from './ui/methodology.js';
import {
  renderAnomalies, renderComparisonSummary, renderKPIs, renderSeasonal, renderTable,
} from './ui/render.js';
import { initValidation } from './ui/validation-panel.js';

const $ = (id) => document.getElementById(id);
const store = new DataStore(CONFIG.dataRoot);

const PRESETS = [
  { key: 'india', label: 'All India', bbox: null },
  { key: 'punjab', label: 'Punjab–Haryana', bbox: [73.8, 29.5, 77.6, 32.6] },
  { key: 'central', label: 'Central India', bbox: [74.0, 21.0, 82.5, 26.5] },
  { key: 'odisha', label: 'Odisha', bbox: [81.3, 17.8, 87.5, 22.6] },
  { key: 'northeast', label: 'Northeast', bbox: [89.7, 22.0, 97.4, 29.5] },
  { key: 'deccan', label: 'Telangana–AP', bbox: [77.0, 13.5, 81.8, 19.9] },
];

const state = { feature: null, range: null, metric: 'h', focusM: null, preset: 'india' };
const ctx = { renders: 0, manifest: null, cells: null, tiles: [], masks: new Map(), series: {}, scores: {}, nCells: 0, token: 0 };
const charts = {};
let mapApi = null;

// ---------------------------------------------------------------- helpers
const ymLabel = (m) => {
  const { year, month } = indexToYM(m, ctx.manifest.base_year);
  return `${year}-${String(month).padStart(2, '0')}`;
};
const coverageRange = () => [parseYM(ctx.manifest.coverage.start, ctx.manifest.base_year), parseYM(ctx.manifest.coverage.end, ctx.manifest.base_year)];
const metric = () => METRICS[state.metric];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}

function setStatus(html) { $('map-status').innerHTML = html; }

function showFatal(msg) {
  $('coverage-pill').classList.add('error');
  $('coverage-text').textContent = 'Data unavailable';
  const div = document.createElement('div');
  div.className = 'error-banner';
  div.setAttribute('role', 'alert');
  div.textContent = `Could not load the dataset: ${msg}. Check your connection and reload the page.`;
  $('explore').prepend(div);
}

// ---------------------------------------------------------------- selection
function selectionLabel(feature) {
  if (!feature) return 'All of India (full data extent)';
  const preset = PRESETS.find((p) => p.key === state.preset && p.bbox);
  const [w, s, e, n] = geometryBBox(feature);
  const box = `${s.toFixed(2)}–${n.toFixed(2)}°N, ${w.toFixed(2)}–${e.toFixed(2)}°E`;
  const kind = feature.properties.kind === 'rectangle' ? 'Rectangle' : `Polygon (${feature.geometry.coordinates[0].length - 1} vertices)`;
  return preset ? `${preset.label} <small>approximate box · ${box}</small>` : `${kind} <small>${box}</small>`;
}

function updatePresetChips() {
  document.querySelectorAll('#presets .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === state.preset)));
}

function cellIndexMask(feature) {
  // mask over cells.json (all cells) for map highlighting
  const c = ctx.cells;
  return selectCellsInTile({ cells: { lat: c.lat, lon: c.lon } }, feature, turf);
}

async function applySelection(feature, { fit = true, preset = null, fromMap = false } = {}) {
  state.feature = feature;
  state.preset = preset || (feature ? null : 'india');
  state.focusM = null;
  updatePresetChips();
  if (!fromMap) mapApi.show(feature, fit);
  const token = ++ctx.token;
  const ids = tilesForBBox(ctx.manifest.tiles, feature ? geometryBBox(feature) : null);
  const nMonths = ctx.manifest.months.m.length;
  const pending = ids.filter((id) => !store.isCached(id)).length;
  if (pending) setStatus(`<span class="spinner"></span>Loading ${pending} data tile${pending > 1 ? 's' : ''}…`);
  setOverlay(pending ? 'Loading data…' : null);
  let tiles;
  try {
    tiles = await store.tiles(ids, nMonths, (d, t) => {
      if (token === ctx.token && pending) setStatus(`<span class="spinner"></span>Loading data tiles ${d}/${t}…`);
    });
  } catch (err) {
    if (token !== ctx.token) return;
    setStatus('');
    setOverlay('Data could not be loaded. Please retry.');
    toast(`Loading failed: ${err.message}`);
    return;
  }
  if (token !== ctx.token) return; // a newer selection superseded this one
  const masks = new Map(tiles.map((t) => [t.tile, selectCellsInTile(t, feature, turf)]));
  const agg = aggregateMonthly(tiles, masks, nMonths);
  ctx.tiles = tiles;
  ctx.masks = masks;
  ctx.nCells = agg.nCells;
  for (const k of ['h', 'f']) {
    ctx.series[k] = buildSeries(agg, ctx.manifest, k);
    ctx.scores[k] = scoreSeries(ctx.series[k], k);
  }
  mapApi.highlight(feature ? cellIndexMask(feature) : null);
  const area = areaKm2(feature, turf);
  $('selection-summary').innerHTML = `${selectionLabel(feature)}<small>${agg.nCells.toLocaleString('en-US')} grid cells with fire records${area ? ` · ${Math.round(area).toLocaleString('en-US')} km²` : ''}</small>`;
  setStatus(agg.nCells ? `${agg.nCells.toLocaleString('en-US')} cells selected` : 'No fire cells in this selection');
  render();
}

function setOverlay(msg) {
  const o = $('calendar-overlay');
  o.hidden = !msg;
  o.textContent = msg || '';
}

// ---------------------------------------------------------------- rendering
function render() {
  const m = metric();
  const series = ctx.series[state.metric];
  const scores = ctx.scores[state.metric];
  const range = state.range;
  const unit = m.unit;
  history.replaceState(null, '', encodeState(state, ymLabel));
  $('calendar-sub').textContent = `${m.label} per month, ${labelYM(range[0], ctx.manifest.base_year)} – ${labelYM(range[1], ctx.manifest.base_year)}. Click a month to compare it with its history.`;
  $('annual-sub').textContent = `${m.label} per year · partial years faded · colour shows the source sensor`;

  if (!ctx.nCells) {
    setOverlay('No grid cell with fire detections has its centre inside this selection. Draw a larger area or clear the selection.');
    renderKPIs(null, {});
    for (const c of ['calendar', 'compare', 'profile', 'annual']) if (charts[c]) charts[c].clear();
    renderComparisonSummary(null);
    $('anomaly-summary').innerHTML = '';
    $('anomaly-list').innerHTML = '<li class="empty-state" style="display:block">No data for this selection.</li>';
    $('seasonal-insights').innerHTML = '';
    $('season-bars').innerHTML = '';
    $('calendar-table').innerHTML = '';
    return;
  }
  setOverlay(null);
  renderKPIs(keyStats(series, range), { metricLabel: m.short === 'FRP' ? 'FRP' : 'hotspots', unit, coverageEnd: ctx.manifest.coverage.end });
  charts.calendar = renderCalendar($('chart-calendar'), {
    series, scores, range, metric: state.metric, unit, focusM: state.focusM,
    onSelect: (mm) => { state.focusM = mm; render(); $('insights').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  });
  const cmp = compareToHistory(series, range, state.focusM);
  renderComparisonSummary(cmp, unit, ctx.manifest.base_year);
  charts.compare = renderComparison($('chart-compare'), cmp, unit);
  renderAnomalies(series, scores, range, unit, (mm) => { state.focusM = mm; render(); });

  const { profile } = monthlyProfile(series, range);
  const peak = peakWindow(profile, 3);
  const annual = annualTotals(series, range);
  const trend = viirsTrend(annual);
  let topAnomaly = null;
  for (let mm = range[0]; mm <= range[1]; mm++) {
    const s = scores[mm];
    if ((s.status === 'high' || s.status === 'low') && (!topAnomaly || Math.abs(s.z) > Math.abs(topAnomaly.s.z))) topAnomaly = { p: series[mm], s };
  }
  renderSeasonal({ profile, seasons: seasonShares(profile), peak, annual, trend, topAnomaly }, unit);
  charts.profile = renderProfile($('chart-profile'), profile, peak, unit);
  charts.annual = renderAnnual($('chart-annual'), annual, trend, unit);
  if ($('calendar-table').closest('details').open) renderTable(series, scores, range, unit);
  updateDownloadState();
  ctx.renders += 1;
}

// ---------------------------------------------------------------- controls
function initRangeControls() {
  const [lo, hi] = coverageRange();
  const base = ctx.manifest.base_year;
  const y0 = indexToYM(lo, base).year; const y1 = indexToYM(hi, base).year;
  for (const id of ['start-month', 'end-month']) $(id).innerHTML = MONTH_SHORT.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  for (const id of ['start-year', 'end-year']) {
    let h = '';
    for (let y = y0; y <= y1; y++) h += `<option value="${y}">${y}</option>`;
    $(id).innerHTML = h;
  }
  const onChange = () => {
    const a = ymToIndex(Number($('start-year').value), Number($('start-month').value), base);
    const b = ymToIndex(Number($('end-year').value), Number($('end-month').value), base);
    const err = $('range-error');
    const bad = a > b;
    ['start-month', 'start-year', 'end-month', 'end-year'].forEach((id) => $(id).setAttribute('aria-invalid', String(bad)));
    if (bad) { err.textContent = 'The start must be before the end.'; return; }
    const r = normaliseRange(a, b, lo, hi);
    err.textContent = r && (r[0] !== a || r[1] !== b) ? `Data covers ${labelYM(lo, base)} – ${labelYM(hi, base)}; the period was clipped.` : '';
    setRange(r, false);
  };
  ['start-month', 'start-year', 'end-month', 'end-year'].forEach((id) => $(id).addEventListener('change', onChange));
  const vStart = parseYM(ctx.manifest.sensor_spans.V[0].slice(0, 7), base) + (ctx.manifest.sensor_spans.V[0].endsWith('-01') ? 0 : 1);
  const presets = [
    { label: 'Full record', r: [lo, hi] },
    { label: 'Last 5 years', r: [Math.max(lo, hi - 59), hi] },
    { label: 'Last 12 months', r: [Math.max(lo, hi - 11), hi] },
    { label: 'VIIRS era', r: [vStart, hi] },
    { label: 'MODIS era', r: [lo, vStart - 1] },
  ];
  $('range-presets').innerHTML = presets.map((p, i) => `<button class="chip" type="button" data-i="${i}">${p.label}</button>`).join('');
  $('range-presets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    $('range-error').textContent = '';
    setRange(presets[Number(b.dataset.i)].r, true);
  });
}

function setRange(r, syncInputs) {
  if (!r) return;
  state.range = r;
  state.focusM = null;
  if (syncInputs) {
    const base = ctx.manifest.base_year;
    const a = indexToYM(r[0], base); const b = indexToYM(r[1], base);
    $('start-month').value = a.month; $('start-year').value = a.year;
    $('end-month').value = b.month; $('end-year').value = b.year;
    ['start-month', 'start-year', 'end-month', 'end-year'].forEach((id) => $(id).setAttribute('aria-invalid', 'false'));
  }
  if (ctx.series.h) render();
}

function initSelectionControls() {
  $('presets').innerHTML = PRESETS.map((p) => `<button class="chip" type="button" data-key="${p.key}" aria-pressed="false">${p.label}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    const p = PRESETS.find((x) => x.key === b.dataset.key);
    applySelection(p.bbox ? bboxToFeature(p.bbox) : null, { preset: p.key });
  });
  $('btn-clear').addEventListener('click', () => applySelection(null));

  $('bounds-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = validateBounds(Object.fromEntries(fd));
    const err = $('bounds-error');
    e.target.querySelectorAll('input').forEach((i) => i.setAttribute('aria-invalid', String(!res.ok)));
    if (!res.ok) { err.textContent = `Check the bounds: ${res.errors.join('; ')}.`; return; }
    err.textContent = '';
    applySelection(bboxToFeature(res.bbox));
  });
  $('polygon-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = parsePolygonText($('polygon-text').value);
    const err = $('polygon-error');
    $('polygon-text').setAttribute('aria-invalid', String(!res.ok));
    if (!res.ok) { err.textContent = `Check the vertices: ${res.errors.join('; ')}.`; return; }
    const kinks = turf.kinks(res.feature);
    if (kinks.features.length) { err.textContent = 'The polygon edges cross each other. Reorder the vertices.'; $('polygon-text').setAttribute('aria-invalid', 'true'); return; }
    err.textContent = '';
    applySelection(res.feature);
  });

  document.querySelectorAll('input[name="metric"]').forEach((r) => r.addEventListener('change', (e) => {
    state.metric = e.target.value;
    render();
  }));
  $('btn-unfocus').addEventListener('click', () => { state.focusM = null; render(); });
}

// ---------------------------------------------------------------- exports
function updateDownloadState() {
  const empty = !ctx.nCells;
  ['dl-monthly', 'dl-cells'].forEach((id) => { $(id).disabled = empty; });
  $('dl-geojson').disabled = !state.feature;
  $('download-hint').textContent = empty ? 'Nothing to export: the selection contains no fire cells.'
    : `Exports cover ${labelYM(state.range[0], ctx.manifest.base_year)} – ${labelYM(state.range[1], ctx.manifest.base_year)} for the current selection.`;
}

function initExports() {
  const names = () => [ymLabel(state.range[0]), ymLabel(state.range[1])];
  $('dl-monthly').addEventListener('click', () => {
    const rows = aggregateRows(ctx.series.h, ctx.series.f, state.range, ctx.scores.h);
    downloadText(toCSV(AGGREGATE_HEADERS, rows), exportFileName('monthly', ...names()));
    toast(`Downloaded ${rows.length} monthly rows`);
  });
  $('dl-cells').addEventListener('click', () => {
    const rows = cellRows(ctx.tiles, ctx.masks, state.range, ctx.manifest.base_year);
    if (!rows.length) { toast('No cell records in this period (all observed zero or no data).'); return; }
    downloadText(toCSV(CELL_HEADERS, rows), exportFileName('cells', ...names()));
    toast(`Downloaded ${rows.length.toLocaleString('en-US')} cell-month rows`);
  });
  $('dl-geojson').addEventListener('click', () => {
    if (!state.feature) return;
    const fc = { type: 'FeatureCollection', features: [state.feature] };
    downloadText(JSON.stringify(fc, null, 2), 'hotspot-sync_selection.geojson', 'application/geo+json');
  });
  $('copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('Link copied'); } catch { toast('Copy failed — use the address bar URL'); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    const key = b.dataset.export;
    const map = { calendar: 'chart-calendar', compare: 'chart-compare', profile: 'chart-profile', annual: 'chart-annual',
      'val-raw': 'chart-val-raw', 'val-harm': 'chart-val-harm', 'val-national': 'chart-val-national', 'val-ratio': 'chart-val-ratio',
      'val-bands': 'chart-val-bands', 'frp-raw': 'chart-frp-raw', 'frp-harm': 'chart-frp-harm', 'frp-baseline': 'chart-frp-baseline' };
    const el = $(map[key]);
    const inst = el && echarts.getInstanceByDom(el);
    if (!inst) { toast('Chart not ready yet'); return; }
    const [a, z] = state.range ? names() : ['', ''];
    exportPNG(inst, key.startsWith('val') || key.startsWith('frp') ? `hotspot-sync_${key}.png` : exportFileName(key, a, z, 'png'));
  });
  $('calendar-table').closest('details').addEventListener('toggle', (e) => {
    if (e.target.open && ctx.series.h) renderTable(ctx.series[state.metric], ctx.scores[state.metric], state.range, metric().unit);
  });
}

// ---------------------------------------------------------------- boot
function heroFacts() {
  const man = ctx.manifest;
  const total = man.coverage.total_h;
  $('hero-facts').innerHTML = `
    <div><dt>Record</dt><dd>${man.coverage.start.slice(0, 4)}–${man.coverage.end.slice(0, 4)}</dd></div>
    <div><dt>Grid cells</dt><dd>${man.coverage.n_cells.toLocaleString('en-US')}</dd></div>
    <div><dt>Harmonised hotspots</dt><dd>${total ? `${(total / 1e6).toFixed(1)}M` : '—'}</dd></div>`;
}

function restoreFromHash() {
  const s = decodeState(window.location.hash);
  const base = ctx.manifest.base_year;
  const [lo, hi] = coverageRange();
  let range = [lo, hi];
  if (s.range) {
    try { range = normaliseRange(parseYM(s.range[0], base), parseYM(s.range[1], base), lo, hi) || range; } catch { /* keep default */ }
  }
  if (s.metric) {
    state.metric = s.metric;
    document.querySelector(`input[name="metric"][value="${s.metric}"]`).checked = true;
  }
  let feature = null;
  if (s.bbox) {
    const v = validateBounds({ west: s.bbox[0], south: s.bbox[1], east: s.bbox[2], north: s.bbox[3] });
    if (v.ok) feature = bboxToFeature(v.bbox);
  } else if (s.ring) {
    const r = parsePolygonText(s.ring.map(([x, y]) => `${y}, ${x}`).join('\n'));
    if (r.ok) feature = r.feature;
  }
  return { range, feature };
}

async function main() {
  try {
    [ctx.manifest, ctx.cells] = await Promise.all([store.manifest(), store.cells()]);
  } catch (err) {
    console.error(err);
    showFatal(err.message);
    return;
  }
  const man = ctx.manifest;
  $('coverage-pill').classList.add('ready');
  $('coverage-text').textContent = `NASA FIRMS · ${labelYM(coverageRange()[0], man.base_year)} – ${labelYM(coverageRange()[1], man.base_year)}`;
  renderMethodology($('method-content'), man);
  mapApi = createMap($('map'), {
    cells: ctx.cells, grid: man.grid_deg,
    onSelection: (f) => applySelection(f, { fromMap: true }),
  });
  initRangeControls();
  initSelectionControls();
  initExports();
  const { range, feature } = restoreFromHash();
  setRange(range, true);
  heroFacts();
  await applySelection(feature, { fit: !!feature });
  initValidation(store, man);
  window.hotspotSync = { state, ctx, charts }; // debugging & e2e tests
}

main();
