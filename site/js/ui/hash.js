// Shareable URL state: #r=YYYY-MM,YYYY-MM&k=h&b=w,s,e,n  or  &p=lon lat;lon lat;...
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export function encodeState({ range, metric, feature }, ymLabel) {
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
  return `#${parts.join('&')}`;
}

/** Returns a partial state; invalid pieces are ignored (validated by the caller). */
export function decodeState(hash) {
  const out = {};
  const params = new URLSearchParams(String(hash).replace(/^#/, ''));
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
