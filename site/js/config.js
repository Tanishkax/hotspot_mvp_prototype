// Central configuration. Analytical constants are documented in docs/methodology.md.
export const CONFIG = {
  dataRoot: './data/',
  anomaly: {
    minRefYears: 5,      // complete same-calendar-month years needed to score a month
    threshold: 3.5,      // |robust z| (Iglewicz & Hoaglin modified z-score) for a flag
    minScale: 0.25,      // floor on the robust scale, log1p units (~ +/-28 %) to avoid blow-ups
    minAbsDiff: { h: 10, f: 50 }, // also require this absolute departure from the median (noise guard)
  },
  comparison: { minRefYears: 5 },
  seasons: [
    { key: 'winter', label: 'Winter', months: [1, 2] },
    { key: 'premonsoon', label: 'Pre-monsoon', months: [3, 4, 5] },
    { key: 'monsoon', label: 'Monsoon', months: [6, 7, 8, 9] },
    { key: 'postmonsoon', label: 'Post-monsoon', months: [10, 11, 12] },
  ],
  trendMinYears: 5,
};

export const METRICS = {
  h: { key: 'h', short: 'Hotspots', label: 'Harmonised hotspot count', unit: 'hotspots', decimals: 0 },
  f: { key: 'f', short: 'FRP', label: 'Harmonised fire radiative power', unit: 'MW', decimals: 0 },
};
