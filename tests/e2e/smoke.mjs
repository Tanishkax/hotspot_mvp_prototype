// End-to-end browser test of the static site (Playwright + Chromium).
// Usage: node tests/e2e/smoke.mjs [--shots dir]   (serves ./site on a random port, or E2E_URL)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const PORT = 8000 + Math.floor(Math.random() * 900);
const SUBPATH = '/hotspot_mvp_prototype/'; // mimic GitHub Pages project path
let server = null;
let base = process.env.E2E_URL;
if (!base) {
  // serve site/ under a sub-path to catch absolute-path bugs
  const root = path.resolve('tests/e2e/.serve');
  mkdirSync(root, { recursive: true });
  spawn('ln', ['-sfn', path.resolve('site'), path.join(root, 'hotspot_mvp_prototype')]).on('exit', () => {});
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
  base = `http://127.0.0.1:${PORT}${SUBPATH}`;
  await new Promise((r) => setTimeout(r, 900));
}

const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };
const tilePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGcAAAIOAQXz3cD/AAAAAElFTkSuQmCC', 'base64');

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const badRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => { if (!/arcgisonline\.com|openstreetmap\.org/.test(r.url())) badRequests.push(`${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`); });
  await page.route(/arcgisonline\.com|tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tilePng }));

  console.log('Load');
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.hotspotSync && window.hotspotSync.ctx.renders > 0, null, { timeout: 30000 });
  console.log(`  initial India load ${Date.now() - t0} ms`);
  check(await page.locator('#coverage-pill.ready').count() === 1, 'coverage pill ready');
  const kpiText = await page.locator('#kpis').innerText();
  check(/Peak month/i.test(kpiText) && !/No data/.test(kpiText), 'KPIs rendered');
  const cal = await page.evaluate(() => {
    const c = echarts.getInstanceByDom(document.getElementById('chart-calendar'));
    const o = c.getOption();
    return { heat: o.series[0].data.length, overlay: o.series[1].data.length, years: o.yAxis[0].data.length };
  });
  check(cal.heat > 250 && cal.years === 26, `calendar has ${cal.heat} heat cells over ${cal.years} years`);
  const nodata = await page.evaluate(() => window.hotspotSync.ctx.series.h.slice(0, 10).every((p) => p.status === 'nodata'));
  check(nodata, 'Jan-Oct 2000 marked no-data');
  const sumOk = await page.evaluate(() => {
    const s = window.hotspotSync.ctx.series.h; const man = window.hotspotSync.ctx.manifest;
    const t = s.reduce((a, p) => a + (p.value || 0), 0);
    return Math.abs(t - man.coverage.total_h) / man.coverage.total_h < 1e-7;
  });
  check(sumOk, 'All-India series total equals manifest total');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/desktop-full.png`, fullPage: true });

  console.log('Preset + comparison + anomalies');
  await page.click('#presets button[data-key="punjab"]');
  await page.waitForFunction(() => window.hotspotSync.state.preset === 'punjab' && window.hotspotSync.ctx.nCells > 0);
  await page.waitForTimeout(300);
  const nPunjab = await page.evaluate(() => window.hotspotSync.ctx.nCells);
  check(nPunjab > 50 && nPunjab < 300, `Punjab box selects ${nPunjab} cells`);
  const peak = await page.locator('#kpis .kpi:nth-child(2) .k-value').innerText();
  check(/Oct|Nov|Apr|May/.test(peak), `Punjab peak month is a crop-residue month (${peak})`);
  check(/median/i.test(await page.locator('#compare-summary').innerText()), 'comparison summary shows median');
  check(await page.locator('#seasonal-insights .insight').count() === 3, 'seasonal insights rendered');
  check(/account for \d+%/.test(await page.locator('#seasonal-insights').innerText()), 'critical period sentence computed');
  if (shotsDir) await page.locator('#calendar').screenshot({ path: `${shotsDir}/calendar-punjab.png` });

  console.log('Manual bounds');
  await page.click('#bounds-details summary');
  await page.fill('#bounds-form input[name=north]', '20');
  await page.fill('#bounds-form input[name=south]', '25');
  await page.fill('#bounds-form input[name=west]', '75');
  await page.fill('#bounds-form input[name=east]', '80');
  await page.click('#bounds-form button[type=submit]');
  check(/south must be less than north/.test(await page.locator('#bounds-error').innerText()), 'invalid bounds rejected with message');
  await page.fill('#bounds-form input[name=north]', '25');
  await page.fill('#bounds-form input[name=south]', '20');
  await page.click('#bounds-form button[type=submit]');
  await page.waitForFunction(() => window.hotspotSync.state.feature && window.hotspotSync.state.feature.properties.kind === 'rectangle' && window.hotspotSync.state.preset === null);
  await page.waitForTimeout(300);
  check((await page.locator('#bounds-error').innerText()) === '', 'valid bounds accepted');
  check(/#.*b=75,20,80,25/.test(page.url()), 'URL hash encodes bounds');

  console.log('Polygon text');
  await page.locator('details:has(#polygon-form) summary').click();
  await page.fill('#polygon-text', '20, 75\n20, 80\n25, 75');
  await page.click('#polygon-form button[type=submit]');
  await page.waitForFunction(() => window.hotspotSync.state.feature && window.hotspotSync.state.feature.properties.kind === 'polygon');
  await page.waitForTimeout(300);
  const triCells = await page.evaluate(() => window.hotspotSync.ctx.nCells);
  check(triCells > 0, `triangle polygon selects ${triCells} cells`);
  await page.fill('#polygon-text', '20, 75\n25, 80\n20, 80\n25, 75');
  await page.click('#polygon-form button[type=submit]');
  check(/cross/.test(await page.locator('#polygon-error').innerText()), 'self-intersecting polygon rejected');

  console.log('Draw rectangle with the mouse');
  await page.click('.leaflet-draw-draw-rectangle');
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.hotspotSync.state.feature && window.hotspotSync.state.feature.properties.kind === 'rectangle', null, { timeout: 10000 });
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.hotspotSync.ctx.nCells) > 0, 'drawn rectangle selects cells');

  console.log('Date range + metric');
  await page.click('#range-presets button:has-text("Last 5 years")');
  await page.waitForTimeout(300);
  const yrs = await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('chart-calendar')).getOption().yAxis[0].data.length);
  check(yrs === 5, `last-5-years range shows ${yrs} calendar rows`);
  await page.selectOption('#start-year', '2025');
  await page.selectOption('#end-year', '2021');
  check(/before the end/.test(await page.locator('#range-error').innerText()), 'inverted range rejected');
  await page.selectOption('#end-year', '2025');
  await page.click('label:has(input[value=f])');
  await page.waitForTimeout(300);
  check(/MW/.test(await page.locator('#kpis').innerText()), 'FRP metric switches units');
  await page.click('label:has(input[value=h])');

  console.log('Calendar click focus');
  await page.click('#presets button[data-key="india"]');
  await page.waitForFunction(() => window.hotspotSync.state.preset === 'india' && window.hotspotSync.ctx.nCells > 4000);
  await page.click('#range-presets button:has-text("Full record")');
  await page.waitForTimeout(300);
  const pt = await page.evaluate(() => {
    const c = echarts.getInstanceByDom(document.getElementById('chart-calendar'));
    return c.convertToPixel({ seriesIndex: 0 }, [2, 10]); // Mar, 2010
  });
  await page.locator('#chart-calendar').scrollIntoViewIfNeeded();
  const cb = await page.locator('#chart-calendar').boundingBox();
  await page.mouse.click(cb.x + pt[0], cb.y + pt[1]);
  await page.waitForTimeout(500);
  const focus = await page.evaluate(() => window.hotspotSync.state.focusM);
  check(focus === (2010 - 2000) * 12 + 2, `clicking calendar focuses Mar 2010 (m=${focus})`);
  check(/March 2010/.test(await page.locator('#compare-sub').innerText()), 'comparison follows the clicked month');

  console.log('Exports');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#dl-monthly')]);
  const csv = readFileSync(await dl1.path(), 'utf8');
  const lines = csv.trim().split(/\r\n/);
  check(lines[0].startsWith('year,month,total_hotspots'), 'monthly CSV header');
  check(lines.length - 1 === 302, `monthly CSV has ${lines.length - 1} rows (full record = 302 months)`);
  check(dl1.suggestedFilename() === 'hotspot-sync_monthly_2000-11_to_2025-12.csv', `monthly filename ${dl1.suggestedFilename()}`);
  await page.click('#presets button[data-key="odisha"]');
  await page.waitForFunction(() => window.hotspotSync.state.preset === 'odisha' && window.hotspotSync.ctx.nCells > 0);
  await page.click('#range-presets button:has-text("Last 12 months")');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dl-cells')]);
  const cells = readFileSync(await dl2.path(), 'utf8').trim().split(/\r\n/);
  check(cells[0] === 'year,month,cell_id,latitude,longitude,count_harmonised,frp_harmonised_mw,modis_raw_count,viirs_raw_count', 'cell CSV header');
  check(cells.slice(1).every((l) => l.startsWith('2025,')), `cell CSV restricted to 2025 (${cells.length - 1} rows)`);
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="calendar"]')]);
  check(dl3.suggestedFilename().endsWith('.png'), `calendar PNG export ${dl3.suggestedFilename()}`);
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('#dl-geojson')]);
  const gj = JSON.parse(readFileSync(await dl4.path(), 'utf8'));
  check(gj.features[0].geometry.coordinates[0][0][0] > 60, 'GeoJSON uses [lon, lat]');

  console.log('Validation section');
  await page.locator('#validation').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const c = document.getElementById('chart-frp-baseline');
    return c && echarts.getInstanceByDom(c) && echarts.getInstanceByDom(c).getOption().series.length === 5;
  }, null, { timeout: 15000 });
  check(/r \(log1p\)/.test(await page.locator('#val-count-table').innerText()), 'count validation metrics table');
  await page.click('label:has(input[value=synthetic_weekly_frp])');
  await page.waitForFunction(() => document.getElementById('frp-callout').classList.contains('synth'));
  check(await page.locator('#frp-cell').inputValue() === 'C009', 'synthetic baseline defaults to C009');
  if (shotsDir) {
    await page.waitForTimeout(400);
    await page.locator('#validation').screenshot({ path: `${shotsDir}/validation.png` });
  }

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  check(badRequests.length === 0, `no failed requests${badRequests.length ? `: ${badRequests.slice(0, 3).join(' | ')}` : ''}`);
  const perf = await page.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, bytes: window.hotspotSync.ctx && null }));
  console.log(`  JS heap ${perf.heap} MB`);

  console.log('Mobile');
  const mctx = await browser.newContext({ ...require('playwright').devices['iPhone 13'] });
  const mp = await mctx.newPage();
  const merr = [];
  mp.on('pageerror', (e) => merr.push(String(e)));
  await mp.route(/arcgisonline\.com|tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: tilePng }));
  await mp.goto(`${base}#r=2015-01,2025-12&k=h&b=73.8,29.5,77.6,32.6`);
  await mp.waitForFunction(() => window.hotspotSync && window.hotspotSync.ctx.renders > 0 && window.hotspotSync.state.feature, null, { timeout: 30000 });
  await mp.waitForTimeout(500);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
  const myears = await mp.evaluate(() => echarts.getInstanceByDom(document.getElementById('chart-calendar')).getOption().yAxis[0].data.length);
  check(myears === 11, 'hash-restored range on mobile');
  check(merr.length === 0, 'no page errors on mobile');
  if (shotsDir) await mp.screenshot({ path: `${shotsDir}/mobile-full.png`, fullPage: true });
} finally {
  await browser.close();
  if (server) server.kill();
}
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
process.exit(failures.length ? 1 : 0);
