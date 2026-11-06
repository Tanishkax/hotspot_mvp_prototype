// Year x month burning calendar (primary visualisation).
import { MONTH_LONG, MONTH_SHORT, inRange, ymToIndex } from '../analytics/time.js';
import { C, VIRIDIS, axis, fmt, makeChart, tooltip } from './theme.js';

const SOURCE = { V: 'VIIRS S-NPP', TA: 'MODIS Terra+Aqua, scaled to VIIRS', T: 'MODIS Terra only, scaled to VIIRS' };
const K = { OUTSIDE: 1, NODATA: 2, ZERO: 4, INCOMPLETE: 8, HIGH: 16, LOW: 32, FOCUS: 64 };

function hatch(x, y, w, h, step, style) {
  // diagonal lines (bottom-left to top-right) clipped to the rectangle
  const lines = [];
  for (let c = step; c < w + h; c += step) {
    const x1 = x + Math.max(0, c - h); const y1 = y + h - Math.min(c, h);
    const x2 = x + Math.min(c, w); const y2 = y + h - Math.max(0, c - w);
    lines.push({ type: 'line', shape: { x1, y1: y1, x2, y2: y2 }, style, silent: true });
  }
  return lines;
}

function renderOverlay(params, api) {
  const mi = api.value(0); const yi = api.value(1); const k = api.value(2);
  const [cx, cy] = api.coord([mi, yi]);
  const [cw, ch] = api.size([1, 1]);
  const x = cx - cw / 2 + 1.5; const y = cy - ch / 2 + 1.5; const w = cw - 3; const h = ch - 3;
  const kids = [];
  if (k & K.OUTSIDE) kids.push({ type: 'rect', shape: { x, y, width: w, height: h, r: 3 }, style: { fill: 'rgba(255,255,255,0.025)' } });
  if (k & K.NODATA) {
    kids.push({ type: 'rect', shape: { x, y, width: w, height: h, r: 3 }, style: { fill: 'transparent', stroke: '#364456', lineWidth: 1 } });
    kids.push(...hatch(x, y, w, h, 6, { stroke: '#2b3747', lineWidth: 1 }));
  }
  if (k & K.ZERO) kids.push({ type: 'rect', shape: { x, y, width: w, height: h, r: 3 }, style: { fill: C.zero } });
  if (k & K.INCOMPLETE) kids.push(...hatch(x, y, w, h, 5, { stroke: 'rgba(255,255,255,0.5)', lineWidth: 1 }));
  const tri = Math.max(5, Math.min(9, h * 0.38));
  if (k & K.HIGH) {
    kids.push({ type: 'rect', shape: { x: x + 1, y: y + 1, width: w - 2, height: h - 2, r: 3 }, style: { fill: 'transparent', stroke: C.high, lineWidth: 2 } });
    kids.push({ type: 'polygon', shape: { points: [[x + w - tri - 2, y + 2], [x + w - 2, y + 2], [x + w - 2, y + tri + 2]] }, style: { fill: C.high } });
  }
  if (k & K.LOW) {
    kids.push({ type: 'rect', shape: { x: x + 1, y: y + 1, width: w - 2, height: h - 2, r: 3 }, style: { fill: 'transparent', stroke: C.low, lineWidth: 2 } });
    kids.push({ type: 'polygon', shape: { points: [[x + 2, y + h - tri - 2], [x + 2, y + h - 2], [x + tri + 2, y + h - 2]] }, style: { fill: C.low } });
  }
  if (k & K.FOCUS) kids.push({ type: 'rect', shape: { x: x - 1, y: y - 1, width: w + 2, height: h + 2, r: 4 }, style: { fill: 'transparent', stroke: C.accent, lineWidth: 2.5 } });
  return { type: 'group', children: kids };
}

export function tooltipHTML(p, s, metric, unit) {
  const name = `${MONTH_LONG[p.month - 1]} ${p.year}`;
  if (p.status === 'nodata') return `<b>${name}</b><br>No satellite data (outside MODIS/VIIRS coverage)`;
  const lines = [`<b>${name}</b>`, `<span style="font-size:15px;font-weight:600">${fmt(p.value, p.value < 10 && p.value % 1 ? 1 : 0)}</span> ${unit}`];
  lines.push(`<span style="color:${C.text2}">${SOURCE[p.source] || ''}</span>`);
  if (p.status === 'zero') lines.push('Observed zero: no fire detected');
  if (p.status === 'incomplete') lines.push(`<span style="color:#ffd9a3">Incomplete: ${p.missingDays} days of satellite outage. Not scored.</span>`);
  if (s) {
    if (s.status === 'high' || s.status === 'low') {
      lines.push(`<b style="color:${s.status === 'high' ? '#fff' : C.low}">${s.status === 'high' ? '▲ Unusually high' : '▼ Unusually low'}</b> · robust z ${s.z.toFixed(1)}`);
    } else if (s.status === 'normal') lines.push(`Within normal range · robust z ${s.z.toFixed(1)}`);
    else if (s.status === 'insufficient') lines.push(`Not scored: only ${s.n} comparable years`);
    else if (s.status === 'lowconf') lines.push('<span style="color:#ffd9a3">Not scored: Terra-only estimate (before Aqua), large harmonisation uncertainty</span>');
    if (s.median != null && s.status !== 'nodata') lines.push(`Median ${MONTH_SHORT[p.month - 1]} (other years): ${fmt(s.median)} · n=${s.n}`);
  }
  if (metric === 'h' && p.modisRaw != null) lines.push(`<span style="color:${C.muted}">Raw MODIS ${fmt(p.modisRaw)} · raw VIIRS ${fmt(p.viirsRaw)}</span>`);
  return lines.join('<br>');
}

export function renderCalendar(el, { series, scores, range, metric, unit, focusM, onSelect }) {
  const chart = makeChart(el);
  const base = series[0].year;
  const y0 = series[range[0]].year; const y1 = series[range[1]].year;
  const years = []; for (let y = y0; y <= y1; y++) years.push(y);
  const heat = []; const overlay = [];
  let max = 0;
  for (let yi = 0; yi < years.length; yi++) {
    for (let mo = 1; mo <= 12; mo++) {
      const m = ymToIndex(years[yi], mo, base);
      const p = series[m];
      if (!p) continue;
      let k = 0;
      if (!inRange(m, range)) k |= K.OUTSIDE;
      else {
        const s = scores[m];
        if (p.status === 'nodata') k |= K.NODATA;
        else if (p.value === 0) k |= K.ZERO;
        else { heat.push([mo - 1, yi, Math.log10(1 + p.value), m]); max = Math.max(max, p.value); }
        if (p.status === 'incomplete') k |= K.INCOMPLETE;
        if (s && s.status === 'high') k |= K.HIGH;
        if (s && s.status === 'low') k |= K.LOW;
        if (focusM === m) k |= K.FOCUS;
      }
      if (k) overlay.push([mo - 1, yi, k, m]);
    }
  }
  const maxLog = Math.max(1, Math.log10(1 + max));
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 52, right: 16, top: 26, bottom: 64 },
    tooltip: {
      ...tooltip, trigger: 'item',
      formatter: (prm) => {
        const m = prm.value[3];
        if (!inRange(m, range)) return `${MONTH_LONG[series[m].month - 1]} ${series[m].year}<br><span style="color:${C.muted}">Outside the selected period</span>`;
        return tooltipHTML(series[m], scores[m], metric, unit);
      },
    },
    xAxis: { type: 'category', data: MONTH_SHORT, position: 'top', ...axis(), axisLine: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: years.map(String), inverse: true, ...axis(), axisLine: { show: false }, splitLine: { show: false } },
    visualMap: {
      type: 'continuous', seriesIndex: 0, dimension: 2, min: 0, max: maxLog, calculable: false, realtime: false,
      orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 12, itemHeight: 260,
      inRange: { color: VIRIDIS }, textStyle: { color: C.text2, fontSize: 11 },
      text: [`${fmt(max)} ${unit}`, `1   ·   log scale`], textGap: 10,
    },
    series: [
      { type: 'heatmap', data: heat, itemStyle: { borderColor: C.bg, borderWidth: 3, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } }, progressive: 0 },
      { type: 'custom', data: overlay, renderItem: renderOverlay, z: 3, encode: { x: 0, y: 1 } },
    ],
  }, { notMerge: true });
  chart.off('click');
  chart.on('click', (prm) => {
    const m = prm.value && prm.value[3];
    if (m != null && inRange(m, range) && series[m].status !== 'nodata') onSelect(m);
  });
  return chart;
}
