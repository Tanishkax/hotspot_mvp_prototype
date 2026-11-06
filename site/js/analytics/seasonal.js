// Seasonal profile, season shares, peak windows and annual totals within the active date range.
import { CONFIG } from '../config.js';
import { isComplete } from './aggregate.js';
import { theilSen } from './stats.js';
import { inRange, MONTH_LONG } from './time.js';

/**
 * Mean value per calendar month over complete months in range. Using means (not sums) keeps
 * shares unbiased when the range covers some calendar months more often than others.
 */
export function monthlyProfile(series, range) {
  const acc = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, n: 0 }));
  for (const p of series) {
    if (!inRange(p.m, range) || !isComplete(p)) continue;
    acc[p.month - 1].total += p.value;
    acc[p.month - 1].n += 1;
  }
  const profile = acc.map((a) => ({ ...a, mean: a.n ? a.total / a.n : null }));
  const totalMean = profile.reduce((s, a) => s + (a.mean ?? 0), 0);
  const allMonths = profile.every((a) => a.n > 0);
  for (const a of profile) a.share = totalMean > 0 && a.mean != null ? (100 * a.mean) / totalMean : null;
  return { profile, totalMean, allMonths };
}

export function seasonShares(profile, seasons = CONFIG.seasons) {
  return seasons.map((s) => ({
    ...s,
    share: s.months.reduce((t, m) => t + (profile[m - 1].share ?? 0), 0),
    covered: s.months.every((m) => profile[m - 1].n > 0),
  }));
}

/** Highest-share window of `len` consecutive calendar months (wrapping Dec -> Jan). */
export function peakWindow(profile, len = 3) {
  let best = null;
  for (let start = 0; start < 12; start++) {
    const months = Array.from({ length: len }, (_, k) => ((start + k) % 12) + 1);
    if (months.some((m) => profile[m - 1].share == null)) continue;
    const share = months.reduce((t, m) => t + profile[m - 1].share, 0);
    if (!best || share > best.share) best = { months, share };
  }
  if (best) best.label = `${MONTH_LONG[best.months[0] - 1]} to ${MONTH_LONG[best.months[len - 1] - 1]}`;
  return best;
}

/** Annual totals for years touched by the range. complete = all 12 months in range and complete. */
export function annualTotals(series, range) {
  const years = new Map();
  for (const p of series) {
    if (!inRange(p.m, range) || p.status === 'nodata') continue;
    if (!years.has(p.year)) years.set(p.year, { year: p.year, total: 0, months: 0, completeMonths: 0, sources: new Set() });
    const y = years.get(p.year);
    y.total += p.value;
    y.months += 1;
    if (isComplete(p)) y.completeMonths += 1;
    y.sources.add(p.source);
  }
  return [...years.values()].map((y) => {
    const sources = [...y.sources];
    return { ...y, sources, complete: y.completeMonths === 12, viirsOnly: sources.length === 1 && sources[0] === 'V' };
  });
}

/** Robust trend over complete VIIRS-only years (avoids mixing sensors in a trend). */
export function viirsTrend(annual, minYears = CONFIG.trendMinYears) {
  const ys = annual.filter((a) => a.complete && a.viirsOnly);
  if (ys.length < minYears) return { status: 'insufficient', n: ys.length };
  const { slope, intercept } = theilSen(ys.map((a) => a.year), ys.map((a) => a.total));
  const mid = ys[Math.floor(ys.length / 2)].year;
  const level = intercept + slope * mid;
  return {
    status: 'ok', n: ys.length, slope, intercept,
    firstYear: ys[0].year, lastYear: ys[ys.length - 1].year,
    pctPerYear: level > 0 ? (100 * slope) / level : null,
  };
}
