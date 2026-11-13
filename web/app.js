// app.js - search, assistant (streamed answers), evidence report, Trust UI, stories, modals and shortcuts. Drives window.Globe.
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (p, o) => fetch(p, o).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.detail || r.statusText); return j; });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
  const SENSOR = { 'landsat-5': 'Landsat 5 TM', 'landsat-7': 'Landsat 7 ETM+', 'landsat-8': 'Landsat 8 OLI', 'landsat-9': 'Landsat 9 OLI-2',
                   'sentinel-2a': 'Sentinel-2A', 'sentinel-2b': 'Sentinel-2B', 'sentinel-2c': 'Sentinel-2C' };
  const sensorName = p => SENSOR[String(p).toLowerCase()] || p;
  const resText = s => s.sensor === 'sentinel-2' && s.resolution_m > 10 ? `${s.resolution_m} m grid` : `${s.resolution_m} m`;
  const caption = s => `${sensorName(s.platform)} · ${resText(s)} · ${fmtDate(s.day)}`;
  const INDEX = { mndwi: ['MNDWI', '(green − SWIR1) / (green + SWIR1)', 'water'], ndvi: ['NDVI', '(NIR − red) / (NIR + red)', 'vegetated'],
                  ndwi: ['NDWI', '(green − NIR) / (green + NIR)', 'surface water'], flood: ['MNDWI flood rule', 'before < 0, after > −0.05 and rise > 0.18', 'flooded'], nbr: ['dNBR', '(NIR − SWIR2) / (NIR + SWIR2), pre − post', 'burned'] };
  const STORY_MSG = { palm_jumeirah: 'Palm Jumeirah 2001 to 2008' };
  const icon = id => `<svg class="ico"><use href="#${id}"/></svg>`;
  const app = $('#app'), log = $('#log');

  let cfg = { online: false, attributions: {}, model: null }, last = null, lastQ = null, current = null, presets = [];

  // ------------------------------------------------------------ boot
  async function boot() {
    try { cfg = await api('/api/config', { signal: AbortSignal.timeout(4000) }); } catch { cfg = { online: false, attributions: {}, model: null }; }
    renderStatus();
    Globe.on('fatal', fatal);
    Globe.on('imagery', imagery);
    Globe.on('compare', updateTags);
    const ok = await Globe.init(cfg);
    $('#optSpin').checked = Globe.state.spin;
    loadStories();
    if (ok) setTimeout(() => $('#hint').classList.add('gone'), 9000);
  }

  function renderStatus() {
    const online = cfg.online && navigator.onLine;
    const model = cfg.model ? `${cfg.model.split(':')[0]} · on this machine` : 'no language model · rules and templates';
    $('#chatSub').innerHTML = `<span class="dot ${online ? 'on' : 'off'}"></span>${online ? 'Online' : 'Offline'} · ${esc(model)}`;
    $('#modelNote').textContent = cfg.live === false ? 'Stories only on this host' : '';
  }
  addEventListener('online', () => api('/api/config').then(c => { cfg = { ...cfg, ...c }; renderStatus(); }).catch(() => {}));
  addEventListener('offline', () => { cfg.online = false; renderStatus(); });

  function imagery(kind) {
    const pill = $('#imageryPill'), card = $('.esri-card');
    if (card) card.remove();
    if (kind === 'esri') pill.hidden = true;
    else if (kind === 'naturalearth') { pill.hidden = false; pill.textContent = 'Imagery: Natural Earth II · coarse, context only'; }
    else {
      pill.hidden = false; pill.textContent = kind === 'offline' ? 'Imagery: offline · NASA Blue Marble' : 'Imagery: Esri unavailable · NASA Blue Marble';
      if (kind === 'failed') {
        const d = document.createElement('div');
        d.className = 'esri-card';
        d.innerHTML = '<b>Esri World Imagery is not loading.</b> The globe fell back to NASA Blue Marble. Measured layers and numbers are unaffected: they come from Landsat and Sentinel-2 scenes on disk.';
        $('#stage').append(d);
        setTimeout(() => d.remove(), 12000);
      }
    }
    setAttribution();
  }

  function setAttribution() {
    const A = cfg.attributions || {}, parts = [];
    parts.push(Globe.state.esri === 'ok' && Globe.state.basemap === 'esri' ? 'Basemap: context only, current mixed dates, not analysed' : 'Basemap: NASA Blue Marble / Natural Earth II');
    parts.push('Orbit: NASA Blue Marble');
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
    const frames = cfg.frames || {};
    const ready = presets.filter(p => p.cached || (frames[p.id] || []).length);
    const yr = d => (d || '').slice(0, 4), span = p => yr(p.before) === yr(p.after) ? `${fmtDate(p.before)} to ${fmtDate(p.after)}` : `${yr(p.before)} to ${yr(p.after)}`;   // target dates; the scene picker may shift them a few days
    const html = ready.map(p => `<button class="story" data-id="${esc(p.id)}" data-title="${esc(p.title)}">
        ${p.cached ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
        <span><b>${esc(p.title)}</b>${p.blurb ? `<small>${esc(p.blurb)}</small>` : ''}
        <span class="yr">${p.before ? `${esc(span(p))} · ${p.sensor === 'landsat' ? 'Landsat' : 'Sentinel-2'} · ${esc((INDEX[p.index] || [p.index])[0])}` : ''}</span></span></button>`).join('');
    $('#stories').innerHTML = html || '<p class="mut">No stories are cached yet.</p>';
    if (!$('#fatal').hidden) $('#fatal .stories').innerHTML = html;
    renderBookmarks();
    initSelectors();
  }
  const BK = 'ats.bookmarks.v1';
  const getBk = () => { try { return JSON.parse(localStorage.getItem(BK)) || []; } catch { return []; } };
  const setBk = v => { try { localStorage.setItem(BK, JSON.stringify(v)); } catch { /* private window: bookmarks are a convenience only */ } };
  function renderBookmarks() {
    const b = getBk();
    $('#bookmarks').innerHTML = b.length ? b.map((x, i) => `<button class="story" data-bk="${i}"><span class="ph"></span><span><b>${esc(x.title)}</b><small>${esc(x.when)}</small></span></button>`).join('')
      : '<p class="mut" style="margin:0;font-size:12.5px">Bookmark an answer to keep it here.</p>';
  }
  document.addEventListener('click', e => {
    const s = e.target.closest('.story');
    if (!s) return;
    if (s.dataset.bk) { const b = getBk()[+s.dataset.bk]; if (b) ask(b.message, b.preset_id, b.hint, { index: b.index }); }
    else ask(STORY_MSG[s.dataset.id] || s.dataset.title, s.dataset.id);
    openDrawer(false);
  });

  function fatal(err) {
    const f = $('#fatal');
    f.hidden = false;
    f.innerHTML = `<div class="eyebrow">Globe unavailable</div><h2>The 3D globe could not start on this device.</h2>
      <p class="mut">${esc(err && err.message || 'WebGL is not available.')} The assistant still works: pick a story and the images, measurements and confidence level appear in the chat.</p>
      <div class="stories"></div>`;
    loadStories();
  }

  // ------------------------------------------------------------ search (Google-Earth style type-ahead)
  const sInput = $('#search'), sList = $('#suggest'), sBox = $('#searchBox');
  let sItems = [], sIdx = -1, sCtrl = null, sTimer = null;
  const KIND_ICON = { story: 'i-story', country: 'i-globe', region: 'i-globe', town: 'i-town' };
  function renderSuggest(items, q) {
    sItems = items; sIdx = items.length ? 0 : -1;
    sList.innerHTML = items.length ? items.map((s, i) => `<li role="option" id="sg${i}" aria-selected="${i === 0}" class="${s.kind === 'story' ? 'story' : ''}" data-i="${i}">
        ${icon(KIND_ICON[s.kind] || 'i-pin')}<span><b dir="auto">${esc(s.name)}</b><small>${esc(s.sub || '')}</small></span><span class="k">${esc(s.kind === 'story' ? 'story' : s.kind || '')}</span></li>`).join('')
      : `<li class="none">No match for “${esc(q)}”. Press Enter to ask the assistant.</li>`;
    sList.hidden = false; sBox.setAttribute('aria-expanded', 'true');
  }
  function closeSuggest() { sList.hidden = true; sBox.setAttribute('aria-expanded', 'false'); }
  sInput.addEventListener('input', () => {
    const q = sInput.value.trim();
    clearTimeout(sTimer);
    if (q.length < 2) return closeSuggest();
    sTimer = setTimeout(async () => {
      if (sCtrl) sCtrl.abort();
      sCtrl = new AbortController();
      try { renderSuggest(await api('/api/search?q=' + encodeURIComponent(q), { signal: sCtrl.signal }), q); } catch (e) { if (e.name !== 'AbortError') renderSuggest([], q); }
    }, 160);
  });
  sInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sItems.length) return;
      e.preventDefault();
      sIdx = (sIdx + (e.key === 'ArrowDown' ? 1 : -1) + sItems.length) % sItems.length;
      $$('#suggest li[role=option]').forEach((li, i) => li.setAttribute('aria-selected', i === sIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sItems[sIdx] && !sList.hidden) choose(sItems[sIdx]);
      else if (sInput.value.trim()) { ask(sInput.value.trim()); closeSuggest(); sInput.blur(); }
    } else if (e.key === 'Escape') { closeSuggest(); sInput.blur(); }
  });
  sList.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(sItems[+li.dataset.i]); } });
  sInput.addEventListener('blur', () => setTimeout(closeSuggest, 120));
  function choose(s) {
    closeSuggest(); sInput.value = s.name; sInput.blur();
    if (s.preset_id) return ask(s.name.replace(/ reclamation$/, '') + ' before and after', s.preset_id);
    Globe.flyTo(s.bbox);
    ask([s.name, s.sub].filter(Boolean).join(', '), null, { name: s.name, center: s.center, bbox: s.bbox });
  }

  // ------------------------------------------------------------ assistant
  async function sse(url, body, onEvent, signal) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
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

  function setBusy(b) {
    const s = $('#send');
    s.classList.toggle('stop', b);
    s.setAttribute('aria-label', b ? 'Stop' : 'Send');
    s.innerHTML = icon(b ? 'i-stop' : 'i-send');
  }

  async function ask(message, preset_id = null, hint = null, opts = {}) {
    if (!message || !message.trim()) return;
    if (current) current.stop('Stopped: you asked something new');
    await ready;
    $('#empty') && $('#empty').remove();
    if (app.classList.contains('chat-closed')) toggleChat(true);
    openDrawer(false);                                               // moving on: the stories drawer gets out of the way
    Globe.stopRotate();
    lastQ = { message, preset_id, hint, index: opts.index };
    const turn = document.createElement('div');
    turn.className = 'turn';
    turn.innerHTML = `<div class="q-line" dir="auto">${esc(message)}</div>
      <div class="status"><span class="spinner"></span><span class="lbl">Reading the question</span><span class="t">0.0 s</span></div><div class="body"></div>`;
    log.append(turn);
    const pinTop = () => { log.scrollTop = turn.offsetTop - log.offsetTop - 8; };     // keep the new answer's top in view
    pinTop();
    const body = turn.querySelector('.body'), status = turn.querySelector('.status'), lbl = status.querySelector('.lbl'), tEl = status.querySelector('.t');
    const ctrl = new AbortController(), t0 = performance.now();
    const tick = setInterval(() => { tEl.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }, 100);
    let flight = null, flownKey = hint ? hint.bbox.join() : null, analysis = null, place = null, sayBox = null, reveal = Promise.resolve();
    const me = current = {
      stop(why) { ctrl.abort(); finish(why || 'Stopped'); },
    };
    function finish(text, verify) {
      clearInterval(tick);
      status.classList.add('done');
      status.innerHTML = `<span class="lbl">${esc(text)}</span>${verify ? ' · <button data-verify>Verify the science</button>' : ''}`;
      if (current === me) { current = null; setBusy(false); }
    }
    const sayTarget = () => {
      if (!sayBox) {
        sayBox = document.createElement('div');
        sayBox.className = 'sect read';
        sayBox.innerHTML = `<h4>${analysis ? 'What this shows' : 'About this place'}</h4><p dir="auto"></p><div class="byline">${analysis ? 'Narrated' : 'Written'} by ${esc((cfg.model || 'local model').split(':')[0])} from ${analysis ? 'the measurement and the named sources below' : 'Wikipedia'} · names and numbers checked before display</div>`;
        const anchor = body.querySelector('[data-say-anchor]');
        anchor ? anchor.after(sayBox) : body.append(sayBox);
      }
      return sayBox.querySelector('p');
    };
    setBusy(true);
    try {
      await sse('/api/chat/stream', { message, preset_id, last_analysis_id: last && last.analysis_id, place_hint: hint, index: opts.index || null }, async (ev, d) => {
        if (me !== current) return;
        if (ev === 'plan') {
          if (!d.plan.preset_id) showInstr(false);                   // not a story: the dates bar has nothing to show
          if (d.fly_to && d.fly_to.join() !== flownKey) {
            flownKey = d.fly_to.join();
            const f = Globe.flyTo(d.fly_to); flight = { ...f, start: performance.now() };
          }
          const pr = presets.find(p => p.id === d.plan.preset_id);
          const region = pr ? pr.title : d.place || d.plan.place;
          if (region) { $('#regionChip').hidden = false; $('#regionChip').textContent = `Region · ${region}`; }
        } else if (ev === 'progress') {
          lbl.textContent = d.label;
        } else if (ev === 'place') {
          place = d;
          if (Globe.state.analysis) Globe.hideAnalysis();
          body.insertAdjacentHTML('beforeend', placeHtml(d));
          pinTop();
        } else if (ev === 'analysis') {
          analysis = d;
          lbl.textContent = 'Flying there';
          reveal = (async () => {
            if (flight) await Promise.race([flight.done, sleep(Math.max(0, flight.start + flight.duration * 700 - performance.now()))]);
            if (me !== current) return;
            showAnalysis(d);
            syncSelectors(d);
            body.insertAdjacentHTML('afterbegin', reportHeadHtml(d));
            wireCompare(body.querySelector('.cmp'), d);
            pinTop();
          })();
          await reveal;
        } else if (ev === 'say') {
          await reveal;
          const p = sayTarget();
          p.insertAdjacentHTML('beforeend', `<span class="say">${esc(d.text)} </span>`);
        } else if (ev === 'cards') {
          await reveal;
          if (d.kind === 'analysis') { const m = body.querySelector('[data-measured]'); if (m) m.innerHTML = measuredHtml(d); body.insertAdjacentHTML('beforeend', reportRestHtml(d)); }
          else if (d.kind === 'place') body.insertAdjacentHTML('beforeend', actionsHtml(d.next));
          else body.insertAdjacentHTML('beforeend', `<div class="info ${d.kind === 'error' ? 'error' : ''}" dir="auto">${esc(d.measured)}</div>${notesHtml(d.notes)}${actionsHtml(d.next)}`);
        } else if (ev === 'done') {
          await reveal;
          const s = ((performance.now() - t0) / 1000).toFixed(1);
          finish(`Answered in ${s} s`, !!analysis);
          if (analysis || place) turn.insertAdjacentHTML('beforeend', `<div class="foot"><button data-bookmark>${icon('i-bookmark')}Bookmark</button>${analysis ? `<button data-verify>${icon('i-check')}Verify the science</button>` : ''}</div>`);
        }
      }, ctrl.signal);
      if (me === current) finish(`Answered in ${((performance.now() - t0) / 1000).toFixed(1)} s`, !!analysis);
    } catch (e) {
      if (e.name === 'AbortError') return;
      body.insertAdjacentHTML('beforeend', `<div class="info error">The server did not answer (${esc(e.message)}). Stories still work from disk: open Stories.</div>`);
      finish('Not answered');
    }
  }

  function showAnalysis(a) {
    last = a;
    Globe.showAnalysis(a);
    $('#btnVerify').disabled = false;
    $$('[data-layer=mask]')[0].checked = a.quality.confidence !== 'HIGH';
    updateTags();
    setAttribution();
  }

  function updateTags() {
    if (!last) return;
    const today = Globe.state.compare === 'bt';
    $('#tagLeft').textContent = `Before · ${caption(last.scene_before)}`;
    $('#tagRight').textContent = today ? (Globe.state.esri === 'ok' ? 'Right: Esri imagery, current, mixed dates. Visual only, not measured.' : 'Right: basemap. Visual only, not measured.') : `After · ${caption(last.scene_after)}`;
  }

  // ------------------------------------------------------------ rendering: place guide
  function placeHtml(d) {
    const w = d.wiki || {}, m = w.main || {};
    const stops = (w.nearby || []).map(n => `<li><button class="stop" data-goto='${esc(JSON.stringify({ c: n.center, t: n.title }))}'>
        ${n.thumb ? `<img src="${esc(n.thumb)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
        <span><b dir="auto">${esc(n.title)}</b><small>${esc(n.description || n.extract || '')}</small></span><span class="d">${n.dist_km} km</span></button></li>`).join('');
    return `${m.thumb ? `<div class="banner" style="background-image:url('${esc(m.thumb)}')" role="img" aria-label="${esc(m.title)}"></div>` : ''}
      <h3 class="place-title" dir="auto">${esc(m.title || d.name)}</h3>
      <p class="place-desc">${esc(m.description || d.full || '')}</p>
      ${m.extract ? `<p class="extract" dir="auto">${esc(m.extract)}</p>` : '<p class="extract">No encyclopedia entry found for this spot. The globe shows it in current Esri imagery.</p>'}
      ${m.url ? `<a class="src-link" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Wikipedia${icon('i-ext')}</a>` : ''}
      <div data-say-anchor></div>
      ${stops ? `<div class="sect"><h4>Nearby</h4><ol class="stops">${stops}</ol></div>` : ''}
      <div class="byline" style="margin-top:8px">Place notes: Wikipedia (CC BY-SA 4.0). Not measured by satellite.</div>`;
  }

  // ------------------------------------------------------------ rendering: change report
  // Order: telemetry banner (figure, dates, sensors, quality) -> swipe + thumbnails -> 3-sentence field summary -> named sources -> next steps
  const FLAG_TXT = { cross_sensor: 'Different satellites', season_mismatch: 'Season gap over 45 days', landsat7_slc_gaps: 'Landsat 7 stripe gaps', low_valid_pixels: 'Under 60% measurable' };
  function reportHeadHtml(a) {
    const st = a.stats, q = a.quality, b = a.scene_before, f = a.scene_after;
    const sign = st.net_km2 > 0 ? '+' : st.net_km2 < 0 ? '−' : '';
    const [iname, , noun] = INDEX[a.index] || [a.index, '', ''];
    const pct = st.area_before_km2 > 0 && !q.headline_hidden && a.index !== 'nbr' ? ` · ${st.net_km2 >= 0 ? '+' : '−'}${Math.abs(100 * st.net_km2 / st.area_before_km2).toFixed(0)}%` : '';
    const res = [...new Set([b, f].map(s => `${s.resolution_m} m ${s.sensor === 'landsat' ? 'Landsat' : 'Sentinel-2'}`))].join(' / ');
    const thumb = (kind, bg, label) => `<button class="th" data-lb="${kind}" title="Open ${label} full size"><span style="background-image:${bg}"></span><b>${label}</b></button>`;
    return `<section class="telemetry" dir="auto">
        <div class="tel-top"><span class="eyebrow">Measured with ${esc(iname)}</span><span class="badge ${esc(q.confidence)}">${esc(q.confidence[0] + q.confidence.slice(1).toLowerCase())} confidence</span></div>
        <div class="figure-row">${q.headline_hidden ? '<div class="figure hidden">Too much cloud or missing data to measure reliably</div>'
          : `<div class="figure">${sign}${Math.abs(st.net_km2).toFixed(2)}<span class="u"> km²</span></div><div class="figure-lbl">net ${noun} area${pct}</div>`}</div>
        <div class="when">${esc(caption(b))} → ${esc(caption(f))} · analysis grid ${esc(res)}</div>
        ${q.headline_hidden ? '' : `<dl class="stats"><div><dt>Gained</dt><dd>${st.gain_km2} km²</dd></div><div><dt>Lost</dt><dd>${st.loss_km2} km²</dd></div><div><dt>Clear on both</dt><dd>${st.valid_pct_both}%</dd></div></dl>`}
        <div class="vbar" title="Share of the area measurable on both dates"><i style="width:${Math.max(0, Math.min(100, st.valid_pct_both))}%"></i></div>
        <div class="when">${st.valid_pct_both}% clear on both dates · before ${st.valid_pct_before}% · after ${st.valid_pct_after}% ·
          <span class="why" tabindex="0" title="${esc(whyText(b))}">why these scenes?</span></div>
        <div class="chips">${q.flags.map(x => `<span class="qchip">${esc(FLAG_TXT[x] || x)}</span>`).join('')}
          ${st.ignored_small_km2 > 0 && !q.headline_hidden ? `<span class="qchip">Under ${st.min_mapping_unit_px} px ignored: ${st.ignored_small_km2} km²</span>` : ''}
          <span class="qchip">Basemap not analysed</span></div>
        <div data-measured></div>
      </section>
      <div class="cmp" style="--p:50%" title="Drag to compare. Double-click for full size.">
        <img src="${esc(a.layers.rgb_after)}" alt="After: ${esc(caption(f))}"><img class="chg" src="${esc(a.layers.change)}" alt="">
        <div class="b"><img src="${esc(a.layers.rgb_before)}" alt="Before: ${esc(caption(b))}"></div>
        <div class="hand"></div><span class="tag l">${esc(fmtDate(b.day))}</span><span class="tag r">${esc(fmtDate(f.day))}</span>
      </div>
      <div class="cmp-tools"><label><input type="checkbox" data-chg checked> Change</label>
        <span class="legend"><i class="g"></i>${esc(st.gain_label)}${st.loss_label ? `<i class="l"></i>${esc(st.loss_label)}` : ''}</span></div>
      <div class="thumbs">
        ${thumb('before', `url('${esc(a.layers.rgb_before)}')`, 'Before')}
        ${thumb('after', `url('${esc(a.layers.rgb_after)}')`, 'After')}
        ${thumb('change', `url('${esc(a.layers.change)}'),url('${esc(a.layers.rgb_after)}')`, 'Change')}
      </div>
      <div data-say-anchor></div>`;
  }

  function wireCompare(el, a) {
    if (!el) return;
    const set = x => { const r = el.getBoundingClientRect(); el.style.setProperty('--p', Math.min(98, Math.max(2, (x - r.left) / r.width * 100)) + '%'); };
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); set(e.clientX); const mv = ev => set(ev.clientX); el.addEventListener('pointermove', mv); el.addEventListener('pointerup', () => el.removeEventListener('pointermove', mv), { once: true }); });
    el.addEventListener('dblclick', () => lightbox(a, 'after'));
    const root = el.parentElement;
    root.querySelector('[data-chg]').addEventListener('change', e => { el.classList.toggle('nochg', !e.target.checked); Globe.setLayer('change', e.target.checked); $$('[data-layer=change]')[0].checked = e.target.checked; });
    root.querySelectorAll('.thumbs [data-lb]').forEach(t => t.addEventListener('click', () => lightbox(a, t.dataset.lb)));
  }

  const notesHtml = notes => (notes || []).map(n => `<div class="note" dir="auto">${esc(n)}</div>`).join('');
  const actionsHtml = next => next && next.length ? `<div class="actions"><div class="eyebrow">Look next</div>${next.map(c => `<button class="act" data-next='${esc(JSON.stringify(c))}'>${esc(c.label)}${icon('i-arrow')}</button>`).join('')}</div>` : '';

  function measuredHtml(c) {
    return `<p class="measured" dir="auto">${esc(c.measured)}</p>${c.quality ? `<p class="qtext" dir="auto">${esc(c.quality.text)}</p>` : ''}${notesHtml(c.notes)}`;
  }

  function reportRestHtml(c) {
    const ctx = c.context;
    const srcs = [], cite = (title, url) => { let i = srcs.findIndex(s => s.url === url); if (i < 0) { srcs.push({ title, url }); i = srcs.length - 1; } return `<a class="cite" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">[${i + 1}]</a>`; };
    let h = '';
    if (c.interpretation) h += `<div class="sect"><h4>A likely reading <span class="eyebrow">· model's guess, not measured</span></h4><p class="ai" dir="auto">${esc(c.interpretation.text)}</p></div>`;
    if (ctx && ((ctx.what_happened || []).length || (ctx.downsides || []).length || (ctx.counterpoints || []).length)) {
      h += `<div class="sect"><h4>Background <span class="eyebrow">· from the sources listed, not from the satellite</span></h4>`;
      if ((ctx.what_happened || []).length) h += `<div class="eyebrow sub-h">What happened</div><ul class="ctx-list">${ctx.what_happened.map(x => `<li dir="auto">${esc(x.text)}${cite(x.source_title, x.source_url)}</li>`).join('')}</ul>`;
      if ((ctx.downsides || []).length) h += `<div class="eyebrow sub-h">Reported impacts</div><ul class="ctx-list">${ctx.downsides.map(x => `<li dir="auto">${esc(x.text)}${cite(x.source_title, x.source_url)}${x.disputed ? `<span class="tag-d">Disputed by developer</span>${x.disputed_note ? `<span class="dispute">${esc(x.disputed_note.replace(/^Disputed by developer:\s*/i, ''))}</span>` : ''}` : ''}</li>`).join('')}</ul>`;
      if ((ctx.counterpoints || []).length) h += `<div class="eyebrow sub-h">The other side</div><ul class="ctx-list">${ctx.counterpoints.map(x => `<li dir="auto">${esc(x.text)}${cite(x.source_title, x.source_url)}</li>`).join('')}</ul>`;
      h += `<ol class="sources">${srcs.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')}</ol></div>`;
    }
    return h + actionsHtml(c.next);
  }

  function whyText(s) {
    return `Why ${fmtDate(s.day)}? Candidate days in the search window, with the real share of your area that was clear:\n` +
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
    const g = e.target.closest('[data-goto]');
    if (g) { const { c, t } = JSON.parse(g.dataset.goto); Globe.flyTo([c[0] - 0.006, c[1] - 0.005, c[0] + 0.006, c[1] + 0.005]); Globe.pin(c, t); return; }
    if (e.target.closest('[data-verify]')) return openVerify();
    const bm = e.target.closest('[data-bookmark]');
    if (bm && lastQ) {
      const b = getBk().filter(x => x.message !== lastQ.message);
      b.unshift({ ...lastQ, title: (last && last.title) || lastQ.message, when: `Saved ${fmtDate(new Date().toISOString())}` });
      setBk(b.slice(0, 20)); renderBookmarks();
      bm.innerHTML = `${icon('i-bookmark')}Saved`;
    }
    const s = e.target.closest('.starter');
    if (s) ask(s.dataset.q, s.dataset.preset || null);
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
        <tr><th>Confidence rules</th><td>HIGH ≥ 85% valid on both dates; MEDIUM 60–85% or one downgrade; LOW below 60% or two downgrades. One downgrade each for different sensor families and a season gap over 45 days. Under 50% valid the area headline is hidden. A data-quality badge, not a statistical interval.</td></tr>
        <tr><th>Flags</th><td>${a.quality.flags.length ? a.quality.flags.map(esc).join(', ') : 'none'}</td></tr>
        <tr><th>Analysis id</th><td><code>${esc(a.analysis_id)}</code></td></tr></table>
      <h4>Language model</h4><table><tr><th>Role</th><td>Plans the question and narrates. It never computes a number. Every narrated sentence is dropped unless all its numbers and proper names appear in the facts it was given.</td></tr>
        <tr><th>Model</th><td>${esc(cfg.model || 'none on this host (rules and templates)')}</td></tr></table>
      <h4>Attribution</h4><table>
        <tr><th>Basemap (context only)</th><td>${esc(A.esri || '')}. Current, mixed-date imagery; never analysed.</td></tr>
        <tr><th>Orbit view</th><td>${esc(A.nasa || 'NASA Blue Marble')}</td></tr>
        <tr><th>Landsat</th><td>${esc(A.landsat || '')}</td></tr>
        <tr><th>Sentinel-2</th><td>${esc(A.sentinel2 || '')}</td></tr>
        <tr><th>This analysis</th><td>${esc(a.attribution)}</td></tr>
        <tr><th>Globe</th><td>${esc(A.cesium || 'CesiumJS (Apache-2.0)')} · ${esc(A.naturalearth || '')}</td></tr>
        <tr><th>Search and places</th><td>${esc(A.geocode || '')} · ${esc(A.wikipedia || '')}</td></tr>
        <tr><th>Satellites</th><td>${esc(A.celestrak || '')}</td></tr></table>
      <p class="mut" style="margin-top:12px;font-size:12.5px">No model training was performed.</p></div>`;
    $('#verify').showModal();
  }

  function lightbox(a, kind) {
    const url = kind === 'before' ? a.layers.rgb_before : kind === 'after' ? a.layers.rgb_after : a.layers.change;
    const s = kind === 'before' ? a.scene_before : a.scene_after;
    const lb = $('#lightbox');
    lb.innerHTML = `<div class="modal-head"><h3>${kind === 'before' ? 'Before' : 'After'} · ${esc(caption(s))}</h3>
      <div class="lb-tools"><button data-k="before">Before</button><button data-k="after">After</button><button data-zoom="1.4">${icon('i-plus')}</button><button data-zoom="0.7">${icon('i-minus')}</button>
      <a href="${esc(url)}" download="${esc(a.analysis_id.replace(/[:]/g, '_'))}_${kind}.png">${icon('i-download')}PNG</a>
      <button class="x" data-close aria-label="Close">${icon('i-close')}</button></div></div>
      <div class="lb-view"><img alt="${esc(kind)} image" src="${esc(url)}"></div>`;
    lb.open || lb.showModal();
    const view = lb.querySelector('.lb-view'), img = lb.querySelector('img');
    let k = 1, x = 0, y = 0;
    const apply = () => { img.style.transform = `translate(${x}px,${y}px) scale(${k})`; };
    img.onload = () => { k = Math.min(view.clientWidth / img.naturalWidth, view.clientHeight / img.naturalHeight); x = (view.clientWidth - img.naturalWidth * k) / 2; y = (view.clientHeight - img.naturalHeight * k) / 2; apply(); };
    const zoomAt = (fct, cx, cy) => { x = cx - (cx - x) * fct; y = cy - (cy - y) * fct; k *= fct; apply(); };
    view.addEventListener('wheel', e => { e.preventDefault(); const r = view.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    view.addEventListener('pointerdown', e => {
      view.setPointerCapture(e.pointerId);
      const sx = e.clientX - x, sy = e.clientY - y;
      const mv = ev => { x = ev.clientX - sx; y = ev.clientY - sy; apply(); };
      view.addEventListener('pointermove', mv);
      view.addEventListener('pointerup', () => view.removeEventListener('pointermove', mv), { once: true });
    });
    lb.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => zoomAt(+b.dataset.zoom, view.clientWidth / 2, view.clientHeight / 2));
    lb.querySelectorAll('[data-k]').forEach(b => b.onclick = () => lightbox(a, b.dataset.k));
  }
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });

  // ------------------------------------------------------------ selector bar: region, two observation dates, index
  // Two-way: changing a selector runs the comparison; any analysis shown (story, chip, typed question) updates the selectors.
  const SEL = { region: $('#sel-region'), y1: $('#sel-y1'), y2: $('#sel-y2'), index: $('#sel-index'), run: $('#sel-run') };
  const IDX_LABEL = { mndwi: 'MNDWI · water, coast', ndvi: 'NDVI · vegetation', ndwi: 'NDWI · surface water', flood: 'MNDWI flood rule', nbr: 'dNBR · burn scar' };
  const DEFAULT_PAIR = { palm_jumeirah: ['2001', '2008'] };
  const banks = {}, singles = {};
  const shortSensor = p => sensorName(p).replace(/ (TM|ETM\+|OLI(-2)?)$/, '');
  const regionName = pid => ((presets.find(p => p.id === pid) || {}).title || pid).replace(/ reclamation$/, '');

  async function fillRegion(pid, y1, y2, ix) {
    SEL.region.value = pid;
    const frames = (cfg.frames || {})[pid];
    if (frames && frames.length) {
      const rows = banks[pid] || (banks[pid] = await api(`/api/frames/${pid}`));
      const opts = rows.map(r => `<option value="${esc(r.year)}">${esc(r.year)} · ${esc(fmtDate(r.day).replace(/^\d+ /, ''))} · ${esc(shortSensor(r.platform))}</option>`).join('');
      const [d1, d2] = DEFAULT_PAIR[pid] || [rows[0].year, rows[rows.length - 1].year];
      SEL.y1.innerHTML = opts; SEL.y2.innerHTML = opts;
      SEL.y1.value = y1 || d1; SEL.y2.value = y2 || d2;
      SEL.index.innerHTML = ['mndwi', 'ndvi', 'ndwi'].map(k => `<option value="${k}">${IDX_LABEL[k]}</option>`).join('');
      SEL.index.value = ix && IDX_LABEL[ix] ? ix : 'mndwi';
      [SEL.y1, SEL.y2, SEL.index].forEach(s => { s.disabled = false; });
    } else {                                                       // single-pair story: its two dates and index are fixed
      const a = singles[pid] || (singles[pid] = await api(`/api/presets/${pid}`));
      SEL.y1.innerHTML = `<option>${esc(fmtDate(a.scene_before.day))} · ${esc(shortSensor(a.scene_before.platform))}</option>`;
      SEL.y2.innerHTML = `<option>${esc(fmtDate(a.scene_after.day))} · ${esc(shortSensor(a.scene_after.platform))}</option>`;
      SEL.index.innerHTML = `<option value="${esc(a.index)}">${esc(IDX_LABEL[a.index] || a.index)}</option>`;
      [SEL.y1, SEL.y2, SEL.index].forEach(s => { s.disabled = true; });
    }
    SEL.run.disabled = !SEL.y1.disabled && SEL.y1.value === SEL.y2.value;
  }

  async function initSelectors() {
    const frames = cfg.frames || {};
    const ready = presets.filter(p => p.cached || (frames[p.id] || []).length);
    SEL.region.innerHTML = ready.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
    if (ready.length) await fillRegion(ready.some(p => p.id === 'palm_jumeirah') ? 'palm_jumeirah' : ready[0].id).catch(() => {});
  }

  function runSelectors() {
    const pid = SEL.region.value;
    if (!pid) return;
    if (!SEL.y1.disabled) {
      const ys = [SEL.y1.value, SEL.y2.value].sort();
      if (ys[0] === ys[1]) { SEL.run.disabled = true; return; }
      ask(`Compare ${regionName(pid)} ${ys[0]} to ${ys[1]}`, pid, null, { index: SEL.index.value });
    } else ask(STORY_MSG[pid] || regionName(pid), pid);
  }

  // The bar starts closed. It opens by itself for pre-computed (story) analyses and closes for any other answer.
  function showInstr(v) { $('#instr').hidden = !v; $('#instrToggle').setAttribute('aria-expanded', v); }
  $('#instrToggle').onclick = () => showInstr($('#instr').hidden);

  function syncSelectors(a) {
    const m = /^presets:([a-z0-9_]+?)(?:__(\d{4})_(\d{4})(?:_([a-z]+))?)?$/.exec(a.analysis_id || '');
    const pre = !!m && [...SEL.region.options].some(o => o.value === m[1]);
    showInstr(pre);
    if (pre) fillRegion(m[1], m[2], m[3], m[4] || a.index).catch(() => {});
  }

  SEL.region.addEventListener('change', () => fillRegion(SEL.region.value).then(runSelectors).catch(() => {}));
  [SEL.y1, SEL.y2, SEL.index].forEach(s => s.addEventListener('change', () => { SEL.run.disabled = SEL.y1.value === SEL.y2.value; runSelectors(); }));
  $('#instr').addEventListener('submit', e => { e.preventDefault(); runSelectors(); });

  // ------------------------------------------------------------ chrome controls
  function setSeg(mode) { $$('[data-compare]').forEach(b => { const on = b.dataset.compare === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); }); }
  $$('[data-compare]').forEach(b => b.onclick = () => { setSeg(b.dataset.compare); Globe.setCompare(b.dataset.compare); });
  $$('[data-layer]').forEach(i => i.onchange = () => Globe.setLayer(i.dataset.layer, i.checked));
  $$('input[name=basemap]').forEach(i => i.onchange = () => { Globe.setBasemap(i.value); setAttribution(); });
  const pop = $('#layersPop');
  $('#btnLayers').onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; $('#btnLayers').setAttribute('aria-expanded', !pop.hidden); };
  document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.pop-wrap')) { pop.hidden = true; $('#btnLayers').setAttribute('aria-expanded', false); } });
  $('#btnVerify').onclick = openVerify;
  $('#btnTilt').onclick = () => $('#btnTilt').setAttribute('aria-pressed', !!Globe.tilt());
  const projector = v => { const on = document.body.classList.toggle('projector', v); $('#optProj').checked = on; Globe.setProjector(on); };
  $('#optProj').onchange = e => projector(e.target.checked);
  $('#optSpin').onchange = e => Globe.setSpin(e.target.checked);
  async function sats(want) {
    const btn = $('#btnSats'), box = $('#optSats'), chip = $('#satChip');
    chip.hidden = false; chip.textContent = want ? 'Loading satellites…' : '';
    const onNow = await Globe.satellites(s => {
      if (s.error) { chip.textContent = 'Satellites unavailable offline'; return; }
      chip.textContent = `Live · ${s.count} satellites · CelesTrak`;
    });
    btn.setAttribute('aria-pressed', onNow); box.checked = onNow;
    if (!onNow && !chip.textContent.startsWith('Satellites unavailable')) chip.hidden = true;
  }
  $('#btnSats').onclick = () => sats($('#btnSats').getAttribute('aria-pressed') !== 'true');
  $('#optSats').onchange = e => { if ((e.target.checked) !== ($('#btnSats').getAttribute('aria-pressed') === 'true')) sats(e.target.checked); };
  // The chat slides over the globe with a CSS transform; the canvas keeps its size, so we only repaint once, at the end.
  const chatEl = $('#chat'), narrow = () => matchMedia('(max-width: 900px)').matches;
  const syncInset = () => Globe.setInset(!narrow() && !app.classList.contains('chat-closed') ? chatEl.offsetWidth : 0);
  let slideT;
  const settle = () => { clearTimeout(slideT); slideT = null; syncInset(); Globe.resize(); };
  const toggleChat = force => {
    if (force === true) app.classList.remove('chat-closed'); else app.classList.toggle('chat-closed');
    $('#btnChat').setAttribute('aria-pressed', !app.classList.contains('chat-closed'));
    clearTimeout(slideT); slideT = setTimeout(settle, 250);           // fallback if transitionend never fires (reduced motion)
  };
  chatEl.addEventListener('transitionend', e => { if (e.target === chatEl && e.propertyName === 'transform' && slideT) settle(); });
  $('#btnChat').onclick = () => toggleChat();
  $('#chatClose').onclick = () => toggleChat();
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { syncInset(); Globe.resize(); }, 120); });
  if (narrow()) { app.classList.add('chat-closed'); $('#btnChat').setAttribute('aria-pressed', false); }
  syncInset();
  $('#btnHelp').onclick = () => $('#help').showModal();
  const openDrawer = v => { $('#drawer').hidden = !v; $('#navSaved').setAttribute('aria-expanded', v); };
  $('#navSaved').onclick = () => openDrawer($('#drawer').hidden);
  $('#drawerClose').onclick = () => openDrawer(false);
  $('#zoomIn').onclick = () => Globe.zoom(1);
  $('#zoomOut').onclick = () => Globe.zoom(-1);
  $('#compass').onclick = () => Globe.northUp();
  $('#resetOrbit').onclick = () => { Globe.resetOrbit(); $('#btnTilt').setAttribute('aria-pressed', false); };

  const q = $('#q');
  q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer').onsubmit = e => {
    e.preventDefault();
    if (current && !q.value.trim()) return current.stop('Stopped');
    const v = q.value.trim();
    if (v) { q.value = ''; q.style.height = 'auto'; ask(v); }
  };

  const SCENES = { 1: ['Palm Jumeirah 2001 to 2008', 'palm_jumeirah'], 2: ['UAE flood, April 2024', 'dubai_flood_2024'], 3: ['Did Lake Mead shrink?', null], 4: ['Palisades fire, Los Angeles 2025', 'la_palisades_2025'] };
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); sInput.focus(); sInput.select(); return; }
    const typing = e.target.closest('input, textarea, [contenteditable]');
    if (e.key === 'Escape') { if (!pop.hidden) pop.hidden = true; if (!$('#drawer').hidden) openDrawer(false); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'c') toggleChat();
    else if (k === '/') { e.preventDefault(); toggleChat(true); q.focus(); }
    else if (k === 'p') projector();
    else if (k === 's') Globe.toggleSwipe();
    else if (k === 't') $('#btnTilt').click();
    else if (k === 'o') $('#resetOrbit').click();
    else if (SCENES[k]) ask(...SCENES[k]);
  });

  window.App = { ask, get last() { return last; }, get busy() { return !!current; } };
  const ready = boot();
})();
