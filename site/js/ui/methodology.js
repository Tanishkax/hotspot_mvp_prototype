// Methodology & limitations section, filled from the dataset manifest (no hard-coded results).
import { CONFIG } from '../config.js';

export function renderMethodology(el, man) {
  const r = man.ratios.count;
  const cov = man.coverage;
  const sp = man.sensor_spans;
  el.innerHTML = `
  <div class="card">
    <h3>Data</h3>
    <ul>
      <li><strong>Source:</strong> NASA FIRMS yearly country archives for India — MODIS Collection 6.1 (Terra from ${sp.T[0]}, Aqua from ${sp.A[0]}) and VIIRS S-NPP 375 m (from ${sp.V[0]}).</li>
      <li><strong>Coverage:</strong> ${cov.start} to ${cov.end}; ${cov.n_cells.toLocaleString('en-US')} grid cells with at least one detection. Months before ${cov.start} have <em>no data</em>.</li>
      <li><strong>Filters:</strong> type ${man.filters.type}; MODIS confidence ${man.filters.modis_confidence}; VIIRS confidence ${man.filters.viirs_confidence}. Static industrial sources (type 2) are excluded.</li>
      <li><strong>Grid:</strong> detections are binned into ${man.grid_deg}° cells (about 27 km) by pixel centre, then summed per month. Files are partitioned into ${man.tile_deg}° tiles and loaded only for the area you select.</li>
    </ul>
  </div>
  <div class="card">
    <h3>Harmonisation (MODIS → VIIRS-equivalent)</h3>
    <ul>
      <li><strong>Reference sensor:</strong> VIIRS S-NPP, as in the supplied <code>fire_harmonise.py</code>. VIIRS sees many more, smaller fires, so raw MODIS counts are ~5× lower.</li>
      <li><strong>Ratio:</strong> per 1° latitude band, <em>sum(VIIRS) ÷ sum(MODIS)</em> over all overlap cell-months (${sp.V[0].slice(0, 4)}–${cov.end.slice(0, 4)}, complete months only). National fallback: ${r.fallback_TA} (Terra+Aqua), ${r.fallback_T} (Terra-only, used before Aqua).</li>
      <li><strong>Change from upstream:</strong> the upstream median of per-pair ratios ignores cell-months where only one sensor detected fire. Applied to real data it overestimates harmonised totals (see the FRP validation panel), so regional <em>totals</em> use a ratio of sums. The upstream estimator is shown alongside for comparison.</li>
      <li><strong>Fusion without double counting:</strong> each month uses one source — VIIRS from its first complete month, scaled MODIS before it. MODIS and VIIRS are never summed.</li>
      <li><strong>FRP</strong> (MW, summed) is a separate energy metric, harmonised the same way with its own ratios. It is never labelled as a count.</li>
    </ul>
  </div>
  <div class="card">
    <h3>Missing data, zeros and incomplete months</h3>
    <ul>
      <li><strong>Observed zero:</strong> a covered month in which no detection fell in the selection. FIRMS lists every detection, so absence within coverage is zero <em>detected</em> fire. Cloud, smoke and small fires can still hide burning.</li>
      <li><strong>No data:</strong> months outside satellite coverage. Shown hatched, never as zero.</li>
      <li><strong>Incomplete:</strong> months with ≥ 2 days of satellite outage, found when a sensor reports zero detections for all of India while its typical daily activity in a 31-day window is ≥ 10 (plus the documented Terra outage of June–July 2001). Incomplete months are shown but excluded from baselines and comparisons.</li>
    </ul>
  </div>
  <div class="card">
    <h3>Selection, comparison and anomalies</h3>
    <ul>
      <li><strong>Geographic selection:</strong> a cell is included when its <em>centre</em> lies inside the drawn shape (points on the edge count as inside). Detections are not re-tested individually, so edges are accurate to about half a cell.</li>
      <li><strong>Historical comparison:</strong> the latest complete month in the period (or the month you click) against the median of the same calendar month in every <em>other</em> complete year, for the same selection. At least ${CONFIG.comparison.minRefYears} years are required.</li>
      <li><strong>Anomalies:</strong> modified z-score on log(1+value): (x − median) ÷ (1.4826 × MAD), with a 1.2533 × mean-absolute-deviation fallback when MAD is 0 and a floor of ${CONFIG.anomaly.minScale}. Flags need |z| ≥ ${CONFIG.anomaly.threshold}, at least ${CONFIG.anomaly.minAbsDiff.h} hotspots (${CONFIG.anomaly.minAbsDiff.f} MW) of absolute difference, and ≥ ${CONFIG.anomaly.minRefYears} complete reference years. Terra-only months (before Aqua, ${sp.A[0].slice(0, 7)}) are shown but neither scored nor used as references, because their regional scaling ratios are large and uncertain. Otherwise the month is <em>not scored</em>, rather than called normal.</li>
      <li>Baselines use the whole archive, independent of the period filter, so a month's flag does not change when you zoom in time.</li>
      <li><strong>Seasonal shares</strong> use the mean of each calendar month, so a period that contains more Januaries than Julys is not biased.</li>
    </ul>
  </div>
  <div class="card span-2">
    <h3>Limitations</h3>
    <ul>
      <li><strong>Not independently validated.</strong> The holdout test checks that scaled MODIS reproduces VIIRS. It is not a comparison against ground truth or burned-area products.</li>
      <li><strong>Sensor boundary:</strong> values before ${sp.V[0].slice(0, 7)} are MODIS-based estimates. Trends spanning 2012 mix sensors, which is why the trend shown uses VIIRS years only. Terra-only months (before Aqua) carry the largest uncertainty.</li>
      <li><strong>Non-stationary ratio:</strong> the VIIRS/MODIS ratio varies from year to year (see the chart), partly because of Terra and Aqua orbital drift in later years. One ratio per band does not capture this.</li>
      <li><strong>Latitude bands</strong> can mix regions with different fire types and true ratios (a limitation inherited from the upstream method). Bands with too few pairs fall back to the national ratio.</li>
      <li><strong>Detection is not burning:</strong> counts are satellite detections at overpass times. Cloud cover (especially in the monsoon), smoke, canopy and small or short fires reduce detection. A zero means "nothing detected".</li>
      <li><strong>Small baselines:</strong> the archive gives at most ${Number(cov.end.slice(0, 4)) - Number(cov.start.slice(0, 4)) + 1} years per calendar month, but small regions with sparse fire can still produce unstable scores. The absolute-difference guard limits but does not remove false alarms.</li>
      <li><strong>Upstream weekly FRP pipeline:</strong> it was tested on synthetic data only, treats absent weeks as missing (not zero), uses only weeks where both sensors detected fire for its ratio, and produced about 2.5–3% flags on synthetic data. Its outputs are shown as validation material, not as the main analysis.</li>
      <li><strong>Boundaries:</strong> the India extent follows the FIRMS country subset. Basemap borders are not authoritative.</li>
    </ul>
  </div>
  <div class="card span-2">
    <h3>Reference figures supplied with the upstream pipeline</h3>
    <p>Static images from the synthetic test of <code>fire_harmonise.py</code>. They are reproduced as live charts above, from data, and kept here for provenance only.</p>
    <div class="ref-figs">
      <figure><img src="assets/reference/val_harmonisation.png" alt="Synthetic raw and harmonised MODIS versus VIIRS scatter plots with 1:1 line" loading="lazy" width="1500" height="600"><figcaption>Synthetic: raw vs harmonised</figcaption></figure>
      <figure><img src="assets/reference/val_baseline_cell.png" alt="Synthetic weekly VIIRS activity for cell C009 with baseline, 3 SD range and flagged weeks" loading="lazy" width="1500" height="600"><figcaption>Synthetic: cell C009 baseline</figcaption></figure>
    </div>
  </div>`;
}
