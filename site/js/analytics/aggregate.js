// Region-level monthly aggregation over selected grid cells.
import { indexToYM } from './time.js';

export const METRIC_KEYS = ['h', 'f', 'mo', 'vi'];

/**
 * Sum tile records for the selected cells into dense per-month arrays.
 * tiles: array of tile objects; masks: Map(tileId -> Uint8Array over tile.cells.id).
 */
export function aggregateMonthly(tiles, masks, nMonths) {
  const out = { nCells: 0 };
  for (const k of METRIC_KEYS) out[k] = new Float64Array(nMonths);
  for (const tile of tiles) {
    const mask = masks.get(tile.tile);
    if (!mask) continue;
    for (let i = 0; i < mask.length; i++) out.nCells += mask[i];
    const { c, m } = tile.rec;
    for (let i = 0; i < c.length; i++) {
      if (!mask[c[i]] || m[i] >= nMonths) continue;
      for (const k of METRIC_KEYS) out[k][m[i]] += tile.rec[k][i];
    }
  }
  return out;
}

/**
 * Build the region's monthly series with explicit data-status semantics:
 *  nodata     - month outside satellite coverage (NOT zero)
 *  incomplete - satellite outage >= threshold days (value shown, excluded from baselines)
 *  zero       - covered month with no detections in the selection (observed zero)
 *  ok         - covered month with detections
 */
export function buildSeries(agg, manifest, metric = 'h') {
  const months = manifest.months;
  const base = manifest.base_year;
  const n = months.m.length;
  const series = new Array(n);
  for (let m = 0; m < n; m++) {
    const source = months.source[m];
    const { year, month } = indexToYM(m, base);
    let status;
    let value = round1(agg[metric][m]);
    if (source == null) {
      status = 'nodata';
      value = null;
    } else if (!months.complete[m]) status = 'incomplete';
    else if (value === 0) status = 'zero';
    else status = 'ok';
    series[m] = {
      m, year, month, value, status, source,
      missingDays: months.missing_days[m],
      modisRaw: source == null ? null : agg.mo[m],
      viirsRaw: source == null ? null : agg.vi[m],
    };
  }
  return series;
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}

export const isComplete = (p) => p.status === 'ok' || p.status === 'zero';
/** Months that may serve as (or be scored against) a historical baseline. Terra-only estimates
 *  (before Aqua) carry a much larger harmonisation uncertainty and are excluded. */
export const LOW_CONFIDENCE_SOURCES = new Set(['T']);
export const isBaselineEligible = (p) => isComplete(p) && !LOW_CONFIDENCE_SOURCES.has(p.source);
export const hasData = (p) => p.status !== 'nodata';
