// Leaflet map: basemap, hotspot-cell layer, drawing tools and programmatic selections.
import { viridis } from '../charts/theme.js';
import { geometryBBox } from '../geo/selection.js';

const SHAPE = { color: '#ffa630', weight: 2, fillColor: '#ffa630', fillOpacity: 0.08 };
const INDIA_VIEW = [[6.5, 68], [35.5, 97.5]];

/** Whole-number zoom that best shows India: zoom in a level when it nearly fits (crops edges slightly). */
function showIndia(map) {
  const b = L.latLngBounds(INDIA_VIEW);
  const size = map.getSize();
  const p0 = map.project(b.getNorthWest(), 0);
  const p1 = map.project(b.getSouthEast(), 0);
  const fit = Math.log2(Math.min(size.x / (p1.x - p0.x), size.y / (p1.y - p0.y)));
  const z = fit - Math.floor(fit) >= 0.7 ? Math.ceil(fit) : Math.floor(fit);
  map.setView([22.5, 81.5], Math.max(map.getMinZoom(), z));
}

export function createMap(el, { onSelection, cells, grid }) {
  // whole zoom levels only: fractional zoom scales tiles and shows hairline seams
  let lastFeature = null; // last selection, re-fitted when the map first becomes visible (created in a hidden tab)
  const map = L.map(el, { zoomSnap: 1, minZoom: 3, maxZoom: 12, worldCopyJump: false, preferCanvas: true });
  let pendingFit = el.clientWidth === 0; // a fit requested while the map is hidden is applied when it is shown
  showIndia(map);
  // Key-free basemaps. Esri dark grey canvas (base + labels) is the default; OpenStreetMap is an alternative.
  const esriAttr = 'Basemap &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors · Fire data NASA FIRMS';
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450;          // above hotspot cells, below drawn shapes' handles
  map.getPane('labels').style.pointerEvents = 'none'; // never block drawing or clicks
  const dark = L.layerGroup([
    L.tileLayer(`${esri}World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: esriAttr }),
    L.tileLayer(`${esri}World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: 'labels', opacity: 0.9 }),
  ]).addTo(map);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Fire data NASA FIRMS',
  });

  // Hotspot cells (0.25 deg), coloured by mean annual harmonised hotspots (log scale).
  const renderer = L.canvas({ padding: 0.3 });
  const cellLayer = L.layerGroup();
  const rects = [];
  const maxLog = Math.log10(1 + Math.max(...cells.mean_annual));
  const half = grid / 2;
  for (let i = 0; i < cells.id.length; i++) {
    const v = cells.mean_annual[i];
    const r = L.rectangle([[cells.lat[i] - half, cells.lon[i] - half], [cells.lat[i] + half, cells.lon[i] + half]], {
      renderer, stroke: false, fillColor: viridis(Math.log10(1 + v) / maxLog), fillOpacity: 0.55, interactive: false,
    });
    rects.push(r);
    cellLayer.addLayer(r);
  }
  cellLayer.addTo(map);

  const drawn = new L.FeatureGroup().addTo(map);
  L.control.layers({ 'Dark (Esri)': dark, 'Streets (OpenStreetMap)': osm }, { 'Hotspot cells (mean annual)': cellLayer }, { position: 'topright', collapsed: true }).addTo(map);
  map.addControl(new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: { allowIntersection: false, showArea: false, shapeOptions: SHAPE, drawError: { color: '#e05252', message: 'Edges cannot cross' } },
      rectangle: { shapeOptions: SHAPE, showArea: false },
      polyline: false, circle: false, marker: false, circlemarker: false,
    },
    edit: { featureGroup: drawn, remove: true },
  }));

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-legend');
    const stops = Array.from({ length: 9 }, (_, i) => viridis(i / 8)).join(',');
    const top = Math.round(10 ** maxLog - 1);
    d.innerHTML = `<strong>Mean annual hotspots / cell</strong><div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="ends"><span>1</span><span>${top.toLocaleString('en-US')}</span></div><span>0.25° cells · ${cells.years_for_mean[0]}–${cells.years_for_mean[1]} · log scale</span>`;
    return d;
  };
  legend.addTo(map);
  const hint = L.control({ position: 'topright' });
  hint.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-hint');
    d.innerHTML = 'Use <b>▭</b> or <b>⬠</b> (top left) to draw a region. Cells are selected by their centre point.';
    return d;
  };
  hint.addTo(map);

  const toFeature = (layer) => {
    const f = layer.toGeoJSON(); // GeoJSON [lon, lat]
    f.properties = { kind: layer instanceof L.Rectangle ? 'rectangle' : 'polygon' };
    return f;
  };
  map.on(L.Draw.Event.CREATED, (e) => {
    drawn.clearLayers();
    drawn.addLayer(e.layer);
    lastFeature = toFeature(e.layer);
    onSelection(lastFeature, 'draw');
  });
  map.on(L.Draw.Event.EDITED, () => {
    const layers = drawn.getLayers();
    lastFeature = layers.length ? toFeature(layers[0]) : null;
    onSelection(lastFeature, 'draw');
  });
  map.on(L.Draw.Event.DELETED, () => {
    if (!drawn.getLayers().length) { lastFeature = null; onSelection(null, 'draw'); }
  });

  return {
    map,
    /** Show a GeoJSON selection (from presets, forms or URL). null clears. */
    show(feature, fit = true) {
      lastFeature = feature;
      if (fit && el.clientWidth === 0) pendingFit = true;
      drawn.clearLayers();
      if (!feature) { if (fit) showIndia(map); return; }
      const latlngs = feature.geometry.coordinates[0].slice(0, -1).map(([lon, lat]) => [lat, lon]);
      const layer = feature.properties && feature.properties.kind === 'rectangle'
        ? L.rectangle(L.latLngBounds(latlngs), SHAPE) : L.polygon(latlngs, SHAPE);
      drawn.addLayer(layer);
      if (fit) {
        const [w, s, e, n] = geometryBBox(feature);
        map.fitBounds([[s, w], [n, e]], { padding: [30, 30], maxZoom: 9 });
      }
    },
    /** Call after the map's container becomes visible again (tab switch): fixes size and initial view. */
    refresh() {
      if (el.clientWidth === 0) return;
      map.invalidateSize({ pan: false });
      if (!pendingFit) return;
      pendingFit = false;
      if (lastFeature) {
        const [w, s, e, n] = geometryBBox(lastFeature);
        map.fitBounds([[s, w], [n, e]], { padding: [30, 30], maxZoom: 9 });
      } else showIndia(map);
    },
    /** Emphasise selected cells; mask is a boolean array aligned with cells.id (null = all). */
    highlight(mask) {
      for (let i = 0; i < rects.length; i++) {
        rects[i].setStyle({ fillOpacity: !mask ? 0.55 : mask[i] ? 0.9 : 0.12 });
      }
    },
  };
}
