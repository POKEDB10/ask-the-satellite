// app.js - chat, evidence cards, Trust UI, drawer, modals and shortcuts. Talks to /api/* and drives window.Globe.
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (p, o) => fetch(p, o).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || r.statusText); return j; });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
  const SENSOR = { 'landsat-5': 'Landsat 5 TM', 'landsat-7': 'Landsat 7 ETM+', 'landsat-8': 'Landsat 8 OLI', 'landsat-9': 'Landsat 9 OLI-2',
                   'sentinel-2a': 'Sentinel-2A MSI', 'sentinel-2b': 'Sentinel-2B MSI', 'sentinel-2c': 'Sentinel-2C MSI' };
  const sensorName = p => SENSOR[String(p).toLowerCase()] || p;
  const resText = s => s.sensor === 'sentinel-2' && s.resolution_m > 10 ? `${s.resolution_m} m grid (10 m native)` : `${s.resolution_m} m`;
  const caption = s => `${sensorName(s.platform)} · ${resText(s)} · ${fmtDate(s.day)}`;
  const INDEX = { mndwi: ['MNDWI', '(green − SWIR1) / (green + SWIR1)', 'water'], ndvi: ['NDVI', '(NIR − red) / (NIR + red)', 'vegetated'],
                  flood: ['MNDWI flood rule', 'before < 0, after > −0.05 and rise > 0.18', 'flooded'], nbr: ['dNBR', '(NIR − SWIR2) / (NIR + SWIR2), pre − post', 'burned'] };
  const STORY_MSG = { palm_jumeirah: 'Palm Jumeirah 2001 to 2008' };
  const icon = id => `<svg class="ico"><use href="#${id}"/></svg>`;

  let cfg = { online: false, attributions: {}, model: null }, last = null, lastQ = null, busy = false, presets = [];
  const app = $('#app');

  // ------------------------------------------------------------ boot
  async function boot() {
    try { cfg = await api('/api/config', { signal: AbortSignal.timeout(4000) }); } catch { cfg = { online: false, attributions: {}, model: null }; }
    setNet(cfg.online && navigator.onLine);
    $('#pillModel').textContent = cfg.model ? cfg.model.split(':')[0] : 'Rules';
    $('#pillModel').title = cfg.model ? `Local model ${cfg.model} (plans and words; never computes numbers)` : 'No local model: rule router and templates';
    Globe.on('fatal', fatal);
    Globe.on('imagery', imagery);
    Globe.on('interacted', () => $('#hint').classList.add('gone'));
    Globe.on('compare', updateTags);
    const ok = await Globe.init(cfg);
    loadStories();
    if (ok) setTimeout(() => $('#hint').classList.add('gone'), 9000);
  }

  function setNet(online) {
    const p = $('#pillNet');
    p.textContent = online ? 'Online' : 'Offline';
    p.className = 'pill sm ' + (online ? 'on' : 'off');
  }
  addEventListener('online', () => api('/api/config').then(c => { cfg = { ...cfg, ...c }; setNet(c.online); }).catch(() => {}));
  addEventListener('offline', () => setNet(false));

  function imagery(kind) {
    const pill = $('#imageryPill');
    const card = $('.esri-card');
    if (card) card.remove();
    if (kind === 'esri') { pill.hidden = true; }
    else if (kind === 'naturalearth') { pill.hidden = false; pill.textContent = 'Imagery: Natural Earth II · coarse, context only'; }
    else {
      pill.hidden = false; pill.textContent = kind === 'offline' ? 'Imagery: Natural Earth II · offline' : 'Imagery: Natural Earth II · Esri unavailable';
      if (kind === 'failed') {
        const d = document.createElement('div');
        d.className = 'esri-card';
        d.innerHTML = '<b>Esri World Imagery is not loading.</b> The globe fell back to the bundled Natural Earth II texture. Measured layers and numbers are unaffected: they come from Landsat and Sentinel-2 scenes on disk.';
        $('#stage').append(d);
        setTimeout(() => d.remove(), 12000);
      }
    }
    setAttribution();
  }

  function setAttribution() {
    const A = cfg.attributions || {}, parts = [];
    parts.push(Globe.state.basemap === 'esri' && Globe.state.esri === 'ok' ? 'Basemap: context only, current mixed dates, not analysed' : `Basemap: ${A.naturalearth || 'Natural Earth II'}`);
    if (last) {
      const sensors = [last.scene_before.sensor, last.scene_after.sensor];
      if (sensors.includes('landsat')) parts.push(A.landsat || 'Landsat data courtesy of the U.S. Geological Survey');
      if (sensors.includes('sentinel-2')) {
        const ys = [...new Set([last.scene_before, last.scene_after].filter(s => s.sensor === 'sentinel-2').map(s => s.day.slice(0, 4)))].join(', ');
        parts.push(`Contains modified Copernicus Sentinel data ${ys}`);
      }
    }
    $('#attribText').textContent = parts.join(' · ');
  }

  // ------------------------------------------------------------ stories, bookmarks, fallback
  async function loadStories() {
    try { presets = await api('/api/presets'); } catch { presets = []; }
    const frames = (cfg.frames || {});
    const ready = presets.filter(p => p.cached || (frames[p.id] || []).length);
    const html = ready.map(p => `<button class="story" data-id="${esc(p.id)}" data-title="${esc(p.title)}">
        ${p.cached ? `<img src="${esc(p.thumb)}" alt="">` : '<span class="ph"></span>'}
        <span><b>${esc(p.title)}</b><small>Pre-computed · ${p.tier === 'A' ? 'core story' : 'extra'}</small></span></button>`).join('');
    $('#stories').innerHTML = html || '<p class="mut">No stories are cached yet. Run precompute.py with internet.</p>';
    if (!$('#fatal').hidden) $('#fatal .stories').innerHTML = html;
    renderBookmarks();
  }
  const BK = 'ats.bookmarks.v1';
  const getBk = () => { try { return JSON.parse(localStorage.getItem(BK)) || []; } catch { return []; } };
  const setBk = v => { try { localStorage.setItem(BK, JSON.stringify(v)); } catch { /* private window: bookmarks are a convenience only */ } };
  function renderBookmarks() {
    const b = getBk();
    $('#bookmarks').innerHTML = b.length ? b.map((x, i) => `<button class="story" data-bk="${i}"><span class="ph"></span><span><b>${esc(x.title)}</b><small>${esc(x.when)}</small></span></button>`).join('')
      : '<p class="mut" style="margin:0">Bookmark an answer to keep it here.</p>';
  }
  document.addEventListener('click', e => {
    const s = e.target.closest('.story');
    if (!s) return;
    if (s.dataset.bk) { const b = getBk()[+s.dataset.bk]; if (b) ask(b.message, b.preset_id); }
    else ask(STORY_MSG[s.dataset.id] || s.dataset.title, s.dataset.id);
    openDrawer(false);
  });

  function fatal(err) {
    const f = $('#fatal');
    f.hidden = false;
    f.innerHTML = `<div class="eyebrow">Globe unavailable</div><h2>The 3D globe could not start on this device.</h2>
      <p class="mut">${esc(err && err.message || 'WebGL is not available.')} The assistant still works: pick a story and the evidence cards, images and confidence badge appear in the chat.</p>
      <div class="stories"></div>`;
    loadStories();
  }

  // ------------------------------------------------------------ chat
  const log = $('#log');
  function addMsg(cls, html) {
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = html;
    log.append(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  async function sse(url, body, onEvent) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        let ev = 'message', data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) await onEvent(ev, JSON.parse(data));
      }
    }
  }

  const STEPS = [['locate', 'Locating'], ['scenes', 'Picking scenes'], ['measure', 'Measuring change']];

  async function ask(message, preset_id = null) {
    if (busy || !message.trim()) return;
    busy = true; $('#send').disabled = true;
    await ready;                                                   // the globe must exist before the first flight
    $('#empty') && $('#empty').remove();
    Globe.stopRotate();
    lastQ = { message, preset_id };
    addMsg('user', `<div class="bubble" dir="auto">${esc(message)}</div>`);
    const m = addMsg('bot', `<div class="ticker">${STEPS.map(([k, l]) => `<div class="step" data-step="${k}"><span class="dot"></span>${l}</div>`).join('')}</div><div class="body"></div>`);
    const body = m.querySelector('.body'), t0 = performance.now();
    let flight = null, flownKey = null, analysis = null, reveal = Promise.resolve();
    const step = (k, state) => { const s = m.querySelector(`[data-step="${k}"]`); if (s) { s.classList.remove('active', 'done'); s.classList.add(state); } };
    try {
      await sse('/api/chat/stream', { message, preset_id, last_analysis_id: last && last.analysis_id }, async (ev, d) => {
        if (ev === 'plan') {
          if (d.fly_to && d.fly_to.join() !== flownKey) {
            flownKey = d.fly_to.join();
            const f = Globe.flyTo(d.fly_to); flight = { ...f, start: performance.now() };
          }
          const pr = presets.find(p => p.id === d.plan.preset_id);
          const region = pr ? pr.title : d.place || d.plan.place;
          if (region) { $('#regionChip').hidden = false; $('#regionChip').textContent = `Region · ${region}`; }
        } else if (ev === 'progress') {
          step(d.step, d.state);
        } else if (ev === 'analysis') {
          analysis = d;
          STEPS.forEach(([k]) => step(k, 'done'));
          reveal = (async () => {
            if (flight) await Promise.race([flight.done, sleep(Math.max(0, flight.start + flight.duration * 700 - performance.now()))]);
            showAnalysis(d);
            body.insertAdjacentHTML('afterbegin', stripHtml(d));
            wireStrip(body, d);
          })();
        } else if (ev === 'cards') {
          await reveal;
          body.insertAdjacentHTML('beforeend', d.kind === 'analysis' ? cardsHtml(d, analysis) : `<div class="card info ${d.kind === 'error' ? 'error' : ''}" dir="auto">${esc(d.measured)}</div>${notesHtml(d.notes)}${nextHtml(d.next)}`);
          log.scrollTop = log.scrollHeight;
        } else if (ev === 'done') {
          await reveal;
          const s = ((performance.now() - t0) / 1000).toFixed(1);
          const tk = m.querySelector('.ticker');
          tk.className = 'ticker collapsed';
          tk.innerHTML = analysis ? `Done in ${s} s · <button data-verify>Verify</button>` : `Done in ${s} s`;
          if (analysis) m.insertAdjacentHTML('beforeend', `<div class="msg-foot"><button data-bookmark>${icon('i-bookmark')}Bookmark</button><button data-verify>${icon('i-check')}Verify the science</button></div>`);
        }
      });
    } catch (e) {
      body.insertAdjacentHTML('beforeend', `<div class="card info error">The server did not answer (${esc(e.message)}). Pre-computed stories still work from disk: open Saved regions.</div>`);
      m.querySelector('.ticker').remove();
    } finally {
      busy = false; $('#send').disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  function showAnalysis(a) {
    last = a;
    Globe.showAnalysis(a);
    $('#btnVerify').disabled = false;
    $$('[data-layer=mask]')[0].checked = a.quality.confidence !== 'HIGH';
    const live = a.mode === 'live';
    for (const p of [$('#modePill'), $('#pillData')]) { p.textContent = live ? 'Live' : 'Pre-computed'; p.className = 'pill ' + (p.id === 'pillData' ? 'sm ' : '') + (live ? 'live' : 'pre'); }
    updateTags();
    setAttribution();
  }

  function updateTags() {
    if (!last) return;
    const b = last.scene_before, a = last.scene_after, today = Globe.state.compare === 'bt';
    $('#tagLeft').textContent = `Before · ${caption(b)}`;
    $('#tagRight').textContent = today ? (Globe.state.esri === 'ok' ? 'Right: Esri imagery, current, mixed dates. Visual only, not measured.' : 'Right: Natural Earth II basemap. Visual only, not measured.') : `After · ${caption(a)}`;
  }

  // ------------------------------------------------------------ evidence rendering
  function stripHtml(a) {
    const b = a.scene_before, f = a.scene_after;
    const th = (kind, bg, title, cap) => `<button class="thumb" data-thumb="${kind}" title="Click: focus the swipe. Click again: open full size.">
      <div class="img" style="background-image:${bg}"></div><div class="cap"><b>${title}</b>${esc(cap)}</div></button>`;
    return `<div class="sect"><div class="eyebrow">Imagery · same 0–0.30 reflectance stretch on both dates</div><div class="strip">
      ${th('before', `url('${a.layers.rgb_before}')`, 'Before', caption(b))}
      ${th('after', `url('${a.layers.rgb_after}')`, 'After', caption(f))}
      ${th('change', `url('${a.layers.change}'),url('${a.layers.rgb_after}')`, 'Change', `${a.stats.gain_label}${a.stats.loss_label ? ' / ' + a.stats.loss_label : ''}`)}
    </div></div>`;
  }

  function wireStrip(root, a) {
    root.querySelectorAll('[data-thumb]').forEach(t => t.addEventListener('click', () => {
      const kind = t.dataset.thumb;
      if (t.classList.contains('focus')) return lightbox(a, kind);
      root.querySelectorAll('.thumb').forEach(x => x.classList.toggle('focus', x === t));
      if (last !== a) showAnalysis(a);
      Globe.setCompare('ba'); setSeg('ba'); Globe.setSwipe(true);
      Globe.setLayer('change', kind === 'change' || $$('[data-layer=change]')[0].checked);
      Globe.flyTo(a.bounds);
    }));
  }

  const srcChip = (title, url) => `<a class="src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('i-link')}${esc(title)}</a>`;
  const notesHtml = notes => (notes || []).map(n => `<div class="note" dir="auto">${esc(n)}</div>`).join('');
  const nextHtml = next => next && next.length ? `<div class="sect"><div class="eyebrow">Next</div><div class="next">${next.map(c =>
      `<button data-next='${esc(JSON.stringify(c))}'>${esc(c.label)}</button>`).join('')}</div></div>` : '';

  function cardsHtml(c, a) {
    const st = a.stats, q = a.quality, b = a.scene_before, f = a.scene_after, ctx = c.context;
    const [iname] = INDEX[a.index] || [a.index];
    const sign = st.net_km2 > 0 ? '+' : st.net_km2 < 0 ? '−' : '';
    const figure = q.headline_hidden ? '<div class="figure" style="font-size:15px">Too much cloud to measure reliably</div>'
      : `<div class="figure">${sign}${Math.abs(st.net_km2).toFixed(2)} km²<small>net ${INDEX[a.index] ? INDEX[a.index][2] : ''} area</small></div>
         <div class="meta">${esc(caption(b))} → ${esc(caption(f))}</div>`;
    let h = `<div class="sect"><div class="eyebrow">What happened</div>
      <div class="card measured" dir="auto"><div class="head"><span class="eyebrow">Measured by satellite · ${esc(iname)}</span></div>${figure}
        <p style="margin:8px 0 0">${esc(c.measured)}</p></div>`;
    if (ctx && ctx.what_happened && ctx.what_happened.length)
      h += `<div class="card" dir="auto"><span class="eyebrow">Context · reported by named sources</span><ul class="lines">${ctx.what_happened.map(x =>
        `<li><span>${esc(x.text)}</span>${srcChip(x.source_title, x.source_url)}</li>`).join('')}</ul></div>`;
    h += notesHtml(c.notes) + '</div>';

    const qc = c.quality || {}, whyB = whyText(b), whyA = whyText(f);
    const res = [...new Set([b, f].map(s => `${s.resolution_m} m (${s.sensor === 'landsat' ? 'Landsat' : 'Sentinel-2'})`))].join(' and ');
    h += `<div class="sect"><div class="eyebrow">Data quality</div><div class="card q-${esc(q.confidence)}" dir="auto">
      <div class="head"><span class="badge ${esc(q.confidence)}">Data confidence: ${esc(q.confidence)}</span>
        <span class="meta"><span class="why" tabindex="0" title="${esc(whyB)}">Why this scene?</span> · <span class="why" tabindex="0" title="${esc(whyA)}">and this one?</span></span></div>
      <div class="vbar" title="Share of the area measurable on both dates"><i style="width:${Math.max(0, Math.min(100, st.valid_pct_both))}%"></i></div>
      <div class="meta">${st.valid_pct_both}% measurable on both dates · before ${st.valid_pct_before}% · after ${st.valid_pct_after}%</div>
      <div class="meta">${esc(caption(b))} → ${esc(caption(f))}</div>
      <p style="margin:8px 0 0">${esc(qc.text || '')}</p>
      <div class="chips">${(qc.flags || []).map(x => `<span class="qchip">${esc(x)}</span>`).join('')}
        ${st.ignored_small_km2 > 0 && !q.headline_hidden ? `<span class="qchip">Changes under ${st.min_mapping_unit_px} px ignored: ${st.ignored_small_km2} km²</span>` : ''}
        <span class="qchip">Analysis ${esc(res)} · basemap high-res, not analysed</span></div>
    </div></div>`;

    if (ctx && ((ctx.downsides || []).length || (ctx.counterpoints || []).length)) {
      h += `<div class="sect"><div class="eyebrow">From named sources, not measured by satellite</div><div class="card" dir="auto">
        <span class="eyebrow">Reported downsides</span><ul class="lines">${(ctx.downsides || []).map(x => `<li><span>${esc(x.text)}</span>
          ${x.disputed ? `<span class="tag" title="${esc(x.disputed_note || '')}">Disputed by developer</span>${x.disputed_note ? `<span class="meta">${esc(x.disputed_note.replace(/^Disputed by developer:\s*/i, ''))}</span>` : ''}` : ''}
          ${srcChip(x.source_title, x.source_url)}</li>`).join('')}</ul>
        ${(ctx.counterpoints || []).length ? `<div class="eyebrow" style="margin-top:12px">Counterpoints · developer and scientist statements</div><ul class="lines">${ctx.counterpoints.map(x =>
          `<li><span>${esc(x.text)}</span>${srcChip(x.source_title, x.source_url)}</li>`).join('')}</ul>` : ''}
      </div></div>`;
    } else if (c.interpretation) {
      h += `<div class="sect"><div class="eyebrow">What it might mean · AI hypothesis, not measured</div>
        <div class="card ai" dir="auto"><p style="margin:0">${esc(c.interpretation.text)}</p>
        <div class="meta" style="margin-top:6px">${c.interpretation.source === 'template' ? 'Fixed template (the number guard or the model was unavailable)' : 'Worded by ' + esc(c.interpretation.source.replace('llm:', '')) + '; every number checked against the measurements'}</div></div></div>`;
    }
    return h + nextHtml(c.next);
  }

  function whyText(s) {
    return `Why ${fmtDate(s.day)}? Candidate days within the search window, with the real share of your area that was clear:\n` +
      (s.candidates || []).map(c => `${fmtDate(c.day)}: ${c.valid_pct_aoi}% clear, tile cloud ${c.cloud_tile}%${c.day === s.day ? '  ← chosen' : ''}`).join('\n') +
      '\nThe clearest day wins; within 2 points the day nearer the target date wins.';
  }

  log.addEventListener('click', e => {
    const n = e.target.closest('[data-next]');
    if (n) {
      const c = JSON.parse(n.dataset.next);
      if (c.action === 'before_today') { Globe.setCompare('bt'); setSeg('bt'); }
      else ask(c.message, c.preset_id || null);
      return;
    }
    if (e.target.closest('[data-verify]')) return openVerify();
    if (e.target.closest('[data-bookmark]') && last && lastQ) {
      const b = getBk().filter(x => x.message !== lastQ.message);
      b.unshift({ ...lastQ, title: last.title || lastQ.message, when: `Saved ${fmtDate(new Date().toISOString())}` });
      setBk(b.slice(0, 20)); renderBookmarks();
      e.target.closest('[data-bookmark]').innerHTML = `${icon('i-bookmark')}Saved`;
    }
  });

  // ------------------------------------------------------------ verify modal and lightbox
  function scaleText(s) {
    if (s.scale !== undefined) return `DN × ${s.scale} ${s.offset < 0 ? '− ' + Math.abs(s.offset) : '+ ' + s.offset}`;
    return s.sensor === 'landsat' ? 'DN × 0.0000275 − 0.2 (Collection 2 Level-2)' : 'DN × 0.0001, offset 0 when the item says it is already harmonised, else −0.1 for baseline ≥ 04.00';
  }
  function openVerify() {
    const a = last;
    if (!a) return;
    const A = cfg.attributions || {}, st = a.stats;
    const [iname, formula] = INDEX[a.index] || [a.index, ''];
    const scene = (s, label) => `<h4>${label}</h4><table>
      <tr><th>STAC item ids</th><td>${s.ids.map(i => `<code>${esc(i)}</code>`).join('<br>')}</td></tr>
      <tr><th>Acquired</th><td><code>${esc(s.datetime)}</code></td></tr>
      <tr><th>Sensor</th><td>${esc(sensorName(s.platform))} · ${esc(resText(s))}</td></tr>
      <tr><th>Catalogue</th><td>${s.catalog === 'pc' ? 'Microsoft Planetary Computer' : 'Element 84 Earth Search v1'} · ${s.sensor === 'landsat' ? 'landsat-c2-l2' : 'sentinel-2-l2a'}</td></tr>
      <tr><th>Reflectance</th><td>${esc(scaleText(s))}</td></tr>
      <tr><th>Mask</th><td>${s.sensor === 'landsat' ? 'QA_PIXEL bits 0–4 (fill, dilated cloud, cirrus, cloud, shadow); Landsat 7 stripe gaps = no data' : 'SCL classes 0, 1, 3, 8, 9, 10 (no data, saturated, shadow, cloud medium/high, cirrus)'}</td></tr>
      <tr><th>Why this day</th><td>${(s.candidates || []).map(c => `${esc(c.day)}: ${c.valid_pct_aoi}% clear`).join(' · ')}</td></tr></table>`;
    $('#verify').innerHTML = `<div class="modal-head"><h3 id="verifyTitle">Verify the science</h3><button class="x" data-close aria-label="Close">${icon('i-close')}</button></div>
      <div class="modal-body">${scene(a.scene_before, 'Before scene')}${scene(a.scene_after, 'After scene')}
      <h4>Method</h4><table>
        <tr><th>Index</th><td>${esc(iname)} = ${esc(formula)}; threshold ${st.threshold ?? 'rule-based'}; class flip between dates, never raw differences across sensors</td></tr>
        <tr><th>Grid</th><td>EPSG:3857, ${a.scene_before.resolution_m} m, one grid for both dates; area corrected by cos²(latitude)</td></tr>
        <tr><th>Minimum mapping unit</th><td>${st.min_mapping_unit_px} pixels; ${st.ignored_small_km2} km² of smaller blobs ignored</td></tr>
        <tr><th>Valid pixels</th><td>before ${st.valid_pct_before}% · after ${st.valid_pct_after}% · both ${st.valid_pct_both}%</td></tr>
        <tr><th>Confidence rules</th><td>HIGH ≥ 85% valid on both dates; MEDIUM 60–85% or one downgrade; LOW below 60% or two downgrades. One downgrade each for different sensor families and a season gap over 45 days. Under 50% valid the area headline is hidden. This is a data-quality badge, not a statistical interval.</td></tr>
        <tr><th>Flags</th><td>${a.quality.flags.length ? a.quality.flags.map(esc).join(', ') : 'none'}</td></tr>
        <tr><th>Analysis id</th><td><code>${esc(a.analysis_id)}</code></td></tr></table>
      <h4>Attribution</h4><table>
        <tr><th>Basemap (context only)</th><td>${esc(A.esri || '')}. Current, mixed-date imagery; never analysed.</td></tr>
        <tr><th>Landsat</th><td>${esc(A.landsat || '')}</td></tr>
        <tr><th>Sentinel-2</th><td>${esc(A.sentinel2 || '')}</td></tr>
        <tr><th>This analysis</th><td>${esc(a.attribution)}</td></tr>
        <tr><th>Globe</th><td>${esc(A.cesium || 'CesiumJS (Apache-2.0)')} · ${esc(A.naturalearth || '')}</td></tr>
        <tr><th>Search</th><td>${esc(A.geocode || '')}</td></tr></table>
      <p class="mut" style="margin-top:12px">No model training was performed. The language model plans the question and words the reply; it never computes or edits a number.</p></div>`;
    $('#verify').showModal();
  }

  function lightbox(a, kind) {
    const url = kind === 'before' ? a.layers.rgb_before : kind === 'after' ? a.layers.rgb_after : a.layers.change;
    const s = kind === 'before' ? a.scene_before : a.scene_after;
    const lb = $('#lightbox');
    lb.innerHTML = `<div class="modal-head"><h3>${kind === 'change' ? 'Change' : kind === 'before' ? 'Before' : 'After'} · ${esc(caption(s))}</h3>
      <div class="lb-tools"><button data-zoom="1.4">${icon('i-plus')}</button><button data-zoom="0.7">${icon('i-minus')}</button>
      <a href="${esc(url)}" download="${esc(a.analysis_id.replace(/[:]/g, '_'))}_${kind}.png">${icon('i-download')}Download PNG</a>
      <button class="x" data-close aria-label="Close">${icon('i-close')}</button></div></div>
      <div class="lb-view"><img alt="${esc(kind)} image" src="${esc(url)}" ${kind === 'change' ? `style="background:url('${esc(a.layers.rgb_after)}') 0 0/100% 100%"` : ''}></div>`;
    lb.showModal();
    const view = lb.querySelector('.lb-view'), img = lb.querySelector('img');
    let k = 1, x = 0, y = 0;
    const apply = () => { img.style.transform = `translate(${x}px,${y}px) scale(${k})`; };
    img.onload = () => { k = Math.min(view.clientWidth / img.naturalWidth, view.clientHeight / img.naturalHeight); x = (view.clientWidth - img.naturalWidth * k) / 2; y = (view.clientHeight - img.naturalHeight * k) / 2; apply(); };
    const zoomAt = (f, cx, cy) => { x = cx - (cx - x) * f; y = cy - (cy - y) * f; k *= f; apply(); };
    view.addEventListener('wheel', e => { e.preventDefault(); const r = view.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    view.addEventListener('pointerdown', e => {
      view.setPointerCapture(e.pointerId);
      const sx = e.clientX - x, sy = e.clientY - y;
      const mv = ev => { x = ev.clientX - sx; y = ev.clientY - sy; apply(); };
      view.addEventListener('pointermove', mv);
      view.addEventListener('pointerup', () => view.removeEventListener('pointermove', mv), { once: true });
    });
    lb.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => zoomAt(+b.dataset.zoom, view.clientWidth / 2, view.clientHeight / 2));
  }
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });

  // ------------------------------------------------------------ chrome controls
  function setSeg(mode) { $$('[data-compare]').forEach(b => { const on = b.dataset.compare === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); }); }
  $$('[data-compare]').forEach(b => b.onclick = () => { setSeg(b.dataset.compare); Globe.setCompare(b.dataset.compare); });
  $$('[data-layer]').forEach(i => i.onchange = () => Globe.setLayer(i.dataset.layer, i.checked));
  $$('input[name=basemap]').forEach(i => i.onchange = () => { Globe.setBasemap(i.value); setAttribution(); });
  const pop = $('#layersPop');
  $('#btnLayers').onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; $('#btnLayers').setAttribute('aria-expanded', !pop.hidden); };
  document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.pop-wrap')) { pop.hidden = true; $('#btnLayers').setAttribute('aria-expanded', false); } });
  $('#btnVerify').onclick = openVerify;
  $('#btnTilt').onclick = () => $('#btnTilt').setAttribute('aria-pressed', Globe.tilt());
  Globe.on('tilt', v => $('#btnTilt').setAttribute('aria-pressed', v));
  const projector = () => { const v = document.body.classList.toggle('projector'); $('#btnProj').setAttribute('aria-pressed', v); Globe.setProjector(v); };
  $('#btnProj').onclick = projector;
  const toggleChat = () => {
    const closed = app.classList.toggle('chat-closed');
    $('#btnChat').setAttribute('aria-pressed', !closed);
    setTimeout(() => Globe.resize(), 260);
  };
  $('#btnChat').onclick = toggleChat;
  app.addEventListener('transitionend', e => { if (e.target === app) Globe.resize(); });
  addEventListener('resize', () => Globe.resize());
  $('#btnHelp').onclick = () => $('#help').showModal();
  const openDrawer = v => { $('#drawer').hidden = !v; $('#navSaved').classList.toggle('active', v); $('#navWork').classList.toggle('active', !v); $('#navSaved').setAttribute('aria-expanded', v); };
  $('#navSaved').onclick = () => openDrawer($('#drawer').hidden);
  $('#navWork').onclick = () => openDrawer(false);
  $('#drawerClose').onclick = () => openDrawer(false);
  $('#zoomIn').onclick = () => Globe.zoom(1);
  $('#zoomOut').onclick = () => Globe.zoom(-1);
  $('#compass').onclick = () => Globe.northUp();
  $('#resetOrbit').onclick = () => { Globe.resetOrbit(); $('#btnTilt').setAttribute('aria-pressed', false); };

  $('#search').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const inp = e.target, q = inp.value.trim();
    if (!q) return;
    inp.disabled = true;
    try { const g = await api('/api/geocode?q=' + encodeURIComponent(q)); Globe.flyTo(g.bbox); inp.value = g.name; }
    catch { inp.value = ''; inp.placeholder = `No match for "${q}"`; }
    finally { inp.disabled = false; inp.blur(); }
  });

  const q = $('#q');
  q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer').onsubmit = e => { e.preventDefault(); const v = q.value.trim(); if (v && !busy) { q.value = ''; q.style.height = 'auto'; ask(v); } };
  log.addEventListener('click', e => { const s = e.target.closest('.starter'); if (s) ask(s.dataset.q); });

  const SCENES = { 1: ['Palm Jumeirah 2001 to 2008', 'palm_jumeirah'], 2: ['UAE flood, April 2024', 'dubai_flood_2024'], 3: ['Did Lake Mead shrink?', null] };
  document.addEventListener('keydown', e => {
    const typing = e.target.closest('input, textarea, [contenteditable]');
    if (e.key === 'Escape') { if (!pop.hidden) pop.hidden = true; if (!$('#drawer').hidden) openDrawer(false); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'c') toggleChat();
    else if (k === '/') { e.preventDefault(); if (app.classList.contains('chat-closed')) toggleChat(); q.focus(); }
    else if (k === 'p') projector();
    else if (k === 's') Globe.toggleSwipe();
    else if (SCENES[k]) ask(...SCENES[k]);
  });

  window.App = { ask, get last() { return last; } };
  const ready = boot();
})();
