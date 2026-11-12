// map.js - Leaflet 1.9.4, ONE map, swipe via two panes + CSS clip. No plugin, no second map to sync.
const map = L.map('map', { zoomSnap: 0.25 }).setView([25.117, 55.138], 12);
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);   // online only: never cache OSM tiles
map.createPane('beforePane').style.zIndex = 410;
map.createPane('afterPane').style.zIndex = 420;      // clipped: only the right of the divider shows
map.createPane('changePane').style.zIndex = 430;     // clipped like 'after'
map.createPane('maskPane').style.zIndex = 440;       // hatch, not clipped
const layers = {}; let split = 0.5;                  // divider position, 0..1 of map width

function clip() {
  const s = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(s);
  const x = nw.x + s.x * split, rect = `rect(${nw.y}px,${se.x}px,${se.y}px,${x}px)`;
  ['afterPane', 'changePane'].forEach(p => map.getPane(p).style.clip = rect);
  document.getElementById('divider').style.left = (split * 100) + '%';
}
map.on('move zoom viewreset resize', clip);

function showAnalysis(a) {                           // a = /api/analyze response
  Object.values(layers).forEach(l => map.removeLayer(l));
  const b = [[a.bounds[1], a.bounds[0]], [a.bounds[3], a.bounds[2]]];         // [[south,west],[north,east]]
  const mk = (url, pane, op) => L.imageOverlay(url, b, { pane, opacity: op }).addTo(map);
  layers.before = mk(a.layers.rgb_before, 'beforePane', 1);
  layers.after  = mk(a.layers.rgb_after,  'afterPane', 1);
  layers.change = mk(a.layers.change,     'changePane', 0.85);
  layers.mask   = mk(a.layers.mask,       'maskPane', 1);
  map.fitBounds(b, { padding: [40, 40] }); clip();
}
const toggle = (name, on) => on ? layers[name].addTo(map) : map.removeLayer(layers[name]);
const flyTo = bbox => map.flyToBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [40, 40] });

// divider drag (mouse + touch)
const div = document.getElementById('divider');
const move = e => { const r = map.getContainer().getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX);
  split = Math.min(1, Math.max(0, (cx - r.left) / r.width)); clip(); };
div.addEventListener('pointerdown', e => { map.dragging.disable(); const up = () => { map.dragging.enable(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
window.app = { showAnalysis, toggle, flyTo, map };
