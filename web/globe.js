// globe.js - CesiumJS globe: imagery stack, camera, analysis overlays and swipe. Exposes window.Globe. Vanilla JS, no build step.
(() => {
  const C = window.Cesium;
  const NATIVE_MAX_LEVEL = 19;          // Esri World Imagery over Dubai: level 20+ returns placeholder tiles (measured in P0)
  const ESRI_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const LABELS_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer';
  const ORBIT = { lon: 52, lat: 22, h: 2.0e7 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const on = {}, emit = (n, d) => (on[n] || []).forEach(f => f(d));

  let viewer, scene, camera;
  const base = {}, ov = {};
  const st = { split: 0.5, swipe: true, compare: 'ba', want: { before: true, after: true, change: true, mask: false, labels: false },
               basemap: 'esri', esri: 'pending', rotate: !reduce, flying: false, analysis: null, projector: false };
  const stats = { fps: null, qualityStep: 0 };

  // ------------------------------------------------------------ init
  async function init(cfg) {
    try {
      viewer = new C.Viewer('globe', {
        animation: false, baseLayerPicker: false, fullscreenButton: false, vrButton: false, geocoder: false, homeButton: false,
        infoBox: false, sceneModePicker: false, selectionIndicator: false, timeline: false, navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false, scene3DOnly: true, baseLayer: false,
        terrainProvider: new C.EllipsoidTerrainProvider(), creditContainer: $('credits'),
        requestRenderMode: true, maximumRenderTimeChange: Infinity, useBrowserRecommendedResolution: false, msaaSamples: 4,
        // ?shots keeps the drawing buffer so headless screenshots can capture the canvas; off for the demo (faster)
        contextOptions: { webgl: { preserveDrawingBuffer: /[?&]shots\b/.test(location.search) } },
      });
    } catch (e) { emit('fatal', e); return false; }
    scene = viewer.scene; camera = scene.camera;
    const g = scene.globe;
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
    g.maximumScreenSpaceError = 1; g.tileCacheSize = 1000; g.preloadSiblings = true;
    g.enableLighting = false; g.showGroundAtmosphere = true; scene.skyAtmosphere.show = true;
    g.baseColor = C.Color.fromCssColorString('#0B1324');
    scene.postProcessStages.fxaa.enabled = true;
    const ctl = scene.screenSpaceCameraController; ctl.minimumZoomDistance = 20; ctl.maximumZoomDistance = 3e7;
    scene.splitPosition = st.split;
    camera.percentageChanged = 0.002;
    camera.setView({ destination: C.Cartesian3.fromDegrees(ORBIT.lon, ORBIT.lat, ORBIT.h) });

    scene.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); emit('fatal', new Error('The graphics context was lost.')); });
    // offline floor: bundled Natural Earth II
    base.ne = C.ImageryLayer.fromProviderAsync(C.TileMapServiceImageryProvider.fromUrl(C.buildModuleUrl('Assets/Textures/NaturalEarthII')));
    viewer.imageryLayers.add(base.ne);
    if (cfg.online !== false && navigator.onLine) addEsri(cfg); else esriFailed('offline');

    wireInput(); wireHud(); wireRotate(); wireFps();
    scene.requestRender();
    return true;
  }

  function addEsri(cfg) {
    // Never-discard: the default policy probes a level-23 tile that 404s; we never request above level 19 anyway.
    const opts = { maximumLevel: NATIVE_MAX_LEVEL, enablePickFeatures: false, tileDiscardPolicy: new C.NeverTileDiscardPolicy() };
    let p;
    if (cfg.arcgis_key) {
      C.ArcGisMapService.defaultAccessToken = cfg.arcgis_key;
      p = C.ArcGisMapServerImageryProvider.fromBasemapType(C.ArcGisBaseMapType.SATELLITE, opts);
    } else p = C.ArcGisMapServerImageryProvider.fromUrl(ESRI_URL, opts);
    base.esri = C.ImageryLayer.fromProviderAsync(p);
    base.esri.readyEvent.addEventListener(prov => {
      if (st.esri === 'pending') st.esri = 'ok';
      applyBasemap();
      const errs = [];                                            // 3 tile failures within 15 s = Esri is down
      prov.errorEvent.addEventListener(() => {
        const t = performance.now(); errs.push(t);
        while (errs.length && t - errs[0] > 15000) errs.shift();
        if (errs.length >= 3 && st.esri === 'ok') esriFailed('tiles');
      });
    });
    base.esri.errorEvent.addEventListener(() => esriFailed('metadata'));
    viewer.imageryLayers.add(base.esri);
    base.labels = C.ImageryLayer.fromProviderAsync(C.ArcGisMapServerImageryProvider.fromUrl(LABELS_URL, { enablePickFeatures: false, tileDiscardPolicy: new C.NeverTileDiscardPolicy() }));
    base.labels.errorEvent.addEventListener(() => { base.labels.show = false; });
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

  // ------------------------------------------------------------ camera
  function rectFor(bbox, pad = 0.25) {
    const [w, s, e, n] = bbox, pw = (e - w) * pad, ph = (n - s) * pad;
    return C.Rectangle.fromDegrees(w - pw, s - ph, e + pw, n + ph);
  }

  function flyTo(bbox) {
    stopRotate();
    const h = camera.positionCartographic.height;
    const fromOrbit = h > 2e6;
    const duration = reduce ? 0.8 : fromOrbit ? 6 : h > 1.5e5 ? 3.5 : 2.5;
    let resolve;
    const done = new Promise(r => { resolve = r; });
    st.flying = true;
    camera.flyTo({
      destination: rectFor(bbox), duration,
      orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
      easingFunction: C.EasingFunction.QUARTIC_IN_OUT,
      maximumHeight: fromOrbit ? undefined : Math.max(h * 3, 4e4),
      complete: () => { st.flying = false; resolve(true); },
      cancel: () => { st.flying = false; resolve(false); },
    });
    return { duration, done };
  }

  function resetOrbit() {
    stopTilt();
    camera.flyTo({ destination: C.Cartesian3.fromDegrees(ORBIT.lon, ORBIT.lat, ORBIT.h), duration: reduce ? 0.8 : 3,
                   orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 }, easingFunction: C.EasingFunction.QUARTIC_IN_OUT });
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
      offset: new C.HeadingPitchRange(camera.heading, C.Math.toRadians(tilted ? -40 : -89.9), range),
      duration: reduce ? 0 : 1.5, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
    });
    return tilted;
  }
  function stopTilt() { tilted = false; emit('tilt', false); }

  function northUp() {
    const target = centerTarget();
    if (!target) return;
    camera.flyToBoundingSphere(new C.BoundingSphere(target, 0), {
      offset: new C.HeadingPitchRange(0, camera.pitch, C.Cartesian3.distance(camera.positionWC, target)), duration: reduce ? 0 : 0.6 });
  }
  const zoom = k => { const h = camera.positionCartographic.height; k > 0 ? camera.zoomIn(h * 0.45) : camera.zoomOut(h * 0.8); scene.requestRender(); };

  // ------------------------------------------------------------ overlays
  function clearOverlays() {
    for (const k of Object.keys(ov)) { viewer.imageryLayers.remove(ov[k], true); delete ov[k]; }
  }

  const ALPHA = () => ({ before: 1, after: 1, change: st.projector ? 0.92 : 0.9, mask: 1 });

  function showAnalysis(a) {
    clearOverlays();
    st.analysis = a;
    const [w, s, e, n] = a.bounds, rectangle = C.Rectangle.fromDegrees(w, s, e, n);
    const mk = (url, nearest) => {
      const l = C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl(url, { rectangle }), {
        alpha: 0, magnificationFilter: nearest ? C.TextureMagnificationFilter.NEAREST : C.TextureMagnificationFilter.LINEAR });
      viewer.imageryLayers.add(l);
      return l;
    };
    ov.before = mk(a.layers.rgb_before, false);
    ov.after = mk(a.layers.rgb_after, false);
    ov.change = mk(a.layers.change, true);
    ov.mask = mk(a.layers.mask, true);
    if (base.labels) viewer.imageryLayers.raiseToTop(base.labels);
    st.want.mask = a.quality.confidence !== 'HIGH';               // Trust UI: masked layer on by default for Medium/Low
    applyCompare();
    fade(reduce ? 0 : 600);
    emit('analysis', a);
  }

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
      ov.after.show = st.want.after && !today;
      ov.after.splitDirection = split ? R : N;
      ov.change.show = st.want.change && !today;
      ov.change.splitDirection = split ? R : N;
      ov.mask.show = st.want.mask;
      ov.mask.splitDirection = today ? L : N;
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

  // ------------------------------------------------------------ input, HUD, rotation, FPS governor
  function wireInput() {
    const cv = scene.canvas;
    const interrupt = () => { if (st.flying) camera.cancelFlight(); stopRotate(); };
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

  const fmtLen = m => m >= 1000 ? `${+(m / 1000).toFixed(m >= 1e4 ? 0 : 1)} km` : `${Math.round(m)} m`;
  let mouse = null;
  function wireHud() {
    const cv = scene.canvas;
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); mouse = new C.Cartesian2(e.clientX - r.left, e.clientY - r.top); hud(); });
    cv.addEventListener('pointerleave', () => { mouse = null; hud(); });
    camera.changed.addEventListener(hud);
    camera.moveEnd.addEventListener(hud);
    hud();
  }

  function hud() {
    const c = camera.positionCartographic, cv = scene.canvas, W = cv.clientWidth, H = cv.clientHeight;
    const p = mouse ? camera.pickEllipsoid(mouse) : centerTarget();
    if (p) {
      const g = C.Cartographic.fromCartesian(p), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
      $('hudCoord').textContent = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
    } else $('hudCoord').textContent = '—';
    $('hudHeight').textContent = `Camera ${fmtLen(c.height)}`;
    const a = camera.pickEllipsoid(new C.Cartesian2(W / 2 - 50, H - 70)), b = camera.pickEllipsoid(new C.Cartesian2(W / 2 + 50, H - 70));
    let mpp = null;
    if (a && b) {
      mpp = new C.EllipsoidGeodesic(C.Cartographic.fromCartesian(a), C.Cartographic.fromCartesian(b)).surfaceDistance / 100;
      const raw = mpp * 120, p10 = Math.pow(10, Math.floor(Math.log10(raw))), nice = [5, 2, 1].map(k => k * p10).find(v => v <= raw) || p10;
      $('scaleBar').style.width = Math.round(nice / mpp) + 'px';
      $('scaleText').textContent = fmtLen(nice);
    } else { $('scaleBar').style.width = '0'; $('scaleText').textContent = ''; }
    const native = 156543.03 * Math.cos(c.latitude) / Math.pow(2, NATIVE_MAX_LEVEL);
    $('detailChip').hidden = !(mpp && mpp < native * 0.9 && st.basemap === 'esri' && st.esri === 'ok');
    $('compassNeedle').style.transform = `rotate(${-C.Math.toDegrees(camera.heading)}deg)`;
  }

  let lastTick = null;
  function wireRotate() {
    viewer.clock.onTick.addEventListener(() => {
      const t = performance.now(), dt = lastTick ? (t - lastTick) / 1000 : 0; lastTick = t;
      if (!st.rotate || st.flying) return;
      camera.rotate(C.Cartesian3.UNIT_Z, -0.035 * Math.min(dt, 0.1));
      scene.requestRender();
    });
  }
  function stopRotate() { if (st.rotate) { st.rotate = false; emit('interacted'); } }

  // Back off quality if the median FPS stays under 30 for 5 s while the scene is moving.
  const LADDER = [() => { viewer.scene.msaaSamples = 2; }, () => { viewer.scene.msaaSamples = 1; },
                  () => { viewer.resolutionScale = Math.min(viewer.resolutionScale, 1.5); }, () => { viewer.resolutionScale = 1; },
                  () => { scene.globe.maximumScreenSpaceError = 1.5; }, () => { scene.globe.maximumScreenSpaceError = 2; }];
  function wireFps() {
    let last = null, win = [], since = null;
    scene.postRender.addEventListener(() => {
      const t = performance.now();
      const moving = st.flying || st.rotate || dragging;
      if (last && moving && t - last < 500) {
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
    let dragging = false;
    scene.canvas.addEventListener('pointerdown', () => { dragging = true; });
    window.addEventListener('pointerup', () => { dragging = false; });
  }

  window.Globe = {
    init, flyTo, resetOrbit, tilt, northUp, zoom, showAnalysis, stopRotate, stats,
    on: (n, f) => { (on[n] = on[n] || []).push(f); },
    setLayer(name, v) { st.want[name] = v; applyCompare(); },
    setCompare(mode) { st.compare = mode; applyCompare(); },
    setSwipe(v) { st.swipe = v; applyCompare(); },
    toggleSwipe() { st.swipe = !st.swipe; applyCompare(); return st.swipe; },
    setBasemap(kind) { st.basemap = kind; applyBasemap(); },
    setProjector(v) { st.projector = v; if (ov.change) ov.change.alpha = ALPHA().change; scene && scene.requestRender(); },
    resize() { if (viewer) { viewer.resize(); scene.requestRender(); hud(); } },
    get state() { return st; },
    get viewer() { return viewer; },
  };
})();
