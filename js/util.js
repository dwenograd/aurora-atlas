/* Aurora Atlas: shared helpers */
'use strict';
window.AA = window.AA || {};

(function (AA) {
  const U = (AA.U = {});

  // ---------- DOM ----------
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  U.el = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat()) {
      if (k == null || k === false) continue;
      e.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return e;
  };

  // ---------- Math ----------
  U.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (e0, e1, x) => { const t = U.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  U.rad = (d) => (d * Math.PI) / 180;
  U.deg = (r) => (r * 180) / Math.PI;
  U.R = 6371; // km
  U.centralAngle = (lat1, lon1, lat2, lon2) => {
    const p1 = U.rad(lat1), p2 = U.rad(lat2), dl = U.rad(lon2 - lon1);
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  };
  U.distKm = (a, b) => U.R * U.centralAngle(a.lat, a.lon, b.lat, b.lon);
  U.dest = (lat, lon, brgDeg, km) => {
    const d = km / U.R, b = U.rad(brgDeg), p1 = U.rad(lat), l1 = U.rad(lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: U.deg(p2), lon: ((U.deg(l2) + 540) % 360) - 180 };
  };
  U.bearing = (a, b) => {
    const p1 = U.rad(a.lat), p2 = U.rad(b.lat), dl = U.rad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (U.deg(Math.atan2(y, x)) + 360) % 360;
  };
  U.compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
  U.mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + U.rad(U.clamp(lat, -85.05, 85.05)) / 2));
  U.wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

  // ---------- Timing ----------
  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.MIN = 60e3;
  U.HOUR = 3600e3;
  U.DAY = 86400e3;
  U.floorHour = (t) => Math.floor(t / U.HOUR) * U.HOUR;

  // ---------- Storage (never throws) ----------
  U.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  // Small TTL cache in localStorage for API responses
  U.cacheGet = (key, maxAgeMs) => {
    const v = U.store.get('aa.c.' + key, null);
    if (!v || typeof v.t !== 'number') return null;
    if (Date.now() - v.t > maxAgeMs) return null;
    return v.d;
  };
  U.cachePut = (key, data) => {
    if (U.store.set('aa.c.' + key, { t: Date.now(), d: data })) return;
    // Storage full: drop old cache entries and retry once
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('aa.c.')) keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
      U.store.set('aa.c.' + key, { t: Date.now(), d: data });
    } catch (e) { /* ignore */ }
  };

  // ---------- Network ----------
  U.fetchJSON = async (url, opts = {}) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 25000);
    try {
      const r = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers: opts.headers, signal: ctl.signal, cache: opts.cache || 'default' });
      if (!r.ok) { const err = new Error(`HTTP ${r.status}`); err.status = r.status; throw err; }
      return opts.text ? await r.text() : await r.json();
    } finally {
      clearTimeout(timer);
    }
  };
  U.retry = async (fn, tries = 2, delay = 1500) => {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(i); } catch (e) {
        last = e;
        // Rate limited: back off much longer before the next try
        if (i < tries - 1) await U.sleep(e && e.status === 429 ? 12000 * (i + 1) : delay * (i + 1));
      }
    }
    throw last;
  };

  // ---------- Formatting ----------
  U.imperial = () => (AA.state && AA.state.settings && AA.state.settings.units) !== 'metric';
  U.fmtDist = (km) => {
    if (U.imperial()) { const mi = km * 0.621371; return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`; }
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  };
  U.fmtElev = (m) => (U.imperial() ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`);
  U.tempUnit = () => (U.imperial() ? '°F' : '°C');
  U.windUnit = () => (U.imperial() ? 'mph' : 'km/h');
  U.fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  U.fmtHour = (t) => {
    // "11 PM" style, compact
    const d = new Date(t);
    const s = d.toLocaleTimeString([], { hour: 'numeric' });
    return s.replace(/^0/, '');
  };
  U.fmtHourTiny = (t) => {
    const d = new Date(t);
    const h = d.getHours();
    const uses12 = /[AP]M/i.test(new Date(2020, 0, 1, 13).toLocaleTimeString([], { hour: 'numeric' }));
    if (!uses12) return String(h).padStart(2, '0');
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? 'a' : 'p'}`;
  };
  U.fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'short' });
  U.fmtDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  U.fmtDateLong = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  U.fmtDayTime = (t) => `${U.fmtDay(t)} ${U.fmtClock(t)}`;
  U.isSameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
  U.relDay = (t, now = Date.now()) => {
    if (U.isSameDay(t, now)) return 'Today';
    if (U.isSameDay(t, now + U.DAY)) return 'Tomorrow';
    if (U.isSameDay(t, now - U.DAY)) return 'Yesterday';
    return U.fmtDay(t);
  };
  U.ago = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  };
  U.fmtCoord = (lat, lon) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
  U.pct = (x) => (x == null || Number.isNaN(x) ? '–' : `${Math.round(x)}%`);

  // ---------- Encoding (share links) ----------
  U.b64e = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  U.b64d = (s) => {
    const pad = '==='.slice((s.length + 3) % 4);
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };
  U.uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-5);

  // ---------- Canvas ----------
  U.fitCanvas = (canvas, maxDpr = 2) => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height, dpr };
  };
  U.roundRect = (ctx, x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // Tiny event bus
  const handlers = {};
  AA.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  AA.emit = (name, payload) => { (handlers[name] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); };
})(window.AA);
