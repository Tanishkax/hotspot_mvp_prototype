import assert from 'node:assert/strict';
import test from 'node:test';
import { DataStore } from '../../site/js/data/loader.js';
import { DataError, validateManifest, validateTile } from '../../site/js/data/schema.js';
import { aggregateRows, cellRows, csvEscape, exportFileName, toCSV } from '../../site/js/export/csv.js';
import { aggregateMonthly, buildSeries } from '../../site/js/analytics/aggregate.js';
import { scoreSeries } from '../../site/js/analytics/anomaly.js';
import {
  bboxToFeature, geometryBBox, parsePolygonText, selectCellsInTile, tilesForBBox, validateBounds,
} from '../../site/js/geo/selection.js';
import { makeManifest, makeTile, turf } from './fixtures.mjs';

test('bboxToFeature uses [lon, lat] order and a closed ring', () => {
  const f = bboxToFeature([76, 20, 80, 25]);
  const ring = f.geometry.coordinates[0];
  assert.deepEqual(ring[0], [76, 20]);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.deepEqual(geometryBBox(f), [76, 20, 80, 25]);
  // a point at lon 78, lat 22 is inside; swapped order (lat, lon) would be outside
  assert.ok(turf.booleanPointInPolygon([78, 22], f));
  assert.ok(!turf.booleanPointInPolygon([22, 78], f));
});

test('validateBounds catches bad input and inverted bounds', () => {
  assert.equal(validateBounds({ south: '20', north: '25', west: '75', east: '80' }).ok, true);
  assert.deepEqual(validateBounds({ south: 20, north: 25, west: 75, east: 80 }).bbox, [75, 20, 80, 25]);
  assert.equal(validateBounds({ south: 25, north: 20, west: 75, east: 80 }).ok, false);
  assert.equal(validateBounds({ south: 'x', north: 20, west: 75, east: 80 }).ok, false);
  assert.equal(validateBounds({ south: '', north: 20, west: 75, east: 80 }).ok, false);
  assert.equal(validateBounds({ south: 20, north: 25, west: 75, east: 200 }).ok, false);
  assert.match(validateBounds({ south: 50, north: 60, west: 0, east: 10 }).errors[0], /overlap/);
});

test('parsePolygonText reads "lat, lon" lines into [lon, lat] and closes the ring', () => {
  const r = parsePolygonText('20, 75\n25, 75\n25 80;20,80');
  assert.equal(r.ok, true);
  const ring = r.feature.geometry.coordinates[0];
  assert.deepEqual(ring[0], [75, 20]);
  assert.deepEqual(ring[2], [80, 25]);
  assert.equal(ring.length, 5);
  assert.equal(parsePolygonText('20,75\n25,75').ok, false);
  assert.equal(parsePolygonText('20,75\nabc\n25,80').ok, false);
  assert.equal(parsePolygonText('95,75\n25,75\n25,80').ok, false);
});

test('rectangle selection is centroid-based and inclusive at boundaries', () => {
  const t = makeTile();
  // box edge exactly on cell B centre (lon 78.125) -> included
  const m = selectCellsInTile(t, bboxToFeature([76, 21, 78.125, 23]), turf);
  assert.deepEqual([...m], [1, 1, 0]);
  const m2 = selectCellsInTile(t, bboxToFeature([76.2, 21, 78, 23]), turf);
  assert.deepEqual([...m2], [0, 0, 0]);
  assert.deepEqual([...selectCellsInTile(t, null, turf)], [1, 1, 1]);
});

test('polygon selection uses point-in-polygon, not the bounding box', () => {
  const t = makeTile();
  // triangle covering A (21.125N 76.125E) but not B (22.125N 78.125E), although B is inside its bbox
  const tri = parsePolygonText('20, 75\n20, 80\n23, 75').feature;
  assert.deepEqual([...selectCellsInTile(t, tri, turf)], [1, 0, 0]);
  const bb = geometryBBox(tri);
  assert.ok(22.125 <= bb[3] && 78.125 <= bb[2]);
});

test('tilesForBBox selects intersecting partitions only', () => {
  const tiles = makeManifest().tiles;
  assert.deepEqual(tilesForBBox(tiles, [76, 21, 78, 23]), ['t20_075']);
  assert.deepEqual(tilesForBBox(tiles, [76, 24, 78, 26]), ['t20_075', 't25_075']);
  assert.deepEqual(tilesForBBox(tiles, null), ['t20_075', 't25_075']);
  assert.deepEqual(tilesForBBox(tiles, [60, 0, 61, 1]), []);
});

test('schema validation rejects malformed data', () => {
  assert.ok(validateManifest(makeManifest()));
  const bad = makeManifest(); bad.months.source.pop();
  assert.throws(() => validateManifest(bad), DataError);
  assert.ok(validateTile(makeTile(), 36));
  const t = makeTile(); t.rec.m[0] = 99;
  assert.throws(() => validateTile(t, 36), DataError);
  const t2 = makeTile(); t2.rec.h.pop();
  assert.throws(() => validateTile(t2, 36), DataError);
  const t3 = makeTile(); t3.cells.lat[0] = 95;
  assert.throws(() => validateTile(t3, 36), DataError);
});

test('csv escaping and generation', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(NaN), '');
  assert.equal(csvEscape(0), '0');
  assert.equal(toCSV(['a', 'b'], [{ a: 1, b: 'x,y' }]), 'a,b\r\n1,"x,y"\r\n');
});

test('aggregate export covers exactly the range, with status columns', () => {
  const man = makeManifest();
  const agg = aggregateMonthly([makeTile()], new Map([['t20_075', new Uint8Array([1, 1, 1])]]), 36);
  const sh = buildSeries(agg, man, 'h');
  const sf = buildSeries(agg, man, 'f');
  const rows = aggregateRows(sh, sf, [2, 5], scoreSeries(sh));
  assert.deepEqual(rows.map((r) => [r.year, r.month]), [[2000, 3], [2000, 4], [2000, 5], [2000, 6]]);
  assert.equal(rows[0].total_hotspots, null);  // no data, not zero
  assert.equal(rows[0].data_status, 'nodata');
  assert.equal(rows[1].total_hotspots, 15);
  assert.equal(rows[2].total_hotspots, 107);
  assert.equal(rows[2].frp_mw, 428);
  assert.equal(rows[3].total_hotspots, 0);
  assert.equal(rows[3].data_status, 'zero');
});

test('cell export filters by selection and range and sorts deterministically', () => {
  const t = makeTile();
  const rows = cellRows([t], new Map([['t20_075', new Uint8Array([1, 0, 1])]]), [0, 4], 2000);
  assert.deepEqual(rows.map((r) => [r.month, r.cell_id, r.count_harmonised]), [[4, 'A', 10], [5, 'A', 7], [5, 'C', 100]]);
  assert.equal(exportFileName('monthly', '2000-04', '2002-12'), 'hotspot-sync_monthly_2000-04_to_2002-12.csv');
});

test('DataStore caches tiles and retries after failure', async () => {
  let calls = 0;
  let fail = true;
  const fakeFetch = async (url) => {
    calls += 1;
    if (url.endsWith('t20_075.json') && fail) { fail = false; return { ok: false, status: 503 }; }
    return { ok: true, text: async () => JSON.stringify(makeTile()) };
  };
  const ds = new DataStore('./data/', fakeFetch);
  await assert.rejects(ds.tile('t20_075', 36), DataError);
  const a = await ds.tile('t20_075', 36);
  const b = await ds.tile('t20_075', 36);
  assert.equal(a, b);
  assert.equal(calls, 2);
});

test('URL state: tab path round-trips and legacy hashes still decode', async () => {
  const { encodeState, decodeState, splitHash } = await import('../../site/js/ui/hash.js');
  const ym = (m) => `${2000 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
  const f = bboxToFeature([73.8, 29.5, 77.6, 32.6]);
  const h = encodeState({ tab: 'insights', range: [12, 23], metric: 'f', feature: f }, ym);
  assert.equal(h, '#/insights?r=2001-01,2001-12&k=f&b=73.8,29.5,77.6,32.6');
  const d = decodeState(h);
  assert.equal(d.tab, 'insights');
  assert.deepEqual(d.range, ['2001-01', '2001-12']);
  assert.equal(d.metric, 'f');
  assert.deepEqual(d.bbox, [73.8, 29.5, 77.6, 32.6]);
  // legacy (pre-tabs) links open Explore with their selection
  const legacy = decodeState('#r=2015-01,2025-12&k=h&b=73.8,29.5,77.6,32.6');
  assert.equal(legacy.tab, 'explore');
  assert.deepEqual(legacy.bbox, [73.8, 29.5, 77.6, 32.6]);
  // unknown tabs fall back to explore; polygons round-trip
  assert.equal(splitHash('#/nope?k=h').tab, 'explore');
  const poly = parsePolygonText('20, 75\n20, 80\n25, 75').feature;
  const back = decodeState(encodeState({ tab: 'validation', range: [0, 1], metric: 'h', feature: poly }, ym));
  assert.deepEqual(back.ring, [[75, 20], [80, 20], [75, 25]]);
  assert.equal(encodeState({ range: [0, 0], metric: 'h', feature: null }, ym), '#/explore?r=2000-01,2000-01&k=h');
});
