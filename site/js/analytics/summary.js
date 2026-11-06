// Key statistics for the active selection and date range.
import { isComplete } from './aggregate.js';
import { compareToHistory } from './compare.js';
import { inRange } from './time.js';
import { annualTotals } from './seasonal.js';

export function keyStats(series, range) {
  let total = 0;
  let monthsWithData = 0;
  let incomplete = 0;
  let peakMonth = null;
  for (const p of series) {
    if (!inRange(p.m, range) || p.status === 'nodata') continue;
    total += p.value;
    monthsWithData += 1;
    if (!isComplete(p)) incomplete += 1;
    if (!peakMonth || p.value > peakMonth.value) peakMonth = p;
  }
  const annual = annualTotals(series, range);
  const full = annual.filter((a) => a.complete);
  const pool = full.length ? full : annual;
  const peakYear = pool.reduce((b, a) => (!b || a.total > b.total ? a : b), null);
  let latest = null;
  for (let m = range[1]; m >= range[0]; m--) {
    if (series[m] && series[m].status !== 'nodata') { latest = series[m]; break; }
  }
  const latestCmp = latest ? compareToHistory(series, range, latest.m) : null;
  return {
    total, monthsWithData, incomplete,
    peakMonth: peakMonth && peakMonth.value > 0 ? peakMonth : null,
    peakYear: peakYear && peakYear.total > 0 ? { ...peakYear, partialPool: !full.length } : null,
    latest, latestMedian: latestCmp && latestCmp.status !== 'none' ? latestCmp.median : null,
    latestRefN: latestCmp ? latestCmp.n : 0,
  };
}
