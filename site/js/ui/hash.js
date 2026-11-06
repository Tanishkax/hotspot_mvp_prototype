// Shareable URL state: #/<tab>?r=YYYY-MM,YYYY-MM&k=h&b=w,s,e,n   or  ...&p=lon lat;lon lat;...
// Legacy links without a tab path (#r=...&b=...) are still accepted and open the Explore tab.
export const TABS = ['explore', 'insights', 'validation', 'methodology'];
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export function encodeState({ tab = 'explore', range, metric, feature }, ymLabel) {
  const parts = [`r=${ymLabel(range[0])},${ymLabel(range[1])}`, `k=${metric}`];
  if (feature) {
    const ring = feature.geometry.coordinates[0];
    if (feature.properties && feature.properties.kind === 'rectangle') {
      const xs = ring.map((c) => c[0]); const ys = ring.map((c) => c[1]);
      parts.push(`b=${[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r4).join(',')}`);
    } else {
      parts.push(`p=${ring.slice(0, -1).map(([x, y]) => `${r4(x)} ${r4(y)}`).join(';')}`);
    }
  }
  return `#/${TABS.includes(tab) ? tab : 'explore'}?${parts.join('&')}`;
}

/** Split "#/tab?query" (or legacy "#query") into { tab, query }. */
export function splitHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const m = /^\/([a-z]+)\/?(?:\?(.*))?$/.exec(h);
  if (m) return { tab: TABS.includes(m[1]) ? m[1] : 'explore', query: m[2] || '' };
  return { tab: 'explore', query: h };
}

/** Returns a partial state; invalid pieces are ignored (validated by the caller). */
export function decodeState(hash) {
  const { tab, query } = splitHash(hash);
  const out = { tab };
  const params = new URLSearchParams(query);
  const r = params.get('r');
  if (r && /^\d{4}-\d{2},\d{4}-\d{2}$/.test(r)) out.range = r.split(',');
  const k = params.get('k');
  if (k === 'h' || k === 'f') out.metric = k;
  const b = params.get('b');
  if (b) {
    const v = b.split(',').map(Number);
    if (v.length === 4 && v.every(Number.isFinite)) out.bbox = v;
  }
  const p = params.get('p');
  if (p) {
    const ring = p.split(';').map((s) => s.trim().split(/\s+/).map(Number));
    if (ring.length >= 3 && ring.every((c) => c.length === 2 && c.every(Number.isFinite))) out.ring = ring;
  }
  return out;
}
