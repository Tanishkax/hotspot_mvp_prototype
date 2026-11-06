export function sum(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(xs, med = median(xs)) {
  return median(xs.map((x) => Math.abs(x - med)));
}

export function meanAbsDev(xs, centre = median(xs)) {
  if (!xs.length) return NaN;
  return sum(xs.map((x) => Math.abs(x - centre))) / xs.length;
}

/** Fraction of reference values strictly below x plus half of ties (mid-rank percentile, 0-100). */
export function percentileRank(x, refs) {
  if (!refs.length) return NaN;
  let below = 0;
  let equal = 0;
  for (const r of refs) {
    if (r < x) below += 1;
    else if (r === x) equal += 1;
  }
  return (100 * (below + equal / 2)) / refs.length;
}

/** Theil-Sen slope and Sen intercept. Robust linear trend. */
export function theilSen(xs, ys) {
  const slopes = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    }
  }
  if (!slopes.length) return { slope: NaN, intercept: NaN };
  const slope = median(slopes);
  const intercept = median(xs.map((x, i) => ys[i] - slope * x));
  return { slope, intercept };
}
