// Validation charts: sensor scatter with 1:1 line, national series, ratio stability, band ratios, cell baseline.
import { MONTH_SHORT } from '../analytics/time.js';
import { C, axis, fmt, fmtCompact, makeChart, tooltip } from './theme.js';

const logAxis = (name) => ({
  type: 'log', name, nameLocation: 'middle', nameGap: 30, logBase: 10,
  ...axis({ axisLabel: { color: C.text2, fontSize: 10, formatter: fmtCompact } }),
});

/** Log-log scatter of MODIS (x) vs VIIRS (y) with the 1:1 reference line. */
export function renderScatter(el, xs, ys, { xLabel, yLabel, color, unit }) {
  const chart = makeChart(el);
  const pts = [];
  let lo = Infinity; let hi = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > 0 && ys[i] > 0) { pts.push([xs[i], ys[i]]); lo = Math.min(lo, xs[i], ys[i]); hi = Math.max(hi, xs[i], ys[i]); }
  }
  const min = 10 ** Math.floor(Math.log10(lo || 1)); const max = 10 ** Math.ceil(Math.log10(hi || 10));
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 54, right: 14, top: 14, bottom: 44 },
    tooltip: { ...tooltip, trigger: 'item', formatter: (p) => (p.seriesIndex === 0 ? `${xLabel}: ${fmt(p.value[0], 1)} ${unit}<br>VIIRS: ${fmt(p.value[1], 1)} ${unit}` : '1:1 line') },
    xAxis: { ...logAxis(xLabel), min, max }, yAxis: { ...logAxis(yLabel), min, max, nameGap: 40 },
    series: [
      { type: 'scatter', data: pts, symbolSize: 4, itemStyle: { color, opacity: 0.45 }, large: true },
      { type: 'line', data: [[min, min], [max, max]], symbol: 'none', lineStyle: { color: C.critical || '#e05252', width: 1.5 }, z: 3, silent: true },
    ],
    graphic: [{ type: 'text', right: 18, top: 18, style: { text: '— 1:1 line', fill: '#e05252', font: '11px Inter, sans-serif' } }],
  }, { notMerge: true });
  return chart;
}

export function renderNational(el, ns, baseYear) {
  const chart = makeChart(el);
  const labels = ns.m.map((m) => `${MONTH_SHORT[m % 12]} ${baseYear + Math.floor(m / 12)}`);
  const s = (name, data, color, width = 2) => ({ type: 'line', name, data, symbol: 'none', lineStyle: { color, width }, itemStyle: { color } });
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 54, right: 12, top: 36, bottom: 28 },
    legend: { top: 0, textStyle: { color: C.text2, fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
    tooltip: { ...tooltip, trigger: 'axis', valueFormatter: (v) => fmt(v) },
    xAxis: { type: 'category', data: labels, ...axis({ axisLabel: { color: C.text2, fontSize: 10, hideOverlap: true } }), splitLine: { show: false } },
    yAxis: { type: 'value', ...axis({ axisLabel: { color: C.text2, fontSize: 11, formatter: fmtCompact } }) },
    series: [s('VIIRS (observed)', ns.viirs, C.viirs), s('MODIS harmonised', ns.modis_harmonised, C.harm), s('MODIS raw', ns.modis_raw, C.modis, 1.5)],
  }, { notMerge: true });
  return chart;
}

export function renderRatioByYear(el, yr, fitYears) {
  const chart = makeChart(el);
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 44, right: 12, top: 36, bottom: 28 },
    legend: { top: 0, textStyle: { color: C.text2, fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
    tooltip: { ...tooltip, trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : v.toFixed(2)) },
    xAxis: { type: 'category', data: yr.year.map(String), ...axis(), splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, ...axis() },
    series: [
      { type: 'line', name: 'VIIRS ÷ (Terra+Aqua)', data: yr.ratio_TA, symbolSize: 7, lineStyle: { color: C.harm, width: 2 }, itemStyle: { color: C.harm },
        markArea: fitYears ? { silent: true, itemStyle: { color: 'rgba(255,255,255,0.035)' }, label: { color: C.muted, fontSize: 10, position: 'insideTop' },
          data: [[{ name: 'holdout fit years', xAxis: String(fitYears[0]) }, { xAxis: String(fitYears[1]) }]] } : undefined },
    ],
  }, { notMerge: true });
  return chart;
}

export function renderBands(el, table) {
  const chart = makeChart(el);
  const rows = table.filter((r) => r.n_cell_months > 0);
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 44, right: 12, top: 36, bottom: 40 },
    legend: { top: 0, textStyle: { color: C.text2, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { ...tooltip, trigger: 'axis',
      formatter: (p) => { const r = rows[p[0].dataIndex]; return `<b>${r.lat_range[0]}–${r.lat_range[1]}°N</b><br>Ratio of sums (used): ${r.ratio == null ? 'fallback' : r.ratio.toFixed(2)}<br>Upstream median-of-pairs: ${r.upstream_median_pair_ratio == null ? '—' : r.upstream_median_pair_ratio.toFixed(2)}<br>${fmt(r.n_pairs)} cell-months with both sensors`; } },
    xAxis: { type: 'category', name: 'latitude band (°N)', nameLocation: 'middle', nameGap: 26, data: rows.map((r) => String(r.band)), ...axis(), splitLine: { show: false } },
    yAxis: { type: 'value', ...axis() },
    series: [
      { type: 'bar', name: 'Ratio of sums (used)', data: rows.map((r) => r.ratio), itemStyle: { color: C.harm, borderRadius: [3, 3, 0, 0] }, barGap: '15%', barMaxWidth: 14 },
      { type: 'bar', name: 'Upstream median of pairs', data: rows.map((r) => r.upstream_median_pair_ratio), itemStyle: { color: C.modis, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 },
    ],
  }, { notMerge: true });
  return chart;
}

/** Weekly cell baseline chart (dynamic version of the supplied reference figure). */
export function renderBaseline(el, cell, label) {
  const chart = makeChart(el);
  const lower = cell.lower.map((v) => v);
  const width = cell.upper.map((u, i) => (u == null || cell.lower[i] == null ? null : u - cell.lower[i]));
  const flagged = cell.date.map((d, i) => (cell.flag[i] ? [d, cell.activity[i]] : null)).filter(Boolean);
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 54, right: 14, top: 36, bottom: 56 },
    legend: { top: 0, textStyle: { color: C.text2, fontSize: 11 }, itemWidth: 14, itemHeight: 8,
      data: ['VIIRS activity', 'baseline', 'normal range (3 SD)', 'flagged'] },
    tooltip: { ...tooltip, trigger: 'axis',
      formatter: (p) => {
        const i = p[0].dataIndex;
        const z = cell.z[i];
        return `<b>Week of ${cell.date[i]}</b> · ${label}<br>VIIRS FRP ${fmt(cell.activity[i], 1)} MW<br>Baseline ${fmt(cell.baseline[i], 1)} · upper ${fmt(cell.upper[i], 1)}<br>${z == null ? 'No baseline (not scored)' : `z ${z.toFixed(2)}${cell.flag[i] ? ' · <b>flagged</b>' : ''}`}`;
      } },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: C.axis, textStyle: { color: C.muted }, fillerColor: 'rgba(255,166,48,0.12)', handleStyle: { color: C.accent } }],
    xAxis: { type: 'category', data: cell.date, ...axis({ axisLabel: { color: C.text2, fontSize: 10, hideOverlap: true } }), splitLine: { show: false } },
    yAxis: { type: 'value', name: 'FRP (MW)', ...axis() },
    series: [
      { type: 'line', name: 'band-base', data: lower, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, connectNulls: false },
      { type: 'line', name: 'normal range (3 SD)', data: width, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(57,135,229,0.25)' }, itemStyle: { color: 'rgba(57,135,229,0.5)' }, silent: true },
      { type: 'line', name: 'VIIRS activity', data: cell.activity, symbol: 'none', lineStyle: { color: C.modis, width: 1.6 }, itemStyle: { color: C.modis } },
      { type: 'line', name: 'baseline', data: cell.baseline, symbol: 'none', lineStyle: { color: C.accent, width: 1.6 }, itemStyle: { color: C.accent } },
      { type: 'scatter', name: 'flagged', data: flagged, symbolSize: 8, itemStyle: { color: '#e05252', borderColor: C.bg, borderWidth: 1.5 }, z: 5 },
    ],
  }, { notMerge: true });
  return chart;
}

/** Selection-level comparison: raw MODIS, raw VIIRS and harmonised monthly counts on one axis (same unit). */
export function renderRegionSensors(el, series, range) {
  const chart = makeChart(el);
  const pts = series.slice(range[0], range[1] + 1);
  const labels = pts.map((p) => `${MONTH_SHORT[p.month - 1]} ${p.year}`);
  const vStart = pts.findIndex((p) => p.source === 'V');
  const line = (name, data, color, width = 1.6) => ({
    type: 'line', name, data, symbol: 'none', connectNulls: false, lineStyle: { color, width }, itemStyle: { color },
  });
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 56, right: 14, top: 40, bottom: 56 },
    legend: { top: 0, textStyle: { color: C.text2, fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
    tooltip: { ...tooltip, trigger: 'axis', valueFormatter: (v) => (v == null ? 'no data' : fmt(v)) },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: C.axis, textStyle: { color: C.muted }, fillerColor: 'rgba(255,166,48,0.12)', handleStyle: { color: C.accent } }],
    xAxis: { type: 'category', data: labels, ...axis({ axisLabel: { color: C.text2, fontSize: 10, hideOverlap: true } }), splitLine: { show: false } },
    yAxis: { type: 'value', name: 'hotspots / month', ...axis({ axisLabel: { color: C.text2, fontSize: 11, formatter: fmtCompact } }) },
    series: [
      { ...line('Harmonised', pts.map((p) => p.value), C.harm, 2.2), z: 3,
        markLine: vStart > 0 ? { symbol: 'none', silent: true, lineStyle: { color: C.muted, width: 1, type: 'solid' },
          label: { color: C.text2, fontSize: 10, formatter: 'VIIRS era begins', position: 'insideEndTop' }, data: [{ xAxis: vStart }] } : undefined },
      line('Raw VIIRS S-NPP', pts.map((p) => (p.source == null || p.m < 0 ? null : (p.viirsRaw || (p.source === 'V' ? 0 : null)))), C.viirs),
      line('Raw MODIS', pts.map((p) => p.modisRaw), C.modis),
    ],
  }, { notMerge: true });
  return chart;
}
