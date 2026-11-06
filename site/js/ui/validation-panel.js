// Validation section: loaded lazily when it scrolls into view.
import { renderBands, renderBaseline, renderNational, renderRatioByYear, renderScatter } from '../charts/validation.js';
import { C, esc, fmt, fmtPct } from '../charts/theme.js';
import { metricsTable } from './render.js';

const $ = (id) => document.getElementById(id);

async function renderCounts(store, man) {
  const v = await store.validation('real_harmonisation');
  const h = v.holdout;
  $('val-count-sub').textContent = `Ratios fitted on ${h.fit_years[0]}–${h.fit_years[1]}, evaluated on ${h.test_years[0]}–${h.test_years[1]} (complete months only). Correlations use log(1+count).`;
  $('val-count-table').innerHTML = metricsTable(h.levels, [
    ['cell_month_0.25deg', '0.25° cell-month'], ['cell_month_1deg', '1° cell-month'], ['national_month', 'All-India month']]);
  const sc = h.scatter_1deg;
  renderScatter($('chart-val-raw'), sc.modis_raw, sc.viirs, { xLabel: 'MODIS raw', yLabel: 'VIIRS', color: C.modis, unit: 'hotspots' });
  renderScatter($('chart-val-harm'), sc.modis_harmonised, sc.viirs, { xLabel: 'MODIS harmonised', yLabel: 'VIIRS', color: C.harm, unit: 'hotspots' });
  $('val-scatter-note').textContent = `Each point is one 1° cell-month in the test years where both sensors detected fire (random sample of ${fmt(sc.modis_raw.length)} of ${fmt(sc.n_total_pairs)}). Zero pairs cannot be drawn on log axes but are included in the table.`;
  renderNational($('chart-val-national'), h.national_series, man.base_year);
  renderRatioByYear($('chart-val-ratio'), v.yearly_ratio, h.fit_years);
  renderBands($('chart-val-bands'), v.ratio_tables.count_TA);
}

async function renderFRP(store, name) {
  const v = await store.validation(name);
  const synth = v.kind === 'synthetic';
  const call = $('frp-callout');
  call.className = `callout${synth ? ' synth' : ''}`;
  const a = v.anomaly_summary;
  call.innerHTML = synth
    ? `<strong>Synthetic data — code check only, not scientific validation.</strong> ${esc(v.description)} ${fmt(v.n_cells)} cells, ${v.date_range[0]} to ${v.date_range[1]}. ${fmt(a.n_flagged)} of ${fmt(a.n_scored)} scored rows flagged (${(100 * a.flag_rate).toFixed(1)}%).`
    : `<strong>Real data.</strong> ${esc(v.description)} ${fmt(v.n_cells)} cells, ${v.date_range[0]} to ${v.date_range[1]}. ${fmt(a.n_flagged)} of ${fmt(a.n_scored)} scored rows flagged (${(100 * a.flag_rate).toFixed(2)}%). Note the total bias of the harmonised FRP: ${fmtPct(v.metrics.harmonised.percent_bias, 0)}. The median-of-pairs ratio centres the typical week but not the total, which is why the monthly count harmonisation uses a ratio of sums.`;
  $('val-frp-table').innerHTML = metricsTable({ pairs: v.metrics }, [['pairs', synth ? 'Synthetic cell-weeks' : '1° cell-weeks (both sensors)']]);
  renderScatter($('chart-frp-raw'), v.scatter.modis_raw, v.scatter.viirs, { xLabel: 'MODIS raw FRP', yLabel: 'VIIRS FRP', color: C.modis, unit: 'MW' });
  renderScatter($('chart-frp-harm'), v.scatter.modis_harmonised, v.scatter.viirs, { xLabel: 'MODIS harmonised FRP', yLabel: 'VIIRS FRP', color: C.harm, unit: 'MW' });
  const sel = $('frp-cell');
  const ids = Object.keys(v.cells);
  sel.innerHTML = ids.map((id) => `<option value="${esc(id)}">${esc(id)} · ${v.cells[id].lat.toFixed(2)}°N ${v.cells[id].lon.toFixed(2)}°E</option>`).join('');
  const preferred = synth && ids.includes('C009') ? 'C009' : ids[0];
  sel.value = preferred;
  const draw = () => renderBaseline($('chart-frp-baseline'), v.cells[sel.value], sel.value);
  sel.onchange = draw;
  draw();
}

export function initValidation(store, man) {
  const section = $('validation');
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    try {
      await renderCounts(store, man);
      await renderFRP(store, document.querySelector('input[name="frp-ds"]:checked').value);
    } catch (err) {
      console.error(err);
      section.insertAdjacentHTML('beforeend', `<p class="error-banner" role="alert">Validation data could not be loaded: ${esc(err.message)}</p>`);
    }
  };
  document.querySelectorAll('input[name="frp-ds"]').forEach((r) => r.addEventListener('change', (e) => {
    renderFRP(store, e.target.value).catch((err) => console.error(err));
  }));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '600px' });
    io.observe(section);
  } else start();
}
