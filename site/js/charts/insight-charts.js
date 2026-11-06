// Comparison, seasonal profile and annual totals charts.
import { MONTH_LONG, MONTH_SHORT } from '../analytics/time.js';
import { C, axis, fmt, fmtCompact, makeChart, tooltip } from './theme.js';

export function renderComparison(el, cmp, unit) {
  const chart = makeChart(el);
  if (!cmp || cmp.status === 'none') { chart.clear(); return chart; }
  const t = cmp.target;
  const rows = [...cmp.refs, { year: t.year, value: t.value, target: true }].sort((a, b) => a.year - b.year);
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 52, right: 16, top: 24, bottom: 30 },
    tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: (p) => `<b>${MONTH_LONG[t.month - 1]} ${p[0].name}</b><br>${fmt(p[0].value)} ${unit}${rows[p[0].dataIndex].target ? '<br><span style="color:#ffa630">Selected month</span>' : ''}` },
    xAxis: { type: 'category', data: rows.map((r) => String(r.year)), ...axis({ axisLabel: { color: C.text2, fontSize: 10, hideOverlap: true } }), splitLine: { show: false } },
    yAxis: { type: 'value', ...axis({ axisLabel: { color: C.text2, fontSize: 11, formatter: fmtCompact } }) },
    series: [{
      type: 'bar', barMaxWidth: 22,
      data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.target ? C.accent : '#3a4a5e', borderRadius: [4, 4, 0, 0] } })),
      markLine: cmp.median != null ? {
        symbol: 'none', silent: true, lineStyle: { color: C.text, width: 1.5, type: 'solid' },
        label: { color: C.text, formatter: `median ${fmt(cmp.median)}`, position: 'insideEndTop', fontSize: 11 },
        data: [{ yAxis: cmp.median }],
      } : undefined,
    }],
  }, { notMerge: true });
  return chart;
}

export function renderProfile(el, profile, peak, unit) {
  const chart = makeChart(el);
  const inPeak = new Set(peak ? peak.months : []);
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 52, right: 12, top: 24, bottom: 28 },
    tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: (p) => {
        const a = profile[p[0].dataIndex];
        return `<b>${MONTH_LONG[a.month - 1]}</b><br>Mean ${fmt(a.mean)} ${unit}<br>${a.share != null ? `${a.share.toFixed(1)}% of the annual cycle` : 'No complete months'}<br><span style="color:${C.muted}">${a.n} complete months averaged</span>`;
      } },
    xAxis: { type: 'category', data: MONTH_SHORT, ...axis(), splitLine: { show: false } },
    yAxis: { type: 'value', ...axis({ axisLabel: { color: C.text2, fontSize: 11, formatter: fmtCompact } }) },
    series: [{
      type: 'bar', barMaxWidth: 28,
      data: profile.map((a) => ({ value: a.mean, itemStyle: { color: inPeak.has(a.month) ? C.accent : C.modis, borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: 'top', color: C.text2, fontSize: 10,
        formatter: (p) => { const a = profile[p.dataIndex]; return inPeak.has(a.month) && a.share != null ? `${a.share.toFixed(0)}%` : ''; } },
    }],
  }, { notMerge: true });
  return chart;
}

export function renderAnnual(el, annual, trend, unit) {
  const chart = makeChart(el);
  const firstV = annual.find((a) => a.viirsOnly);
  const data = annual.map((a) => ({
    value: a.total,
    itemStyle: { color: a.viirsOnly ? C.viirs : C.modis, opacity: a.complete ? 1 : 0.4, borderRadius: [4, 4, 0, 0] },
  }));
  const series = [{ type: 'bar', name: 'Annual total', barMaxWidth: 22, data }];
  if (trend && trend.status === 'ok') {
    series.push({
      type: 'line', name: 'Trend (Theil–Sen, VIIRS years)', symbol: 'none', lineStyle: { color: C.text, width: 2 }, silent: true,
      data: annual.map((a) => (a.year >= trend.firstYear && a.year <= trend.lastYear ? trend.intercept + trend.slope * a.year : null)),
    });
  }
  chart.setOption({
    animation: false, textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
    grid: { left: 56, right: 12, top: 36, bottom: 28 },
    legend: { top: 0, right: 0, textStyle: { color: C.text2, fontSize: 11 }, itemWidth: 12, itemHeight: 8,
      data: [{ name: 'MODIS-era (scaled)', icon: 'roundRect', itemStyle: { color: C.modis } }, { name: 'VIIRS era', icon: 'roundRect', itemStyle: { color: C.viirs } },
        ...(trend && trend.status === 'ok' ? [{ name: 'Trend (Theil–Sen, VIIRS years)', icon: 'path://M0,4L20,4L20,6L0,6Z', itemStyle: { color: C.text } }] : [])] },
    tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
      formatter: (p) => {
        const a = annual[p[0].dataIndex];
        return `<b>${a.year}</b><br>${fmt(a.total)} ${unit}<br><span style="color:${C.text2}">${a.viirsOnly ? 'VIIRS S-NPP' : a.sources.includes('V') ? 'MODIS (scaled) + VIIRS' : 'MODIS scaled to VIIRS'}</span>${a.complete ? '' : `<br><span style="color:#ffd9a3">Partial: ${a.completeMonths} of 12 complete months in period</span>`}`;
      } },
    xAxis: { type: 'category', data: annual.map((a) => String(a.year)), ...axis({ axisLabel: { color: C.text2, fontSize: 10, hideOverlap: true } }), splitLine: { show: false } },
    yAxis: { type: 'value', ...axis({ axisLabel: { color: C.text2, fontSize: 11, formatter: fmtCompact } }) },
    series: [
      ...series,
      // legend proxies (no data) so era colours are explained
      { type: 'bar', name: 'MODIS-era (scaled)', data: [], itemStyle: { color: C.modis } },
      { type: 'bar', name: 'VIIRS era', data: [], itemStyle: { color: C.viirs } },
    ],
  }, { notMerge: true });
  if (firstV) chart.firstViirsYear = firstV.year;
  return chart;
}
