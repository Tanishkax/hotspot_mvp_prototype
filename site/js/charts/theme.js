// Shared chart styling, colour scales and formatting.
export const C = {
  bg: '#11171f', surface2: '#161e29', border: '#222d3a', grid: '#1c2632', axis: '#2e3c4d',
  text: '#e9eef3', text2: '#a9b5c2', muted: '#74828f', accent: '#ffa630',
  modis: '#3987e5', viirs: '#d95926', harm: '#199e70', critical: '#e05252', zero: '#2a3544', low: '#9ec5f4', high: '#ffffff',
};

// Viridis (matplotlib), trimmed at the dark end so the lowest values stay visible on the dark surface.
export const VIRIDIS = ['#46327e', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour for t in [0,1] along viridis. */
export function viridis(t) {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(VIRIDIS[i]); const b = hexToRgb(VIRIDIS[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
export const fmt = (x, d = 0) => (x == null || !Number.isFinite(x) ? '—' : (d ? nf1 : nf0).format(x));
export function fmtCompact(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(x / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return nf0.format(x);
}
export const fmtPct = (x, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);

export const tooltip = {
  backgroundColor: 'rgba(17,23,31,0.96)', borderColor: C.axis, borderWidth: 1, padding: [8, 10],
  textStyle: { color: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.5);',
};

export const baseText = { fontFamily: 'Inter, system-ui, sans-serif', color: C.text2, fontSize: 11 };

export function axis(extra = {}) {
  return {
    axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false },
    axisLabel: { color: C.text2, fontSize: 11 }, splitLine: { lineStyle: { color: C.grid } },
    nameTextStyle: { color: C.muted, fontSize: 11 }, ...extra,
  };
}

/** Create (or reuse) an ECharts instance that follows its container size. */
export function makeChart(el) {
  const existing = echarts.getInstanceByDom(el);
  if (existing) return existing;
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  new ResizeObserver(() => chart.resize()).observe(el);
  return chart;
}

export function exportPNG(chart, filename) {
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: C.bg });
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
