import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateMonthly, buildSeries } from '../../site/js/analytics/aggregate.js';
import { robustScore, scoreSeries } from '../../site/js/analytics/anomaly.js';
import { compareToHistory, pickTarget } from '../../site/js/analytics/compare.js';
import { annualTotals, monthlyProfile, peakWindow, seasonShares, viirsTrend } from '../../site/js/analytics/seasonal.js';
import { mad, median, percentileRank, theilSen } from '../../site/js/analytics/stats.js';
import { keyStats } from '../../site/js/analytics/summary.js';
import { indexToYM, normaliseRange, parseYM, ymToIndex } from '../../site/js/analytics/time.js';
import { makeManifest, makeTile } from './fixtures.mjs';

test('time helpers round-trip and validate', () => {
  assert.equal(ymToIndex(2024, 3, 2000), 290);
  assert.deepEqual(indexToYM(290, 2000), { year: 2024, month: 3 });
  assert.equal(parseYM('2000-01', 2000), 0);
  assert.throws(() => parseYM('2000-13', 2000));
  assert.throws(() => parseYM('2000/01', 2000));
  assert.deepEqual(normaliseRange(10, 2, 0, 5), [2, 5]);
  assert.equal(normaliseRange(10, 20, 0, 5), null);
});

test('stats: median, MAD, percentile, Theil-Sen', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(mad([1, 2, 3, 4, 100]), 1);
  assert.equal(percentileRank(5, [1, 5, 9, 10]), 37.5);
  const { slope, intercept } = theilSen([1, 2, 3, 4, 5], [2, 4, 6, 8, 100]);
  assert.equal(slope, 2);
  assert.equal(intercept, 0);
});

test('monthly aggregation respects the cell mask', () => {
  const tile = makeTile();
  const all = aggregateMonthly([tile], new Map([['t20_075', new Uint8Array([1, 1, 1])]]), 36);
  assert.equal(all.h[3], 15);
  assert.equal(all.h[4], 107);
  assert.equal(all.h[24], 3);
  assert.equal(all.nCells, 3);
  const onlyA = aggregateMonthly([tile], new Map([['t20_075', new Uint8Array([1, 0, 0])]]), 36);
  assert.equal(onlyA.h[3], 10);
  assert.equal(onlyA.h[4], 7);
  assert.equal(onlyA.h[24], 0);
  assert.equal(onlyA.f[4], 28);
  assert.equal(onlyA.mo[3], 2);
});

test('series status distinguishes no-data, incomplete, observed zero', () => {
  const s = buildSeries(aggregateMonthly([makeTile()], new Map([['t20_075', new Uint8Array([1, 1, 1])]]), 36), makeManifest());
  assert.equal(s[0].status, 'nodata');
  assert.equal(s[0].value, null);
  assert.equal(s[3].status, 'ok');
  assert.equal(s[5].status, 'zero');   // covered month without records = observed zero
  assert.equal(s[5].value, 0);
  assert.equal(s[18].status, 'incomplete');
  assert.equal(s[24].source, 'V');
});

function seriesFrom(values, { incomplete = [], nodata = [] } = {}) {
  // values: array of {year, month, value}
  return values.map((v, m) => ({
    m, year: v.year, month: v.month, value: nodata.includes(m) ? null : v.value, source: 'V',
    status: nodata.includes(m) ? 'nodata' : incomplete.includes(m) ? 'incomplete' : v.value === 0 ? 'zero' : 'ok',
  }));
}

/** 10 years x 12 months; March has a flat history of 100 except a spike of 1000 in the last year. */
function marchSeries(last = 1000) {
  const out = [];
  for (let y = 2010; y < 2020; y++) for (let mo = 1; mo <= 12; mo++) {
    let v = mo === 3 ? 100 + (y % 3) * 10 : 50;
    if (y === 2019 && mo === 3) v = last;
    out.push({ year: y, month: mo, value: v });
  }
  return seriesFrom(out);
}

test('robust score: insufficient history is never classified', () => {
  assert.equal(robustScore(500, [1, 2, 3]).status, 'insufficient');
});

test('robust score: flags a spike, uses scale floor and absolute guard', () => {
  const r = robustScore(1000, [100, 110, 120, 100, 110, 120, 100], { minAbsDiff: 10 });
  assert.equal(r.status, 'high');
  assert.ok(r.z > 3.5);
  assert.equal(r.median, 110);
  // flat history (MAD = meanAD = 0) uses the 0.25 floor: log1p(4)/0.25 > 3.5 but abs diff 4 < 10
  assert.equal(robustScore(4, [0, 0, 0, 0, 0], { minAbsDiff: 10 }).status, 'normal');
  assert.equal(robustScore(40, [0, 0, 0, 0, 0], { minAbsDiff: 10 }).status, 'high');
  assert.equal(robustScore(0, [200, 210, 190, 205, 195], { minAbsDiff: 10 }).status, 'low');
});

test('scoreSeries excludes the target year and incomplete months from baselines', () => {
  const s = marchSeries();
  const scores = scoreSeries(s);
  const spike = s.findIndex((p) => p.year === 2019 && p.month === 3);
  assert.equal(scores[spike].status, 'high');
  assert.equal(scores[spike].n, 9);          // other 9 years only
  assert.equal(scores[spike].median, 110);   // target excluded
  // an incomplete month is not scored and is not part of other months' baselines
  const s2 = marchSeries();
  s2[spike].status = 'incomplete';
  const sc2 = scoreSeries(s2);
  assert.equal(sc2[spike].status, 'incomplete');
  const mar2018 = s2.findIndex((p) => p.year === 2018 && p.month === 3);
  assert.equal(sc2[mar2018].n, 8);
});

test('comparison skips an incomplete latest month and reports it', () => {
  const s = marchSeries(300);
  const last = s.length - 1; // Dec 2019
  s[last].status = 'incomplete';
  const { target, skipped } = pickTarget(s, [0, last]);
  assert.equal(target.m, last - 1);
  assert.equal(skipped.length, 1);
  const spike = s.findIndex((p) => p.year === 2019 && p.month === 3);
  const c = compareToHistory(s, [0, last], spike);
  assert.equal(c.status, 'ok');
  assert.equal(c.median, 110);
  assert.equal(c.diff, 190);
  assert.ok(Math.abs(c.pct - 172.727) < 0.01);
  assert.equal(c.direction, 'above');
  assert.equal(c.n, 9);
  // too little history
  const short = compareToHistory(s.slice(0, 36), [0, 35], 26);
  assert.equal(short.status, 'insufficient');
});

test('comparison: pct is null when the historical median is zero', () => {
  const vals = [];
  for (let y = 2010; y < 2017; y++) vals.push({ year: y, month: 1, value: y === 2016 ? 5 : 0 });
  const s = seriesFrom(vals);
  const c = compareToHistory(s, [0, 6], 6, { minRefYears: 5 });
  assert.equal(c.median, 0);
  assert.equal(c.pct, null);
});

test('seasonal profile shares sum to 100 and peak window wraps', () => {
  const vals = [];
  for (let y = 2010; y < 2012; y++) for (let mo = 1; mo <= 12; mo++) vals.push({ year: y, month: mo, value: [12, 1].includes(mo) ? 40 : mo === 11 ? 20 : 0 });
  const s = seriesFrom(vals);
  const { profile } = monthlyProfile(s, [0, 23]);
  const total = profile.reduce((t, p) => t + p.share, 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
  assert.equal(profile[11].share, 40);
  const pk = peakWindow(profile, 3);
  assert.deepEqual(pk.months, [11, 12, 1]);
  assert.equal(pk.share, 100);
  const seasons = seasonShares(profile);
  assert.equal(seasons.find((x) => x.key === 'winter').share, 40);
  assert.equal(seasons.find((x) => x.key === 'postmonsoon').share, 60);
});

test('seasonal profile uses means so partially covered months are not under-weighted', () => {
  // range covers Jan twice but Feb once; equal monthly values -> equal shares
  const vals = [{ year: 2010, month: 1, value: 10 }, { year: 2010, month: 2, value: 10 }];
  for (let mo = 3; mo <= 12; mo++) vals.push({ year: 2010, month: mo, value: 0 });
  vals.push({ year: 2011, month: 1, value: 10 });
  const { profile } = monthlyProfile(seriesFrom(vals), [0, 12]);
  assert.equal(profile[0].share, profile[1].share);
});

test('annual totals, completeness and VIIRS-only trend', () => {
  const vals = [];
  for (let y = 2010; y < 2017; y++) for (let mo = 1; mo <= 12; mo++) vals.push({ year: y, month: mo, value: 10 * (y - 2009) });
  const s = seriesFrom(vals);
  const annual = annualTotals(s, [0, s.length - 1]);
  assert.equal(annual.length, 7);
  assert.equal(annual[0].total, 120);
  assert.ok(annual.every((a) => a.complete && a.viirsOnly));
  const partial = annualTotals(s, [6, s.length - 1]);
  assert.equal(partial[0].complete, false);
  const tr = viirsTrend(annual);
  assert.equal(tr.status, 'ok');
  assert.equal(tr.slope, 120);
  assert.equal(viirsTrend(annual.slice(0, 3)).status, 'insufficient');
});

test('key stats: totals, peaks and latest month', () => {
  const s = marchSeries(1000);
  const k = keyStats(s, [0, s.length - 1]);
  assert.equal(k.peakMonth.year, 2019);
  assert.equal(k.peakMonth.month, 3);
  assert.equal(k.peakYear.year, 2019);
  assert.equal(k.latest.m, s.length - 1);
  assert.equal(k.latestMedian, 50);
  const expected = s.reduce((t, p) => t + p.value, 0);
  assert.equal(k.total, expected);
});

test('Terra-only (low-confidence) months are not scored and not used as references', () => {
  const s = marchSeries();
  s.forEach((p) => { if (p.year === 2010) p.source = 'T'; });
  const scores = scoreSeries(s);
  const mar2010 = s.findIndex((p) => p.year === 2010 && p.month === 3);
  const mar2019 = s.findIndex((p) => p.year === 2019 && p.month === 3);
  assert.equal(scores[mar2010].status, 'lowconf');
  assert.equal(scores[mar2019].n, 8);
  const c = compareToHistory(s, [0, s.length - 1], mar2019);
  assert.equal(c.n, 8);
});
