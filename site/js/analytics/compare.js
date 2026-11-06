// Latest (or focused) month vs historical median of the same calendar month.
import { CONFIG } from '../config.js';
import { isComplete } from './aggregate.js';
import { median, percentileRank } from './stats.js';
import { inRange } from './time.js';

/**
 * Pick the target month: the focused month if given, otherwise the latest month in range with data.
 * If that month is incomplete, fall back to the most recent COMPLETE month and report what was skipped.
 */
export function pickTarget(series, range, focusM = null) {
  if (focusM != null && series[focusM] && series[focusM].status !== 'nodata') {
    return { target: series[focusM], skipped: [], focused: true };
  }
  const skipped = [];
  for (let m = range[1]; m >= range[0]; m--) {
    const p = series[m];
    if (!p || p.status === 'nodata') continue;
    if (isComplete(p)) return { target: p, skipped, focused: false };
    skipped.push(p);
  }
  return { target: null, skipped, focused: false };
}

export function compareToHistory(series, range, focusM = null, opts = {}) {
  const minRef = opts.minRefYears ?? CONFIG.comparison.minRefYears;
  const { target, skipped, focused } = pickTarget(series, range, focusM);
  if (!target) return { status: 'none', skipped };
  const refs = series
    .filter((p) => p.month === target.month && p.year !== target.year && isComplete(p))
    .map((p) => ({ year: p.year, value: p.value }));
  const values = refs.map((r) => r.value);
  const out = { target, skipped, focused, refs, n: refs.length, targetComplete: isComplete(target) };
  out.inRange = inRange(target.m, range);
  if (refs.length < minRef) return { ...out, status: 'insufficient', median: refs.length ? median(values) : null };
  const med = median(values);
  const diff = target.value - med;
  return {
    ...out,
    status: 'ok',
    median: med,
    diff,
    pct: med > 0 ? (100 * diff) / med : null,
    direction: diff > 0 ? 'above' : diff < 0 ? 'below' : 'equal',
    percentile: percentileRank(target.value, values),
  };
}
