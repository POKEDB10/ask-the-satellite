// globe.js - CesiumJS globe: imagery stack, lighting, orbit-turn-zoom flights, spin, overlays + swipe, live satellites.
// Exposes window.Globe. Vanilla JS, no build step.
(() => {
  const C = window.Cesium;
  const BASE_LEVEL = 17;              // Esri World Imagery is assumed to exist everywhere up to here
  const MAX_LEVEL = 23;               // deeper tiles are requested only where Esri's /tilemap says they exist
  const ESRI_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const ESRI_KEYED_URL = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
  const LABELS_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer';
  const ORBIT = { lon: 52, lat: 20, h: 1.9e7 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const on = {}, emit = (n, d) => (on[n] || []).forEach(f => f(d));
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let viewer, scene, camera, flight = null;
  const base = {}, ov = {};
  const st = { split: 0.5, swipe: true, compare: 'ba', want: { before: true, after: true, change: true, mask: false, labels: false },
               basemap: 'esri', esri: 'pending', spin: !reduce, spinning: false, lastInput: performance.now() - 19000, analysis: null,
               projector: false, nativeLevel: 19 };
  const stats = { fps: null, qualityStep: 0 };
  try { const v = localStorage.getItem('ats.spin'); if (v !== null) st.spin = v === '1' && !reduce; } catch { /* storage off: default */ }

  // ------------------------------------------------------------ init
  async function init(cfg) {
    try {
      viewer = new C.Viewer('globe', {
        animation: false, baseLayerPicker: false, fullscreenButton: false, vrButton: false, geocoder: false, homeButton: false,
        infoBox: false, sceneModePicker: false, selectionIndicator: false, timeline: false, navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false, scene3DOnly: true, baseLayer: false,
        terrainProvider: new C.EllipsoidTerrainProvider(), creditContainer: $('credits'),
        requestRenderMode: true, maximumRenderTimeChange: Infinity, showRenderLoopErrors: false,
        useBrowserRecommendedResolution: false, msaaSamples: 2,
        contextOptions: { webgl: { preserveDrawingBuffer: /[?&]shots\b/.test(location.search), powerPreference: 'high-performance' } },
      });
    } catch (e) { emit('fatal', e); return false; }
    scene = viewer.scene; camera = scene.camera;
    const g = scene.globe;
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5);
    g.maximumScreenSpaceError = 1.25; g.tileCacheSize = 600; g.preloadSiblings = false; g.preloadAncestors = true;
    g.baseColor = C.Color.fromCssColorString('#0A1630');
    g.showGroundAtmosphere = true; scene.skyAtmosphere.show = true;
    // Google-Earth-like orbit look: soft light from over the viewer's shoulder, faded out when close so imagery keeps its true colours.
    g.enableLighting = true; g.dynamicAtmosphereLighting = true; g.dynamicAtmosphereLightingFromSun = false;
    g.lightingFadeOutDistance = 2.5e6; g.lightingFadeInDistance = 9e6;
    scene.light = new C.DirectionalLight({ direction: new C.Cartesian3(1, 0, 0), intensity: 2.4 });
    scene.skyAtmosphere.brightnessShift = 0.06; scene.skyAtmosphere.saturationShift = 0.05;
    scene.postProcessStages.fxaa.enabled = true;
    const ctl = scene.screenSpaceCameraController; ctl.minimumZoomDistance = 25; ctl.maximumZoomDistance = 3.2e7;
    ctl.inertiaSpin = 0.9; ctl.inertiaTranslate = 0.9; ctl.inertiaZoom = 0.8;
    scene.splitPosition = st.split;
    camera.percentageChanged = 0.002;
    camera.setView({ destination: C.Cartesian3.fromDegrees(ORBIT.lon, ORBIT.lat, ORBIT.h) });

    const lost = err => { viewer.useDefaultRenderLoop = false; emit('fatal', err); };
    scene.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost(new Error('The graphics context was lost.')); });
    scene.renderError.addEventListener((_, err) => lost(err instanceof Error ? err : new Error('Rendering stopped.')));

    // imagery stack, bottom to top: Natural Earth (offline floor), Esri (detail), Blue Marble + clouds (orbit look), overlays, labels
    base.ne = C.ImageryLayer.fromProviderAsync(C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl('Assets/Textures/NaturalEarthII')));
    viewer.imageryLayers.add(base.ne);
    if (cfg.online !== false && navigator.onLine) addEsri(cfg); else esriFailed('offline');
    const whole = { rectangle: C.Rectangle.MAX_VALUE };
    base.bm = C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl('vendor/earth/bluemarble_topo_july_4096.jpg', whole));
    base.clouds = C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl('vendor/earth/clouds_4096.jpg', whole));
    viewer.imageryLayers.add(base.bm); viewer.imageryLayers.add(base.clouds);
    if (base.labels) viewer.imageryLayers.raiseToTop(base.labels);

    scene.preRender.addEventListener(frame);
    wireInput(); wireHud(); wireQuality();
    scene.requestRender();
    return true;
  }

  // per-frame: light follows the camera, orbit textures fade by altitude, idle spin. Cheap, and only runs when a frame renders.
  const dir = new C.Cartesian3(), tmp = new C.Cartesian3();
  let lastT = performance.now();
  function frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    C.Cartesian3.multiplyByScalar(camera.rightWC, 0.45, tmp);
    C.Cartesian3.add(camera.directionWC, tmp, dir);
    C.Cartesian3.multiplyByScalar(camera.upWC, -0.35, tmp);
    C.Cartesian3.add(dir, tmp, dir);
    C.Cartesian3.normalize(dir, scene.light.direction);
    const h = camera.positionCartographic.height;
    const esriOk = st.esri === 'ok' && st.basemap === 'esri';
    if (base.bm) base.bm.alpha = esriOk ? smooth(1.2e6, 4.5e6, h) : 1;
    if (base.clouds) base.clouds.alpha = 0.92 * smooth(4.5e6, 1.25e7, h);
    if (st.spinning) { camera.rotate(C.Cartesian3.UNIT_Z, -0.03 * dt); scene.requestRender(); }
  }

  // ------------------------------------------------------------ Esri, with deep tiles only where they exist
  function deepProvider(url, credit) {
    const prov = new C.UrlTemplateImageryProvider({ url, maximumLevel: MAX_LEVEL, credit, tilingScheme: new C.WebMercatorTilingScheme() });
    const avail = new Map(), orig = prov.requestImage.bind(prov);
    const none = () => { const e = new Error('no imagery at this zoom'); e.statusCode = 404; return Promise.reject(e); };
    prov.requestImage = (x, y, level, request) => {
      if (level <= BASE_LEVEL) return orig(x, y, level, request);
      const bx = x >> 5, by = y >> 5, k = `${level}/${by}/${bx}`, a = avail.get(k);
      if (a === undefined) {
        avail.set(k, 'pending');
        fetch(`${ESRI_URL}/tilemap/${level}/${by << 5}/${bx << 5}/32/32`).then(r => (r.ok ? r.json() : null))
          .then(j => avail.set(k, j && j.data ? j : null)).catch(() => avail.set(k, null)).finally(() => scene.requestRender());
        return undefined;                                         // Cesium retries once the availability block has arrived
      }
      if (a === 'pending') return undefined;
      if (!a) return none();
      const L = a.location, i = (y - L.top) * L.width + (x - L.left);
      return a.data[i] === 1 ? orig(x, y, level, request) : none();
    };
    prov.availableAt = (lon, lat, level) => {
      const n = 2 ** level, x = Math.floor((lon + 180) / 360 * n);
      const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      const a = avail.get(`${level}/${y >> 5}/${x >> 5}`);
      if (!a || a === 'pending') return undefined;
      return a.data[(y - a.location.top) * a.location.width + (x - a.location.left)] === 1;
    };
    return prov;
  }

  function addEsri(cfg) {
    const tiles = cfg.arcgis_key ? `${ESRI_KEYED_URL}/tile/{z}/{y}/{x}?token=${encodeURIComponent(cfg.arcgis_key)}` : `${ESRI_URL}/tile/{z}/{y}/{x}`;
    const credit = new C.Credit((cfg.attributions && cfg.attributions.esri) || 'Esri, Vantor, Earthstar Geographics, and the GIS User Community');
    base.esriProv = deepProvider(tiles, credit);
    base.esri = C.ImageryLayer.fromProviderAsync(Promise.resolve(base.esriProv));
    base.esri.readyEvent.addEventListener(prov => {
      if (st.esri === 'pending') st.esri = 'ok';
      applyBasemap();
      const errs = [];                                            // 3 real failures within 15 s = Esri is down
      prov.errorEvent.addEventListener(e => {
        if (e && e.error && e.error.statusCode === 404) return;   // no imagery for that tile: not an outage
        const t = performance.now(); errs.push(t);
        while (errs.length && t - errs[0] > 15000) errs.shift();
        if (errs.length >= 3 && st.esri === 'ok') esriFailed('tiles');
      });
    });
    viewer.imageryLayers.add(base.esri);
    base.labels = C.ImageryLayer.fromProviderAsync(Promise.resolve(new C.UrlTemplateImageryProvider({
      url: `${LABELS_URL}/tile/{z}/{y}/{x}`, maximumLevel: 19, tilingScheme: new C.WebMercatorTilingScheme() })));
    viewer.imageryLayers.add(base.labels);
    applyBasemap();
  }

  function esriFailed(why) {
    st.esri = 'failed';
    if (base.esri) base.esri.show = false;
    if (base.labels) base.labels.show = false;
    emit('imagery', why === 'offline' ? 'offline' : 'failed');
    applyCompare();
  }

  // ------------------------------------------------------------ camera: zoom out to orbit, turn the globe, zoom in
  function rectFor(bbox, pad = 0.18) {
    const [w, s, e, n] = bbox, pw = (e - w) * pad, ph = (n - s) * pad;
    return C.Rectangle.fromDegrees(w - pw, s - ph, e + pw, n + ph);
  }
  const unit = c => new C.Cartesian3(Math.cos(c.latitude) * Math.cos(c.longitude), Math.cos(c.latitude) * Math.sin(c.longitude), Math.sin(c.latitude));

  function cancelFlight() { if (flight) { flight.cancelled = true; flight = null; } }

  function flyTo(bbox) {
    if (!camera) return { duration: 0, done: Promise.resolve(false) };
    cancelFlight(); stopSpin(); touch();
    const s = camera.positionCartographic.clone(), d = C.Cartographic.fromCartesian(camera.getRectangleCameraCoordinates(rectFor(bbox)));
    d.height = Math.max(d.height, 900);
    const a = unit(s), b = unit(d), ang = Math.acos(Math.min(1, Math.max(-1, C.Cartesian3.dot(a, b))));
    const far = ang > 0.3, mid = ang > 0.04;
    const peak = far ? Math.max(1.5e7, s.height, d.height) : mid ? Math.max(s.height, d.height, ang * 1.6e7) : Math.max(s.height, d.height) * 1.6;
    const duration = reduce ? 0.8 : far ? 6.2 : mid ? 4 : 2.2;
    const h0 = camera.heading, p0 = camera.pitch, ls = Math.log(s.height), lp = Math.log(peak), ld = Math.log(d.height);
    const goingUp = s.height < peak * 0.9;
    const f = { cancelled: false, duration };
    flight = f;
    const done = new Promise(resolve => {
      const t0 = performance.now();
      const step = now => {
        if (f.cancelled) return resolve(false);
        const t = Math.min(1, (now - t0) / (duration * 1000));
        const move = goingUp ? smooth(0.16, 0.84, t) : smooth(0, 0.75, t);
        const up = goingUp ? smooth(0, 0.38, t) : 1, down = smooth(goingUp ? 0.6 : 0.2, 1, t);
        const lh = ((goingUp ? ls + (lp - ls) * up : ls) * (1 - down)) + ld * down;
        let v;
        if (ang < 1e-6) v = a;
        else {
          const k1 = Math.sin((1 - move) * ang) / Math.sin(ang), k2 = Math.sin(move * ang) / Math.sin(ang);
          v = new C.Cartesian3(a.x * k1 + b.x * k2, a.y * k1 + b.y * k2, a.z * k1 + b.z * k2);
        }
        const lon = Math.atan2(v.y, v.x), lat = Math.asin(Math.max(-1, Math.min(1, v.z / C.Cartesian3.magnitude(v))));
        const o = smooth(0, 0.35, t);
        camera.setView({ destination: C.Cartesian3.fromRadians(lon, lat, Math.exp(lh)),
                         orientation: { heading: lerpAngle(h0, 0, o), pitch: p0 + (-C.Math.PI_OVER_TWO - p0) * o, roll: 0 } });
        scene.requestRender();
        if (t < 1) requestAnimationFrame(step);
        else { if (flight === f) flight = null; idleQuality(); resolve(true); }
      };
      busyQuality();
      requestAnimationFrame(step);
    });
    return { duration, done };
  }
  const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

  function orbitHeight() {                                          // finish the reset at orbit height rather than the tiny box
    cancelFlight();
    const c = camera.positionCartographic;
    camera.flyTo({ destination: C.Cartesian3.fromRadians(c.longitude, Math.max(-0.6, Math.min(0.6, c.latitude)), ORBIT.h),
                   orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 }, duration: reduce ? 0.8 : 3, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
                   complete: () => { touch(-25000); } });
  }

  function centerTarget() {
    const c = scene.canvas;
    return camera.pickEllipsoid(new C.Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
  }
  let tilted = false;
  function tilt(want) {
    const target = centerTarget();
    if (!target) return tilted;
    tilted = want === undefined ? !tilted : want;
    const range = C.Cartesian3.distance(camera.positionWC, target);
    camera.flyToBoundingSphere(new C.BoundingSphere(target, 0), {
      offset: new C.HeadingPitchRange(camera.heading, C.Math.toRadians(tilted ? -38 : -89.9), range),
      duration: reduce ? 0 : 1.5, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT });
    return tilted;
  }
  function northUp() {
    const target = centerTarget();
    if (!target) return;
    camera.flyToBoundingSphere(new C.BoundingSphere(target, 0), {
      offset: new C.HeadingPitchRange(0, camera.pitch, C.Cartesian3.distance(camera.positionWC, target)), duration: reduce ? 0 : 0.6 });
  }
  const zoom = k => {
    const h = camera.positionCartographic.height;
    camera.flyTo({ destination: C.Cartesian3.fromRadians(camera.positionCartographic.longitude, camera.positionCartographic.latitude, k > 0 ? h * 0.5 : Math.min(3e7, h * 2)),
                   orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 }, duration: reduce ? 0 : 0.45, easingFunction: C.EasingFunction.QUADRATIC_OUT });
  };

  // ------------------------------------------------------------ spin when idle at orbit
  function touch(offset = 0) { st.lastInput = performance.now() + offset; if (st.spinning) stopSpin(); }
  function stopSpin() { if (!st.spinning) return; st.spinning = false; viewer.targetFrameRate = undefined; emit('spin', false); }
  setInterval(() => {
    if (!viewer || !st.spin || st.spinning || flight) return;
    if (performance.now() - st.lastInput > 20000 && camera.positionCartographic.height > 5e6) {
      st.spinning = true; viewer.targetFrameRate = 30; emit('spin', true); scene.requestRender();    // 30 fps is plenty for a slow spin
    }
  }, 1000);

  // ------------------------------------------------------------ overlays (measured layers) and swipe
  function clearOverlays() { for (const k of Object.keys(ov)) { viewer.imageryLayers.remove(ov[k], true); delete ov[k]; } }
  const ALPHA = () => ({ before: 1, after: 1, change: st.projector ? 0.92 : 0.9, mask: 1 });

  function showAnalysis(a) {
    st.analysis = a;
    if (!viewer) return;
    clearOverlays();
    const [w, s, e, n] = a.bounds, rectangle = C.Rectangle.fromDegrees(w, s, e, n);
    const mk = (url, nearest) => {
      const l = C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl(url, { rectangle }), {
        alpha: 0, magnificationFilter: nearest ? C.TextureMagnificationFilter.NEAREST : C.TextureMagnificationFilter.LINEAR });
      viewer.imageryLayers.add(l);
      return l;
    };
    ov.before = mk(a.layers.rgb_before, false); ov.after = mk(a.layers.rgb_after, false);
    ov.change = mk(a.layers.change, true); ov.mask = mk(a.layers.mask, true);
    if (base.labels) viewer.imageryLayers.raiseToTop(base.labels);
    st.want.mask = a.quality.confidence !== 'HIGH';               // Trust UI: masked layer on by default for Medium/Low
    applyCompare();
    fade(reduce ? 0 : 600);
    emit('analysis', a);
  }
  function hideAnalysis() { if (viewer) clearOverlays(); st.analysis = null; applyCompare(); }

  function fade(ms) {
    const t0 = performance.now(), A = ALPHA();
    const step = t => {
      const k = ms ? Math.min(1, (t - t0) / ms) : 1, e = 1 - Math.pow(1 - k, 3);
      for (const n of Object.keys(ov)) ov[n].alpha = A[n] * e;
      scene.requestRender();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function applyCompare() {
    if (!viewer) return;
    const L = C.SplitDirection.LEFT, R = C.SplitDirection.RIGHT, N = C.SplitDirection.NONE;
    const today = st.compare === 'bt', split = st.swipe && !!st.analysis;
    if (ov.before) {
      ov.before.show = st.want.before && (split || today);
      ov.before.splitDirection = split || today ? L : N;
      ov.after.show = st.want.after && !today; ov.after.splitDirection = split ? R : N;
      ov.change.show = st.want.change && !today; ov.change.splitDirection = split ? R : N;
      ov.mask.show = st.want.mask; ov.mask.splitDirection = today ? L : N;
    }
    if (base.labels) base.labels.show = st.want.labels && st.esri === 'ok' && st.basemap === 'esri';
    $('swipe').hidden = !(st.analysis && (split || today));
    scene.splitPosition = st.split;
    $('swipe').style.setProperty('--split', (st.split * 100).toFixed(2) + '%');
    emit('compare', { mode: st.compare, swipe: split || today });
    scene.requestRender();
  }

  function applyBasemap() {
    if (base.esri) base.esri.show = st.basemap === 'esri' && st.esri === 'ok';
    applyCompare();
    emit('imagery', st.basemap === 'esri' && st.esri === 'ok' ? 'esri' : st.esri === 'ok' ? 'naturalearth' : st.esri === 'pending' ? 'esri' : st.esri);
  }

  // a pin for "worth a stop" places
  let pins;
  function pin(center, title) {
    if (!viewer) return;
    if (!pins) { pins = viewer.entities; }
    pins.removeAll();
    pins.add({ position: C.Cartesian3.fromDegrees(center[0], center[1]),
      point: { pixelSize: 10, color: C.Color.fromCssColorString('#06B6D4'), outlineColor: C.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: title, font: '500 13px "IBM Plex Sans", sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#0B0F19'),
               outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    scene.requestRender();
  }

  // ------------------------------------------------------------ input, HUD, adaptive quality
  function wireInput() {
    const cv = scene.canvas;
    const interrupt = () => { cancelFlight(); touch(); };
    cv.addEventListener('pointerdown', interrupt);
    cv.addEventListener('wheel', interrupt, { passive: true });
    const h = $('swipeHandle');
    const move = e => {
      const r = cv.getBoundingClientRect();
      st.split = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
      h.setAttribute('aria-valuenow', Math.round(st.split * 100));
      applyCompare();
    };
    h.addEventListener('pointerdown', e => { h.setPointerCapture(e.pointerId); h.addEventListener('pointermove', move); });
    h.addEventListener('pointerup', e => { h.releasePointerCapture(e.pointerId); h.removeEventListener('pointermove', move); });
    h.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { st.split = Math.min(0.98, Math.max(0.02, st.split + (e.key === 'ArrowLeft' ? -0.02 : 0.02))); applyCompare(); e.preventDefault(); }
    });
  }

  // While the camera moves, draw coarser tiles (fewer requests, steady frame rate); sharpen as soon as it stops.
  let qTimer;
  function busyQuality() { clearTimeout(qTimer); scene.globe.maximumScreenSpaceError = 2.6; }
  function idleQuality() { clearTimeout(qTimer); qTimer = setTimeout(() => { scene.globe.maximumScreenSpaceError = stats.qualityStep > 2 ? 1.8 : 1.25; scene.requestRender(); }, 120); }
  function wireQuality() {
    camera.moveStart.addEventListener(busyQuality);
    camera.moveEnd.addEventListener(() => { if (!flight) idleQuality(); });
    let last = null, win = [], since = null;                       // governor: median FPS under 30 for 5 s while moving -> back off
    const LADDER = [() => { scene.msaaSamples = 1; }, () => { viewer.resolutionScale = 1; }, () => { scene.postProcessStages.fxaa.enabled = false; }];
    scene.postRender.addEventListener(() => {
      const t = performance.now();
      if (last && (flight || st.spinning) && t - last < 500) {
        win.push(t - last); since = since || t;
        if (t - since >= 5000) {
          const s = win.slice().sort((x, y) => x - y), fps = 1000 / s[s.length >> 1];
          stats.fps = Math.round(fps);
          if (fps < 30 && stats.qualityStep < LADDER.length) LADDER[stats.qualityStep++]();
          win = []; since = null;
        }
      }
      last = t;
    });
  }

  const fmtLen = m => m >= 1000 ? `${+(m / 1000).toFixed(m >= 1e4 ? 0 : 1)} km` : `${Math.round(m)} m`;
  let mouse = null, hudQueued = false;
  function wireHud() {
    const cv = scene.canvas;
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); mouse = new C.Cartesian2(e.clientX - r.left, e.clientY - r.top); queueHud(); });
    cv.addEventListener('pointerleave', () => { mouse = null; queueHud(); });
    camera.changed.addEventListener(queueHud);
    camera.moveEnd.addEventListener(queueHud);
    hud();
  }
  function queueHud() { if (!hudQueued) { hudQueued = true; requestAnimationFrame(() => { hudQueued = false; hud(); }); } }   // at most once per frame

  function hud() {
    const c = camera.positionCartographic, cv = scene.canvas, W = cv.clientWidth, H = cv.clientHeight;
    const p = mouse ? camera.pickEllipsoid(mouse) : centerTarget();
    let lon = null, lat = null;
    if (p) {
      const g = C.Cartographic.fromCartesian(p); lat = C.Math.toDegrees(g.latitude); lon = C.Math.toDegrees(g.longitude);
      $('hudCoord').textContent = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
    } else $('hudCoord').textContent = '—';
    $('hudHeight').textContent = `Camera ${fmtLen(c.height)}`;
    const a = camera.pickEllipsoid(new C.Cartesian2(W / 2 - 50, H - 70)), b = camera.pickEllipsoid(new C.Cartesian2(W / 2 + 50, H - 70));
    let mpp = null;
    if (a && b) {
      mpp = new C.EllipsoidGeodesic(C.Cartographic.fromCartesian(a), C.Cartographic.fromCartesian(b)).surfaceDistance / 100;
      const raw = mpp * 110, p10 = Math.pow(10, Math.floor(Math.log10(raw))), nice = [5, 2, 1].map(k => k * p10).find(v => v <= raw) || p10;
      $('scaleBar').style.width = Math.round(nice / mpp) + 'px';
      $('scaleText').textContent = fmtLen(nice);
    } else { $('scaleBar').style.width = '0'; $('scaleText').textContent = ''; }
    // native detail at the view centre: the deepest level Esri's tilemap reports there (19 if not known yet)
    let native = 19;
    const ctr = centerTarget();
    if (ctr && base.esriProv) {
      const g = C.Cartographic.fromCartesian(ctr), lo = C.Math.toDegrees(g.longitude), la = C.Math.toDegrees(g.latitude);
      for (let lv = MAX_LEVEL; lv > BASE_LEVEL; lv--) { if (base.esriProv.availableAt(lo, la, lv)) { native = lv; break; } }
    }
    st.nativeLevel = native;
    const res = 156543.03 * Math.cos(c.latitude) / Math.pow(2, native);
    $('detailChip').hidden = !(mpp && mpp < res * 0.9 && st.basemap === 'esri' && st.esri === 'ok');
    $('swipe').classList.toggle('far', c.height > 4e5);                 // measured overlays are invisible from orbit
    $('compassNeedle').style.transform = `rotate(${-C.Math.toDegrees(camera.heading)}deg)`;
  }

  // ------------------------------------------------------------ live satellites (CelesTrak TLEs + satellite.js SGP4)
  let sat = null;
  async function satellites(onState) {
    if (!viewer) return false;
    if (sat) {                                                     // toggle off
      clearInterval(sat.timer); scene.primitives.remove(sat.points); scene.primitives.remove(sat.labels); scene.primitives.remove(sat.paths);
      sat = null; scene.requestRender(); return false;
    }
    sat = { loading: true };
    try {
      const [{ twoline2satrec }, { propagate, gstime }, { eciToEcf }, feed] = await Promise.all([
        import('./vendor/satellite/io.js'), import('./vendor/satellite/propagation.js'), import('./vendor/satellite/transforms.js'),
        fetch('/api/satellites').then(r => r.json())]);
      if (!sat) return false;
      const recs = feed.sats.map(s => ({ ...s, rec: twoline2satrec(s.l1, s.l2) }));
      const points = scene.primitives.add(new C.PointPrimitiveCollection());
      const labels = scene.primitives.add(new C.LabelCollection());
      const paths = scene.primitives.add(new C.PolylineCollection());
      const KEY = C.Color.fromCssColorString('#06B6D4'), DIM = C.Color.WHITE.withAlpha(0.75);
      const pos = (rec, date) => {
        const pv = propagate(rec, date);
        if (!pv || !pv.position || typeof pv.position !== 'object') return null;
        const e = eciToEcf(pv.position, gstime(date));
        return new C.Cartesian3(e.x * 1000, e.y * 1000, e.z * 1000);
      };
      const nice = n => n.replace('ISS (ZARYA)', 'ISS').replace(/^LANDSAT /, 'Landsat ').replace(/^SENTINEL-/, 'Sentinel-');
      for (const r of recs) {
        r.pt = points.add({ position: C.Cartesian3.ZERO, pixelSize: r.key ? 8 : 3.5, color: r.key ? KEY : DIM,
                            outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: r.key ? 1.5 : 0, show: false });
        if (r.key) r.lb = labels.add({ position: C.Cartesian3.ZERO, text: nice(r.name), font: '500 12px "IBM Plex Sans", sans-serif',
                                        fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#0B0F19'), outlineWidth: 3,
                                        style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(10, -10), show: false });
      }
      const tracks = () => {                                       // one orbit ahead for the Landsat / Sentinel-2 / ISS family
        paths.removeAll();
        const now = Date.now();
        for (const r of recs.filter(x => x.key)) {
          const ptsArr = [];
          for (let m = 0; m <= 100; m += 2) { const p = pos(r.rec, new Date(now + m * 60000)); if (p) ptsArr.push(p); }
          if (ptsArr.length > 2) paths.add({ positions: ptsArr, width: 1.5, material: C.Material.fromType('Color', { color: KEY.withAlpha(0.55) }) });
        }
      };
      const tick = () => {
        const d = new Date();
        let n = 0;
        for (const r of recs) {
          const p = pos(r.rec, d);
          r.pt.show = !!p;
          if (p) { r.pt.position = p; n++; if (r.lb) { r.lb.position = p; r.lb.show = true; } }
        }
        scene.requestRender();
        onState && onState({ count: n, fetched: feed.fetched, source: feed.source });
      };
      Object.assign(sat, { points, labels, paths, loading: false, timer: setInterval(tick, 1000) });
      tracks(); tick();
      sat.trackTimer = setInterval(() => sat && tracks(), 300000);
      return true;
    } catch (e) {
      sat = null; onState && onState({ error: e.message }); return false;
    }
  }

  window.Globe = {
    init, flyTo, showAnalysis, hideAnalysis, stats, pin, satellites,
    resetOrbit: () => camera && orbitHeight(), tilt: (...a) => camera && tilt(...a), northUp: () => camera && northUp(), zoom: k => camera && zoom(k),
    stopRotate: () => { touch(); }, cancelFlight,
    on: (n, f) => { (on[n] = on[n] || []).push(f); },
    setLayer(name, v) { st.want[name] = v; applyCompare(); },
    setCompare(mode) { st.compare = mode; applyCompare(); },
    setSwipe(v) { st.swipe = v; applyCompare(); },
    toggleSwipe() { st.swipe = !st.swipe; applyCompare(); return st.swipe; },
    setBasemap(kind) { st.basemap = kind; applyBasemap(); },
    setSpin(v) { st.spin = v && !reduce; try { localStorage.setItem('ats.spin', v ? '1' : '0'); } catch { /* convenience only */ } if (!v) stopSpin(); else touch(-25000); },
    setProjector(v) { st.projector = v; if (ov.change) ov.change.alpha = ALPHA().change; scene && scene.requestRender(); },
    resize() { if (viewer) { viewer.resize(); scene.requestRender(); hud(); } },
    get state() { return st; },
    get viewer() { return viewer; },
  };
})();
