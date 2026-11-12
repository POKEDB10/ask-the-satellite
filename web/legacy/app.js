// app.js - wires the API contract to map.js, the HUD, the Trust panel and the chat. Vanilla JS, no build step.
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (p, o) => fetch(p, o).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || r.statusText); return j; });
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const FLAG = { cross_sensor: 'Different satellites (resolution and bands differ)', season_mismatch: 'Season gap over 45 days', landsat7_slc_gaps: 'Landsat 7 stripe gaps', low_valid_pixels: 'Under 60% measurable' };
let last = null;

function why(s) { return 'Why this scene? Candidates (valid % of your area):\n' + s.candidates.map(c => `${c.day}: ${c.valid_pct_aoi}% valid, tile cloud ${c.cloud_tile}%`).join('\n'); }
function showAnalysis(a) {
  last = a; app.showAnalysis(a);
  const s = a.stats, q = a.quality, b = a.scene_before, f = a.scene_after;
  $('#hud').hidden = $('#layers').hidden = false; $('#divider').style.display = 'block';
  $('#hud').innerHTML = `<span class="badge ${q.confidence.toLowerCase()}">Data confidence: ${q.confidence}</span>` +
    (q.headline_hidden ? `<h2 style="font-size:16px">Too much cloud to measure reliably</h2>`
      : `<h2>${s.net_km2 >= 0 ? '+' : '−'}${Math.abs(s.net_km2).toFixed(1)} km²</h2><p>≈ ${s.football_pitches.toLocaleString()} football pitches</p>`) +
    `<div class="bar"><i style="width:${s.valid_pct_both}%"></i></div><p>${s.valid_pct_both}% measurable on both dates</p>` +
    `<p>Gained ${s.gain_km2} km² · Lost ${s.loss_km2} km²</p>` +
    `<p><span title="${esc(why(b))}">${b.day}</span> → <span title="${esc(why(f))}">${f.day}</span> <small>(hover: why this scene?)</small></p>` +
    q.flags.filter(x => FLAG[x]).map(x => `<span class="chip">${FLAG[x]}</span>`).join('') +
    (s.ignored_small_km2 > 0 ? `<span class="chip">Changes under ${s.min_mapping_unit_px} px ignored: ${s.ignored_small_km2} km²</span>` : '');
  $('#attr').textContent = a.attribution + ' · © OpenStreetMap contributors';
  const mk = document.querySelector('[data-l=mask]'); mk.checked = q.confidence !== 'HIGH'; app.toggle('mask', mk.checked);
  $('#modal').innerHTML = `<h3>Verify the science</h3><p>Index: ${a.index} · threshold ${s.threshold} · min. mapping unit ${s.min_mapping_unit_px} px · grid EPSG:3857, area corrected by cos²(lat)</p>` +
    [b, f].map(x => `<p><b>${x.day}</b> ${esc(x.platform)} · ${x.resolution_m} m · ${esc(x.catalog)}<br><small>${x.ids.map(esc).join('<br>')}</small></p>`).join('') +
    `<p>${esc(a.attribution)}</p><p><small>Confidence is a data-quality badge (valid pixels, sensor match, season match), not a statistical interval.</small></p><form method="dialog"><button>Close</button></form>`;
}
document.querySelectorAll('#layers input').forEach(i => i.onchange = () => app.toggle(i.dataset.l, i.checked));
$('#verify').onclick = () => last ? $('#modal').showModal() : alert('Run an analysis first');

const log = $('#log');
const add = h => { const d = document.createElement('div'); d.className = 'msg'; d.innerHTML = h; log.append(d); log.scrollTop = 1e9; return d; };
const card = (t, body, cls = '') => `<div class="card ${cls}" dir="auto"><h4>${t}</h4>${body}</div>`;
async function ask(message, preset_id = null) {
  add(`<span class="me" dir="auto">${esc(message)}</span>`); const wait = add('<i>Fetching satellite scenes...</i>');
  try {
    const r = await post('/api/chat', { message, preset_id, last_analysis_id: last && last.analysis_id });
    let h = card('Measured by satellite', esc(r.reply_measured));
    if (r.reply_quality) h += card('Data quality', esc(r.reply_quality.text) + r.reply_quality.flags.map(f => `<span class="chip">${esc(f)}</span>`).join(''), 'q-' + r.reply_quality.level.toLowerCase());
    if (r.reply_interpretation) h += card('Interpretation · AI hypothesis', esc(r.reply_interpretation), 'ai');
    wait.innerHTML = h;
    for (const act of r.actions) if (act.type === 'fly_to') app.flyTo(act.bbox);
    if (r.analysis) showAnalysis(r.analysis);
  } catch (e) { wait.innerHTML = card('Error', esc(e.message) + ' Try one of the stories above.', 'q-low'); }
}
$('#ask').onsubmit = e => { e.preventDefault(); const v = $('#q').value.trim(); if (v) { $('#q').value = ''; ask(v); } };

async function boot() {
  try { const h = await api('/api/health'); $('#pill').textContent = h.online ? (h.ollama ? 'online' : 'online · no LLM (rule mode)') : 'offline mode: stories only'; $('#pill').classList.toggle('off', !h.online); } catch { $('#pill').textContent = 'offline mode'; $('#pill').classList.add('off'); }
  try { const ps = await api('/api/presets'); $('#stories').innerHTML = ''; ps.filter(p => p.cached || p.tier === 'A').forEach(p => { const b = document.createElement('button'); b.textContent = p.title; b.onclick = () => ask(p.title, p.id); $('#stories').append(b); }); } catch { }
}
boot();
