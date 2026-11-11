/* Aurora Atlas: live data (NOAA SWPC, Open-Meteo, Lorenz light pollution atlas, OpenStreetMap) */
'use strict';
(function (AA) {
  const U = AA.U;
  const D = (AA.D = { ov: null, kpFc: [], kp1m: [], wind: [], mag: [], alerts: [], outlook: [], hp: null, grid: null, updated: {}, errors: {} });

  const SWPC = 'https://services.swpc.noaa.gov';
  D.URL = {
    ovation: `${SWPC}/json/ovation_aurora_latest.json`,
    kpFc: `${SWPC}/products/noaa-planetary-k-index-forecast.json`,
    kp1m: `${SWPC}/json/planetary_k_index_1m.json`,
    wind: `${SWPC}/json/rtsw/rtsw_wind_1m.json`,
    mag: `${SWPC}/json/rtsw/rtsw_mag_1m.json`,
    windNow: `${SWPC}/products/summary/solar-wind-speed.json`,
    magNow: `${SWPC}/products/summary/solar-wind-mag-field.json`,
    alerts: `${SWPC}/products/alerts.json`,
    outlook: `${SWPC}/text/27-day-outlook.txt`,
    hp: `${SWPC}/text/aurora-nowcast-hemi-power.txt`,
    meteo: 'https://api.open-meteo.com/v1/forecast',
    elev: 'https://api.open-meteo.com/v1/elevation',
    geo: 'https://geocoding-api.open-meteo.com/v1/search',
    reverse: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
    photon: 'https://photon.komoot.io/reverse',
    route: 'https://router.project-osrm.org/table/v1/driving/',
    lp: 'https://djlorenz.github.io/astronomy/image_tiles/tiles2025/tile_{z}_{x}_{y}.png',
  };
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const utc = (s) => (s ? Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z') : NaN);
  const mark = (name) => { D.updated[name] = Date.now(); delete D.errors[name]; };

  // ---------- NOAA: OVATION aurora forecast ----------
  D.loadOvation = async () => {
    const j = await U.retry(() => U.fetchJSON(D.URL.ovation, { cache: 'no-cache', timeout: 40000 }));
    const grid = new Uint8Array(360 * 181);
    for (const c of j.coordinates || []) {
      const lon = c[0], lat = c[1];
      if (lon >= 0 && lon < 360 && lat >= -90 && lat <= 90) grid[(lat + 90) * 360 + lon] = Math.min(100, Math.max(0, c[2]));
    }
    D.ov = { grid, obs: utc(j['Observation Time']), fc: utc(j['Forecast Time']) };
    AA.Sky.ov = D.ov;
    mark('ovation');
    AA.emit('ovation', D.ov);
  };

  // ---------- NOAA: Kp ----------
  D.loadKpForecast = async () => {
    const j = await U.retry(() => U.fetchJSON(D.URL.kpFc, { cache: 'no-cache' }));
    let rows;
    if (Array.isArray(j) && j.length && Array.isArray(j[0])) {
      const [hdr, ...rest] = j;
      const iT = hdr.indexOf('time_tag'), iK = hdr.indexOf('kp'), iO = hdr.indexOf('observed'), iS = hdr.indexOf('noaa_scale');
      rows = rest.map((r) => ({ t: utc(r[iT]), kp: parseFloat(r[iK]), kind: r[iO], scale: r[iS] }));
    } else {
      rows = (j || []).map((r) => ({ t: utc(r.time_tag), kp: parseFloat(r.kp), kind: r.observed, scale: r.noaa_scale }));
    }
    D.kpFc = rows.filter((r) => Number.isFinite(r.t) && Number.isFinite(r.kp)).sort((a, b) => a.t - b.t);
    mark('kpFc');
    AA.emit('kp');
  };
  D.loadKp1m = async () => {
    const j = await U.retry(() => U.fetchJSON(D.URL.kp1m, { cache: 'no-cache' }));
    D.kp1m = (j || [])
      .map((r) => ({ t: utc(r.time_tag), kp: r.estimated_kp != null ? parseFloat(r.estimated_kp) : parseFloat(r.kp_index) }))
      .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.kp))
      .sort((a, b) => a.t - b.t);
    mark('kp1m');
    AA.emit('kp');
  };
  D.kpBlock = (t) => {
    let hit = null;
    for (const r of D.kpFc) if (r.t <= t && t < r.t + 3 * U.HOUR) hit = r;
    return hit;
  };
  D.kpNow = () => {
    const n = D.kp1m.length, k = D.kp1m[n - 1];
    if (k && Date.now() - k.t < 3 * U.HOUR) {
      // NOAA's running estimate restarts from zero at each 3-hour mark (00, 03, ... UTC) and builds back up,
      // so early in a window the last reading of the window before is the better "now"
      const w0 = Math.floor(k.t / (3 * U.HOUR)) * 3 * U.HOUR;
      if (k.t - w0 < 45 * U.MIN) {
        for (let i = n - 1; i >= 0; i--) {
          if (D.kp1m[i].t < w0) { if (D.kp1m[i].kp > k.kp) return D.kp1m[i].kp; break; }
        }
      }
      return k.kp;
    }
    const b = D.kpBlock(Date.now());
    return b ? b.kp : null;
  };
  D.kpAt = (t) => {
    if (Math.abs(t - Date.now()) < 1.5 * U.HOUR) {
      const k = D.kpNow();
      if (k != null) { const b = D.kpBlock(t); return b && b.kind === 'predicted' ? Math.max(k, b.kp) : k; }
    }
    const b = D.kpBlock(t);
    return b ? b.kp : null;
  };

  // ---------- NOAA: real-time solar wind (DSCOVR / ACE at L1) ----------
  const activeOnly = (rows, has) => {
    let a = rows.filter((r) => r.active && has(r));
    if (!a.length) {
      // During spacecraft switch-overs nothing is flagged active: use the source with the newest data
      const src = (rows.find(has) || {}).source;
      a = rows.filter((r) => r.source === src && has(r));
    }
    return a;
  };
  D.loadSolarWind = async () => {
    const [w, m] = await Promise.all([
      U.retry(() => U.fetchJSON(D.URL.wind, { cache: 'no-cache', timeout: 40000 })),
      U.retry(() => U.fetchJSON(D.URL.mag, { cache: 'no-cache', timeout: 40000 })),
    ]);
    D.wind = activeOnly(w || [], (r) => r.proton_speed != null)
      .map((r) => ({ t: utc(r.time_tag), v: +r.proton_speed, n: r.proton_density != null ? +r.proton_density : null, src: r.source }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);
    D.mag = activeOnly(m || [], (r) => r.bz_gsm != null)
      .map((r) => ({ t: utc(r.time_tag), bz: +r.bz_gsm, bt: r.bt != null ? +r.bt : null, src: r.source }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);
    mark('sw');
    AA.emit('sw');
  };
  D.loadSolarWindNow = async () => {
    if (!D.wind.length) return;
    const [s, b] = await Promise.all([U.fetchJSON(D.URL.windNow, { cache: 'no-cache' }), U.fetchJSON(D.URL.magNow, { cache: 'no-cache' })]);
    const sv = Array.isArray(s) ? s[0] : s, bv = Array.isArray(b) ? b[0] : b;
    const lastW = D.wind[D.wind.length - 1], lastM = D.mag[D.mag.length - 1];
    const t1 = utc(sv && sv.time_tag), t2 = utc(bv && bv.time_tag);
    let changed = false;
    if (Number.isFinite(t1) && sv.proton_speed != null && (!lastW || t1 > lastW.t)) { D.wind.push({ t: t1, v: +sv.proton_speed, n: lastW ? lastW.n : null }); changed = true; }
    if (Number.isFinite(t2) && bv.bz_gsm != null && (!lastM || t2 > lastM.t)) { D.mag.push({ t: t2, bz: +bv.bz_gsm, bt: bv.bt != null ? +bv.bt : null }); changed = true; }
    if (changed) { mark('sw'); AA.emit('sw'); }
  };
  D.swNow = () => {
    const w = D.wind[D.wind.length - 1], m = D.mag[D.mag.length - 1];
    let n = null;
    for (let i = D.wind.length - 1; i >= 0 && i > D.wind.length - 30; i--) if (D.wind[i].n != null) { n = D.wind[i].n; break; }
    return { v: w ? w.v : null, n, bz: m ? m.bz : null, bt: m ? m.bt : null, t: Math.max(w ? w.t : 0, m ? m.t : 0) || null };
  };

  // When the newest live reading was actually measured. Offline, the service worker hands back the last
  // saved copies, so "fetched just now" proves nothing: the data's own timestamps do.
  D.dataTime = () => {
    const k = D.kp1m[D.kp1m.length - 1], s = D.swNow();
    const ts = [D.ov ? D.ov.obs : 0, k ? k.t : 0, s.t || 0].filter((t) => Number.isFinite(t) && t > 0);
    return ts.length ? Math.max(...ts) : null;
  };

  // ---------- NOAA: alerts, outlook, hemispheric power ----------
  const parseAlert = (a) => {
    const msg = a.message || '';
    const m = msg.match(/^(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CANCEL WARNING|CANCEL WATCH|CANCEL SUMMARY)[^:\n]*:\s*(.+)$/m);
    if (!m) return null;
    const val = (k) => { const r = msg.match(new RegExp('^' + k + ':\\s*(.+)$', 'mi')); return r ? r[1].trim() : null; };
    const when = (s) => {
      const r = s && s.match(/(\d{4}) (\w{3}) (\d{1,2}) (\d{2})(\d{2}) UTC/);
      return r && MON[r[2]] != null ? Date.UTC(+r[1], MON[r[2]], +r[3], +r[4], +r[5]) : null;
    };
    const head = m[2].trim();
    return {
      id: a.product_id, t: utc(String(a.issue_datetime || '').replace(' ', 'T')), kind: m[1].toLowerCase(), head,
      geomag: /geomagnetic|magnetopause|sudden impulse|k-index/i.test(head),
      validFrom: when(val('Valid From')), validTo: when(val('Valid To')) || when(val('Now Valid Until')),
      scale: val('NOAA Scale'), text: msg,
    };
  };
  D.loadAlerts = async () => {
    const j = await U.fetchJSON(D.URL.alerts, { cache: 'no-cache' });
    D.alerts = (j || []).map(parseAlert).filter(Boolean).sort((a, b) => b.t - a.t);
    mark('alerts');
    AA.emit('alerts');
  };
  D.loadOutlook = async () => {
    const txt = await U.fetchJSON(D.URL.outlook, { text: true, cache: 'no-cache' });
    const rows = [];
    for (const line of txt.split('\n')) {
      const m = line.match(/^(\d{4})\s+(\w{3})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (m && MON[m[2]] != null) rows.push({ t: Date.UTC(+m[1], MON[m[2]], +m[3], 12), f107: +m[4], ap: +m[5], kp: +m[6] });
    }
    D.outlook = rows;
    mark('outlook');
    AA.emit('outlook');
  };
  D.loadHP = async () => {
    const txt = await U.fetchJSON(D.URL.hp, { text: true, cache: 'no-cache' });
    const toT = (s) => Date.parse(s.replace('_', 'T') + ':00Z');
    const rows = txt.split('\n').filter((l) => /^\d{4}-\d\d-\d\d_\d\d:\d\d/.test(l.trim())).map((l) => {
      const p = l.trim().split(/\s+/);
      return { t: toT(p[0]), fc: toT(p[1]), north: +p[2], south: +p[3] };
    });
    if (!rows.length) return;
    D.hp = { ...rows[rows.length - 1], series: rows.slice(-96) };
    mark('hp');
    AA.emit('hp');
  };

  // ---------- Open-Meteo weather ----------
  const WX_VARS = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability';
  const wxMem = new Map();
  D.pointWx = async (lat, lon, { force = false } = {}) => {
    const units = U.imperial() ? 'imp' : 'met';
    const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}:${units}`;
    const hit = wxMem.get(key);
    if (!force && hit && Date.now() - hit.fetched < 30 * U.MIN) return hit;
    if (!force) { const c = U.cacheGet(key, 30 * U.MIN); if (c) { wxMem.set(key, c); return c; } }
    let url = `${D.URL.meteo}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=${WX_VARS}&past_hours=14&forecast_hours=72&timeformat=unixtime&timezone=GMT`;
    if (units === 'imp') url += '&temperature_unit=fahrenheit&wind_speed_unit=mph';
    const j = await U.retry(() => U.fetchJSON(url));
    const h = j.hourly;
    const wx = {
      t: h.time.map((s) => s * 1000), cc: h.cloud_cover, low: h.cloud_cover_low, mid: h.cloud_cover_mid, high: h.cloud_cover_high,
      vis: h.visibility, temp: h.temperature_2m, dew: h.dew_point_2m, rh: h.relative_humidity_2m, wind: h.wind_speed_10m,
      gust: h.wind_gusts_10m, pop: h.precipitation_probability, elev: j.elevation, fetched: Date.now(), units,
    };
    wxMem.set(key, wx);
    U.cachePut(key, wx);
    return wx;
  };
  D.wxAt = (wx, t) => {
    if (!wx || !wx.t || !wx.t.length) return null;
    const i = Math.round((t - wx.t[0]) / U.HOUR);
    if (i < 0 || i >= wx.t.length) return null;
    const g = (a) => (a ? a[i] : null);
    return { i, t: wx.t[i], cc: g(wx.cc), low: g(wx.low), mid: g(wx.mid), high: g(wx.high), vis: g(wx.vis), temp: g(wx.temp), dew: g(wx.dew), rh: g(wx.rh), wind: g(wx.wind), gust: g(wx.gust), pop: g(wx.pop) };
  };
  // Hourly cloud cover for many points in one request (spot ranking)
  D.multiClouds = async (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i += 60) {
      const chunk = pts.slice(i, i + 60);
      const url = `${D.URL.meteo}?latitude=${chunk.map((p) => p.lat.toFixed(2)).join(',')}&longitude=${chunk.map((p) => p.lon.toFixed(2)).join(',')}&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&past_hours=1&forecast_hours=48&timeformat=unixtime&timezone=GMT`;
      const j = await U.retry(() => U.fetchJSON(url));
      const arr = Array.isArray(j) ? j : [j];
      for (const x of arr) out.push({ t: x.hourly.time.map((s) => s * 1000), cc: x.hourly.cloud_cover, low: x.hourly.cloud_cover_low, mid: x.hourly.cloud_cover_mid, high: x.hourly.cloud_cover_high });
    }
    return out;
  };

  // 8-day hourly cloud cover at a handful of places within driving range (one request, cached 3 hours)
  D.loadNightClouds = async (pts, key) => {
    const c = U.cacheGet(key, 3 * U.HOUR);
    if (c) return c;
    const url = `${D.URL.meteo}?latitude=${pts.map((p) => p.lat.toFixed(2)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(2)).join(',')}&hourly=cloud_cover&forecast_days=8&timeformat=unixtime&timezone=GMT`;
    const j = await U.retry(() => U.fetchJSON(url, { timeout: 30000 }));
    const out = (Array.isArray(j) ? j : [j]).map((x) => ({ t0: x.hourly.time[0] * 1000, cc: x.hourly.cloud_cover }));
    U.cachePut(key, out);
    return out;
  };

  // Regional cloud grid: 21 x 21 points about 24 km apart (roughly 480 km square) around a center
  const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  D.GRID_N = 21;
  D.loadCloudGrid = async (lat, lon, { force = false } = {}) => {
    const cLat = Math.round(lat * 4) / 4, cLon = Math.round(lon * 4) / 4;
    const key = `grid2:${cLat},${cLon}`;
    if (!force && D.grid && D.grid.key === key && Date.now() - D.grid.fetched < 85 * U.MIN) return D.grid;
    if (!force) {
      const c = U.cacheGet(key, 85 * U.MIN);
      if (c) { D.grid = { ...c, total: fromB64(c.total), low: fromB64(c.low) }; mark('grid'); AA.emit('grid', D.grid); return D.grid; }
    }
    const N = D.GRID_N, dLat = 0.216, dLon = 0.216 / Math.cos(U.rad(cLat));
    const south = cLat - dLat * (N - 1) / 2, west = cLon - dLon * (N - 1) / 2;
    const lats = [], lons = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { lats.push((south + j * dLat).toFixed(3)); lons.push((west + i * dLon).toFixed(3)); }
    const url = `${D.URL.meteo}?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=cloud_cover,cloud_cover_low&past_hours=2&forecast_hours=60&timeformat=unixtime&timezone=GMT`;
    const j = await U.retry(() => U.fetchJSON(url, { timeout: 45000 }));
    const arr = Array.isArray(j) ? j : [j];
    const T = arr[0].hourly.time.length, NN = N * N;
    const total = new Uint8Array(T * NN), low = new Uint8Array(T * NN);
    arr.forEach((x, k) => {
      if (k >= NN) return;
      for (let h = 0; h < T; h++) { total[h * NN + k] = x.hourly.cloud_cover[h] ?? 0; low[h * NN + k] = x.hourly.cloud_cover_low[h] ?? 0; }
    });
    const g = { key, fetched: Date.now(), nx: N, ny: N, west, south, east: west + dLon * (N - 1), north: south + dLat * (N - 1), t: arr[0].hourly.time.map((s) => s * 1000), total, low, center: { lat: cLat, lon: cLon } };
    U.cachePut(key, { ...g, total: toB64(total), low: toB64(low) });
    D.grid = g;
    mark('grid');
    AA.emit('grid', g);
    return g;
  };
  D.gridAt = (g, lat, lon, t) => {
    if (!g) return null;
    const fx = ((lon - g.west) / (g.east - g.west)) * (g.nx - 1), fy = ((lat - g.south) / (g.north - g.south)) * (g.ny - 1);
    if (!(fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1)) return null;
    const ht = (t - g.t[0]) / U.HOUR;
    if (!(ht >= 0 && ht <= g.t.length - 1)) return null;
    const h0 = Math.floor(ht), h1 = Math.min(g.t.length - 1, h0 + 1), fh = ht - h0;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const NN = g.nx * g.ny;
    const samp = (arr, h) => {
      const o = h * NN, v = (x, y) => arr[o + y * g.nx + x];
      return (v(x0, y0) * (1 - ax) + v(x1, y0) * ax) * (1 - ay) + (v(x0, y1) * (1 - ax) + v(x1, y1) * ax) * ay;
    };
    return { cc: U.lerp(samp(g.total, h0), samp(g.total, h1), fh), low: U.lerp(samp(g.low, h0), samp(g.low, h1), fh) };
  };

  // ---------- Light pollution atlas tiles (read pixel colours -> zone) ----------
  const LPZ = 6; // the atlas' finest zoom (1024 px tiles, ~420 m per pixel at 47°N)
  const lpTiles = new Map();
  D.lpTile = (x, y) => {
    const key = `${x}_${y}`;
    if (lpTiles.has(key)) return lpTiles.get(key);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          const z = new Uint8Array(c.width * c.height);
          let lastKey = -1, lastIdx = 0;
          for (let i = 0, j = 0; j < z.length; i += 4, j++) {
            const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
            if (k !== lastKey) { lastKey = k; lastIdx = AA.Sky.lpIndex(d[i], d[i + 1], d[i + 2]); }
            z[j] = lastIdx;
          }
          resolve({ w: c.width, h: c.height, z });
        } catch (e) { console.warn('Light pollution tile could not be read', e); resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = D.URL.lp.replace('{z}', LPZ).replace('{x}', x).replace('{y}', y);
    });
    lpTiles.set(key, p);
    if (lpTiles.size > 12) lpTiles.delete(lpTiles.keys().next().value);
    return p;
  };
  D.lpZone = async (lat, lon) => {
    const n = 2 ** LPZ;
    const xf = ((U.wrapLon(lon) + 180) / 360) * n;
    const s = Math.sin(U.rad(U.clamp(lat, -85, 85)));
    const yf = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const tx = Math.min(n - 1, Math.floor(xf)), ty = U.clamp(Math.floor(yf), 0, n - 1);
    const t = await D.lpTile(tx, ty);
    if (!t) return null;
    const px = Math.min(t.w - 1, Math.floor((xf - tx) * t.w)), py = Math.min(t.h - 1, Math.floor((yf - ty) * t.h));
    return t.z[py * t.w + px];
  };

  // ---------- Darkness grid for the Best sky map ----------
  // The atlas zones resampled onto the cloud grid's box (about 1 km per cell), as a 0..1 "how dark" value.
  const tileX = (lon, n) => ((U.wrapLon(lon) + 180) / 360) * n;
  const tileY = (lat, n) => { const s = Math.sin(U.rad(U.clamp(lat, -85, 85))); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n; };
  D.site = null;
  D.buildSite = async (g, W = 512, H = 384) => {
    const n = 2 ** LPZ;
    const x0 = Math.floor(tileX(g.west, n)), x1 = Math.floor(tileX(g.east, n));
    const y0 = Math.floor(tileY(g.north, n)), y1 = Math.floor(tileY(g.south, n));
    const tiles = new Map(), jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(D.lpTile(x, y).then((t) => tiles.set(`${x}_${y}`, t)));
    await Promise.all(jobs);
    const dLat = (g.north - g.south) / (H - 1), dLon = (g.east - g.west) / (W - 1);
    const colX = [], rowY = [];
    for (let i = 0; i < W; i++) for (const o of [-0.25, 0.25]) { const xf = tileX(g.west + (i + o) * dLon, n), tx = Math.floor(xf); colX.push([tx, xf - tx]); }
    for (let j = 0; j < H; j++) for (const o of [-0.25, 0.25]) { const yf = tileY(g.south + (j + o) * dLat, n), ty = Math.floor(yf); rowY.push([ty, yf - ty]); }
    const S = AA.Sky.SITE_STARS, data = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        let acc = 0, cnt = 0;
        for (let a = 0; a < 2; a++) {
          const [tx, fx] = colX[i * 2 + a];
          for (let b = 0; b < 2; b++) {
            const [ty, fy] = rowY[j * 2 + b];
            const t = tiles.get(`${tx}_${ty}`);
            if (!t) continue;
            acc += S[t.z[Math.min(t.h - 1, Math.floor(fy * t.h)) * t.w + Math.min(t.w - 1, Math.floor(fx * t.w))]];
            cnt++;
          }
        }
        data[j * W + i] = Math.round((cnt ? acc / cnt : 0.55) * 255);
      }
    }
    D.site = { data, W, H, west: g.west, south: g.south, east: g.east, north: g.north, key: g.key };
    AA.emit('site', D.site);
    return D.site;
  };
  D.siteAt = (lat, lon) => {
    const s = D.site;
    if (!s) return null;
    const fx = ((lon - s.west) / (s.east - s.west)) * (s.W - 1), fy = ((lat - s.south) / (s.north - s.south)) * (s.H - 1);
    if (!(fx >= 0 && fy >= 0 && fx <= s.W - 1 && fy <= s.H - 1)) return null;
    return AA.Sky.siteAdj(s.data[Math.round(fy) * s.W + Math.round(fx)] / 255);
  };

  // ---------- OpenStreetMap places to stand (Photon by Komoot) ----------
  D.KINDS = {
    viewpoint: { label: 'Viewpoint', icon: 'binoculars', w: 1.0 },
    beach: { label: 'Beach', icon: 'wave', w: 1.0 },
    boat: { label: 'Boat launch', icon: 'boat', w: 0.98 },
    observatory: { label: 'Observatory', icon: 'telescope', w: 1.08 },
    park: { label: 'Park', icon: 'tree', w: 0.95 },
    camp: { label: 'Campground', icon: 'tent', w: 0.9 },
    picnic: { label: 'Picnic area', icon: 'tree', w: 0.9 },
    trailhead: { label: 'Trailhead', icon: 'sign', w: 0.86 },
    area: { label: 'Dark area', icon: 'moon', w: 0.72 },
    place: { label: 'Place', icon: 'pin', w: 0.8 },
  };
  // Parks and reserves are left out: a whole national forest comes back as one point in the middle of the woods
  const PHOTON_TAGS = ['tourism:viewpoint', 'tourism:camp_site', 'leisure:slipway', 'natural:beach', 'highway:trailhead', 'tourism:picnic_site', 'man_made:observatory'];
  const kindOf = (k, v) => (k === 'man_made' ? 'observatory' : v === 'viewpoint' ? 'viewpoint' : v === 'camp_site' ? 'camp' : v === 'slipway' ? 'boat'
    : v === 'beach' ? 'beach' : v === 'trailhead' ? 'trailhead' : v === 'picnic_site' ? 'picnic' : v === 'park' || v === 'nature_reserve' ? 'park' : 'place');
  // Real places (viewpoints, campgrounds, boat launches, beaches, parks, trailheads) nearest to a point
  D.nearbyPlaces = async (lat, lon, radiusKm = 12) => {
    const key = `near2:${lat.toFixed(2)},${lon.toFixed(2)}:${radiusKm}`;
    const c = U.cacheGet(key, 7 * U.DAY);
    if (c) return c;
    const url = `${D.URL.photon}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&limit=15&radius=${radiusKm}&lang=en&${PHOTON_TAGS.map((t) => 'osm_tag=' + encodeURIComponent(t)).join('&')}`;
    const j = await U.retry(() => U.fetchJSON(url, { timeout: 15000 }), 2, 1200);
    const out = (j.features || []).map((f) => {
      const p = f.properties || {}, xy = f.geometry && f.geometry.coordinates;
      if (!xy) return null;
      return { id: `${String(p.osm_type || 'x').toLowerCase()}${p.osm_id}`, lat: +(+xy[1]).toFixed(5), lon: +(+xy[0]).toFixed(5), name: p.name || null, kind: kindOf(p.osm_key, p.osm_value), area: p.city || p.county || null };
    }).filter(Boolean);
    U.cachePut(key, out);
    return out;
  };

  // ---------- Terrain: elevation and the view north ----------
  D.elevations = async (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i += 100) {
      const chunk = pts.slice(i, i + 100);
      const url = `${D.URL.elev}?latitude=${chunk.map((p) => p.lat.toFixed(4)).join(',')}&longitude=${chunk.map((p) => p.lon.toFixed(4)).join(',')}`;
      const j = await U.retry(() => U.fetchJSON(url));
      out.push(...(j.elevation || []));
    }
    return out;
  };
  // 3 directions x 6 distances = 19 elevation lookups per spot (each counts against Open-Meteo's free quota)
  D.HZ_DISTS = [0.8, 1.5, 3, 5, 9, 15];
  // Highest terrain angle in the aurora direction (terrain only; trees and buildings are not in the model)
  D.horizon = async (spots) => {
    const pts = [];
    const azs = spots.map((s) => (s.lat >= 0 ? [330, 0, 30] : [150, 180, 210]));
    spots.forEach((s, k) => {
      pts.push({ lat: s.lat, lon: s.lon });
      for (const az of azs[k]) for (const d of D.HZ_DISTS) pts.push(U.dest(s.lat, s.lon, az, d));
    });
    const elev = await D.elevations(pts);
    const per = 1 + 3 * D.HZ_DISTS.length;
    return spots.map((s, k) => {
      const o = k * per, base = elev[o] ?? 0, eye = base + 1.7;
      const prof = azs[k].map((az, a) => {
        let mx = -5;
        D.HZ_DISTS.forEach((d, di) => {
          const h = elev[o + 1 + a * D.HZ_DISTS.length + di];
          if (h == null) return;
          const drop = (0.87 * d * d * 1000) / (2 * U.R); // earth curve with normal refraction, metres
          const ang = U.deg(Math.atan((h - drop - eye) / (d * 1000)));
          if (ang > mx) mx = ang;
        });
        return { az, ang: mx };
      });
      const mean = prof.reduce((sum, p) => sum + p.ang, 0) / prof.length;
      return { elev: base, prof, block: Math.max(0, mean), worst: Math.max(0, ...prof.map((p) => p.ang)) };
    });
  };

  // ---------- Drive times (OSRM, on OpenStreetMap roads) ----------
  // One request gives the drive from one place to many. Each answer is { min, km, snap }: minutes and road
  // km with no traffic, how far the point sits from the nearest road (km), and where on that road the
  // drive ends ([lat, lon]). min is null when no road route exists. A point nobody has asked about yet reads as undefined.
  const driveMem = new Map();
  const dkey = (a, b) => `drv:${a.lat.toFixed(3)},${a.lon.toFixed(3)}>${b.lat.toFixed(3)},${b.lon.toFixed(3)}`;
  D.driveCached = (from, p) => {
    const k = dkey(from, p);
    let hit = driveMem.get(k);
    if (hit === undefined) { const c = U.cacheGet(k, 30 * U.DAY); if (c) { hit = c; driveMem.set(k, c); } }
    return hit;
  };
  D.driveTimes = async (from, pts, { persist = false } = {}) => {
    const out = pts.map((p) => D.driveCached(from, p));
    const need = [];
    out.forEach((v, i) => { if (v === undefined) need.push(i); });
    const ll = (p) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`;
    for (let s = 0; s < need.length; s += 40) {
      const idx = need.slice(s, s + 40);
      const url = `${D.URL.route}${[from, ...idx.map((i) => pts[i])].map(ll).join(';')}?sources=0&annotations=duration,distance`;
      const j = await U.retry(() => U.fetchJSON(url, { timeout: 20000 }), 2, 1500);
      if (!j || j.code !== 'Ok' || !j.durations) throw new Error('No routing answer');
      idx.forEach((i, n) => {
        const sec = j.durations[0][n + 1], m = j.distances ? j.distances[0][n + 1] : null, dst = j.destinations && j.destinations[n + 1];
        const v = { min: sec == null ? null : sec / 60, km: m == null ? null : m / 1000, snap: dst && dst.distance != null ? dst.distance / 1000 : 0, at: dst && dst.location ? [+dst.location[1].toFixed(5), +dst.location[0].toFixed(5)] : null };
        out[i] = v;
        driveMem.set(dkey(from, pts[i]), v);
        if (persist) U.cachePut(dkey(from, pts[i]), v);
      });
    }
    return out;
  };

  // ---------- Place search ----------
  // Town search: Open-Meteo first (clean town results), Photon when it fails or finds nothing
  D.geocode = async (q) => {
    const lang = (navigator.language || 'en').slice(0, 2);
    try {
      const j = await U.fetchJSON(`${D.URL.geo}?name=${encodeURIComponent(q)}&count=7&language=${lang}&format=json`, { timeout: 10000 });
      const r = (j.results || []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, admin: [x.admin1, x.country_code].filter(Boolean).join(', ') }));
      if (r.length) return r;
    } catch (e) { console.warn('Open-Meteo place search failed, trying Photon', e); }
    const j = await U.fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lang=en&osm_tag=place`, { timeout: 12000 });
    return (j.features || []).map((f) => {
      const p = f.properties || {}, xy = f.geometry && f.geometry.coordinates;
      return xy && p.name ? { name: p.name, lat: +xy[1], lon: +xy[0], admin: [p.state, String(p.countrycode || '').toUpperCase()].filter(Boolean).join(', ') } : null;
    }).filter(Boolean);
  };
  D.placeName = async (lat, lon) => {
    try {
      const j = await U.fetchJSON(`${D.URL.reverse}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&localityLanguage=en`, { timeout: 8000 });
      return j.locality || j.city || j.principalSubdivision || null;
    } catch (e) { return null; }
  };
})(window.AA);
