// Robust monthly anomaly detection (modified z-score on log1p values, leave-target-out).
import { CONFIG } from '../config.js';
import { LOW_CONFIDENCE_SOURCES, isBaselineEligible } from './aggregate.js';
import { mad, meanAbsDev, median } from './stats.js';

/**
 * Score one value against reference values of the same calendar month from OTHER years.
 * Returns { status: 'high'|'low'|'normal'|'insufficient', z, median, n, scale }.
 */
export function robustScore(value, refs, opts = {}) {
  const o = { ...CONFIG.anomaly, minAbsDiff: 10, ...opts };
  const n = refs.length;
  if (n < o.minRefYears) return { status: 'insufficient', z: null, median: n ? median(refs) : null, n, scale: null };
  const lx = Math.log1p(value);
  const lr = refs.map((r) => Math.log1p(r));
  const med = median(lr);
  let scale = 1.4826 * mad(lr, med);
  if (scale === 0) scale = 1.2533 * meanAbsDev(lr, med);
  scale = Math.max(scale, o.minScale);
  const z = (lx - med) / scale;
  const medValue = median(refs); // reported on the original scale (log1p is monotonic)
  let status = 'normal';
  if (z >= o.threshold && value - medValue >= o.minAbsDiff) status = 'high';
  else if (z <= -o.threshold && medValue - value >= o.minAbsDiff) status = 'low';
  return { status, z, median: medValue, n, scale };
}

/**
 * Score every month of a series. Baselines use ALL complete months of the same calendar month in
 * other years (independent of any display date filter). Incomplete, no-data and Terra-only (low
 * confidence) months are not scored and are not used as references.
 * Returns an array aligned with series.
 */
export function scoreSeries(series, metric = 'h', opts = {}) {
  const minAbsDiff = opts.minAbsDiff ?? CONFIG.anomaly.minAbsDiff[metric] ?? 10;
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const p of series) if (isBaselineEligible(p)) byMonth[p.month - 1].push(p);
  return series.map((p) => {
    if (p.status === 'nodata') return { status: 'nodata', z: null, median: null, n: 0 };
    const refs = byMonth[p.month - 1].filter((q) => q.year !== p.year).map((q) => q.value);
    if (p.status === 'incomplete') {
      return { status: 'incomplete', z: null, median: refs.length ? median(refs) : null, n: refs.length };
    }
    if (LOW_CONFIDENCE_SOURCES.has(p.source)) {
      return { status: 'lowconf', z: null, median: refs.length ? median(refs) : null, n: refs.length };
    }
    return robustScore(p.value, refs, { ...opts, minAbsDiff });
  });
}
