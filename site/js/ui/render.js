// DOM rendering for statistics, comparison, anomalies, seasonal insights and the table view.
import { MONTH_LONG, MONTH_SHORT, inRange, labelYM } from '../analytics/time.js';
import { esc, fmt, fmtPct } from '../charts/theme.js';
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);
const SRC = { V: 'VIIRS S-NPP', TA: 'MODIS scaled', T: 'MODIS Terra scaled' };

function kpi(label, value, unit, note) {
  return `<div class="kpi"><div class="k-label">${label}</div><div class="k-value">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="k-note">${note}</div></div>`;
}

export function renderKPIs(k, { metricLabel, unit, coverageEnd }) {
  const el = $('kpis');
  if (!k) {
    el.innerHTML = ['Total', 'Peak month', 'Peak year', 'Latest month', 'Historical median'].map((l) => kpi(l, '—', '', 'No data in selection')).join('');
    return;
  }
  const latest = k.latest;
  const latestLabel = latest ? `${MONTH_SHORT[latest.month - 1]} ${latest.year}` : '—';
  const isLatestAvailable = latest && `${latest.year}-${String(latest.month).padStart(2, '0')}` === coverageEnd;
  el.innerHTML = [
    kpi(`Total ${metricLabel.toLowerCase()}`, fmt(k.total), unit, `${k.monthsWithData} months with data${k.incomplete ? ` · ${k.incomplete} incomplete` : ''}`),
    kpi('Peak month', k.peakMonth ? `${MONTH_SHORT[k.peakMonth.month - 1]} ${k.peakMonth.year}` : '—', '', k.peakMonth ? `${fmt(k.peakMonth.value)} ${unit}` : 'No activity recorded'),
    kpi('Peak year', k.peakYear ? String(k.peakYear.year) : '—', '', k.peakYear ? `${fmt(k.peakYear.total)} ${unit}${k.peakYear.partialPool ? '<span class="tag">partial years only</span>' : ''}` : 'No activity recorded'),
    kpi(isLatestAvailable ? 'Latest available month' : 'Last month in period', latestLabel, '',
      latest ? `${fmt(latest.value)} ${unit}${latest.status === 'incomplete' ? '<span class="tag">incomplete</span>' : ''}` : '—'),
    kpi(`Median ${latest ? MONTH_LONG[latest.month - 1] : 'month'}`, k.latestMedian != null ? fmt(k.latestMedian) : '—', k.latestMedian != null ? unit : '',
      k.latestRefN >= CONFIG.comparison.minRefYears ? `across ${k.latestRefN} other complete years` : `only ${k.latestRefN} comparable years`),
  ].join('');
}

function rankText(cmp) {
  if (cmp.refs.every((r) => cmp.target.value > r.value)) return 'highest on record';
  if (cmp.refs.every((r) => cmp.target.value < r.value)) return 'lowest on record';
  const p = Math.round(cmp.percentile);
  const sfx = p % 100 >= 11 && p % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][p % 10] || 'th';
  return `${p}${sfx} percentile`;
}

export function renderComparisonSummary(cmp, unit, baseYear) {
  const el = $('compare-sub');
  const box = $('compare-summary');
  $('btn-unfocus').hidden = !(cmp && cmp.focused);
  if (!cmp || cmp.status === 'none') {
    el.textContent = 'Same calendar month in every other complete year';
    box.innerHTML = '<p class="empty-state">No complete month with data in the selected period.</p>';
    return;
  }
  const t = cmp.target;
  const name = `${MONTH_LONG[t.month - 1]} ${t.year}`;
  el.textContent = `${name} vs ${MONTH_LONG[t.month - 1]} in ${cmp.n} other complete years`;
  const notices = [];
  if (cmp.skipped.length) {
    notices.push(`${cmp.skipped.map((p) => labelYM(p.m, baseYear)).join(', ')} ${cmp.skipped.length > 1 ? 'are' : 'is'} incomplete (satellite outage), so the most recent complete month is compared instead.`);
  }
  if (cmp.focused) notices.push('Showing the month you selected on the calendar.');
  if (!cmp.targetComplete) notices.push(`${name} is incomplete (${t.missingDays} outage days): its value is likely an undercount and should not be read against complete months.`);
  if (cmp.status === 'insufficient') {
    box.innerHTML = `<div class="cs"><div class="l">${name}</div><div class="v">${fmt(t.value)}</div></div>
      <p class="wide">Only ${cmp.n} comparable complete years (at least ${CONFIG.comparison.minRefYears} needed) — no historical median is reported.</p>
      ${notices.map((n) => `<p class="wide notice">${esc(n)}</p>`).join('')}`;
    return;
  }
  const dirCls = cmp.direction === 'above' ? 'up' : cmp.direction === 'below' ? 'down' : '';
  const word = cmp.direction === 'equal' ? 'equal to' : cmp.direction;
  box.innerHTML = `
    <div class="cs"><div class="l">${MONTH_SHORT[t.month - 1]} ${t.year}</div><div class="v">${fmt(t.value)}</div></div>
    <div class="cs"><div class="l">Historical median</div><div class="v">${fmt(cmp.median)}</div></div>
    <div class="cs"><div class="l">Difference</div><div class="v ${dirCls}">${cmp.diff > 0 ? '+' : ''}${fmt(cmp.diff)}</div></div>
    <div class="cs"><div class="l">Change</div><div class="v ${dirCls}">${cmp.pct == null ? 'n/a' : fmtPct(cmp.pct)}</div></div>
    <p class="wide">${esc(name)} recorded <strong>${fmt(t.value)} ${unit}</strong>, ${word} the ${MONTH_LONG[t.month - 1]} median of ${fmt(cmp.median)} (${cmp.n} years; ${rankText(cmp)}).${cmp.pct == null ? ' Percentage change is not meaningful because the median is zero.' : ''}</p>
    ${notices.map((n) => `<p class="wide notice">${esc(n)}</p>`).join('')}`;
}

export function renderAnomalies(series, scores, range, unit, onPick) {
  const items = [];
  let high = 0; let low = 0; let unscored = 0; let scored = 0;
  for (let m = range[0]; m <= range[1]; m++) {
    const s = scores[m];
    if (!s || s.status === 'nodata') continue;
    if (s.status === 'high' || s.status === 'low') items.push({ p: series[m], s });
    if (s.status === 'high') high += 1;
    else if (s.status === 'low') low += 1;
    else if (s.status === 'insufficient' || s.status === 'incomplete' || s.status === 'lowconf') unscored += 1;
    if (s.z != null) scored += 1;
  }
  $('anomaly-summary').innerHTML = `
    <div class="cs"><div class="l">▲ Unusually high</div><div class="v">${high}</div></div>
    <div class="cs"><div class="l">▼ Unusually low</div><div class="v">${low}</div></div>
    <div class="cs"><div class="l">Not scored</div><div class="v">${unscored}</div></div>`;
  items.sort((a, b) => Math.abs(b.s.z) - Math.abs(a.s.z));
  const list = $('anomaly-list');
  if (!items.length) {
    list.innerHTML = `<li class="empty-state" style="display:block;cursor:default">No month in this period departs from its history by more than ${CONFIG.anomaly.threshold} robust standard units (${scored} months scored).</li>`;
    return;
  }
  list.innerHTML = items.map(({ p, s }) => `
    <li tabindex="0" data-m="${p.m}" aria-label="${MONTH_LONG[p.month - 1]} ${p.year}, unusually ${s.status}, z ${s.z.toFixed(1)}">
      <span class="glyph ${s.status}">${s.status === 'high' ? '▲' : '▼'}</span>
      <span><span class="when">${MONTH_LONG[p.month - 1]} ${p.year}</span><br><span class="detail">${fmt(p.value)} ${unit} vs median ${fmt(s.median)} · ${SRC[p.source]}</span></span>
      <span class="z">z ${s.z > 0 ? '+' : ''}${s.z.toFixed(1)}</span>
    </li>`).join('');
  list.querySelectorAll('li[data-m]').forEach((li) => {
    const go = () => onPick(Number(li.dataset.m));
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

export function renderSeasonal({ profile, seasons, peak, annual, trend, topAnomaly }, unit) {
  const cards = [];
  if (peak) {
    cards.push(`<div class="insight"><div class="l">Critical period</div><p><strong>${peak.label}</strong> account for <strong>${peak.share.toFixed(0)}%</strong> of recorded ${unit === 'MW' ? 'fire radiative power' : 'hotspot activity'} in the selected region.</p></div>`);
  } else {
    cards.push('<div class="insight"><div class="l">Critical period</div><p>Not enough complete months to describe the seasonal cycle.</p></div>');
  }
  const ranked = profile.filter((a) => a.share != null).sort((a, b) => b.share - a.share).slice(0, 3);
  const domSeason = seasons.slice().sort((a, b) => b.share - a.share)[0];
  if (ranked.length && ranked[0].share > 0) {
    cards.push(`<div class="insight"><div class="l">Most active months</div><p>${ranked.map((a) => `<strong>${MONTH_LONG[a.month - 1]}</strong> (${a.share.toFixed(0)}%)`).join(', ')}. The <strong>${domSeason.label.toLowerCase()}</strong> season holds ${domSeason.share.toFixed(0)}% of the cycle.</p></div>`);
  } else cards.push('<div class="insight"><div class="l">Most active months</div><p>No activity recorded in complete months.</p></div>');
  const full = annual.filter((a) => a.complete);
  let third = '';
  if (trend && trend.status === 'ok' && trend.pctPerYear != null) {
    const dir = trend.slope > 0 ? 'increased' : 'decreased';
    third = `Across the VIIRS years ${trend.firstYear}–${trend.lastYear}, annual totals ${dir} by about <strong>${Math.abs(trend.pctPerYear).toFixed(1)}% per year</strong> (Theil–Sen).`;
  } else if (full.length) {
    const top = full.slice().sort((a, b) => b.total - a.total)[0];
    third = `The most active complete year was <strong>${top.year}</strong> (${fmt(top.total)} ${unit}).`;
  } else third = 'No complete calendar year in the selected period.';
  if (topAnomaly) third += ` Largest departure: <strong>${MONTH_LONG[topAnomaly.p.month - 1]} ${topAnomaly.p.year}</strong> (z ${topAnomaly.s.z > 0 ? '+' : ''}${topAnomaly.s.z.toFixed(1)}).`;
  cards.push(`<div class="insight"><div class="l">Notable periods</div><p>${third}</p></div>`);
  $('seasonal-insights').innerHTML = cards.join('');
  const maxShare = Math.max(1, ...seasons.map((s) => s.share));
  $('season-bars').innerHTML = seasons.map((s) => `
    <div class="season-row"><span>${s.label} <span style="color:var(--muted)">${s.months.map((m) => MONTH_SHORT[m - 1][0]).join('')}</span></span>
      <span class="track"><span class="fill" style="width:${(100 * s.share) / maxShare}%"></span></span><span class="pct">${s.covered ? `${s.share.toFixed(0)}%` : '—'}</span></div>`).join('');
}

export function renderTable(series, scores, range, unit) {
  const years = [];
  for (let y = series[range[0]].year; y <= series[range[1]].year; y++) years.push(y);
  const base = series[0].year;
  const rows = years.map((y) => {
    const cells = MONTH_SHORT.map((_, i) => {
      const m = (y - base) * 12 + i;
      const p = series[m];
      if (!p || !inRange(m, range)) return '<td class="na"></td>';
      if (p.status === 'nodata') return '<td class="na" title="no data">n/d</td>';
      const s = scores[m];
      const cls = p.status === 'incomplete' ? 'inc' : s && s.status === 'high' ? 'hi' : s && s.status === 'low' ? 'lo' : '';
      const mark = s && s.status === 'high' ? ' ▲' : s && s.status === 'low' ? ' ▼' : p.status === 'incomplete' ? '*' : '';
      return `<td class="${cls}">${fmt(p.value)}${mark}</td>`;
    }).join('');
    return `<tr><th scope="row">${y}</th>${cells}</tr>`;
  }).join('');
  $('calendar-table').innerHTML = `<table><caption class="hint" style="caption-side:bottom;text-align:left;padding:6px 8px">${unit}. n/d = no satellite data; * = incomplete month; ▲/▼ = anomaly.</caption><thead><tr><th>Year</th>${MONTH_SHORT.map((m) => `<th scope="col">${m}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function metricsTable(levels, labels) {
  const head = '<tr><th>Level</th><th>Version</th><th>n</th><th>r (log1p)</th><th>r</th><th>Bias (total)</th><th>Mean bias</th><th>MAE</th><th>Median VIIRS÷MODIS</th></tr>';
  const rows = [];
  for (const [key, lab] of labels) {
    const lv = levels[key];
    if (!lv) continue;
    for (const ver of ['raw', 'harmonised']) {
      const m = lv[ver];
      rows.push(`<tr><td>${ver === 'raw' ? lab : ''}</td><td>${ver === 'raw' ? 'MODIS raw' : '<strong>MODIS harmonised</strong>'}</td><td>${fmt(m.n)}</td><td>${m.pearson_r_log1p?.toFixed(3) ?? '—'}</td><td>${m.pearson_r?.toFixed(3) ?? '—'}</td><td>${fmtPct(m.percent_bias, 1)}</td><td>${fmt(m.mean_bias, 1)}</td><td>${fmt(m.mae, 1)}</td><td>${m.median_ratio_obs_over_pred?.toFixed(2) ?? '—'}</td></tr>`);
    }
  }
  return `<table class="metric-table"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table>`;
}
