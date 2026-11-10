/* Aurora Atlas: app wiring (state, map, actions, refresh loop) */
'use strict';
(function (AA) {
  const U = AA.U, Sky = AA.Sky, D = AA.D, UI = AA.UI, FX = AA.FX;
  const $ = U.$;
  const SITE_URL = 'https://dwenograd.github.io/aurora-atlas/';
  const app = (AA.app = {});
  const isMobile = () => UI.sheet.enabled; // phone layout: the planner is a bottom sheet
  const coarse = window.matchMedia('(pointer: coarse)').matches; // finger, not mouse
  const shortMq = window.matchMedia('(max-height: 540px) and (min-width: 560px)'); // a phone on its side
  const scrollWithin = (box, el, pad = 8) => { if (box && el) box.scrollTop = Math.max(0, el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - pad); };

  // ---------- State ----------
  const lang = navigator.language || 'en-US';
  const defaults = {
    units: /^en(-US|-LR|-MM)?$/i.test(lang) ? 'imperial' : 'metric',
    mode: 'auto', radiusKm: 120,
    layers: { best: true, aurora: true, clouds: false, lp: false, spots: true },
    base: 'night', alerts: false, alertThreshold: 10, calm: false, nightVision: false, lpOpacity: 0.7,
  };
  const savedSettings = U.store.get('aa.settings', {}) || {};
  const state = (AA.state = {
    home: U.store.get('aa.home', null),
    spots: U.store.get('aa.spots', []) || [],
    log: U.store.get('aa.log', []) || [],
    suggestions: U.store.get('aa.sug', []) || [],
    settings: { ...defaults, ...savedSettings, layers: { ...defaults.layers, ...(savedSettings.layers || {}) } },
    selected: null,
    time: Date.now(),
    live: true,
    picking: false,
    inspect: null,
  });
  const KEYS = { home: 'aa.home', spots: 'aa.spots', log: 'aa.log', settings: 'aa.settings', sug: 'aa.sug' };
  const save = (k) => U.store.set(KEYS[k], k === 'sug' ? state.suggestions : state[k]);
  const calm = () => state.settings.calm || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Map ----------
  const start = state.home ? [state.home.lat, state.home.lon] : [47.35, -120.6];
  const map = L.map('map', {
    zoomControl: false, worldCopyJump: true, minZoom: 3, maxZoom: 15,
    zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 120,
  }).setView(start, state.home ? 7.5 : 6.5);
  app.map = map;
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  for (const [name, z] of [['lpPane', 250], ['labelsPane', 380], ['linesPane', 390]]) map.createPane(name).style.zIndex = z;
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const ESRI_ATTR = 'Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const bases = {
    night: L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, crossOrigin: true, className: 'base-night', attribution: ESRI_ATTR }),
    terrain: L.tileLayer(`${ESRI}/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, crossOrigin: true, className: 'base-terrain', attribution: 'Hillshade &copy; Esri' }),
    satellite: L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 18, maxZoom: 19, crossOrigin: true, className: 'base-sat', attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
  };
  const labels = L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, pane: 'labelsPane', crossOrigin: true, className: 'base-labels' }).addTo(map);
  const lpLayer = L.tileLayer(D.URL.lp, {
    pane: 'lpPane', tileSize: 1024, zoomOffset: -2, minZoom: 2, maxNativeZoom: 8, maxZoom: 19, opacity: state.settings.lpOpacity, crossOrigin: 'anonymous',
    attribution: 'Light pollution &copy; <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener">D. Lorenz</a> · Aurora &amp; Kp: <a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener">NOAA SWPC</a> · Weather: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>',
  });
  const fx = FX.createMapLayer(map);
  const particles = FX.createParticles(map, { max: coarse ? 130 : 240, dpr: coarse ? 1.5 : 2 });
  const sw = FX.createSolarWind($('#swCanvas'));
  const linesRenderer = L.svg({ pane: 'linesPane', padding: 0.5 });
  const homeLayer = L.layerGroup().addTo(map);
  const spotLayer = L.layerGroup().addTo(map);
  const sugLayer = L.layerGroup().addTo(map);
  let pickMarker = null, radiusRing = null;
  let fxDirty = true, mapMoving = false;
  map.on('movestart zoomstart', () => { mapMoving = true; });
  map.on('moveend zoomend', () => { mapMoving = false; fxDirty = true; placeReachTip(); maybeOfferClouds(); refreshKey(); });
  labels.bringToFront();

  // Where the map is hidden behind panels, so fly-tos land in the clear part
  function obstruction() {
    if (isMobile()) {
      // the sheet (counted at half height at most: a full sheet hides the map anyway) plus the timeline riding on it
      const sh = UI.sheet, eff = Math.min(sh.target || sh.heights.half, sh.heights.half);
      return { l: 0, r: 0, t: $('#layers').getBoundingClientRect().bottom + 4, b: eff + ($('#timeline').offsetHeight || 64) + 14 };
    }
    const panel = $('#panel').getBoundingClientRect(), rc = $('.rightcol').getBoundingClientRect();
    const tlTop = window.innerHeight - $('#timeline').getBoundingClientRect().top;
    if (shortMq.matches) return { l: panel.right, r: 8, t: rc.bottom, b: tlTop };
    return { l: panel.right, r: window.innerWidth - rc.left, t: $('.topbar').getBoundingClientRect().bottom, b: tlTop };
  }
  app.flyTo = (lat, lon, zoom, opts = {}) => {
    const z = zoom ?? map.getZoom();
    const o = obstruction();
    const p = map.project([lat, lon], z).subtract([(o.l - o.r) / 2, (o.t - o.b) / 2]);
    map.flyTo(map.unproject(p, z), z, { duration: 1.4, ...opts });
  };
  app.flyToBounds = (bounds) => {
    const o = obstruction();
    map.flyToBounds(bounds, { paddingTopLeft: [o.l + 30, o.t + 30], paddingBottomRight: [o.r + 30, o.b + 30], duration: 1.4, maxZoom: 11 });
  };
  // Put a point in the middle of the part of the map that is actually visible, without animating
  app.centerOn = (lat, lon, zoom) => {
    const z = zoom ?? map.getZoom();
    const o = obstruction();
    const p = map.project([lat, lon], z).subtract([(o.l - o.r) / 2, (o.t - o.b) / 2]);
    map.setView(map.unproject(p, z), z, { animate: false });
  };
  // Nudge the map so a point is not hidden under the panels
  function revealOnMap(lat, lon) {
    const o = obstruction(), size = map.getSize(), pt = map.latLngToContainerPoint([lat, lon]), m = 28;
    const dx = pt.x < o.l + m ? pt.x - (o.l + m) : pt.x > size.x - o.r - m ? pt.x - (size.x - o.r - m) : 0;
    const dy = pt.y < o.t + m ? pt.y - (o.t + m) : pt.y > size.y - o.b - m ? pt.y - (size.y - o.b - m) : 0;
    if (dx || dy) map.panBy([dx, dy], { duration: 0.35 });
  }

  // ---------- Markers ----------
  const divIcon = (html, size) => L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  function placeHome() {
    homeLayer.clearLayers();
    if (!state.home) return;
    const m = L.marker([state.home.lat, state.home.lon], {
      icon: divIcon(`<div class="mk mk-home"><i class="ring"></i><i class="ring r2"></i><div class="core">${U.icon('home')}</div></div>`, 34),
      // on a touch screen a stray drag while panning would move home, so the pin only drags with a mouse
      draggable: !coarse, title: coarse ? state.home.name : `${state.home.name} (drag to adjust)`, zIndexOffset: 1000, keyboard: true,
    });
    m.on('click', () => {
      app.selectPlace(null);
      app.inspect(state.home.lat, state.home.lon, { kind: 'home', kindLabel: 'Home base', title: state.home.name, name: state.home.name });
    });
    m.on('dragend', () => {
      const ll = m.getLatLng();
      state.home.lat = +ll.lat.toFixed(5);
      state.home.lon = +U.wrapLon(ll.lng).toFixed(5);
      save('home');
      homeChanged(false);
      UI.toast("Home moved. Tonight's forecast is updating.");
    });
    homeLayer.addLayer(m);
  }
  function drawSpots() {
    spotLayer.clearLayers();
    sugLayer.clearLayers();
    if (!state.settings.layers.spots) return;
    for (const p of state.spots) {
      const m = L.marker([p.lat, p.lon], { icon: divIcon(`<div class="mk mk-spot">${U.icon('star')}</div>`, 28), title: p.name, riseOnHover: true });
      m.on('click', () => app.focusSpot({ kind: 'spot', lat: p.lat, lon: p.lon, name: p.name, id: p.id }, { fly: false }));
      spotLayer.addLayer(m);
    }
    state.suggestions.forEach((g, i) => {
      if (state.spots.some((p) => p.srcId === g.id)) return;
      const tn = app.tonightFor(g);
      const label = g.name || (D.KINDS[g.kind] || D.KINDS.place).label;
      const m = L.marker([g.lat, g.lon], { icon: divIcon(`<div class="mk mk-sug ${tn && tn.clearHours === 0 ? 'dim' : ''}">${i + 1}</div>`, 26), title: label, riseOnHover: true });
      m.on('click', () => app.focusSpot({ kind: 'sug', lat: g.lat, lon: g.lon, name: label, ref: g }, { fly: false }));
      sugLayer.addLayer(m);
    });
  }
  function showPick(lat, lon) {
    if (pickMarker) pickMarker.remove();
    pickMarker = L.marker([lat, lon], { icon: divIcon('<div class="mk mk-pick"></div>', 22), interactive: false, keyboard: false }).addTo(map);
  }
  function drawRadius() {
    if (radiusRing) { radiusRing.remove(); radiusRing = null; }
    if (UI.activeTab !== 'spots' || !state.home) return;
    radiusRing = L.circle([state.home.lat, state.home.lon], { radius: state.settings.radiusKm * 1000, renderer: linesRenderer, className: 'radius-ring', interactive: false }).addTo(map);
  }

  // ---------- Aurora reach line (magnetic latitude for the timeline's Kp) ----------
  let reach = null, reachGlow = null, reachTip = null, reachKp = null, reachPts = null, reachShown = null;
  function clearReach() {
    if (reach) { reach.remove(); reachGlow.remove(); reach = reachGlow = null; }
    if (reachTip) { map.closeTooltip(reachTip); reachTip = null; }
    reachKp = null;
  }
  function drawReach() {
    const kp = state.plan ? state.plan.kp : D.kpAt(state.time); // a planned night draws its own Kp
    if (!state.settings.layers.aurora || kp == null) { clearReach(); return; }
    reachShown = kp;
    const k = Math.round(kp * 3) / 3;
    if (k !== reachKp || !reach) {
      reachKp = k;
      reachPts = Sky.magContour(Sky.reachLat(k));
      const copies = [-360, 0, 360].map((o) => reachPts.map(([la, lo]) => [la, lo + o]));
      if (!reach) {
        reachGlow = L.polyline(copies, { renderer: linesRenderer, className: 'reach-line-glow', interactive: false }).addTo(map);
        reach = L.polyline(copies, { renderer: linesRenderer, className: 'reach-line', interactive: false }).addTo(map);
      } else { reach.setLatLngs(copies); reachGlow.setLatLngs(copies); }
    }
    placeReachTip();
  }
  function placeReachTip() {
    if (!reach || !reachPts || !reachPts.length) return;
    const c = map.getCenter(), cl = U.wrapLon(c.lng);
    let best = reachPts[0];
    for (const p of reachPts) if (Math.abs(p[1] - cl) < Math.abs(best[1] - cl)) best = p;
    const ll = L.latLng(best[0], best[1] + (c.lng - cl));
    const html = `Aurora likely north of this line · Kp ${(reachShown ?? reachKp).toFixed(1)}`;
    if (!map.getBounds().pad(-0.12).contains(ll)) { if (reachTip) { map.closeTooltip(reachTip); reachTip = null; } return; }
    if (!reachTip) {
      reachTip = L.tooltip({ permanent: true, direction: 'top', className: 'reach-tip', offset: [0, -6], interactive: false }).setLatLng(ll).setContent(html);
      map.openTooltip(reachTip);
    } else { reachTip.setLatLng(ll); reachTip.setContent(html); }
  }

  // ---------- Places ----------
  app.homePlace = () => (state.home ? { kind: 'home', lat: state.home.lat, lon: state.home.lon, name: state.home.name } : null);
  app.place = () => state.selected || app.homePlace();
  // Auto mode leads with the aurora when tonight's forecast Kp gets within one step of what this place needs
  app.mode = () => {
    const m = state.settings.mode;
    if (m === 'aurora' || m === 'stars') return m;
    const p = app.place();
    if (!p || !D.kpFc.length) return 'stars';
    const nw = Sky.nightWindow(p.lat, p.lon);
    const need = Sky.kpNeeded(Sky.magLat(p.lat, p.lon));
    let kpMax = -1;
    for (let t = nw.sunset; t <= nw.sunrise; t += U.HOUR) { const k = D.kpAt(t); if (k != null && k > kpMax) kpMax = k; }
    return kpMax >= need - 1 ? 'aurora' : 'stars';
  };
  const infoCache = new Map();
  const pkey = (p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
  app.placeInfo = (p) => {
    const k = pkey(p);
    let it = infoCache.get(k);
    if (!it) { it = { wx: null, zone: undefined, view: null }; infoCache.set(k, it); loadInfo(p, it); }
    it.view = Sky.ovInView(p.lat, p.lon);
    return it;
  };
  async function loadInfo(p, it) {
    D.lpZone(p.lat, p.lon).then((z) => { it.zone = z; refreshPlaceViews(p); });
    try { it.wx = await D.pointWx(p.lat, p.lon); it.wxErr = null; } catch (e) { it.wxErr = e; }
    refreshPlaceViews(p);
  }
  function refreshPlaceViews(p) {
    const cur = app.place(), home = app.homePlace(), k = pkey(p);
    if (cur && pkey(cur) === k) { UI.renderTonight(); UI.rebuildTimeline(); }
    if (home && pkey(home) === k) UI.renderLive();
  }
  app.tonightFor = (g) => {
    const grid = D.grid;
    const ref = state.home || g;
    if (grid) {
      const nw = Sky.nightWindow(ref.lat, ref.lon);
      const from = nw.dusk || nw.nautDusk || nw.sunset, to = nw.dawn || nw.nautDawn || nw.sunrise;
      const vals = [];
      for (let t = U.floorHour(Math.max(from, Date.now() - U.HOUR)); t < to; t += U.HOUR) { const v = D.gridAt(grid, g.lat, g.lon, t); if (v) vals.push(v.cc); }
      if (vals.length >= 2) return { clearHours: vals.filter((v) => v <= 30).length, mean: vals.reduce((s, v) => s + v, 0) / vals.length };
    }
    return g.tonight && g.found && Date.now() - g.found < 6 * U.HOUR ? g.tonight : null;
  };

  app.selectPlace = (p) => {
    state.selected = p && p.kind !== 'home' ? p : null;
    if (isMobile()) {
      // the place card and the forecast share the sheet: show the forecast for this place
      if (state.inspect) app.closeInspector({ keepPin: !!state.selected });
      UI.sheet.snapTo('half');
      $('#tab-tonight').scrollTop = 0;
    }
    UI.setTab('tonight');
    UI.rebuildTimeline();
    UI.renderSpots();
  };
  app.focusSpot = (p, { fly = true } = {}) => {
    state.selected = p;
    if (isMobile()) UI.sheet.snapTo('half');
    if (fly) app.flyTo(p.lat, p.lon, Math.max(map.getZoom(), 9.5));
    const ref = p.ref || state.spots.find((x) => x.id === p.id) || {};
    app.inspect(p.lat, p.lon, {
      noReveal: fly,
      kind: p.kind, kindLabel: p.kind === 'spot' ? 'Our spot' : 'Suggested spot', title: p.name, name: p.name, id: p.id,
      srcId: p.ref ? p.ref.id : undefined, kindKey: ref.kind, zone: Number.isInteger(ref.zone) ? ref.zone : undefined, hz: ref.hz && ref.hz.prof ? ref.hz : null,
    });
    UI.renderSpots();
    UI.renderTonight();
    UI.rebuildTimeline();
  };

  // ---------- Inspector ----------
  let inspectToken = 0;
  app.inspect = (lat, lon, ctx = {}) => {
    const token = ++inspectToken;
    const d = { lat, lon, wx: null, hz: null, zone: undefined, ...ctx };
    state.inspect = d;
    if (!ctx.kind || ctx.kind === 'pin') showPick(lat, lon); else if (pickMarker) { pickMarker.remove(); pickMarker = null; }
    UI.renderInspector(d);
    if (isMobile()) {
      // on a phone the place card lives in the sheet: bring it to half height and keep the pin in view above it
      if (!UI.sheet.is('half')) UI.sheet.snapTo('half');
      $('#inspector').scrollTop = 0;
      if (!ctx.noReveal) setTimeout(() => revealOnMap(lat, lon), 40);
    }
    const upd = () => { if (token === inspectToken) UI.renderInspector(d); };
    if (d.zone === undefined) D.lpZone(lat, lon).then((z) => { d.zone = z; upd(); });
    D.pointWx(lat, lon).then((wx) => { d.wx = wx; upd(); }).catch((e) => { d.wxErr = e; upd(); });
    if (!ctx.title && !ctx.name) D.placeName(lat, lon).then((n) => { if (n) { d.title = d.name = `Near ${n}`; upd(); } });
  };
  app.closeInspector = ({ keepPin = false } = {}) => {
    state.inspect = null;
    inspectToken++;
    UI.renderInspector(null);
    if (pickMarker && !keepPin) { pickMarker.remove(); pickMarker = null; }
  };
  // Make an inspected point the home base. Changing home resets the spot suggestions, so offer an Undo.
  app.moveHome = async (p) => {
    const prev = state.home ? { ...state.home } : null, prevSug = state.suggestions.slice();
    const near15 = prev && U.distKm(prev, p) < 15;
    const m = /^Near (.+)$/.exec(p.name || '');
    let name = near15 ? prev.name : m ? m[1] : p.name && !/^(Dropped pin|Dark )/.test(p.name) ? p.name : null;
    if (!name) name = (await D.placeName(p.lat, p.lon)) || (prev ? prev.name : 'Home');
    app.closeInspector();
    app.setHome({ lat: p.lat, lon: p.lon, name }, { fly: false });
    UI.toast(`Home is now ${near15 ? 'here' : name}.`, prev ? {
      timeout: 8000,
      action: { label: 'Undo', run: () => { app.setHome(prev, { fly: false }); state.suggestions = prevSug; save('sug'); drawSpots(); UI.renderSpots(); } },
    } : {});
  };
  app.checkHorizon = async (d) => {
    d.hz = 'loading';
    UI.renderInspector(d);
    try { const [h] = await D.horizon([{ lat: d.lat, lon: d.lon }]); d.hz = h; }
    catch (e) { d.hz = null; UI.toast('The elevation service did not answer. Try again in a moment.', { kind: 'error' }); }
    if (state.inspect === d) UI.renderInspector(d);
  };

  // ---------- Spots ----------
  const near = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
  app.saveSpot = (p) => {
    if (state.spots.some((x) => near(x, p))) { UI.toast('Already in our spots.'); return; }
    const kind = D.KINDS[p.kind] ? p.kind : D.KINDS[p.kindKey] ? p.kindKey : null;
    const spot = {
      id: U.uid(), lat: +(+p.lat).toFixed(5), lon: +(+p.lon).toFixed(5), name: String(p.name || 'Our spot').slice(0, 60), kind,
      zone: Number.isInteger(p.zone) ? p.zone : null, hz: p.hz && typeof p.hz.block === 'number' ? { block: p.hz.block, elev: p.hz.elev } : null,
      srcId: p.srcId || null, note: '', added: Date.now(),
    };
    state.spots.push(spot);
    save('spots');
    drawSpots();
    UI.renderSpots();
    if (state.inspect) UI.renderInspector(state.inspect);
    UI.toast(`Saved "${spot.name}" to our spots.`, { action: { label: 'Rename', run: () => UI.renameSpot(spot) } });
  };
  app.updateSpot = (id, patch) => {
    const sp = state.spots.find((x) => x.id === id);
    if (!sp) return;
    Object.assign(sp, patch);
    save('spots');
    drawSpots();
    UI.renderSpots();
    if (state.selected && state.selected.id === id) { state.selected.name = sp.name; UI.renderTonight(); }
  };
  app.removeSpot = (id) => {
    const i = state.spots.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [sp] = state.spots.splice(i, 1);
    save('spots');
    drawSpots();
    UI.renderSpots();
    if (state.selected && state.selected.id === id) { state.selected = null; UI.renderTonight(); UI.rebuildTimeline(); }
    UI.toast(`Removed "${sp.name}".`, { action: { label: 'Undo', run: () => { state.spots.splice(i, 0, sp); save('spots'); drawSpots(); UI.renderSpots(); } } });
  };

  // Spot finder: rank the darkest, clearest ground around home (the Best sky map), then find the
  // nearest real place to stand in each golden area, check the terrain toward the aurora, and rank.
  let finding = false;
  async function ensureSite(home) {
    let g = D.grid;
    if (!g || !g.center || U.distKm(g.center, home) > 30) g = await D.loadCloudGrid(home.lat, home.lon);
    if (!D.site || D.site.key !== g.key) await D.buildSite(g);
    return g;
  }
  app.findSpots = async () => {
    if (finding) return;
    if (!state.home) { app.showWelcome(); return; }
    finding = true;
    $('#findBtn').disabled = true;
    const steps = ['Mapping the darkest, clearest ground around home', 'Finding real places to stand there (OpenStreetMap)', 'Checking the terrain toward the aurora', "Ranking for tonight's sky"];
    const R = state.settings.radiusKm, home = state.home, mode = app.mode();
    try {
      UI.finderStatus(steps, 0);
      let g;
      try { g = await ensureSite(home); }
      catch (e) { UI.finderStatus(steps, 0, true); UI.toast('The cloud forecast or darkness atlas did not load. Try again in a minute.', { kind: 'error' }); return; }
      // Tonight, or the coming evening when less than two dark hours are left
      let nw = Sky.nightWindow(home.lat, home.lon);
      if ((nw.dawn || nw.sunrise) - Date.now() < 2 * U.HOUR) nw = Sky.nightWindow(home.lat, home.lon, Date.now() + 10 * U.HOUR);
      const from = nw.dusk || nw.nautDusk || nw.sunset, to = nw.dawn || nw.nautDawn || nw.sunrise;
      const hours = [];
      for (let t = U.floorHour(Math.max(from, Date.now() - U.HOUR)); t < to; t += U.HOUR) hours.push(t);
      const tonightAt = (lat, lon) => {
        const v = hours.map((t) => D.gridAt(g, lat, lon, t)).filter(Boolean);
        if (!v.length) return null;
        return { clearHours: v.filter((x) => x.cc <= 30).length, frac: v.reduce((s, x) => s + (1 - x.cc / 100), 0) / v.length, mean: v.reduce((s, x) => s + x.cc, 0) / v.length };
      };
      // Darkness dominates inside the chosen radius; distance only breaks near-ties
      const distF = (d) => 1 - 0.35 * Math.pow(Math.min(1, d / R), 1.5);
      // 1. candidate ground on a ~3 km lattice inside the radius
      const cells = [];
      const step = 0.03, dLat = R / 111.2;
      for (let lat = home.lat - dLat; lat <= home.lat + dLat; lat += step) {
        const cosl = Math.cos(U.rad(lat)), dLon = R / (111.2 * cosl);
        for (let lon = home.lon - dLon; lon <= home.lon + dLon; lon += step / cosl) {
          const d = U.distKm(home, { lat, lon });
          if (d > R) continue;
          const s = D.siteAt(lat, lon);
          if (s == null) continue;
          cells.push({ lat, lon, d, site: s, q: Math.pow(s, 1.5) * distF(d) });
        }
      }
      cells.sort((a, b) => b.q - a.q);
      const top = cells.slice(0, 1600);
      for (const c of top) { c.tn = tonightAt(c.lat, c.lon); c.gold = c.q * (0.35 + 0.65 * (c.tn ? c.tn.frac : 0.5)); }
      top.sort((a, b) => b.gold - a.gold);
      const seeds = [];
      for (const c of top) { if (seeds.length >= 16) break; if (seeds.some((s) => U.distKm(s, c) < 12)) continue; seeds.push(c); }
      if (!seeds.length) { UI.finderStatus(null); UI.toast('No dark ground found in that radius. Try a wider one.'); return; }
      // 2. nearest real places around each golden area
      UI.finderStatus(steps, 1);
      const cands = [];
      let answered = 0;
      for (const sd of seeds) {
        let places = [];
        try { places = await D.nearbyPlaces(sd.lat, sd.lon, 12); answered++; } catch (e) { console.warn('Place search failed', e); }
        let best = null;
        for (const p of places) {
          const s = D.siteAt(p.lat, p.lon);
          if (s == null) continue;
          const v = Math.pow(s, 1.5) * (D.KINDS[p.kind] || D.KINDS.place).w * (p.name ? 1 : 0.9) * Math.exp(-U.distKm(sd, p) / 10);
          if (!best || v > best.v) best = { ...p, v, site: s };
        }
        const pick = best || { id: `area${sd.lat.toFixed(3)}${sd.lon.toFixed(3)}`, lat: +sd.lat.toFixed(4), lon: +sd.lon.toFixed(4), name: null, kind: 'area', site: sd.site };
        if (!cands.some((c) => c.id === pick.id || U.distKm(c, pick) < 2)) cands.push(pick);
        await U.sleep(120); // be gentle with the free place-search service
      }
      if (!answered) UI.toast('The place search is not answering, so these are dark areas without a named spot. Check access on the satellite view.', { timeout: 7000 });
      for (const c of cands) {
        c.dist = U.distKm(home, c);
        c.zone = await D.lpZone(c.lat, c.lon);
        if (c.kind === 'area') { const n = await D.placeName(c.lat, c.lon); c.name = n ? `Dark area near ${n}` : 'Dark area'; }
      }
      // 3. terrain toward the aurora
      UI.finderStatus(steps, 2);
      try {
        // terrain check for the 12 darkest candidates (keeps the free elevation quota in hand)
        cands.sort((a, b) => Math.pow(b.site, 1.5) * distF(b.dist) - Math.pow(a.site, 1.5) * distF(a.dist));
        const checkList = cands.slice(0, 12);
        const hz = await D.horizon(checkList);
        checkList.forEach((p, i) => { p.hz = { block: hz[i].block, worst: hz[i].worst, elev: hz[i].elev }; });
      } catch (e) { console.warn('Horizon check failed', e); }
      // 4. rank
      UI.finderStatus(steps, 3);
      for (const p of cands) {
        const b = p.hz ? p.hz.block : 3;
        const hzF = b <= 2 ? 1 : b <= 4 ? 0.9 : b <= 7 ? 0.74 : b <= 11 ? 0.55 : 0.35;
        const s = p.zone != null ? Sky.SITE_STARS[p.zone] : p.site;
        p.quality = Math.pow(s, 1.5) * distF(p.dist) * (D.KINDS[p.kind] || D.KINDS.place).w * (mode === 'stars' ? Math.sqrt(hzF) : hzF);
        p.tonight = tonightAt(p.lat, p.lon);
        p.score = p.quality * (0.4 + 0.6 * (p.tonight && hours.length ? p.tonight.clearHours / hours.length : 0.5));
      }
      cands.sort((a, b) => b.score - a.score);
      state.suggestions = cands.slice(0, 10).map(({ id, lat, lon, name, kind, dist, zone, hz, tonight, score, quality }) => ({ id, lat, lon, name, kind, dist, zone, hz, tonight, score, quality, found: Date.now() }));
      save('sug');
      UI.finderStatus(null);
      drawSpots();
      UI.renderSpots();
      if (state.suggestions.length) {
        if (isMobile()) { UI.sheet.snapTo('half'); scrollWithin($('#tab-spots'), $('#suggestList'), 10); }
        const b = L.latLngBounds(state.suggestions.map((x) => [x.lat, x.lon]));
        b.extend([home.lat, home.lon]);
        app.flyToBounds(b);
      }
      UI.toast(`Ranked ${state.suggestions.length} spots from the darkest, clearest ground within ${U.fmtDist(R)}.`);
    } catch (e) {
      console.error(e);
      UI.finderStatus(null);
      UI.toast('Something went wrong while ranking spots. Try again.', { kind: 'error' });
    } finally {
      finding = false;
      $('#findBtn').disabled = false;
    }
  };

  // ---------- Coming nights: when and where it's worth going out ----------
  const nights = { list: [], loading: false, cloudsOk: false };
  app.nights = () => nights;
  function nightPoints() {
    const h = state.home, R = state.settings.radiusKm;
    const pts = [{ lat: h.lat, lon: h.lon, name: 'home' }];
    for (const s of state.spots.slice(0, 6)) pts.push({ lat: s.lat, lon: s.lon, name: s.name });
    for (const g of state.suggestions.slice(0, 4)) pts.push({ lat: g.lat, lon: g.lon, name: g.name || (D.KINDS[g.kind] || D.KINDS.place).label });
    for (const [f, step] of [[0.5, 90], [1, 45]]) {
      for (let b = 0; b < 360; b += step) { const p = U.dest(h.lat, h.lon, b, R * f); pts.push({ ...p, name: `${U.fmtDist(R * f)} ${U.compass(b)} of home` }); }
    }
    return pts.slice(0, 24);
  }
  function computeNights(pts, cl) {
    const h = state.home, need = Sky.kpNeeded(Sky.magLat(h.lat, h.lon));
    const out = [];
    const base = new Date(); base.setHours(14, 0, 0, 0);
    for (let k = -1; k < 28; k++) {
      const nw = Sky.nightWindow(h.lat, h.lon, base.getTime() + k * U.DAY);
      const from = nw.dusk || nw.nautDusk || nw.sunset, to = nw.dawn || nw.nautDawn || nw.sunrise;
      if (to < Date.now() + U.HOUR || out.some((n) => Math.abs(n.from - from) < U.HOUR)) continue;
      const hours = [];
      for (let x = U.floorHour(Math.max(from, Date.now())); x < to; x += U.HOUR) hours.push(x);
      if (!hours.length) continue;
      // Kp: NOAA's 3-day forecast where it reaches, then the 27-day outlook
      let kp = null, kpSrc = null;
      const fc = D.kpFc.filter((r) => r.t + 3 * U.HOUR > from && r.t < to && r.t + 3 * U.HOUR > Date.now());
      if (fc.length) { kp = Math.max(...fc.map((r) => r.kp)); kpSrc = 'NOAA 3-day forecast'; }
      else {
        const od = D.outlook.filter((r) => Math.abs(r.t - (from + to) / 2) < 0.75 * U.DAY);
        if (od.length) { kp = Math.max(...od.map((r) => r.kp)); kpSrc = 'NOAA 27-day outlook'; }
      }
      const lvl = kp == null ? null : Sky.kpLevel(kp, need);
      const mi = Sky.moonIllum((from + to) / 2);
      let up = 0;
      for (const x of hours) if (Sky.moonPos(x + U.HOUR / 2, h.lat, h.lon).alt > 5) up++;
      const moonLight = mi.fraction * (up / hours.length);
      let bestA = null, bestS = null;
      if (cl) {
        pts.forEach((p, i) => {
          const w = cl[i];
          if (!w) return;
          const v = hours.map((x) => { const j = Math.round((x - w.t0) / U.HOUR); return j >= 0 && j < w.cc.length ? w.cc[j] : null; }).filter((c) => c != null);
          if (v.length < hours.length * 0.6) return;
          const clear = v.reduce((s, c) => s + (1 - c / 100), 0) / v.length;
          const site = D.siteAt(p.lat, p.lon) ?? 0.6;
          const a = Sky.reachFactor(kp, Sky.magLat(p.lat, p.lon)) * clear * (1 - 0.35 * moonLight) * (1 - 0.45 * (1 - site));
          const s = clear * (1 - 0.85 * moonLight) * site;
          const c = { p, clear, a, s };
          if (!bestA || a > bestA.a) bestA = c;
          if (!bestS || s > bestS.s) bestS = c;
        });
      }
      out.push({ from, to, kp, kpSrc, lvl, need, moon: mi.fraction, moonPhase: mi.phase, moonUp: up / hours.length, bestA, bestS, clouds: !!bestS });
    }
    return out;
  }
  async function refreshNights() {
    if (!state.home) return;
    const pts = nightPoints();
    const key = `nights:${state.home.lat.toFixed(2)},${state.home.lon.toFixed(2)}:${state.settings.radiusKm}:${pts.map((p) => p.lat.toFixed(1) + p.lon.toFixed(1)).join('').length}:${state.spots.length}`;
    nights.loading = true;
    let cl = null;
    try { cl = await D.loadNightClouds(pts, key); } catch (e) { console.warn('Night cloud forecast failed', e); }
    nights.loading = false;
    nights.cloudsOk = !!cl;
    nights.cl = cl;
    nights.list = computeNights(pts, cl);
    UI.renderNights();
  }
  app.refreshNights = () => refreshNights();
  app.recomputeNights = () => { if (state.home && nights.list.length) { nights.list = computeNights(nightPoints(), nights.cl); UI.renderNights(); } };
  // Plan a night: Best sky for that night's Kp and moon; beyond the cloud forecast it assumes clear skies
  const planLayer = L.layerGroup().addTo(map);
  function planAreas(n) {
    const h = state.home, R = state.settings.radiusKm;
    if (!D.site) return [];
    const aur = n.lvl && n.lvl.s >= 0.45;
    const cells = [];
    for (let lat = h.lat - R / 111.2; lat <= h.lat + R / 111.2; lat += 0.04) {
      const cosl = Math.cos(U.rad(lat));
      for (let lon = h.lon - R / (111.2 * cosl); lon <= h.lon + R / (111.2 * cosl); lon += 0.04 / cosl) {
        const d = U.distKm(h, { lat, lon });
        if (d > R) continue;
        const s = D.siteAt(lat, lon);
        if (s == null) continue;
        const reach = aur ? Sky.reachFactor(n.kp, Sky.magLat(lat, lon)) : 1;
        cells.push({ lat, lon, d, site: s, v: reach * Math.pow(s, 1.5) * (1 - 0.3 * Math.pow(d / R, 1.5)) });
      }
    }
    cells.sort((a, b) => b.v - a.v);
    const out = [];
    for (const c of cells) { if (out.length >= 3) break; if (out.some((o) => U.distKm(o, c) < 25)) continue; out.push({ ...c, zone: null, name: null }); }
    return out;
  }
  function drawPlan() {
    planLayer.clearLayers();
    const p = state.plan;
    if (!p) return;
    p.areas.forEach((a, i) => {
      const m = L.marker([a.lat, a.lon], { icon: divIcon(`<div class="mk mk-plan">${'ABC'[i]}</div>`, 28), title: a.name || 'Dark area', zIndexOffset: 900 });
      m.on('click', () => app.inspect(a.lat, a.lon, { kind: 'pin', kindLabel: `Option ${'ABC'[i]} for ${U.fmtDate(p.from)}`, title: a.name || 'Dark area', name: a.name }));
      planLayer.addLayer(m);
    });
  }
  app.planNight = async (n) => {
    if (!state.home) { app.showWelcome(); return; }
    if (!D.site && D.grid) { try { await D.buildSite(D.grid); } catch (e) { /* map still works */ } }
    const inRange = !!D.grid && n.to < D.grid.t[D.grid.t.length - 1];
    state.plan = { ...n, mid: (n.from + n.to) / 2, assume: !inRange, areas: [] };
    state.plan.areas = planAreas(n);
    if (!state.settings.layers.best) { state.settings.layers.best = true; save('settings'); applyLayers(); }
    if (inRange) app.setTime(U.floorHour(n.from) + 1.5 * U.HOUR, { live: false, plan: true }); else { updateBest(); drawReach(); refreshKey(); }
    drawPlan();
    if (isMobile() && state.inspect) app.closeInspector();
    UI.setTab('tonight');
    UI.renderNights();
    if (isMobile()) { UI.sheet.snapTo('half'); scrollWithin($('#tab-tonight'), $('#nights'), 10); }
    if (state.plan.areas.length) {
      const b = L.latLngBounds(state.plan.areas.map((a) => [a.lat, a.lon]));
      b.extend([state.home.lat, state.home.lon]);
      app.flyToBounds(b);
    }
    for (const a of state.plan.areas) {
      D.lpZone(a.lat, a.lon).then((z) => { a.zone = z; UI.renderNights(); });
      D.placeName(a.lat, a.lon).then((nm) => { a.name = nm ? `Dark ground near ${nm}` : 'Dark ground'; drawPlan(); UI.renderNights(); });
    }
  };
  app.clearPlan = (back = true) => {
    if (!state.plan) return;
    state.plan = null;
    planLayer.clearLayers();
    UI.renderNights();
    if (back) app.setTime(Date.now(), { live: true }); else updateBest();
  };

  // ---------- Journal ----------
  app.addLog = (e) => { state.log.push(e); save('log'); UI.renderLog(); UI.toast('Saved to your journal.'); };
  app.removeLog = (id) => {
    const i = state.log.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [x] = state.log.splice(i, 1);
    save('log');
    UI.renderLog();
    UI.toast('Entry deleted.', { action: { label: 'Undo', run: () => { state.log.splice(i, 0, x); save('log'); UI.renderLog(); } } });
  };
  app.conditionsSnapshot = () => {
    const p = app.place(), kp = D.kpNow(), s = D.swNow(), mi = Sky.moonIllum(Date.now());
    let cc = null;
    if (p) { const it = app.placeInfo(p); const w = it.wx ? D.wxAt(it.wx, U.floorHour(Date.now())) : null; cc = w ? w.cc : null; }
    const cond = { kp, bz: s.bz, v: s.v, cc, moon: mi.fraction };
    const text = [kp != null ? `Kp ${kp.toFixed(1)}` : null, s.bz != null ? `Bz ${s.bz.toFixed(1)}` : null, cc != null ? `${Math.round(cc)}% cloud` : null, `Moon ${Math.round(mi.fraction * 100)}%`].filter(Boolean).join(', ');
    return { cond, text };
  };

  // ---------- Time and playback ----------
  let playing = false, lastInspectHour = null;
  app.setTime = (t, { live = false, plan = false } = {}) => {
    if (state.plan && !plan) app.clearPlan(false);
    state.time = t;
    state.live = live;
    if (fx) fx.setCloudTime(t);
    fxDirty = true;
    updateAuroraFade();
    updateBest();
    UI.drawTimeline();
    drawReach();
    refreshKey();
    const h = U.floorHour(t);
    if (state.inspect && h !== lastInspectHour) { lastInspectHour = h; UI.renderInspector(state.inspect); }
  };
  // Feed the Best sky shader: Kp, mode, and the night darkness at the timeline's hour
  function updateBest() {
    if (!fx) return;
    const g = D.grid;
    const ready = !!g && !!D.site && D.site.key === g.key;
    fx.setBest(state.settings.layers.best && ready ? 1 : 0);
    if (!g) return;
    const c = { lat: (g.south + g.north) / 2, lon: (g.west + g.east) / 2 };
    const pl = state.plan;
    const t = pl ? pl.mid : state.time;
    const sun = Sky.sunAlt(t, c.lat, c.lon), mp = Sky.moonPos(t, c.lat, c.lon), mi = Sky.moonIllum(t);
    fx.setBestParams({
      kp: pl ? (pl.kp ?? 0) : (D.kpAt(t) ?? 0),
      // which color families show: [gold stargazing, green aurora]. Auto (and a planned night) shows both.
      modeW: pl || state.settings.mode === 'auto' ? [1, 1] : state.settings.mode === 'stars' ? [1, 0] : [0, 1],
      assume: pl && pl.assume ? 1 : 0,
      // when planning a night the map answers "where": moonlight is the same everywhere, so the card covers it
      dark: pl ? [1, 1, 1, 1] : [Sky.darkFactor(sun, 'aurora'), Sky.darkFactor(sun, 'stars'), Sky.moonFactor(mp.alt, mi.fraction, 'aurora'), Sky.moonFactor(mp.alt, mi.fraction, 'stars')],
    });
    fxDirty = true;
  }
  // In daylight the map jumps to tonight, an hour into real darkness, so it always answers "where tonight?"
  app.defaultTime = () => {
    if (!state.home || Sky.sunAlt(Date.now(), state.home.lat, state.home.lon) <= -6) { app.setTime(Date.now(), { live: true }); return; }
    const nw = Sky.nightWindow(state.home.lat, state.home.lon);
    app.setTime(U.floorHour((nw.dusk || nw.nautDusk || nw.sunset) + U.HOUR) + U.HOUR / 2, { live: false });
  };
  function updateAuroraFade() {
    const on = state.settings.layers.aurora;
    const far = D.ov ? Math.abs(state.time - D.ov.fc) > 2 * U.HOUR : false;
    if (fx) fx.setAurora(on ? (far ? 0.28 : 1) : 0);
    particles.setAmount(on && !far && !calm() ? 1 : 0);
    fxDirty = true;
  }
  app.play = () => {
    playing = true;
    $('#tlPlay').innerHTML = U.icon('pause');
    $('#tlPlay').setAttribute('aria-label', 'Pause the forecast');
    if (state.time >= UI.TL.t0 + UI.TL.span - 2 * U.HOUR) state.time = Date.now();
  };
  app.stopPlay = () => {
    playing = false;
    $('#tlPlay').innerHTML = U.icon('play');
    $('#tlPlay').setAttribute('aria-label', 'Play the forecast');
  };
  function advancePlay(dt) {
    let t = state.time + dt * 2.4 * U.HOUR;
    if (t > UI.TL.t0 + UI.TL.span - U.HOUR) t = Date.now();
    app.setTime(t, { live: false });
  }

  // ---------- Layers ----------
  function applyBase() {
    for (const [k, layer] of Object.entries(bases)) {
      if (k === state.settings.base) { if (!map.hasLayer(layer)) layer.addTo(map); layer.bringToBack(); }
      else if (map.hasLayer(layer)) layer.remove();
    }
    U.$$('.base-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.base === state.settings.base)));
  }
  function applyLayers() {
    const ly = state.settings.layers;
    lpLayer.setOpacity(state.settings.lpOpacity);
    if (ly.lp && !map.hasLayer(lpLayer)) lpLayer.addTo(map);
    if (!ly.lp && map.hasLayer(lpLayer)) lpLayer.remove();
    if (fx) fx.setClouds(ly.clouds ? 1 : 0);
    updateAuroraFade();
    updateBest();
    drawSpots();
    drawReach();
    UI.renderLegend();
    U.$$('.chip[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(!!ly[b.dataset.layer])));
  }

  // The map key is always on the map: as a one-line strip, or opened up with the scales. It starts as the
  // strip. On phones and short screens the open key is a pop-up that a tap on the map shrinks again.
  let keyOpen = false, keyPrevSnap = null, keySig = '';
  const compactKey = () => isMobile() || shortMq.matches;
  app.keyFull = () => legendShown();
  // What the key needs to know right now: is the aurora in reach anywhere on the forecast map, and is
  // NOAA's oval on screen?
  app.keyInfo = () => {
    const pl = state.plan, kp = pl ? pl.kp : D.kpAt(state.time), h = state.home;
    const box = D.grid || (h ? { south: h.lat - 2.2, north: h.lat + 2.2, west: h.lon - 3.2, east: h.lon + 3.2 } : null);
    let best = 0;
    if (box && kp != null) for (const la of [box.south, box.north]) for (const lo of [box.west, box.east]) best = Math.max(best, Sky.reachFactor(kp, Sky.magLat(la, lo)));
    let oval = false;
    if (D.ov && state.settings.layers.aurora && Math.abs(state.time - D.ov.fc) <= 2 * U.HOUR) {
      const b = map.getBounds();
      for (let i = 0; i <= 4 && !oval; i++) for (let j = 0; j <= 4 && !oval; j++) {
        oval = (Sky.ovAt(U.lerp(b.getSouth(), b.getNorth(), i / 4), U.lerp(b.getWest(), b.getEast(), j / 4)) || 0) >= 3;
      }
    }
    return { kp, need: h ? Sky.kpNeeded(Sky.magLat(h.lat, h.lon)) : null, inReach: best >= 0.3, oval, planned: !!pl };
  };
  // Redraw the key only when what it says would change
  function refreshKey() {
    const i = app.keyInfo();
    const sig = `${i.inReach}|${i.kp == null ? '' : i.kp.toFixed(1)}|${i.oval}|${i.planned}`;
    if (sig !== keySig) { keySig = sig; UI.renderLegend(); }
  }
  // The key covers part of a small map, so on a phone the sheet steps down to its tab bar while it is open
  function setKey(open) {
    keyOpen = open;
    if (isMobile()) {
      if (open && !UI.sheet.is('peek')) { keyPrevSnap = UI.sheet.snap; UI.sheet.snapTo('peek'); }
      else if (!open && keyPrevSnap) { if (UI.sheet.is('peek')) UI.sheet.snapTo(keyPrevSnap === 'full' ? 'half' : keyPrevSnap); keyPrevSnap = null; }
    }
    UI.renderLegend();
    applyLegend();
  }
  const legendShown = () => (compactKey() ? keyOpen : state.settings.legend === true);
  function applyLegend() {
    const full = legendShown();
    $('#legend').classList.toggle('compact', !full);
    $('#legendBtn').setAttribute('aria-pressed', String(full));
    $('#legendBtn').setAttribute('aria-label', full ? 'Shrink the map key' : 'Open the map key and credits');
  }
  function toggleKey(open) {
    if (compactKey()) { setKey(open == null ? !keyOpen : open); return; }
    state.settings.legend = open == null ? !legendShown() : open;
    save('settings');
    UI.renderLegend();
    applyLegend();
  }

  // ---------- Cloud grid coverage ----------
  let cloudOfferAt = 0;
  function maybeOfferClouds() {
    const g = D.grid;
    if (!g || !state.settings.layers.clouds || map.getZoom() < 5.5 || Date.now() - cloudOfferAt < 90e3) return;
    const c = map.getCenter();
    const inside = c.lat > g.south && c.lat < g.north && U.wrapLon(c.lng) > g.west && U.wrapLon(c.lng) < g.east;
    if (inside) return;
    cloudOfferAt = Date.now();
    UI.toast('The cloud forecast covers about 300 miles around home.', {
      action: { label: 'Load clouds here', run: () => { const cc = map.getCenter(); D.loadCloudGrid(cc.lat, U.wrapLon(cc.lng)).catch(() => UI.toast('The cloud forecast did not load. Try again shortly.', { kind: 'error' })); } },
      timeout: 7000,
    });
  }

  // ---------- Home and welcome ----------
  let welcomeSky = null;
  app.showWelcome = () => {
    const w = $('#welcome');
    w.hidden = false;
    w.classList.remove('leaving');
    if (!welcomeSky) welcomeSky = FX.createWelcomeSky($('#welcomeSky'));
    const back = $('#welcomeBack');
    if (state.home && !back) {
      $('.welcome-actions').append(U.el('button', { class: 'btn ghost', type: 'button', id: 'welcomeBack', html: `${U.icon('close')}Back to the map`, onclick: hideWelcome }));
    }
    setTimeout(() => { const q = $('#homeQuery'); if (q) q.focus(); }, 500);
  };
  function hideWelcome() {
    const w = $('#welcome');
    if (w.hidden) return;
    w.classList.add('leaving');
    setTimeout(() => {
      w.hidden = true;
      w.classList.remove('leaving');
      if (welcomeSky) { welcomeSky.destroy(); welcomeSky = null; }
    }, 950);
  }
  app.setHome = (h, { fly = true } = {}) => {
    state.home = { lat: +(+h.lat).toFixed(5), lon: +U.wrapLon(+h.lon).toFixed(5), name: String(h.name || 'Home').slice(0, 60) };
    save('home');
    state.picking = false;
    $('#map').classList.remove('picking');
    hideWelcome();
    homeChanged(fly);
  };
  function homeChanged(fly) {
    placeHome();
    state.selected = null;
    state.suggestions = [];
    save('sug');
    drawSpots();
    drawRadius();
    $('#homeChipText').textContent = state.home.name;
    if (fly) setTimeout(() => app.flyTo(state.home.lat, state.home.lon, isMobile() ? 7 : 8, { duration: 2.4 }), 300);
    hintOnce();
    D.loadCloudGrid(state.home.lat, state.home.lon).catch((e) => console.warn('Cloud grid failed', e));
    app.clearPlan(false);
    refreshNights();
    UI.renderTonight();
    UI.rebuildTimeline();
    app.defaultTime();
    UI.renderLive();
    UI.renderSpots();
    UI.renderSpace();
  }
  // Say once what the two map colors mean (also for people who knew the earlier green-to-gold map)
  function hintOnce() {
    if (!state.home || U.store.get('aa.hintColors', 0)) return;
    U.store.set('aa.hintColors', 1);
    setTimeout(() => UI.toast('Map colors: gold is good stargazing sky, green is where the aurora should show too.', { timeout: 9000 }), 3200);
  }
  const fineTune = coarse ? 'To fine-tune it, tap the exact spot and choose Set as home.' : 'Drag the home pin to fine-tune it.';
  function bindWelcome() {
    let results = [];
    $('#homeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#homeQuery').value.trim();
      if (!q) return;
      const ul = $('#homeResults');
      ul.hidden = false;
      ul.innerHTML = '<li class="none">Searching…</li>';
      try {
        results = await D.geocode(q);
        ul.innerHTML = results.length
          ? results.map((r, i) => `<li><button type="button" data-i="${i}">${U.esc(r.name)}<small>${U.esc(r.admin)}</small></button></li>`).join('')
          : '<li class="none">No match. Try the nearest town, or pick on the map.</li>';
        const first = ul.querySelector('button');
        if (first) first.focus();
      } catch (err) {
        ul.innerHTML = '<li class="none">The place search did not answer. Try again in a moment, or pick on the map.<br><small>(' + U.esc(String(err && err.message || err)) + ' · ' + U.esc(location.protocol + '//' + location.host) + ')</small></li>';
      }
    });
    $('#homeResults').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const r = results[+b.dataset.i];
      app.setHome({ lat: r.lat, lon: r.lon, name: r.name });
      UI.toast(`Home set to ${r.name}. ${fineTune}`);
    });
    $('#useLocation').addEventListener('click', () => {
      if (!navigator.geolocation) { UI.toast('This browser cannot share its location. Search or pick on the map instead.'); return; }
      $('#useLocation').disabled = true;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        $('#useLocation').disabled = false;
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = (await D.placeName(lat, lon)) || 'Home';
        app.setHome({ lat, lon, name });
        UI.toast(`Home set from your location. ${fineTune}`);
      }, () => {
        $('#useLocation').disabled = false;
        UI.toast('Location is blocked or unavailable. Search for your town or pick on the map.', { kind: 'error' });
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
    });
    $('#pickOnMap').addEventListener('click', () => {
      state.picking = true;
      $('#map').classList.add('picking');
      hideWelcome();
      if (isMobile()) UI.sheet.snapTo('peek');
      UI.toast(`${coarse ? 'Tap' : 'Click'} your home on the map.`, { timeout: 0, action: { label: 'Cancel', run: () => { state.picking = false; $('#map').classList.remove('picking'); if (!state.home) app.showWelcome(); } } });
    });
  }

  // ---------- Search, settings, share ----------
  app.openSearch = () => {
    const box = U.el('div');
    box.innerHTML = `<form class="home-search" id="srchForm" autocomplete="off"><div class="search-field">${U.icon('search')}<input id="srchQ" type="search" placeholder="Town, park or landmark" required aria-label="Place name"><button class="btn primary" type="submit">Search</button></div><ul class="search-results" id="srchRes" hidden></ul></form>`;
    UI.modal('Find a place', box);
    let res = [];
    $('#srchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#srchQ').value.trim();
      const ul = $('#srchRes');
      ul.hidden = false;
      ul.innerHTML = '<li class="none">Searching…</li>';
      try {
        res = await D.geocode(q);
        ul.innerHTML = res.length ? res.map((x, i) => `<li><button type="button" data-i="${i}">${U.esc(x.name)}<small>${U.esc(x.admin)}</small></button></li>`).join('') : '<li class="none">No places found. Try a nearby town.</li>';
      } catch (err) { ul.innerHTML = '<li class="none">Search is not responding. Check the connection and try again.</li>'; }
    });
    $('#srchRes').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const x = res[+b.dataset.i];
      UI.closeModal();
      if (isMobile()) UI.sheet.snapTo('half');
      app.flyTo(x.lat, x.lon, 10);
      app.inspect(x.lat, x.lon, { noReveal: true, title: x.name, name: x.name, kindLabel: x.admin || 'Place' });
    });
  };

  app.shareLink = () => {
    const payload = { v: 1, h: state.home, s: state.spots, l: state.log };
    const base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : SITE_URL;
    return `${base}#share=${U.b64e(JSON.stringify(payload))}`;
  };
  app.openShare = () => {
    const link = app.shareLink();
    const box = U.el('div');
    const n = state.spots.length, m = state.log.length;
    box.innerHTML = `<p>Send this link to your partner. Opening it offers to add ${state.home ? 'your home base, ' : ''}${n} saved spot${n === 1 ? '' : 's'} and ${m} journal entr${m === 1 ? 'y' : 'ies'} to their browser. Send a fresh link whenever you add more.</p>
      <div class="share-box"><input type="text" id="shareLink" readonly value="${U.esc(link)}" aria-label="Share link"><button class="btn primary" type="button" id="shareCopy">${U.icon('copy')}Copy</button></div>
      ${navigator.share ? `<div style="margin-top:10px"><button class="btn" type="button" id="shareNative">${U.icon('share')}Share…</button></div>` : ''}
      <p class="snapshot" style="margin-top:12px">Everything rides inside the link after the # sign, which browsers never send to a server.</p>`;
    UI.modal('Share with your partner', box);
    $('#shareCopy').onclick = () => {
      const inp = $('#shareLink');
      inp.select();
      const ok = () => UI.toast('Link copied. Paste it into a text or email.');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(ok, () => { try { document.execCommand('copy'); ok(); } catch (e) { UI.toast('Select the link and copy it.'); } });
      else { try { document.execCommand('copy'); ok(); } catch (e) { UI.toast('Select the link and copy it.'); } }
    };
    const ns = $('#shareNative');
    if (ns) ns.onclick = () => navigator.share({ title: 'Aurora Atlas', text: 'Our aurora and stargazing spots', url: link }).catch(() => {});
  };

  // Shared links are untrusted input: keep only well-formed fields
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const cleanSpot = (s) => (s && num(s.lat) && num(s.lon) && Math.abs(s.lat) <= 90 ? {
    id: typeof s.id === 'string' ? s.id.slice(0, 24) : U.uid(), lat: +s.lat.toFixed(5), lon: +U.wrapLon(s.lon).toFixed(5),
    name: String(s.name || 'Shared spot').slice(0, 60), note: typeof s.note === 'string' ? s.note.slice(0, 400) : '',
    kind: D.KINDS[s.kind] ? s.kind : null, zone: Number.isInteger(s.zone) && s.zone >= 0 && s.zone < 15 ? s.zone : null,
    hz: s.hz && num(s.hz.block) ? { block: s.hz.block, elev: num(s.hz.elev) ? s.hz.elev : null } : null, srcId: typeof s.srcId === 'string' ? s.srcId.slice(0, 24) : null, added: num(s.added) ? s.added : Date.now(),
  } : null);
  const SAW = ['aurora', 'milkyway', 'meteors', 'planets', 'satellites', 'clouds'];
  const cleanLog = (e) => (e && num(e.t) ? {
    id: typeof e.id === 'string' ? e.id.slice(0, 24) : U.uid(), t: e.t, place: String(e.place || '').slice(0, 60),
    saw: Array.isArray(e.saw) ? e.saw.filter((k) => SAW.includes(k)) : [], rating: Number.isInteger(e.rating) ? U.clamp(e.rating, 0, 5) : 0,
    notes: String(e.notes || '').slice(0, 1000),
    cond: e.cond && typeof e.cond === 'object' ? { kp: num(e.cond.kp) ? e.cond.kp : null, bz: num(e.cond.bz) ? e.cond.bz : null, v: num(e.cond.v) ? e.cond.v : null, cc: num(e.cond.cc) ? e.cond.cc : null, moon: num(e.cond.moon) ? e.cond.moon : null } : null,
  } : null);
  function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } }
  function checkImport() {
    const m = location.hash.match(/^#share=([A-Za-z0-9_-]+)$/);
    if (!m) return false;
    let data;
    try { data = JSON.parse(U.b64d(m[1])); } catch (e) { UI.toast('That share link looks damaged.', { kind: 'error' }); clearHash(); return false; }
    const spots = (Array.isArray(data.s) ? data.s : []).map(cleanSpot).filter(Boolean);
    const log = (Array.isArray(data.l) ? data.l : []).map(cleanLog).filter(Boolean);
    const home = data.h && num(data.h.lat) && num(data.h.lon) ? { lat: data.h.lat, lon: data.h.lon, name: String(data.h.name || 'Home').slice(0, 60) } : null;
    const newSpots = spots.filter((s) => !state.spots.some((x) => x.id === s.id || near(x, s)));
    const newLog = log.filter((e) => !state.log.some((x) => x.id === e.id));
    const box = U.el('div');
    box.innerHTML = `<p>This link holds ${home ? 'a home base, ' : ''}${spots.length} spot${spots.length === 1 ? '' : 's'} and ${log.length} journal entr${log.length === 1 ? 'y' : 'ies'}.</p>
      ${home ? `<div class="set-row"><div><div class="t">Use their home base</div><div class="d">${U.esc(home.name)}${state.home ? ` (replaces ${U.esc(state.home.name)})` : ''}</div></div><label class="switch"><input type="checkbox" id="impHome" ${state.home ? '' : 'checked'} aria-label="Use their home base"><i></i></label></div>` : ''}
      <p class="snapshot">${newSpots.length} new spot${newSpots.length === 1 ? '' : 's'} and ${newLog.length} new entr${newLog.length === 1 ? 'y' : 'ies'} will be added. Nothing of yours is removed.</p>
      <div class="form-actions" style="margin-top:14px"><button class="btn ghost" type="button" data-close>Not now</button><button class="btn primary" type="button" id="impGo">Import</button></div>`;
    UI.modal('Import shared plans', box, { onClose: () => { clearHash(); if (!state.home) app.showWelcome(); } });
    $('#impGo').onclick = () => {
      state.spots.push(...newSpots);
      state.log.push(...newLog);
      save('spots');
      save('log');
      const useHome = home && $('#impHome') && $('#impHome').checked;
      UI.closeModal();
      clearHash();
      if (useHome) app.setHome(home); else if (!state.home) app.showWelcome();
      drawSpots();
      UI.renderSpots();
      UI.renderLog();
      UI.toast(`Imported ${newSpots.length} spot${newSpots.length === 1 ? '' : 's'} and ${newLog.length} journal entr${newLog.length === 1 ? 'y' : 'ies'}.`);
    };
    return true;
  }

  app.openSettings = () => {
    const s = state.settings;
    const box = U.el('div');
    box.innerHTML = `
      <div class="set-row"><div><div class="t">Home base</div><div class="d">${state.home ? `${U.esc(state.home.name)} · ${U.fmtCoord(state.home.lat, state.home.lon)}` : 'Not set'}</div></div><button class="btn sm" type="button" id="stHome">Change</button></div>
      <div class="set-row"><div><div class="t">Units</div><div class="d">Distance, temperature and wind</div></div><div class="seg" role="radiogroup" aria-label="Units"><button type="button" role="radio" data-u="imperial" aria-checked="${s.units !== 'metric'}">mi · °F</button><button type="button" role="radio" data-u="metric" aria-checked="${s.units === 'metric'}">km · °C</button></div></div>
      <div class="set-row"><div><div class="t">Aurora alerts</div><div class="d">A chime and a notification while this page is open, when aurora is likely in view from home.</div></div><label class="switch"><input type="checkbox" id="stAlerts" ${s.alerts ? 'checked' : ''} aria-label="Aurora alerts"><i></i></label></div>
      <div class="set-row"><div><div class="t">Alert when the chance in view reaches</div><div class="d">From NOAA's 30-minute forecast. Kp within a third of what you need also counts.</div></div><select id="stThr" aria-label="Alert threshold">${[5, 10, 20, 30].map((v) => `<option value="${v}" ${v === s.alertThreshold ? 'selected' : ''}>${v}%</option>`).join('')}</select></div>
      <div class="set-row"><div><div class="t">Calm mode</div><div class="d">Stops the animation and particles to save battery.</div></div><label class="switch"><input type="checkbox" id="stCalm" ${s.calm ? 'checked' : ''} aria-label="Calm mode"><i></i></label></div>
      <div class="set-row"><div><div class="t">Light pollution strength</div><div class="d">How strongly the atlas colors show on the map.</div></div><input type="range" id="stLp" min="0.3" max="1" step="0.05" value="${s.lpOpacity}" style="width:130px" aria-label="Light pollution strength"></div>
      <div class="set-row"><div><div class="t">Share with your partner</div><div class="d">Send your home, spots and journal as a link.</div></div><button class="btn sm" type="button" id="stShare">${U.icon('share')}Share</button></div>
      <h4>Take it outside</h4>
      <p>At your spot, turn on night vision (the eye button): the page turns dim red so your eyes stay dark-adapted. On a phone, add Aurora Atlas to the home screen: in Safari tap Share, then Add to Home Screen; in Chrome open the menu, then Install app.</p>
      <h4>How the numbers work</h4>
      <p><b>Kp you need.</b> NOAA's space weather scales say how far from the poles aurora reaches at each Kp: about 60° magnetic latitude at Kp 5, 55° at Kp 6, 50° at Kp 7, 45° at Kp 8 and 40° at Kp 9. Your magnetic latitude sets the Kp you need.</p>
      <p><b>Aurora right now.</b> NOAA's OVATION model gives the chance of aurora overhead on a 1° grid, about 30 minutes ahead. "In view" also counts aurora up to about 1,300 km away that would stand at least 3° above your horizon, taking the glow to be about 150 km up.</p>
      <p><b>Scores.</b> Each hour multiplies the aurora chance (stars skip this), clear sky, darkness, moonlight, and how much light pollution costs at that place. Thin high cloud counts 40% less than low cloud.</p>
      <p><b>Best sky.</b> Gold on the map is good stargazing: clear sky at the timeline's hour × how dark the sky is there (light pollution atlas) × darkness and moonlight. Green is where the aurora should be in view as well: the same clear, dark sky, as far south as the forecast Kp reaches. Auto shows both, Aurora or Stars shows just one. The moving green and violet curtains are NOAA's forecast of aurora overhead, and the dotted green line is how far south it is likely to be seen. In the Forecast tab, Auto leads with the aurora when the forecast Kp gets within one step of what your home needs, and with stars otherwise.</p>
      <p><b>Spots.</b> The finder ranks the darkest, clearest ground within your radius, then picks the nearest real place to stand there from OpenStreetMap. Each one is checked for an open view toward the aurora (terrain only, from a 90 m elevation model), distance and tonight's clouds.</p>
      <h4>Data sources</h4>
      <ul>
        <li>Aurora, Kp, solar wind and alerts: <a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener">NOAA Space Weather Prediction Center</a></li>
        <li>Clouds, weather, elevation and place search: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></li>
        <li>Light pollution: <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener">David J. Lorenz, Light Pollution Atlas 2025</a></li>
        <li>Viewpoints, campgrounds and other places: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, through <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon by Komoot</a></li>
        <li>Place names for dropped pins: BigDataCloud. Base maps: CARTO and Esri. Sun and Moon: SunCalc.</li>
      </ul>
      <h4>Your data</h4>
      <p>Home, spots and journal stay in this browser. To move them to another device, use Share. Forecast lookups send map coordinates to the services above.</p>
      <div class="set-row"><div><div class="t">Clear saved data</div><div class="d">Removes home, spots and journal from this browser.</div></div><button class="btn sm" type="button" id="stClear">Clear…</button></div>`;
    UI.modal('Settings', box);
    $('#stHome').onclick = () => { UI.closeModal(); app.showWelcome(); };
    U.$$('[data-u]', box).forEach((b) => { b.onclick = () => {
      s.units = b.dataset.u;
      save('settings');
      U.$$('[data-u]', box).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      infoCache.clear();
      UI.renderTonight(); UI.rebuildTimeline(); UI.renderSpots(); UI.renderLive();
      if (state.inspect) app.inspect(state.inspect.lat, state.inspect.lon, state.inspect);
    }; });
    $('#stAlerts').onchange = (e) => setAlerts(e.target.checked);
    $('#stThr').onchange = (e) => { s.alertThreshold = +e.target.value; save('settings'); };
    $('#stCalm').onchange = (e) => { s.calm = e.target.checked; save('settings'); document.documentElement.classList.toggle('reduce-motion', s.calm); updateAuroraFade(); };
    $('#stLp').oninput = (e) => { s.lpOpacity = +e.target.value; lpLayer.setOpacity(s.lpOpacity); };
    $('#stLp').onchange = () => save('settings');
    $('#stShare').onclick = () => app.openShare();
    $('#stClear').onclick = (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to clear'; b.classList.add('primary'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Clear…'; b.classList.remove('primary'); } }, 4000); return; }
      for (const k of Object.values(KEYS)) U.store.del(k);
      state.home = null; state.spots = []; state.log = []; state.suggestions = []; state.selected = null;
      homeLayer.clearLayers(); drawSpots(); drawRadius();
      $('#homeChipText').textContent = 'Set home';
      UI.closeModal();
      UI.renderTonight(); UI.rebuildTimeline(); UI.renderSpots(); UI.renderLog(); UI.renderLive();
      app.showWelcome();
    };
  };

  // ---------- Alerts ----------
  let lastAlertAt = U.store.get('aa.lastAlert', 0) || 0;
  function setAlerts(on) {
    state.settings.alerts = on;
    save('settings');
    $('#alertBtn').setAttribute('aria-pressed', String(on));
    const chk = $('#stAlerts');
    if (chk) chk.checked = on;
    if (on) {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      UI.toast(state.home ? 'Aurora alerts are on while this page is open.' : 'Aurora alerts are on. Set a home so they know where to look.');
      checkAuroraAlert();
    } else UI.toast('Aurora alerts are off.');
  }
  function chime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx();
      const t0 = ac.currentTime;
      [659.25, 987.77, 1318.51].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * 0.18);
        g.gain.linearRampToValueAtTime(0.12, t0 + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 1.6);
        o.connect(g).connect(ac.destination);
        o.start(t0 + i * 0.18);
        o.stop(t0 + i * 0.18 + 1.7);
      });
      setTimeout(() => ac.close(), 2600);
    } catch (e) { /* audio unavailable */ }
  }
  let titleTimer = null;
  function flashTitle() {
    clearInterval(titleTimer);
    let on = false, n = 0;
    titleTimer = setInterval(() => { document.title = (on = !on) ? '✦ Aurora alert' : 'Aurora Atlas'; if (++n > 20 || !document.hidden) { clearInterval(titleTimer); document.title = 'Aurora Atlas'; } }, 1000);
  }
  function checkAuroraAlert() {
    if (!state.settings.alerts || !state.home || !D.ov) return;
    const v = Sky.ovInView(state.home.lat, state.home.lon);
    const kp = D.kpNow();
    const need = Sky.kpNeeded(Sky.magLat(state.home.lat, state.home.lon));
    const byOv = v && v.inView >= state.settings.alertThreshold;
    const byKp = kp != null && need <= 9 && kp >= need - 0.34;
    if (!(byOv || byKp) || Date.now() - lastAlertAt < 90 * U.MIN) return;
    lastAlertAt = Date.now();
    U.store.set('aa.lastAlert', lastAlertAt);
    const msg = byOv ? `Aurora alert: about a ${Math.round(v.inView)}% chance it's in view from home right now.` : `Aurora alert: Kp is ${kp.toFixed(1)}, close to the ${need.toFixed(1)} you need at home.`;
    UI.toast(msg, { kind: 'aurora', timeout: 0, action: { label: 'Show me', run: () => { app.selectPlace(null); app.flyTo(state.home.lat, state.home.lon, 6); } } });
    chime();
    flashTitle();
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Aurora Atlas', { body: msg, icon: 'icons/icon-192.png', tag: 'aurora' }); } catch (e) { /* notifications unavailable */ }
  }

  // ---------- Data refresh ----------
  async function refreshWeather() {
    const ps = [app.homePlace(), state.selected].filter(Boolean);
    await Promise.all(ps.map(async (p) => {
      const it = app.placeInfo(p);
      try { it.wx = await D.pointWx(p.lat, p.lon); it.wxErr = null; } catch (e) { it.wxErr = e; }
      refreshPlaceViews(p);
    }));
  }
  async function refreshGrid() { if (state.home) await D.loadCloudGrid(state.home.lat, state.home.lon); }
  const jobs = [
    { k: 'ovation', every: 5 * U.MIN, run: D.loadOvation },
    { k: 'kp1m', every: 5 * U.MIN, run: D.loadKp1m },
    { k: 'kpFc', every: 30 * U.MIN, run: D.loadKpForecast },
    { k: 'sw', every: 10 * U.MIN, run: D.loadSolarWind },
    { k: 'swNow', every: 2 * U.MIN, run: D.loadSolarWindNow },
    { k: 'hp', every: 5 * U.MIN, run: D.loadHP },
    { k: 'alerts', every: 15 * U.MIN, run: D.loadAlerts },
    { k: 'outlook', every: 6 * U.HOUR, run: D.loadOutlook },
    { k: 'wx', every: 30 * U.MIN, run: refreshWeather },
    { k: 'grid', every: 90 * U.MIN, run: refreshGrid },
    { k: 'nights', every: 3 * U.HOUR, run: refreshNights },
  ];
  const lastRun = {}, running = {};
  async function runJob(j) {
    if (running[j.k]) return;
    running[j.k] = true;
    lastRun[j.k] = Date.now();
    try { await j.run(); delete D.errors[j.k]; }
    catch (e) { D.errors[j.k] = String(e && e.message || e); console.warn(`[${j.k}]`, e); lastRun[j.k] = Date.now() - j.every + 90e3; }
    finally { running[j.k] = false; UI.renderUpdated(); }
  }
  function tick() {
    if (document.hidden) return;
    for (const j of jobs) if (!lastRun[j.k] || Date.now() - lastRun[j.k] >= j.every) runJob(j);
    if (state.live) {
      const before = UI.TL.t0;
      state.time = Date.now();
      if (U.floorHour(Date.now()) !== before) UI.rebuildTimeline(); else UI.drawTimeline();
      if (fx) fx.setCloudTime(state.time);
    }
    UI.renderUpdated();
  }

  // ---------- Events from data ----------
  AA.on('ovation', () => {
    if (fx) fx.setOvation(D.ov.grid);
    updateAuroraFade();
    UI.renderLive();
    UI.renderTonight();
    if (state.inspect) UI.renderInspector(state.inspect);
    refreshKey();
    checkAuroraAlert();
  });
  AA.on('kp', () => { app.recomputeNights(); UI.renderLive(); UI.renderTonight(); UI.rebuildTimeline(); UI.renderSpace(); UI.renderLegend(); drawReach(); updateBest(); checkAuroraAlert(); });
  AA.on('sheet', () => { fxDirty = true; });
  AA.on('site', (s) => { if (fx) fx.setSite(s); updateBest(); if (state.inspect) UI.renderInspector(state.inspect); });
  AA.on('sw', () => {
    UI.renderLive();
    UI.renderSWReadouts();
    const v = D.swNow();
    sw.set({ v: v.v, n: v.n, bz: v.bz, kp: D.kpNow() });
  });
  AA.on('hp', () => { UI.renderTonight(); UI.renderSpace(); });
  AA.on('alerts', () => UI.renderSpace());
  AA.on('outlook', () => { UI.renderSpace(); if (state.home) refreshNights(); });
  AA.on('grid', (g) => {
    if (fx) { fx.setCloudGrid(g); fx.setCloudTime(state.time); }
    if (!D.site || D.site.key !== g.key) D.buildSite(g).catch((e) => console.warn('Darkness grid failed', e));
    updateBest();
    fxDirty = true;
    drawSpots();
    UI.renderSpots();
  });

  // ---------- Animation loop ----------
  let lastFrame = performance.now(), lastFx = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!document.hidden) {
      const c = calm();
      const tSec = c ? 120 : now / 1000;
      // nothing to draw while a full-height sheet covers the map; phones also run the map effects at a gentler rate
      if (!(isMobile() && UI.sheet.is('full'))) {
        if (fx && (mapMoving || fxDirty || fx.busy || (!c && now - lastFx > (coarse ? 50 : 32)))) { fx.render(tSec); lastFx = now; fxDirty = false; }
        if (!c && state.settings.layers.aurora) particles.step(dt);
        else if (mapMoving) particles.step(0);
      }
      if (playing) advancePlay(dt);
      if (UI.activeTab === 'space' && !c) sw.step(dt);
      if (welcomeSky && !$('#welcome').hidden) welcomeSky.render(c ? 80 : now / 1000);
    }
    requestAnimationFrame(frame);
  }

  // ---------- UI wiring ----------
  function bindUI() {
    U.$$('.tab-btn').forEach((b) => b.addEventListener('click', () => {
      UI.setTab(b.dataset.tab);
      drawRadius();
      if (UI.sheet.is('peek')) UI.sheet.snapTo('half', { user: true });
    }));
    // on a phone the live strip doubles as a shortcut to the space weather tab
    $('#live').addEventListener('click', () => {
      if (!isMobile()) return;
      if (state.inspect) app.closeInspector();
      UI.setTab('space');
      drawRadius();
      if (UI.sheet.is('peek')) UI.sheet.snapTo('half', { user: true });
    });
    U.$$('#tab-tonight .seg button').forEach((b) => b.addEventListener('click', () => {
      state.settings.mode = b.dataset.mode;
      save('settings');
      UI.renderTonight();
      UI.rebuildTimeline();
      UI.renderLegend();
      updateBest();
    }));
    $('#backHome').onclick = () => { app.selectPlace(null); if (state.home) app.flyTo(state.home.lat, state.home.lon); };
    // where a button shows only its icon (tablets, a phone on its side), say what was switched
    const labelHidden = (b) => { const sp = b.querySelector('span'); return !!sp && getComputedStyle(sp).display === 'none'; };
    U.$$('.chip[data-layer]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.layer;
      state.settings.layers[k] = !state.settings.layers[k];
      save('settings');
      applyLayers();
      if (labelHidden(b)) UI.toast(`${b.querySelector('span').textContent} ${state.settings.layers[k] ? 'on' : 'off'}`, { timeout: 1400 });
    }));
    U.$$('.base-seg button').forEach((b) => b.addEventListener('click', () => {
      state.settings.base = b.dataset.base;
      save('settings');
      applyBase();
      if (labelHidden(b)) UI.toast(`${b.querySelector('span').textContent} map`, { timeout: 1400 });
    }));
    $('#zoomIn').onclick = () => map.zoomIn();
    $('#zoomOut').onclick = () => map.zoomOut();
    $('#goHome').onclick = () => { if (state.home) app.flyTo(state.home.lat, state.home.lon, Math.max(7, map.getZoom())); else app.showWelcome(); };
    $('#homeChip').onclick = () => {
      if (!state.home) { app.showWelcome(); return; }
      app.selectPlace(null);
      app.flyTo(state.home.lat, state.home.lon, Math.max(7.5, map.getZoom()));
    };
    $('#legendBtn').onclick = () => toggleKey();
    $('#legend').addEventListener('click', (e) => {
      if (e.target.closest('#keyStrip')) toggleKey(true);
      else if (e.target.closest('#keyClose')) toggleKey(false);
    });
    $('#searchBtn').onclick = () => app.openSearch();
    $('#settingsBtn').onclick = () => app.openSettings();
    $('#alertBtn').onclick = () => setAlerts(!state.settings.alerts);
    $('#nightBtn').onclick = () => {
      state.settings.nightVision = !state.settings.nightVision;
      save('settings');
      document.documentElement.classList.toggle('night-vision', state.settings.nightVision);
      $('#nightBtn').setAttribute('aria-pressed', String(state.settings.nightVision));
    };
    $('#findBtn').onclick = () => app.findSpots();
    $('#radiusSel').onchange = (e) => { state.settings.radiusKm = +e.target.value; save('settings'); drawRadius(); };
    $('#shareBtn').onclick = () => app.openShare();
    $('#tlPlay').onclick = () => (playing ? app.stopPlay() : app.play());
    $('#tlNow').onclick = () => { app.stopPlay(); app.setTime(Date.now(), { live: true }); };
    map.on('click', (e) => {
      if (state.picking) { app.setHome({ lat: e.latlng.lat, lon: U.wrapLon(e.latlng.lng), name: 'Home' }); UI.toast(`Home set. ${fineTune}`); return; }
      if (compactKey() && keyOpen) { setKey(false); return; }
      app.inspect(e.latlng.lat, U.wrapLon(e.latlng.lng), { kind: 'pin' });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#modal').hidden && state.inspect) app.closeInspector();
    });
    const onResize = U.debounce(() => {
      UI.sheet.refresh();
      map.invalidateSize();
      UI.moveInk(); UI.rebuildTimeline(); UI.renderTonight(); UI.renderLegend(); applyLegend();
      fxDirty = true;
    }, 150);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    // iOS can leave the page scrolled after the keyboard closes; put the fixed layout back
    document.addEventListener('focusout', () => setTimeout(() => {
      const a = document.activeElement;
      if (!a || !a.matches || !a.matches('input, textarea, select')) window.scrollTo(0, 0);
    }, 120));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { UI.moveInk(); UI.rebuildTimeline(); UI.renderTonight(); });
  }

  // ---------- Boot ----------
  function boot() {
    document.documentElement.classList.toggle('night-vision', !!state.settings.nightVision);
    document.documentElement.classList.toggle('reduce-motion', !!state.settings.calm);
    $('#nightBtn').setAttribute('aria-pressed', String(!!state.settings.nightVision));
    $('#alertBtn').setAttribute('aria-pressed', String(!!state.settings.alerts));
    $('#homeChipText').textContent = state.home ? state.home.name : 'Set home';
    UI.initSheet();
    applyBase();
    applyLayers();
    placeHome();
    UI.bindHourly();
    UI.bindSpots();
    UI.bindLog();
    UI.bindTimeline();
    UI.bindNights();
    bindUI();
    bindWelcome();
    const tab = U.store.get('aa.tab', 'tonight');
    UI.setTab(['tonight', 'spots', 'space', 'log'].includes(tab) ? tab : 'tonight');
    drawRadius();
    UI.renderLegend();
    applyLegend();
    UI.renderLive();
    UI.rebuildTimeline();
    if (state.home) {
      app.defaultTime();
      app.centerOn(state.home.lat, state.home.lon, isMobile() ? 6.5 : 7.5);
      hintOnce();
    }
    const importing = checkImport();
    if (!state.home && !importing) app.showWelcome();
    if (location.protocol === 'file:') {
      UI.toast('This is the local copy of the file. The live site has everything working.', { timeout: 0, action: { label: 'Open live site', run: () => { location.href = SITE_URL; } } });
    }
    tick();
    setInterval(tick, 15e3);
    requestAnimationFrame(frame);
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline support unavailable', e));
    }
  }
  boot();
})(window.AA);
