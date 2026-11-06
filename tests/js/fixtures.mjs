// Deterministic fixtures with hand-checkable values.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const turf = require('../../site/vendor/turf/turf.min.js');

/** Manifest: 2000-01 .. 2002-12 (36 months). Jan-Mar 2000 have no data; 2001-07 is incomplete. */
export function makeManifest() {
  const n = 36;
  const source = Array.from({ length: n }, (_, m) => (m < 3 ? null : m < 24 ? 'TA' : 'V'));
  const complete = source.map((s, m) => s != null && m !== 18);
  const missing = source.map((s, m) => (s == null ? 31 : m === 18 ? 5 : 0));
  return {
    schema: '1.0.0', base_year: 2000, coverage: { start: '2000-04', end: '2002-12' },
    months: { m: Array.from({ length: n }, (_, i) => i), source, complete, missing_days: missing },
    tiles: [{ id: 't20_075', bbox: [75, 20, 80, 25] }, { id: 't25_075', bbox: [75, 25, 80, 30] }],
  };
}

/** Tile with 3 cells; records chosen so sums are easy to verify. */
export function makeTile() {
  return {
    schema: '1.0.0', tile: 't20_075',
    cells: { id: ['A', 'B', 'C'], lat: [21.125, 22.125, 24.875], lon: [76.125, 78.125, 79.875] },
    rec: {
      c: [0, 1, 0, 2, 1],
      m: [3, 3, 4, 4, 24],
      h: [10, 5, 7, 100, 3],
      f: [40, 20, 28, 400, 12],
      mo: [2, 1, 1, 20, 0],
      vi: [0, 0, 0, 0, 3],
    },
  };
}
