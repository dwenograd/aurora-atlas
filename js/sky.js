/* Aurora Atlas: sky models (aurora reach, darkness, moon, light pollution, scores) */
'use strict';
(function (AA) {
  const U = AA.U;
  const Sky = (AA.Sky = {});

  // ---------- Geomagnetic latitude ----------
  // Centered-dipole geomagnetic north pole (IGRF, epoch 2025).
  Sky.POLE = { lat: 80.8, lon: -72.7 };
  Sky.magLat = (lat, lon) => {
    const p = U.rad(Sky.POLE.lat), l0 = U.rad(Sky.POLE.lon);
    const f = U.rad(lat), l = U.rad(lon);
    const s = Math.sin(f) * Math.sin(p) + Math.cos(f) * Math.cos(p) * Math.cos(l - l0);
    return U.deg(Math.asin(U.clamp(s, -1, 1)));
  };

  // ---------- How far south the aurora reaches ----------
  // NOAA K-index warnings put the Kp 4 impact area poleward of 65° and Kp 5 poleward of 60° geomagnetic
  // latitude. NOAA's G-scale says aurora has been seen as low as ~55° at G2 (Kp 6), ~50° at G3 (Kp 7),
  // ~45° at G4 (Kp 8) and ~40° at G5 (Kp 9). That is a straight line: 85 - 5 x Kp.
  Sky.REACH = [[4, 65], [5, 60], [6, 55], [7, 50], [8, 45], [9, 40]];
  Sky.reachLat = (kp) => U.clamp(85 - 5 * kp, 40, 72);
  Sky.kpNeeded = (magLat) => (85 - Math.abs(magLat)) / 5;
  Sky.kpLevel = (kp, need) => {
    const m = kp - need;
    if (m >= 1) return { s: 1, label: 'Strong display likely', short: 'Strong', tone: 'great' };
    if (m >= 0) return { s: 0.75, label: 'Visible low in the north', short: 'Likely', tone: 'good' };
    if (m >= -0.67) return { s: 0.45, label: 'Possible, camera first', short: 'Possible', tone: 'maybe' };
    if (m >= -1.34) return { s: 0.18, label: 'Long shot', short: 'Long shot', tone: 'low' };
    return { s: 0.03, label: 'Unlikely', short: 'Unlikely', tone: 'none' };
  };

  // ---------- Kp bands and NOAA G-scale ----------
  Sky.G_COLORS = [null, '#ffd166', '#ffa94d', '#ff6b6b', '#ff4fa3', '#b46bff'];
  Sky.gScale = (kp) => {
    if (kp == null) return 0;
    if (kp >= 8.99) return 5;
    const r = Math.round(kp);
    return r >= 8 ? 4 : r >= 5 ? r - 4 : 0;
  };
  Sky.kpBand = (kp) => {
    const g = Sky.gScale(kp);
    if (g) return { name: `G${g} ${['', 'minor', 'moderate', 'strong', 'severe', 'extreme'][g]} storm`, short: `G${g}`, color: Sky.G_COLORS[g] };
    if (kp >= 4) return { name: 'Active', short: 'Active', color: '#d8e06a' };
    if (kp >= 3) return { name: 'Unsettled', short: 'Unsettled', color: '#7fc8b4' };
    return { name: 'Quiet', short: 'Quiet', color: '#5b8fa0' };
  };
  Sky.kpColor = (kp) => Sky.kpBand(kp).color;

  // ---------- NOAA OVATION aurora grid ----------
  Sky.ov = null; // { grid: Uint8Array(360 * 181) of % chance overhead, obs, fc }
  Sky.ovAt = (lat, lon) => {
    const ov = Sky.ov;
    if (!ov) return null;
    const g = ov.grid;
    const x = ((lon % 360) + 360) % 360, y = U.clamp(lat, -90, 90) + 90;
    const x0 = Math.floor(x) % 360, y0 = Math.min(180, Math.floor(y));
    const x1 = (x0 + 1) % 360, y1 = Math.min(180, y0 + 1);
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const v = (xx, yy) => g[yy * 360 + xx];
    return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
  };
  // Aurora glows from ~100 to 300 km up, so it can be seen low on the horizon from far away.
  // For each grid cell we work out how high a 150 km aurora would stand above the observer's horizon
  // and weight NOAA's chance by that: nothing below 3°, full weight from 15° up.
  Sky.AURORA_KM = 150;
  Sky.ovInView = (lat, lon) => {
    const ov = Sky.ov;
    if (!ov) return null;
    const k = U.R / (U.R + Sky.AURORA_KM);
    const maxTh = Math.acos(k);
    const span = U.deg(maxTh) + 1;
    const g = ov.grid;
    let best = 0, bestElev = null, edgeElev = null;
    const la0 = Math.max(-90, Math.floor(lat - span)), la1 = Math.min(90, Math.ceil(lat + span));
    for (let la = la0; la <= la1; la++) {
      const c = Math.max(0.05, Math.min(Math.cos(U.rad(lat)), Math.cos(U.rad(la)) + 0.01));
      const dLon = Math.min(180, span / c);
      for (let lo = Math.floor(lon - dLon); lo <= Math.ceil(lon + dLon); lo++) {
        const p = g[(la + 90) * 360 + (((lo % 360) + 360) % 360)];
        if (p < 1) continue;
        const th = U.centralAngle(lat, lon, la, lo);
        if (th > maxTh) continue;
        const e = th < 1e-6 ? 90 : U.deg(Math.atan((Math.cos(th) - k) / Math.sin(th)));
        const w = U.clamp((e - 3) / 12, 0, 1);
        const v = p * w;
        if (v > best) { best = v; bestElev = e; }
        if (p >= 10 && e > 0 && (edgeElev == null || e > edgeElev)) edgeElev = e;
      }
    }
    return { overhead: Sky.ovAt(lat, lon), inView: best, elev: bestElev, edgeElev };
  };

  // Line of constant magnetic latitude (northern branch), for drawing the aurora reach on the map
  Sky.magContour = (L) => {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      let prev = Sky.magLat(-40, lon);
      for (let lat = -39.5; lat <= 89.5; lat += 0.5) {
        const m = Sky.magLat(lat, lon);
        if (prev < L && m >= L) { pts.push([lat - 0.5 + (0.5 * (L - prev)) / (m - prev), lon]); break; }
        prev = m;
      }
    }
    return pts;
  };

  // ---------- Sun and Moon (SunCalc) ----------
  const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  const ms = (d) => (valid(d) ? d.getTime() : null);
  Sky.sunAlt = (t, lat, lon) => U.deg(SunCalc.getPosition(new Date(t), lat, lon).altitude);
  Sky.moonPos = (t, lat, lon) => { const m = SunCalc.getMoonPosition(new Date(t), lat, lon); return { alt: U.deg(m.altitude), az: (U.deg(m.azimuth) + 180) % 360 }; };
  Sky.moonIllum = (t) => SunCalc.getMoonIllumination(new Date(t));
  Sky.phaseName = (p) => (p < 0.03 || p > 0.97 ? 'New moon' : p < 0.22 ? 'Waxing crescent' : p < 0.28 ? 'First quarter' : p < 0.47 ? 'Waxing gibbous' : p < 0.53 ? 'Full moon' : p < 0.72 ? 'Waning gibbous' : p < 0.78 ? 'Last quarter' : 'Waning crescent');
  Sky.moonSVG = (phase, cls = 'moon-ic') => {
    const r = 10, f = Math.cos(phase * 2 * Math.PI), rx = (Math.abs(f) * r).toFixed(2), waxing = phase < 0.5;
    const so = waxing ? 1 : 0, si = (f > 0) === waxing ? 0 : 1;
    return `<svg class="${cls}" viewBox="-1 -1 22 22" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#1b2337" stroke="rgba(255,255,255,.2)" stroke-width=".8"/><path d="M10 0A10 10 0 0 ${so} 10 20A${rx} 10 0 0 ${si} 10 0Z" fill="#f2e8cf"/></svg>`;
  };

  // The night that is coming (or that we are in): sunset to sunrise, with twilight edges.
  Sky.nightWindow = (lat, lon, now = Date.now()) => {
    const d = new Date(now);
    const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).getTime();
    const today = SunCalc.getTimes(new Date(noon), lat, lon);
    let eve = noon;
    if (valid(today.sunrise) && now < today.sunrise.getTime()) eve = noon - U.DAY;
    const e = SunCalc.getTimes(new Date(eve), lat, lon);
    const m = SunCalc.getTimes(new Date(eve + U.DAY), lat, lon);
    const out = {
      sunset: ms(e.sunset), nautDusk: ms(e.nauticalDusk), dusk: ms(e.night),
      dawn: ms(m.nightEnd), nautDawn: ms(m.nauticalDawn), sunrise: ms(m.sunrise),
    };
    // Polar day or night: fall back to a fixed evening window
    if (out.sunset == null || out.sunrise == null) { out.sunset = eve + 6 * U.HOUR; out.sunrise = eve + 19 * U.HOUR; out.polar = true; }
    return out;
  };

  Sky.moonNight = (lat, lon, from, to) => {
    const step = 10 * U.MIN;
    const segs = [];
    let up = null, maxAlt = -90;
    for (let t = from; t <= to; t += step) {
      const a = Sky.moonPos(t, lat, lon).alt;
      if (a > maxAlt) maxAlt = a;
      if (a > 0 && up == null) up = t;
      if (a <= 0 && up != null) { segs.push([up, t]); up = null; }
    }
    if (up != null) segs.push([up, to]);
    return { segs, maxAlt };
  };

  // ---------- Light pollution: David Lorenz's 2025 atlas zones ----------
  Sky.LP = [
    { id: '0', rgb: [0, 0, 0], sqm: '22.00–21.99', lpi: '< 0.01', bortle: 1 },
    { id: '1a', rgb: [34, 34, 34], sqm: '21.99–21.93', lpi: '0.01–0.06', bortle: 2 },
    { id: '1b', rgb: [66, 66, 66], sqm: '21.93–21.89', lpi: '0.06–0.11', bortle: 2 },
    { id: '2a', rgb: [20, 47, 114], sqm: '21.89–21.81', lpi: '0.11–0.19', bortle: 3 },
    { id: '2b', rgb: [33, 84, 216], sqm: '21.81–21.69', lpi: '0.19–0.33', bortle: 3 },
    { id: '3a', rgb: [15, 87, 20], sqm: '21.69–21.51', lpi: '0.33–0.58', bortle: 4 },
    { id: '3b', rgb: [31, 161, 42], sqm: '21.51–21.25', lpi: '0.58–1.00', bortle: 4 },
    { id: '4a', rgb: [110, 100, 30], sqm: '21.25–20.91', lpi: '1.00–1.73', bortle: 5 },
    { id: '4b', rgb: [184, 166, 37], sqm: '20.91–20.49', lpi: '1.73–3.00', bortle: 5 },
    { id: '5a', rgb: [191, 100, 30], sqm: '20.49–20.02', lpi: '3.00–5.20', bortle: 6 },
    { id: '5b', rgb: [253, 150, 80], sqm: '20.02–19.50', lpi: '5.20–9.00', bortle: 6 },
    { id: '6a', rgb: [251, 90, 73], sqm: '19.50–18.95', lpi: '9.0–15.6', bortle: 7 },
    { id: '6b', rgb: [251, 153, 138], sqm: '18.95–18.38', lpi: '15.6–27.0', bortle: 7 },
    { id: '7a', rgb: [160, 160, 160], sqm: '18.38–17.80', lpi: '27–47', bortle: 8 },
    { id: '7b', rgb: [242, 242, 242], sqm: '< 17.80', lpi: '> 47', bortle: 9 },
  ];
  Sky.SKY_WORDS = {
    1: 'Pristine. The Milky Way casts shadows.',
    2: 'Truly dark. Milky Way detailed to the horizon.',
    3: 'Rural. Milky Way detailed overhead, faint glow low.',
    4: 'Rural edge. Milky Way visible, washed out low.',
    5: 'Suburban. Milky Way faint, only high up.',
    6: 'Bright suburban. Milky Way barely there.',
    7: 'Urban edge. No Milky Way, bright stars only.',
    8: 'City. Only the brightest stars.',
    9: 'Inner city. A handful of stars.',
  };
  const lpLookup = new Map(Sky.LP.map((z, i) => [(z.rgb[0] << 16) | (z.rgb[1] << 8) | z.rgb[2], i]));
  lpLookup.set(0xffffff, 14);
  Sky.lpIndex = (r, g, b) => {
    const hit = lpLookup.get((r << 16) | (g << 8) | b);
    if (hit != null) return hit;
    let best = 0, bd = Infinity;
    for (let i = 0; i < Sky.LP.length; i++) {
      const c = Sky.LP[i].rgb;
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  Sky.lpColor = (i) => (i == null ? '#3a4458' : `rgb(${Sky.LP[i].rgb.join(',')})`);

  // ---------- Scoring ----------
  // How much a site's light pollution costs you: stars suffer a lot, bright aurora much less.
  Sky.SITE_STARS = [1, 0.97, 0.94, 0.9, 0.85, 0.77, 0.67, 0.53, 0.41, 0.29, 0.2, 0.12, 0.07, 0.04, 0.02];
  Sky.siteFactor = (zone, mode) => {
    if (zone == null) return mode === 'stars' ? 0.55 : 0.8;
    const s = Sky.SITE_STARS[zone];
    return mode === 'stars' ? s : 1 - 0.45 * (1 - s);
  };
  Sky.darkFactor = (sunAlt, mode) => {
    if (mode === 'stars') {
      if (sunAlt <= -18) return 1;
      if (sunAlt <= -12) return U.lerp(0.35, 1, (-12 - sunAlt) / 6);
      if (sunAlt <= -6) return U.lerp(0, 0.35, (-6 - sunAlt) / 6);
      return 0;
    }
    if (sunAlt <= -12) return 1;
    if (sunAlt <= -6) return U.lerp(0.25, 1, (-6 - sunAlt) / 6);
    if (sunAlt <= -3) return U.lerp(0, 0.25, (-3 - sunAlt) / 3);
    return 0;
  };
  Sky.moonFactor = (moonAlt, frac, mode) => {
    const m = frac * U.smooth(-1, 25, moonAlt);
    return mode === 'stars' ? 1 - 0.85 * m : 1 - 0.35 * m;
  };
  // Thin high cloud still lets a lot through, so cloud cover from high cloud alone counts 40% less.
  Sky.clarity = (cc, low, mid, high) => {
    if (cc == null) return null;
    const lowMid = Math.max(low || 0, mid || 0);
    const highOnly = Math.max(0, Math.min(high || 0, cc - lowMid));
    return U.clamp(1 - (cc - 0.4 * highOnly) / 100, 0, 1);
  };

  Sky.auroraFactor = (t, view, need) => {
    const D = AA.D;
    const kp = D.kpAt(t);
    const lvl = kp == null ? null : Sky.kpLevel(kp, need);
    let s = lvl ? lvl.s : 0;
    if (D.ov && view && Math.abs(t - D.ov.fc) < 1.5 * U.HOUR) s = Math.max(s, U.clamp(view.inView / 30, 0, 1));
    return { kp, lvl, s };
  };

  // Best sky: the two map scores, same formulas as the map shader.
  //   Stargazing (gold):     clear sky x dark sky x night darkness and moonlight
  //   Aurora viewing (green): the same, gentler on city lights and moon, x how far south the forecast Kp reaches
  Sky.reachFactor = (kp, magLat) => (kp == null ? 0.03 : 0.03 + 0.97 * U.smooth(-1.5, 1.0, kp - Sky.kpNeeded(magLat)));
  Sky.bestLabel = (s) => (s >= 0.7 ? 'Golden' : s >= 0.5 ? 'Good' : s >= 0.3 ? 'Fair' : 'Poor');
  // lines up with Sky.kpLevel under a clear, dark sky
  Sky.auroraLabel = (s) => (s >= 0.88 ? 'Strong' : s >= 0.6 ? 'Likely' : s >= 0.25 ? 'Possible' : s >= 0.08 ? 'Long shot' : 'Unlikely');
  // Both scores for one spot, each with what holds it back.
  // flat: a planned night. The map then leaves out the hour and the moon (the same everywhere), so this does too.
  Sky.bestScores = ({ lat, lon, t, cc, site, kp, flat = false }) => {
    const clar = cc == null ? 0.5 : U.clamp(1 - cc / 100, 0, 1);
    const s = site == null ? 0.55 : site;
    const sun = flat ? -30 : Sky.sunAlt(t, lat, lon), mp = Sky.moonPos(t, lat, lon), mi = Sky.moonIllum(t);
    const dS = Sky.darkFactor(sun, 'stars'), mS = flat ? 1 : Sky.moonFactor(mp.alt, mi.fraction, 'stars');
    const dA = Sky.darkFactor(sun, 'aurora'), mA = flat ? 1 : Sky.moonFactor(mp.alt, mi.fraction, 'aurora');
    const reach = Sky.reachFactor(kp, Sky.magLat(lat, lon));
    // stargazing: name the weakest of darkness, cloud, city lights and moon
    const low = Math.min(dS, clar, s, mS);
    let why = 'Clear and dark';
    if (low < 0.75) {
      if (low === dS) why = sun > -6 ? 'Daylight at that hour' : 'Twilight at that hour';
      else if (low === clar) why = clar < 0.4 ? 'Mostly cloudy' : 'Some cloud';
      else if (low === s) why = s < 0.3 ? 'City lights wash out the stars' : 'Town lights brighten the sky';
      else why = 'Bright moon';
    }
    // aurora: besides the Kp, only daylight or cloud can spoil it
    const whyA = dA < 0.3 ? (sun > -3 ? 'Daylight at that hour' : 'Twilight at that hour') : clar < 0.5 ? 'Cloud in the way' : null;
    return { reach, why, whyA, stars: clar * dS * mS * s, aurora: reach * clar * dA * mA * (1 - 0.45 * (1 - s)) };
  };

  // Hour-by-hour conditions for a place
  Sky.series = ({ lat, lon, wx, zone, from, to, view }) => {
    const need = Sky.kpNeeded(Sky.magLat(lat, lon));
    const rows = [];
    const siteA = Sky.siteFactor(zone, 'aurora'), siteS = Sky.siteFactor(zone, 'stars');
    for (let t = U.floorHour(from); t <= to; t += U.HOUR) {
      const mid = t + U.HOUR / 2;
      const sunAlt = Sky.sunAlt(mid, lat, lon);
      const mp = Sky.moonPos(mid, lat, lon);
      const mi = Sky.moonIllum(mid);
      const w = wx ? AA.D.wxAt(wx, t) : null;
      const cl = w && w.cc != null ? Sky.clarity(w.cc, w.low, w.mid, w.high) : null;
      const a = Sky.auroraFactor(mid, view, need);
      const darkA = Sky.darkFactor(sunAlt, 'aurora'), darkS = Sky.darkFactor(sunAlt, 'stars');
      const clar = cl == null ? 0.5 : cl;
      rows.push({
        t, sunAlt, moonAlt: mp.alt, moonFrac: mi.fraction, moonPhase: mi.phase, wx: w, clarity: cl,
        kp: a.kp, lvl: a.lvl, aur: a.s, darkA, darkS,
        scoreA: a.s * clar * darkA * Sky.moonFactor(mp.alt, mi.fraction, 'aurora') * siteA,
        scoreS: clar * darkS * Sky.moonFactor(mp.alt, mi.fraction, 'stars') * siteS,
      });
    }
    return { rows, need };
  };

  Sky.summarize = (rows, mode) => {
    const key = mode === 'stars' ? 'scoreS' : 'scoreA';
    const dk = mode === 'stars' ? 'darkS' : 'darkA';
    const dark = rows.filter((r) => r[dk] > 0.3);
    if (!dark.length) return { none: true, mode };
    let best = dark[0];
    for (const r of dark) if (r[key] > best[key]) best = r;
    const thr = Math.max(best[key] * 0.7, 0.06);
    const i0 = rows.indexOf(best);
    let a = i0, b = i0;
    while (a > 0 && rows[a - 1][key] >= thr && rows[a - 1][dk] > 0.3) a--;
    while (b < rows.length - 1 && rows[b + 1][key] >= thr && rows[b + 1][dk] > 0.3) b++;
    const known = dark.filter((r) => r.clarity != null);
    let clearest = null;
    for (const r of known) if (!clearest || r.clarity > clearest.clarity) clearest = r;
    const kps = dark.map((r) => r.kp).filter((k) => k != null);
    return {
      mode, best, score: best[key], start: rows[a].t, end: rows[b].t + U.HOUR,
      darkHours: dark.length,
      clearHours: known.filter((r) => r.clarity >= 0.6).length,
      meanCloud: known.length ? known.reduce((s, r) => s + r.wx.cc, 0) / known.length : null,
      clearest, weatherKnown: known.length > 0,
      kpMax: kps.length ? Math.max(...kps) : null,
      aurMax: Math.max(...dark.map((r) => r.aur)),
    };
  };
})(window.AA);
