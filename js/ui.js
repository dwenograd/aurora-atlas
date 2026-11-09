/* Aurora Atlas: interface rendering */
'use strict';
(function (AA) {
  const U = AA.U, Sky = AA.Sky, D = AA.D;
  const $ = U.$, esc = U.esc, icon = U.icon;
  const UI = (AA.UI = {});
  const app = () => AA.app;
  const st = () => AA.state;

  // ---------- Toasts ----------
  UI.toast = (msg, { kind = '', timeout = 4200, action = null } = {}) => {
    const box = $('#toasts');
    const t = U.el('div', { class: `toast ${kind}`, role: 'status' }, U.el('span', { text: msg }));
    let done = false;
    const close = () => { if (done) return; done = true; t.classList.add('out'); setTimeout(() => t.remove(), 260); };
    if (action) t.append(U.el('button', { class: 'btn sm', type: 'button', text: action.label, onclick: () => { close(); action.run(); } }));
    box.append(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    return close;
  };

  // ---------- Modal ----------
  let modalClose = null;
  UI.modal = (title, body, { onClose } = {}) => {
    if (modalClose) modalClose(true);
    const m = $('#modal');
    $('#modalTitle').textContent = title;
    const b = $('#modalBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else b.append(body);
    m.hidden = false;
    const prevFocus = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close(silent) {
      m.hidden = true;
      document.removeEventListener('keydown', onKey);
      modalClose = null;
      if (onClose && !silent) onClose();
      if (prevFocus && prevFocus.focus && !silent) prevFocus.focus();
    }
    document.addEventListener('keydown', onKey);
    m.querySelectorAll('[data-close]').forEach((x) => { x.onclick = () => close(); });
    modalClose = close;
    setTimeout(() => { const f = b.querySelector('input:not([type=hidden]),select,textarea,button'); if (f) f.focus(); }, 60);
    return close;
  };
  UI.closeModal = () => { if (modalClose) modalClose(); };

  // ---------- Tabs ----------
  UI.activeTab = 'tonight';
  UI.setTab = (name) => {
    UI.activeTab = name;
    U.$$('.tab-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    U.$$('.tab-body').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
    UI.moveInk();
    U.store.set('aa.tab', name);
    if (name === 'tonight') UI.renderTonight();
    if (name === 'spots') UI.renderSpots();
    if (name === 'space') UI.renderSpace();
    if (name === 'log') UI.renderLog();
  };
  UI.moveInk = () => {
    const b = $(`.tab-btn[data-tab="${UI.activeTab}"]`), ink = $('#tabInk');
    if (!b || !ink) return;
    ink.style.width = `${Math.max(0, b.offsetWidth - 28)}px`;
    ink.style.transform = `translateX(${b.offsetLeft + 14}px)`;
  };

  // ---------- Live strip ----------
  UI.renderLive = () => {
    const kp = D.kpNow();
    if (kp != null) {
      const band = Sky.kpBand(kp);
      $('#liveKpVal').textContent = kp.toFixed(1);
      $('#liveKpTag').textContent = band.short;
      const dot = $('#liveKpDot');
      dot.style.background = band.color;
      dot.style.color = band.color;
    }
    const sw = D.swNow();
    const bz = $('#liveBz');
    if (sw.bz != null) {
      bz.textContent = `${sw.bz > 0 ? '+' : ''}${sw.bz.toFixed(1)} nT`;
      bz.style.color = sw.bz <= -5 ? 'var(--rose)' : sw.bz < 0 ? 'var(--amber)' : '';
    }
    if (sw.v != null) $('#liveWind').textContent = `${Math.round(sw.v)} km/s`;
    const home = st().home;
    if (home) {
      const v = Sky.ovInView(home.lat, home.lon);
      if (v) $('#liveAur').textContent = U.pct(v.inView);
      const info = app().placeInfo(app().homePlace());
      const w = info.wx ? D.wxAt(info.wx, Date.now()) : null;
      $('#liveCloud').textContent = w && w.cc != null ? `${Math.round(w.cc)}%` : '–';
    } else {
      $('#liveAur').textContent = '–';
      $('#liveCloud').textContent = '–';
    }
    UI.renderUpdated();
  };
  UI.renderUpdated = () => {
    const u = D.updated;
    const last = Math.max(u.ovation || 0, u.kp1m || 0, u.sw || 0);
    const failing = Object.keys(D.errors).length > 0;
    $('#liveUpdated').textContent = last ? `Live · updated ${U.ago(Date.now() - last)}` : failing ? 'NOAA unreachable, retrying' : 'Connecting…';
    const p = $('.live-upd .pulse');
    if (!p) return;
    p.classList.toggle('stale', !last || Date.now() - last > 20 * U.MIN);
    if (last && last !== UI._lastFresh) {
      // pulse only when new data has actually arrived
      UI._lastFresh = last;
      p.classList.remove('flash');
      void p.offsetWidth;
      p.classList.add('flash');
    }
  };

  // ---------- Tonight ----------
  function ensureVerdict() {
    const v = $('#verdict');
    if (v.dataset.ready) return v;
    const r = 50, r2 = 41;
    v._C = 2 * Math.PI * r;
    v._C2 = 2 * Math.PI * r2;
    v.innerHTML = `<div class="gauge"><svg viewBox="0 0 116 116" aria-hidden="true">
      <defs>
        <linearGradient id="ggA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#37d3c9"/><stop offset="1" stop-color="#7af7b7"/></linearGradient>
        <linearGradient id="ggS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ea6ff"/><stop offset="1" stop-color="#e6ecff"/></linearGradient>
      </defs>
      <circle class="g-track" cx="58" cy="58" r="${r}" fill="none" stroke-width="7"/>
      <circle class="g-val" id="gVal" cx="58" cy="58" r="${r}" fill="none" stroke="url(#ggA)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${v._C.toFixed(2)}" style="stroke-dashoffset:${v._C.toFixed(2)}"/>
      <circle class="g-track" cx="58" cy="58" r="${r2}" fill="none" stroke-width="2.5"/>
      <circle class="g-mini" id="gMini" cx="58" cy="58" r="${r2}" fill="none" stroke="rgba(165,140,255,.85)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${v._C2.toFixed(2)}" style="stroke-dashoffset:${v._C2.toFixed(2)}"/>
    </svg><div class="gauge-num"><b id="gNum">–</b><small id="gLbl">Tonight</small></div></div>
    <div class="verdict-text"><h3 id="vTitle"></h3><p id="vBody"></p><span class="window" id="vWindow" hidden></span><div class="other" id="vOther"></div></div>`;
    v.dataset.ready = '1';
    return v;
  }
  function setGauge(val, mini, mode) {
    const v = ensureVerdict();
    const g = $('#gVal'), m = $('#gMini');
    g.setAttribute('stroke', mode === 'stars' ? 'url(#ggS)' : 'url(#ggA)');
    m.setAttribute('stroke', mode === 'stars' ? 'rgba(98,240,166,.85)' : 'rgba(165,140,255,.85)');
    const apply = () => {
      g.style.strokeDashoffset = String(v._C * (1 - U.clamp(val || 0, 0, 1)));
      m.style.strokeDashoffset = String(v._C2 * (1 - U.clamp(mini || 0, 0, 1)));
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
    $('#gNum').textContent = val == null ? '–' : String(Math.round(val * 100));
    $('#gLbl').textContent = mode === 'stars' ? 'Stars' : 'Aurora';
  }

  const fmtW = (s) => `${U.fmtHour(s.start)}–${U.fmtHour(s.end)}`;
  function verdictCopy(sum, mode, need, info) {
    const wx = !!info.wx;
    if (sum.none) return { title: 'No real darkness tonight', body: 'The sun stays too close to the horizon here for a dark sky tonight.' };
    if (mode === 'aurora') {
      if (sum.kpMax == null) return { title: 'Loading the aurora forecast', body: 'Fetching NOAA data…' };
      const kpTxt = sum.kpMax.toFixed(1), needTxt = need > 9 ? 'an extreme storm' : `about Kp ${need.toFixed(1)}`;
      if (sum.aurMax < 0.1) {
        return {
          title: 'No aurora expected tonight',
          body: `Kp peaks near ${kpTxt}, and from here it takes ${needTxt}.${wx && sum.clearHours >= 2 ? ' Skies look clear, so it could still be a good night for stars.' : ''}`,
        };
      }
      if (wx && sum.clearHours === 0) {
        return { title: "Aurora possible, but it's cloudy", body: `Kp ${kpTxt} is forecast, with about ${Math.round(sum.meanCloud)}% cloud cover all night. Check the cloud map for clear skies within driving range.` };
      }
      const lvl = Sky.kpLevel(sum.kpMax, need);
      const titles = { great: 'Strong display likely', good: 'Watch the northern horizon', maybe: 'Worth a look with a camera', low: 'A long shot tonight', none: 'Unlikely tonight' };
      const cc = sum.best.wx && sum.best.wx.cc != null ? `, ${Math.round(sum.best.wx.cc)}% cloud` : '';
      return { title: titles[lvl.tone], body: `Kp ${kpTxt} forecast; you need ${needTxt} here.${wx ? ` Best ${fmtW(sum)}${cc}.` : ''}`, window: fmtW(sum) };
    }
    if (!wx) return { title: 'Loading the cloud forecast', body: 'Checking the clouds for tonight…' };
    const bright = info.zone != null && info.zone >= 9;
    const lpNote = bright ? ' Light pollution here washes out the Milky Way; the Spots tab finds darker skies.' : '';
    if (sum.clearHours === 0) {
      return { title: 'Cloudy night', body: `Clouds cover about ${Math.round(sum.meanCloud)}% of the sky all night.${sum.clearest && sum.clearest.wx ? ` Clearest around ${U.fmtHour(sum.clearest.t)} (${Math.round(sum.clearest.wx.cc)}%).` : ''}` };
    }
    const moonUp = sum.best.moonAlt > 5 && sum.best.moonFrac > 0.3;
    if (sum.score >= 0.55) return { title: 'Great night for stars', body: `Clear and dark ${fmtW(sum)}.${moonUp ? '' : ' The Moon stays out of the way.'}`, window: fmtW(sum) };
    if (moonUp) return { title: 'Clear, but the Moon is bright', body: `The Moon is ${Math.round(sum.best.moonFrac * 100)}% lit. Best ${fmtW(sum)}.${lpNote}`, window: fmtW(sum) };
    return { title: bright ? 'Clear, but the sky here is bright' : 'A fair night for stars', body: `Best ${fmtW(sum)}, ${Math.round(sum.best.wx ? sum.best.wx.cc : 0)}% cloud.${lpNote}`, window: fmtW(sum) };
  }

  const fact = (ic, k, v, s = '', cls = '', customIcon = '') =>
    `<div class="fact ${cls}"><div class="k">${customIcon || (ic ? icon(ic) : '')}${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const skel = (w = 90) => `<span class="skel" style="display:inline-block;width:${w}px;height:13px"></span>`;

  function moonText(mn, nw) {
    if (!mn.segs.length) return 'Below the horizon all night';
    const [a, b] = mn.segs[0];
    const startsUp = a <= nw.sunset + 10 * U.MIN, endsUp = b >= nw.sunrise - 10 * U.MIN;
    if (startsUp && endsUp) return 'Up all night';
    if (startsUp) return `Sets ${U.fmtClock(b)}`;
    return endsUp ? `Rises ${U.fmtClock(a)}` : `Up ${U.fmtClock(a)}–${U.fmtClock(b)}`;
  }
  function comfort(w) {
    if (!w || w.temp == null) return null;
    const imp = U.imperial();
    const spread = w.dew != null ? w.temp - w.dew : null;
    const close = spread != null && spread <= (imp ? 4 : 2.2);
    const freezing = w.temp <= (imp ? 32 : 0);
    let note = w.rh != null ? `Humidity ${Math.round(w.rh)}%` : '';
    if (close) note = freezing ? 'Frost likely on gear' : 'Dew likely, bring lens heaters';
    return { v: `${Math.round(w.temp)}${U.tempUnit()} · wind ${Math.round(w.wind ?? 0)} ${U.windUnit()}`, s: note, warn: close };
  }

  UI.renderTonight = () => {
    if (UI.activeTab !== 'tonight') return;
    const p = app().place();
    const s = st();
    U.$$('#tab-tonight .seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === s.settings.mode)));
    if (!p) {
      $('#placeKind').textContent = 'Home base';
      $('#placeName').textContent = 'Set your home';
      $('#placeSub').textContent = '';
      $('#verdict').innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Where do you live?</b>Set a home base to see tonight\'s aurora, clouds and darkness.<div style="margin-top:12px"><button class="btn primary sm" type="button" id="emptySetHome">Set home</button></div></div>';
      delete $('#verdict').dataset.ready;
      const b = $('#emptySetHome');
      if (b) b.onclick = () => app().showWelcome();
      $('#facts').innerHTML = '';
      $('#auroraNow').innerHTML = '';
      return;
    }
    const kinds = { home: 'Home base', spot: 'Our spot', sug: 'Suggested spot', pin: 'Dropped pin' };
    $('#placeKind').textContent = kinds[p.kind] || 'Place';
    $('#placeName').textContent = p.name;
    const ml = Sky.magLat(p.lat, p.lon), need = Sky.kpNeeded(ml);
    $('#placeSub').textContent = `${U.fmtCoord(p.lat, p.lon)} · ${Math.abs(ml).toFixed(1)}° magnetic`;
    $('#backHome').hidden = p.kind === 'home' || !s.home;

    const info = app().placeInfo(p);
    const nw = Sky.nightWindow(p.lat, p.lon);
    const { rows } = Sky.series({ lat: p.lat, lon: p.lon, wx: info.wx, zone: info.zone, from: nw.sunset - U.HOUR, to: nw.sunrise + U.HOUR, view: info.view });
    const mode = app().mode();
    // once the night has started, only the hours still ahead count toward the verdict
    const ahead = rows.filter((r) => r.t >= U.floorHour(Date.now()));
    const pool = ahead.length ? ahead : rows;
    const sum = Sky.summarize(pool, mode);
    const other = Sky.summarize(pool, mode === 'stars' ? 'aurora' : 'stars');

    ensureVerdict();
    setGauge(sum.none ? 0 : sum.score, other.none ? 0 : other.score, mode);
    const cp = verdictCopy(sum, mode, need, info);
    $('#vTitle').textContent = cp.title;
    $('#vBody').textContent = cp.body;
    const win = $('#vWindow');
    win.hidden = !cp.window;
    if (cp.window) win.innerHTML = `${icon('sparkle')}Best ${esc(cp.window)}`;
    $('#vOther').textContent = other.none ? '' : `${mode === 'stars' ? 'Aurora' : 'Stars'} tonight: ${Math.round(other.score * 100)} / 100`;

    // Facts
    const f = [];
    f.push(fact('moon', 'Dark sky', nw.dusk && nw.dawn ? `${U.fmtClock(nw.dusk)}–${U.fmtClock(nw.dawn)}` : 'Twilight all night', `Sunset ${U.fmtClock(nw.sunset)}`));
    const mi = Sky.moonIllum((nw.sunset + nw.sunrise) / 2);
    const mn = Sky.moonNight(p.lat, p.lon, nw.sunset, nw.sunrise);
    f.push(fact(null, 'Moon', `${Math.round(mi.fraction * 100)}% lit`, `${Sky.phaseName(mi.phase)}. ${moonText(mn, nw)}`, '', Sky.moonSVG(mi.phase, 'fact-moon')));
    if (info.wx) {
      f.push(fact('cloud', 'Clouds tonight', sum.meanCloud != null ? `${Math.round(sum.meanCloud)}% average` : '–', sum.clearest && sum.clearest.wx ? `Clearest ${U.fmtHour(sum.clearest.t)} (${Math.round(sum.clearest.wx.cc)}%)` : '', sum.meanCloud > 75 ? 'warn' : ''));
    } else {
      f.push(fact('cloud', 'Clouds tonight', info.wxErr ? 'Unavailable' : skel(80), info.wxErr ? 'Open-Meteo did not answer' : ''));
    }
    f.push(fact('aurora', 'Aurora', sum.kpMax != null ? `Kp ${sum.kpMax.toFixed(1)} max` : skel(70), need > 9 ? 'Needs an extreme storm here' : `You need about Kp ${need.toFixed(1)}`, sum.kpMax != null && sum.kpMax < need - 0.67 ? 'warn' : ''));
    if (info.zone === undefined) f.push(fact('bulb', 'Sky darkness', skel(90), ''));
    else if (info.zone === null) f.push(fact('bulb', 'Sky darkness', 'Unknown', 'Atlas tile unavailable'));
    else {
      const z = Sky.LP[info.zone];
      f.push(fact('bulb', 'Sky darkness', `<span class="swatch" style="background:${Sky.lpColor(info.zone)}"></span>Zone ${z.id} · ${z.sqm.split('–')[0]}`, `≈ Bortle ${z.bortle}. ${Sky.SKY_WORDS[z.bortle]}`));
    }
    const best = sum.best && sum.best.wx ? sum.best.wx : info.wx ? D.wxAt(info.wx, U.floorHour(Date.now())) : null;
    const cf = comfort(best);
    f.push(fact('thermo', sum.best ? `At ${U.fmtHour(sum.best ? sum.best.t : Date.now())}` : 'Now', cf ? cf.v : info.wx ? '–' : skel(80), cf ? cf.s : '', cf && cf.warn ? 'warn' : ''));
    $('#facts').innerHTML = f.join('');

    UI.drawHourly(rows, mode);
    renderAuroraNow(p, info);
  };

  function renderAuroraNow(p, info) {
    const box = $('#auroraNow');
    const ov = D.ov, v = info.view;
    if (!ov || !v) {
      box.innerHTML = `<div class="now-card"><span class="eyebrow">Aurora right now</span><div class="row"><div class="big">${skel(60)}<small>Overhead</small></div><div class="big">${skel(60)}<small>In view</small></div></div></div>`;
      return;
    }
    const dir = p.lat >= 0 ? 'northern' : 'southern';
    const hp = D.hp ? (p.lat >= 0 ? D.hp.north : D.hp.south) : null;
    const edge = v.edgeElev != null
      ? `The bright part of the aurora would sit about ${Math.max(1, Math.round(v.edgeElev))}° above your ${dir} horizon.`
      : `Right now the aurora is too far ${p.lat >= 0 ? 'north' : 'south'} to see from here.`;
    box.innerHTML = `<div class="now-card"><span class="eyebrow">Aurora right now</span>
      <div class="row">
        <div class="big">${U.pct(v.overhead)}<small>Overhead</small></div>
        <div class="big">${U.pct(v.inView)}<small>In view</small></div>
        ${hp != null ? `<div class="big">${hp}<small>GW power</small></div>` : ''}
      </div>
      <p>${esc(edge)}</p>
      <div class="src">NOAA OVATION forecast for ${U.fmtClock(ov.fc)}. "In view" counts aurora up to about 1,300 km away that would stand at least 3° above your horizon.</div></div>`;
  }

  // Tonight hour-by-hour chart
  let hourlyRows = [];
  UI.drawHourly = (rows, mode) => {
    hourlyRows = rows;
    const c = $('#hourlyChart');
    if (!c || !c.getBoundingClientRect().width) return;
    const { ctx, w, h } = U.fitCanvas(c, 2);
    ctx.clearRect(0, 0, w, h);
    const n = rows.length;
    if (!n) return;
    const cw = w / n;
    const deckTop = 4, deckRow = 10, deckH = deckRow * 3;
    const plotTop = deckTop + deckH + 10, plotBot = h - 18, plotH = plotBot - plotTop;
    // sky shading by sun altitude
    U.roundRect(ctx, 0, 0, w, h, 12);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#060a15';
    ctx.fillRect(0, 0, w, h);
    rows.forEach((r, i) => {
      const a = r.sunAlt;
      const col = a > 0 ? 'rgba(84,118,182,0.32)' : a > -6 ? 'rgba(62,84,150,0.26)' : a > -12 ? 'rgba(36,52,108,0.22)' : a > -18 ? 'rgba(20,30,70,0.2)' : 'rgba(0,0,0,0)';
      ctx.fillStyle = col;
      ctx.fillRect(i * cw, 0, cw + 0.5, h);
    });
    // cloud deck (high, mid, low)
    const layers = [['high', 'H'], ['mid', 'M'], ['low', 'L']];
    layers.forEach(([key], li) => {
      const y = deckTop + li * deckRow;
      rows.forEach((r, i) => {
        const v = r.wx ? r.wx[key] : null;
        if (v == null) return;
        ctx.fillStyle = `rgba(190,202,226,${(0.08 + 0.8 * (v / 100)).toFixed(3)})`;
        U.roundRect(ctx, i * cw + 1, y + 1, cw - 2, deckRow - 2, 3);
        ctx.fill();
      });
    });
    ctx.font = '700 10px "Hanken Grotesk", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,237,247,0.55)';
    layers.forEach(([, lab], li) => ctx.fillText(lab, 3, deckTop + li * deckRow + 8.5));
    // score bars
    const key = mode === 'stars' ? 'scoreS' : 'scoreA';
    const grd = ctx.createLinearGradient(0, plotBot, 0, plotTop);
    if (mode === 'stars') { grd.addColorStop(0, 'rgba(142,166,255,0.55)'); grd.addColorStop(1, 'rgba(230,236,255,0.95)'); }
    else { grd.addColorStop(0, 'rgba(55,211,201,0.5)'); grd.addColorStop(0.6, 'rgba(98,240,166,0.92)'); grd.addColorStop(1, 'rgba(165,140,255,0.95)'); }
    rows.forEach((r, i) => {
      const v = r[key];
      const bh = Math.max(2, v * plotH);
      ctx.fillStyle = grd;
      ctx.globalAlpha = v < 0.05 ? 0.35 : 1;
      U.roundRect(ctx, i * cw + cw * 0.18, plotBot - bh, cw * 0.64, bh, Math.min(4, cw * 0.3));
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // moon altitude
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(242,232,207,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let pen = false, peak = null;
    rows.forEach((r, i) => {
      const x = i * cw + cw / 2;
      if (r.moonAlt > 0) {
        const y = plotBot - (Math.min(r.moonAlt, 70) / 70) * plotH;
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        if (!peak || r.moonAlt > peak.alt) peak = { x, y, alt: r.moonAlt, frac: r.moonFrac };
      } else pen = false;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (peak) {
      ctx.fillStyle = `rgba(242,232,207,${0.4 + 0.6 * peak.frac})`;
      ctx.beginPath();
      ctx.arc(peak.x, peak.y - 5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // now marker, with the hours already gone dimmed
    const now = Date.now();
    const t0 = rows[0].t, t1 = rows[n - 1].t + U.HOUR;
    if (now >= t0 && now <= t1) {
      const x = ((now - t0) / (t1 - t0)) * w;
      ctx.fillStyle = 'rgba(4,6,12,0.55)';
      ctx.fillRect(0, 0, x, h);
      ctx.strokeStyle = 'rgba(98,240,166,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, plotTop - 6); ctx.lineTo(x, plotBot); ctx.stroke();
    }
    ctx.restore();
    // hour labels
    ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(163,174,196,0.85)';
    ctx.textAlign = 'center';
    const every = cw < 22 ? 3 : 2;
    rows.forEach((r, i) => { if (i % every === 0) ctx.fillText(U.fmtHourTiny(r.t), i * cw + cw / 2, h - 5); });
    ctx.textAlign = 'left';
    $('#hourlyKey').innerHTML = `<span><i style="background:rgba(190,202,226,.7)"></i>Cloud (high, mid, low)</span><span><i style="background:${mode === 'stars' ? '#c6d2ff' : 'linear-gradient(90deg,#37d3c9,#62f0a6)'}"></i>${mode === 'stars' ? 'Stargazing' : 'Aurora'} score</span><span><i style="background:repeating-linear-gradient(90deg,#f2e8cf 0 3px,transparent 3px 6px)"></i>Moon height</span>`;
    $('#hourlyNote').textContent = rows.some((r) => r.wx) ? 'Open-Meteo, NOAA Kp' : 'Loading clouds…';
  };
  function hourlyTip(e) {
    const c = $('#hourlyChart'), tip = $('#hourlyTip');
    if (!hourlyRows.length) return;
    const r = c.getBoundingClientRect();
    const i = U.clamp(Math.floor(((e.clientX - r.left) / r.width) * hourlyRows.length), 0, hourlyRows.length - 1);
    const row = hourlyRows[i];
    const w = row.wx;
    const mode = app().mode();
    const lines = [`<b>${U.fmtHour(row.t)}</b>`];
    lines.push(w && w.cc != null ? `Clouds <b>${Math.round(w.cc)}%</b> <span style="color:var(--ink-3)">(L ${Math.round(w.low)} · M ${Math.round(w.mid)} · H ${Math.round(w.high)})</span>` : 'Clouds –');
    if (row.kp != null) lines.push(`Kp <b>${row.kp.toFixed(1)}</b> · ${row.lvl ? row.lvl.short : ''}`);
    lines.push(row.moonAlt > 0 ? `Moon up ${Math.round(row.moonAlt)}°, ${Math.round(row.moonFrac * 100)}% lit` : 'Moon down');
    if (w && w.temp != null) lines.push(`${Math.round(w.temp)}${U.tempUnit()}, wind ${Math.round(w.wind ?? 0)} ${U.windUnit()}`);
    lines.push(`${mode === 'stars' ? 'Stars' : 'Aurora'} score <b>${Math.round((mode === 'stars' ? row.scoreS : row.scoreA) * 100)}</b>`);
    tip.innerHTML = lines.join('<br>');
    tip.hidden = false;
    const x = e.clientX - r.left;
    tip.style.left = `${U.clamp(x + 12, 0, r.width - tip.offsetWidth)}px`;
    if (x + 12 + tip.offsetWidth > r.width) tip.style.left = `${Math.max(0, x - tip.offsetWidth - 12)}px`;
  }
  UI.bindHourly = () => {
    const c = $('#hourlyChart');
    c.addEventListener('pointermove', hourlyTip);
    c.addEventListener('pointerdown', hourlyTip);
    c.addEventListener('pointerleave', () => { $('#hourlyTip').hidden = true; });
  };

  // ---------- Space weather ----------
  UI.renderSpace = () => {
    if (UI.activeTab !== 'space') return;
    renderKp();
    UI.renderSWReadouts();
    renderKpChart();
    renderOutlook();
    renderAlerts();
  };
  function renderKp() {
    const kp = D.kpNow();
    const home = st().home;
    const need = home ? Sky.kpNeeded(Sky.magLat(home.lat, home.lon)) : null;
    const cx = 75, cy = 80, R = 62;
    const pt = (deg, r) => [cx + r * Math.cos(U.rad(deg)), cy - r * Math.sin(U.rad(deg))];
    let segs = '';
    for (let i = 0; i < 9; i++) {
      const a0 = 180 - i * 20 - 1.2, a1 = 180 - (i + 1) * 20 + 1.2;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
      const on = kp != null && kp >= i;
      segs += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${Sky.kpColor(i + 0.5)}" stroke-width="10" fill="none" stroke-linecap="butt" opacity="${on ? 1 : 0.22}"/>`;
    }
    let needMark = '';
    if (need != null && need <= 9) {
      const a = 180 - (need / 9) * 180;
      const [x0, y0] = pt(a, R - 9), [x1, y1] = pt(a, R + 9);
      needMark = `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="#ffd38a" stroke-width="2" stroke-linecap="round"/>`;
    }
    const rot = kp == null ? 0 : (U.clamp(kp, 0, 9) / 9) * 180;
    const g = $('#kpGauge');
    if (!g.dataset.ready) {
      g.innerHTML = `<svg viewBox="0 0 150 92" aria-hidden="true"><g id="kpSegs"></g><g class="kp-needle" id="kpNeedle"><line x1="75" y1="80" x2="19" y2="80" stroke="#e8edf7" stroke-width="2.2" stroke-linecap="round"/><circle cx="75" cy="80" r="5" fill="#e8edf7"/></g></svg>`;
      g.dataset.ready = '1';
    }
    $('#kpSegs').innerHTML = segs + needMark;
    requestAnimationFrame(() => { $('#kpNeedle').style.transform = `rotate(${rot}deg)`; });
    const band = kp != null ? Sky.kpBand(kp) : null;
    const hp = D.hp;
    $('#kpText').innerHTML = kp == null ? `<div class="kp-big">${skel(70)}</div>` : `
      <div class="kp-big">${kp.toFixed(1)}</div>
      <div class="kp-band" style="color:${band.color}">${esc(band.name)}</div>
      <p>${need != null ? (need > 9 ? 'From home it takes an extreme storm.' : `From home you need about <b>Kp ${need.toFixed(1)}</b> (gold tick).`) : 'Set a home to see the Kp you need.'}${hp ? ` Aurora power ${hp.north} GW north.` : ''}</p>`;
  }
  UI.renderSWReadouts = () => {
    if (UI.activeTab !== 'space') return;
    const sw = D.swNow();
    const box = $('#swReadouts');
    if (sw.v == null && sw.bz == null) { box.innerHTML = ['Speed', 'Density', 'Bz', 'Bt'].map((k) => `<div><div class="k">${k}</div><div class="v">${skel(50)}</div></div>`).join(''); return; }
    const trend = (arr, key) => {
      if (arr.length < 40) return '';
      const a = arr[arr.length - 1][key], b = arr[arr.length - 31][key];
      if (a == null || b == null) return '';
      const d = a - b;
      return Math.abs(d) < (key === 'v' ? 15 : 1) ? '' : d > 0 ? ' ▲' : ' ▼';
    };
    const eta = sw.v ? Math.round(1.5e6 / sw.v / 60) : null;
    const bzTxt = sw.bz == null ? '–' : `${sw.bz > 0 ? '+' : ''}${sw.bz.toFixed(1)}`;
    box.innerHTML = `
      <div><div class="k">Speed</div><div class="v">${sw.v != null ? Math.round(sw.v) : '–'}<small>km/s${trend(D.wind, 'v')}</small></div><div class="s">${eta ? `Arrives in ${eta} min` : ''}</div></div>
      <div><div class="k">Density</div><div class="v">${sw.n != null ? sw.n.toFixed(1) : '–'}<small>p/cm³</small></div><div class="s">${sw.n != null ? (sw.n > 15 ? 'Dense' : sw.n > 5 ? 'Moderate' : 'Thin') : ''}</div></div>
      <div><div class="k">Bz</div><div class="v" style="color:${sw.bz != null && sw.bz < -4 ? 'var(--rose)' : sw.bz != null && sw.bz < 0 ? 'var(--amber)' : 'inherit'}">${bzTxt}<small>nT</small></div><div class="s">${sw.bz == null ? '' : sw.bz < 0 ? 'South: good' : 'North: weak'}</div></div>
      <div><div class="k">Bt</div><div class="v">${sw.bt != null ? sw.bt.toFixed(1) : '–'}<small>nT</small></div><div class="s">${sw.bt != null ? (sw.bt > 15 ? 'Strong field' : sw.bt > 8 ? 'Elevated' : 'Calm') : ''}</div></div>`;
    $('#swNote').textContent = sw.t ? `L1 monitor · ${U.ago(Date.now() - sw.t)}` : '';
  };
  function renderKpChart() {
    const box = $('#kpChart');
    const now = Date.now();
    const rows = D.kpFc.filter((r) => r.t >= now - 24 * U.HOUR);
    if (!rows.length) { box.innerHTML = `<div class="skel" style="height:120px"></div>`; return; }
    const W = Math.max(280, box.clientWidth || 340), H = 128, padL = 18, padB = 16, padT = 8;
    const t0 = rows[0].t, t1 = rows[rows.length - 1].t + 3 * U.HOUR;
    const X = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - 2);
    const Y = (k) => H - padB - (k / 9) * (H - padB - padT);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kp index, past day and NOAA's 3-day forecast"><defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/></pattern></defs>`;
    for (const k of [3, 5, 7, 9]) s += `<line x1="${padL}" x2="${W}" y1="${Y(k)}" y2="${Y(k)}" stroke="rgba(148,178,255,.1)" stroke-dasharray="2 4"/><text x="2" y="${Y(k) + 3}">${k}</text>`;
    // day separators (local midnight)
    const d = new Date(t0); d.setHours(24, 0, 0, 0);
    for (let m = d.getTime(); m < t1; m += U.DAY) s += `<line x1="${X(m)}" x2="${X(m)}" y1="${padT}" y2="${H - padB}" stroke="rgba(148,178,255,.16)"/><text x="${X(m) + 3}" y="${H - 4}">${U.fmtDay(m)}</text>`;
    const bw = Math.max(2, X(t0 + 3 * U.HOUR) - X(t0) - 1.5);
    for (const r of rows) {
      const x = X(r.t) + 0.75, y = Y(Math.max(0.15, r.kp)), hgt = H - padB - y;
      const pred = r.kind === 'predicted';
      s += `<g><title>${U.fmtDayTime(r.t)}: Kp ${r.kp.toFixed(2)} (${r.kind})</title><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="1.5" fill="${Sky.kpColor(r.kp)}" opacity="${pred ? 0.62 : 0.95}"/>${pred ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="url(#hatch)"/>` : ''}</g>`;
    }
    const home = st().home;
    if (home) {
      const need = Sky.kpNeeded(Sky.magLat(home.lat, home.lon));
      if (need <= 9) s += `<line x1="${padL}" x2="${W}" y1="${Y(need)}" y2="${Y(need)}" stroke="#ffd38a" stroke-width="1.3" stroke-dasharray="5 4"/><text x="${W - 4}" y="${Y(need) - 4}" text-anchor="end" style="fill:#ffd38a">you need ${need.toFixed(1)}</text>`;
      $('#kpNeedNote').textContent = 'Hatched = forecast';
    }
    if (now >= t0 && now <= t1) s += `<line x1="${X(now)}" x2="${X(now)}" y1="${padT - 4}" y2="${H - padB}" stroke="#62f0a6" stroke-width="1.5"/><text x="${X(now) + 3}" y="${padT + 4}" style="fill:#62f0a6">now</text>`;
    s += '</svg>';
    box.innerHTML = s;
  }
  function renderOutlook() {
    const box = $('#outlook');
    if (!D.outlook.length) { box.innerHTML = '<div class="skel" style="height:90px;grid-column:1/-1"></div>'; return; }
    const home = st().home;
    const need = home ? Sky.kpNeeded(Sky.magLat(home.lat, home.lon)) : 6;
    const lat = home ? home.lat : 47.6, lon = home ? home.lon : -122.3;
    let good = 0;
    box.innerHTML = D.outlook.map((r) => {
      const local = new Date(new Date(r.t).getUTCFullYear(), new Date(r.t).getUTCMonth(), new Date(r.t).getUTCDate(), 23);
      const mi = Sky.moonIllum(local.getTime());
      const moonUpLate = Sky.moonPos(local.getTime(), lat, lon).alt > 0;
      const dark = mi.fraction < 0.45 || !moonUpLate;
      const isGood = r.kp >= need - 1.5 && dark;
      if (isGood) good++;
      return `<div class="ol-day ${isGood ? 'good' : ''}" title="${U.fmtDateLong(local)}: Kp up to ${r.kp}, moon ${Math.round(mi.fraction * 100)}% lit">
        <div class="d">${local.toLocaleDateString([], { weekday: 'narrow' })} ${local.getDate()}</div>
        <div class="n">${r.kp}</div><div class="bar" style="background:${Sky.kpColor(r.kp)};opacity:${0.35 + r.kp / 12}"></div>${Sky.moonSVG(mi.phase)}</div>`;
    }).join('') + `<div class="ol-key" style="grid-column:1/-1">Numbers are NOAA's largest expected Kp. ${good ? `Outlined days pair a decent Kp with a dark moon: ${good} in the next four weeks.` : 'No standout dark, active nights in the outlook yet.'}</div>`;
  }
  function renderAlerts() {
    const box = $('#alertList');
    const since = Date.now() - 3 * U.DAY;
    const list = D.alerts.filter((a) => a.geomag && a.t >= since).slice(0, 5);
    if (!D.updated.alerts) { box.innerHTML = '<li class="skel" style="height:60px"></li>'; return; }
    if (!list.length) { box.innerHTML = '<li class="empty"><b>All quiet</b>No geomagnetic watches or warnings from NOAA in the last 3 days.</li>'; return; }
    box.innerHTML = list.map((a) => {
      const kind = a.kind.includes('warning') ? 'warning' : a.kind.includes('alert') ? 'alert' : a.kind.includes('watch') ? 'watch' : '';
      const valid = a.validTo ? (a.validTo > Date.now() ? `Valid until ${U.fmtDayTime(a.validTo)}` : 'Expired') : '';
      return `<li class="alert"><div class="a-top"><span class="a-kind ${kind}">${esc(a.kind)}</span><span>${U.relDay(a.t)} ${U.fmtClock(a.t)}</span></div><div class="a-head">${esc(a.head)}</div>${valid || a.scale ? `<div class="a-sub">${esc([a.scale, valid].filter(Boolean).join(' · '))}</div>` : ''}</li>`;
    }).join('');
  }

  // ---------- Spots ----------
  const kindInfo = (k) => D.KINDS[k] || D.KINDS.place;
  const horizonTag = (hz) => {
    if (!hz) return '';
    const b = hz.block;
    const cls = b <= 2.5 ? 'good' : b <= 6 ? 'warn' : 'bad';
    const txt = b <= 2.5 ? 'Open view north' : b <= 6 ? 'Low hills north' : 'Terrain blocks north';
    return `<span class="tag ${cls}" title="Terrain stands about ${b.toFixed(1)}° above the horizon toward the aurora (trees not included)">${icon('compass')}${txt}</span>`;
  };
  const zoneTag = (z) => (z == null ? '' : `<span class="tag" title="Light pollution zone ${Sky.LP[z].id}: ${Sky.LP[z].sqm} mag/arcsec²"><i class="sw" style="background:${Sky.lpColor(z)}"></i>Zone ${Sky.LP[z].id} · Bortle ${Sky.LP[z].bortle}</span>`);
  const tonightTag = (tn) => {
    if (!tn) return '';
    if (tn.clearHours >= 3) return `<span class="tag good">${icon('sparkle')}Clear ${tn.clearHours} h tonight</span>`;
    if (tn.clearHours > 0) return `<span class="tag warn">${icon('cloud')}Clear ${tn.clearHours} h tonight</span>`;
    return `<span class="tag bad">${icon('cloud')}Cloudy tonight</span>`;
  };
  UI.directionsUrl = (lat, lon) => (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? `https://maps.apple.com/?daddr=${lat},${lon}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`);

  UI.finderStatus = (steps, idx, fail) => {
    const box = $('#finderStatus');
    if (!steps) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<ol>${steps.map((s, i) => `<li class="${fail && i === idx ? 'fail' : i < idx ? 'done' : i === idx ? 'doing' : ''}">${esc(s)}</li>`).join('')}</ol>`;
  };

  UI.renderSpots = () => {
    const s = st();
    const sel = $('#radiusSel');
    const opts = U.imperial() ? [[50, '30 mi'], [80, '50 mi'], [120, '75 mi'], [160, '100 mi'], [240, '150 mi']] : [[50, '50 km'], [80, '80 km'], [120, '120 km'], [160, '160 km'], [240, '240 km']];
    sel.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${v === s.settings.radiusKm ? 'selected' : ''}>${l}</option>`).join('');
    if (UI.activeTab !== 'spots') return;
    const list = $('#suggestList');
    const selKey = s.selected ? `${s.selected.lat.toFixed(4)},${s.selected.lon.toFixed(4)}` : '';
    if (!s.home) {
      list.innerHTML = '<li class="empty"><b>Set your home first</b>Spots are found around your home base.</li>';
    } else if (!s.suggestions.length) {
      list.innerHTML = `<li class="empty"><b>No spots yet</b>Press Find spots to scan for dark places with an open view north.</li>`;
    } else {
      list.innerHTML = s.suggestions.map((g, i) => {
        const k = kindInfo(g.kind);
        const saved = s.spots.some((x) => x.srcId === g.id || (Math.abs(x.lat - g.lat) < 1e-4 && Math.abs(x.lon - g.lon) < 1e-4));
        const active = `${g.lat.toFixed(4)},${g.lon.toFixed(4)}` === selKey;
        return `<li class="spot ${active ? 'active' : ''}" data-i="${i}" tabindex="0">
          <span class="spot-rank">${i + 1}</span>
          <span class="spot-name">${esc(g.name || k.label)}<span class="spot-type">${esc(k.label)} · ${U.fmtDist(g.dist)} from home</span></span>
          <span class="spot-score"><b>${Math.round(g.score * 100)}</b><small>Score</small></span>
          <span class="spot-meta">${zoneTag(g.zone)}${horizonTag(g.hz)}${tonightTag(app().tonightFor(g))}</span>
          <span class="spot-actions">
            <button class="btn sm" type="button" data-act="save" ${saved ? 'disabled' : ''}>${icon(saved ? 'check' : 'star')}${saved ? 'Saved' : 'Save'}</button>
            <a class="btn sm ghost" href="${UI.directionsUrl(g.lat, g.lon)}" target="_blank" rel="noopener">${icon('route')}Directions</a>
          </span></li>`;
      }).join('');
    }
    const saved = $('#savedList');
    if (!s.spots.length) {
      saved.innerHTML = '<li class="empty"><b>Nothing saved yet</b>Save a suggested spot, or click anywhere on the map to check a place and save it.</li>';
    } else {
      saved.innerHTML = s.spots.map((p, i) => {
        const active = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` === selKey;
        const dist = s.home ? U.fmtDist(U.distKm(s.home, p)) + ' from home' : '';
        return `<li class="spot spot-saved ${active ? 'active' : ''}" data-s="${i}" tabindex="0">
          <span class="spot-rank">${icon('star')}</span>
          <span class="spot-name">${esc(p.name)}<span class="spot-type">${esc([p.kind ? kindInfo(p.kind).label : 'Our spot', dist].filter(Boolean).join(' · '))}</span></span>
          <span class="spot-score"></span>
          <span class="spot-meta">${zoneTag(p.zone)}${horizonTag(p.hz)}</span>
          ${p.note ? `<span class="spot-note">${esc(p.note)}</span>` : ''}
          <span class="spot-actions">
            <a class="btn sm ghost" href="${UI.directionsUrl(p.lat, p.lon)}" target="_blank" rel="noopener">${icon('route')}Directions</a>
            <button class="btn sm ghost" type="button" data-act="rename">Rename</button>
            <button class="btn sm ghost" type="button" data-act="remove" aria-label="Remove ${esc(p.name)}">${icon('trash')}</button>
          </span></li>`;
      }).join('');
    }
  };
  UI.bindSpots = () => {
    const onList = (e, which) => {
      const li = e.target.closest('.spot');
      if (!li) return;
      const act = e.target.closest('[data-act]');
      if (e.target.closest('a')) return;
      if (which === 'sug') {
        const g = st().suggestions[+li.dataset.i];
        if (!g) return;
        if (act && act.dataset.act === 'save') { app().saveSpot({ ...g, name: g.name || kindInfo(g.kind).label, srcId: g.id }); return; }
        app().focusSpot({ kind: 'sug', lat: g.lat, lon: g.lon, name: g.name || kindInfo(g.kind).label, ref: g });
      } else {
        const idx = +li.dataset.s, p = st().spots[idx];
        if (!p) return;
        if (act && act.dataset.act === 'remove') { app().removeSpot(p.id); return; }
        if (act && act.dataset.act === 'rename') { UI.renameSpot(p); return; }
        app().focusSpot({ kind: 'spot', lat: p.lat, lon: p.lon, name: p.name, id: p.id });
      }
    };
    $('#suggestList').addEventListener('click', (e) => onList(e, 'sug'));
    $('#savedList').addEventListener('click', (e) => onList(e, 'saved'));
    for (const id of ['#suggestList', '#savedList']) {
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('spot')) e.target.click(); });
    }
  };
  UI.renameSpot = (p) => {
    const form = U.el('form', { class: 'log-form', style: 'border:0;padding:0;background:none' });
    form.innerHTML = `<div class="field"><label for="rnName">Name</label><input id="rnName" type="text" maxlength="60" value="${esc(p.name)}" required></div>
      <div class="field"><label for="rnNote">Notes</label><textarea id="rnNote" maxlength="400" placeholder="Parking, gate times, where to stand…">${esc(p.note || '')}</textarea></div>
      <div class="form-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>`;
    form.addEventListener('submit', (e) => { e.preventDefault(); app().updateSpot(p.id, { name: $('#rnName').value.trim() || p.name, note: $('#rnNote').value.trim() }); UI.closeModal(); });
    UI.modal('Edit spot', form);
  };

  // ---------- Journal ----------
  UI.renderLog = () => {
    if (UI.activeTab !== 'log') return;
    const s = st();
    const log = [...s.log].sort((a, b) => b.t - a.t);
    const auroras = log.filter((x) => x.saw && x.saw.includes('aurora')).length;
    const counts = {};
    log.forEach((x) => { if (x.place) counts[x.place] = (counts[x.place] || 0) + 1; });
    const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    $('#logStats').innerHTML = `<div class="stat"><b>${log.length}</b><small>Nights out</small></div><div class="stat"><b>${auroras}</b><small>Auroras</small></div><div class="stat" title="${fav ? esc(fav[0]) : ''}"><b style="font-size:${fav && fav[0].length > 10 ? 15 : 22}px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fav ? esc(fav[0]) : '–'}</b><small>Favorite place</small></div>`;
    const sawNames = { aurora: 'Aurora', milkyway: 'Milky Way', meteors: 'Meteors', planets: 'Planets', satellites: 'Satellites', clouds: 'Clouded out' };
    $('#logList').innerHTML = !log.length
      ? '<li class="empty"><b>Your first night out goes here</b>Log a night to keep the date, place, what you saw and the sky conditions.</li>'
      : log.map((x) => {
        const saw = x.saw || [];
        const badge = saw.includes('aurora') ? '<span class="l-kind aurora">Aurora</span>' : saw.includes('milkyway') ? '<span class="l-kind stars">Milky Way</span>' : '';
        const rest = saw.filter((k) => !(badge && (k === 'aurora' || (k === 'milkyway' && !saw.includes('aurora'))))).map((k) => sawNames[k] || k);
        const c = x.cond || {};
        const cond = [c.kp != null ? `Kp ${c.kp.toFixed(1)}` : null, c.bz != null ? `Bz ${c.bz > 0 ? '+' : ''}${c.bz.toFixed(1)}` : null, c.cc != null ? `${Math.round(c.cc)}% cloud` : null, c.moon != null ? `Moon ${Math.round(c.moon * 100)}%` : null].filter(Boolean);
        return `<li class="log-item" data-id="${esc(x.id)}">
          <div class="l-top"><span class="l-date">${esc(U.fmtDateLong(x.t))}</span><span class="l-stars" aria-label="${x.rating || 0} of 5">${'★'.repeat(x.rating || 0)}${'☆'.repeat(5 - (x.rating || 0))}</span></div>
          <div class="l-where">${badge}<span>${esc(x.place || 'Somewhere dark')}${rest.length ? ` · ${esc(rest.join(', '))}` : badge ? '' : ' · Nothing noted'}</span></div>
          ${x.notes ? `<div class="l-notes">${esc(x.notes)}</div>` : ''}
          ${cond.length ? `<div class="l-cond">${cond.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <button class="icon-btn l-del" type="button" data-del="${esc(x.id)}" aria-label="Delete this entry">${icon('trash')}</button></li>`;
      }).join('');
  };
  UI.openLogForm = () => {
    const s = st();
    const form = $('#logForm');
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const places = [...(s.home ? [s.home.name] : []), ...s.spots.map((p) => p.name)];
    const sel = app().place();
    const snap = app().conditionsSnapshot();
    form.innerHTML = `
      <div class="field-row"><div class="field"><label for="lgDate">When</label><input id="lgDate" type="datetime-local" value="${local}" required></div>
      <div class="field"><label for="lgPlace">Where</label><input id="lgPlace" type="text" list="lgPlaces" maxlength="60" value="${esc(sel ? sel.name : '')}" placeholder="Spot name"><datalist id="lgPlaces">${places.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist></div></div>
      <div class="field"><span class="lbl">What we saw</span><div class="checks">${[['aurora', 'Aurora'], ['milkyway', 'Milky Way'], ['meteors', 'Meteors'], ['planets', 'Planets'], ['satellites', 'Satellites'], ['clouds', 'Clouded out']].map(([v, l]) => `<label class="check"><input type="checkbox" name="saw" value="${v}"><span>${l}</span></label>`).join('')}</div></div>
      <div class="field"><span class="lbl">How good was it</span><div class="stars-input" id="lgStars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star')}</button>`).join('')}</div></div>
      <div class="field"><label for="lgNotes">Notes</label><textarea id="lgNotes" maxlength="1000" placeholder="Colors, how long it lasted, who brought the cocoa…"></textarea></div>
      <div class="snapshot">${snap.text ? `Saving with tonight's conditions: ${esc(snap.text)}` : ''}</div>
      <div class="form-actions"><button class="btn ghost" type="button" id="lgCancel">Cancel</button><button class="btn primary" type="submit">Save night</button></div>`;
    form.hidden = false;
    let rating = 0;
    const paint = () => U.$$('#lgStars button').forEach((b) => b.classList.toggle('on', +b.dataset.n <= rating));
    $('#lgStars').onclick = (e) => { const b = e.target.closest('button'); if (b) { rating = +b.dataset.n; paint(); } };
    $('#lgCancel').onclick = () => { form.hidden = true; };
    form.onsubmit = (e) => {
      e.preventDefault();
      const t = new Date($('#lgDate').value).getTime();
      const saw = U.$$('input[name="saw"]:checked', form).map((x) => x.value);
      app().addLog({ id: U.uid(), t: Number.isFinite(t) ? t : Date.now(), place: $('#lgPlace').value.trim(), saw, rating, notes: $('#lgNotes').value.trim(), cond: Math.abs((Number.isFinite(t) ? t : Date.now()) - Date.now()) < 6 * U.HOUR ? snap.cond : null });
      form.hidden = true;
    };
    $('#lgDate').focus();
  };
  UI.bindLog = () => {
    $('#logNewBtn').onclick = () => UI.openLogForm();
    $('#logList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const li = b.closest('.log-item');
      if (li.dataset.confirm) { app().removeLog(b.dataset.del); return; }
      li.dataset.confirm = '1';
      b.innerHTML = 'Delete?';
      b.style.width = 'auto';
      b.style.padding = '0 10px';
      b.style.opacity = '1';
      setTimeout(() => { if (li.isConnected) { delete li.dataset.confirm; b.innerHTML = icon('trash'); b.style.width = ''; b.style.padding = ''; b.style.opacity = ''; } }, 3500);
    });
  };

  // ---------- Timeline ----------
  const TL = (UI.TL = { t0: 0, span: 48 * U.HOUR, rows: [], sun: [], moon: [], bg: null, w: 0, h: 0 });
  UI.rebuildTimeline = () => {
    const p = app().place();
    TL.t0 = U.floorHour(Date.now());
    TL.bg = null;
    if (!p) { TL.rows = []; TL.sun = []; TL.moon = []; UI.drawTimeline(); return; }
    const info = app().placeInfo(p);
    TL.rows = Sky.series({ lat: p.lat, lon: p.lon, wx: info.wx, zone: info.zone, from: TL.t0, to: TL.t0 + TL.span - U.HOUR, view: info.view }).rows;
    TL.sun = [];
    TL.moon = [];
    for (let t = TL.t0; t <= TL.t0 + TL.span; t += 15 * U.MIN) {
      TL.sun.push(Sky.sunAlt(t, p.lat, p.lon));
      TL.moon.push(Sky.moonPos(t, p.lat, p.lon).alt);
    }
    TL.moonFrac = Sky.moonIllum(TL.t0 + 12 * U.HOUR).fraction;
    UI.drawTimeline();
  };
  const tlX = (t, w) => ((t - TL.t0) / TL.span) * w;
  function renderTimelineBg(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const top = 6, bot = h - 15, bandH = bot - top;
    U.roundRect(ctx, 0, top, w, bandH, 8);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#050913';
    ctx.fillRect(0, 0, w, h);
    // sky color by sun altitude
    const slice = w / Math.max(1, TL.sun.length - 1);
    TL.sun.forEach((a, i) => {
      ctx.fillStyle = a > 0 ? 'rgba(84,118,182,0.42)' : a > -6 ? 'rgba(66,88,160,0.34)' : a > -12 ? 'rgba(40,56,116,0.28)' : a > -18 ? 'rgba(22,32,74,0.24)' : 'rgba(0,0,0,0)';
      ctx.fillRect(i * slice - slice / 2, top, slice + 0.6, bandH);
    });
    const rows = TL.rows;
    const mode = app().mode();
    const key = mode === 'stars' ? 'scoreS' : 'scoreA';
    const hw = w / (TL.span / U.HOUR);
    // score area rising from the bottom
    if (rows.length) {
      const grd = ctx.createLinearGradient(0, bot, 0, top);
      if (mode === 'stars') { grd.addColorStop(0, 'rgba(142,166,255,0.15)'); grd.addColorStop(1, 'rgba(220,228,255,0.85)'); }
      else { grd.addColorStop(0, 'rgba(55,211,201,0.15)'); grd.addColorStop(0.55, 'rgba(98,240,166,0.75)'); grd.addColorStop(1, 'rgba(165,140,255,0.9)'); }
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, bot);
      rows.forEach((r, i) => { const x = i * hw + hw / 2; ctx.lineTo(x, bot - r[key] * (bandH - 6)); });
      ctx.lineTo(w, bot);
      ctx.closePath();
      ctx.fill();
      // cloud curtain hanging from the top
      rows.forEach((r, i) => {
        const cc = r.wx && r.wx.cc != null ? r.wx.cc : null;
        if (cc == null) return;
        const ch = (cc / 100) * (bandH * 0.62);
        const g2 = ctx.createLinearGradient(0, top, 0, top + ch);
        g2.addColorStop(0, 'rgba(200,210,232,0.62)');
        g2.addColorStop(1, 'rgba(200,210,232,0.18)');
        ctx.fillStyle = g2;
        U.roundRect(ctx, i * hw + 0.5, top - 4, hw - 1, ch + 4, 3);
        ctx.fill();
      });
      // Kp strip along the bottom
      for (const r of D.kpFc) {
        if (r.t + 3 * U.HOUR < TL.t0 || r.t > TL.t0 + TL.span) continue;
        ctx.fillStyle = Sky.kpColor(r.kp);
        ctx.globalAlpha = r.kp >= 4 ? 0.95 : 0.45;
        ctx.fillRect(tlX(r.t, w), bot - 3, (3 * U.HOUR / TL.span) * w - 1, 3);
      }
      ctx.globalAlpha = 1;
    }
    // moon band along the top edge
    const mf = TL.moonFrac || 0;
    TL.moon.forEach((a, i) => {
      if (a <= 0) return;
      ctx.fillStyle = `rgba(242,232,207,${(0.25 + 0.65 * mf).toFixed(2)})`;
      ctx.fillRect(i * slice - slice / 2, top, slice + 0.6, 2.5);
    });
    ctx.restore();
    // day separators and labels
    ctx.font = '700 11px "Hanken Grotesk", system-ui, sans-serif';
    const d = new Date(TL.t0);
    d.setHours(24, 0, 0, 0);
    for (let m = d.getTime(); m < TL.t0 + TL.span; m += U.DAY) {
      const x = tlX(m, w);
      ctx.strokeStyle = 'rgba(148,178,255,0.28)';
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
      ctx.fillStyle = 'rgba(232,237,247,0.75)';
      ctx.fillText(new Date(m).toLocaleDateString([], { weekday: 'short' }).toUpperCase(), x + 5, top + 13);
    }
    // hour labels
    ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(163,174,196,0.8)';
    ctx.textAlign = 'center';
    const step = w < 520 ? 6 : 3;
    for (let t = TL.t0; t <= TL.t0 + TL.span; t += U.HOUR) {
      const hr = new Date(t).getHours();
      if (hr % step !== 0) continue;
      const x = tlX(t, w);
      if (x < 12 || x > w - 12) continue;
      ctx.fillText(U.fmtHourTiny(t), x, h - 3);
    }
    ctx.textAlign = 'left';
    TL.bg = c;
    TL.w = w;
    TL.h = h;
  }
  UI.drawTimeline = () => {
    const c = $('#tlCanvas');
    if (!c || !c.getBoundingClientRect().width) return;
    const { ctx, w, h } = U.fitCanvas(c, 2);
    if (!TL.bg || TL.w !== w || TL.h !== h) renderTimelineBg(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(TL.bg, 0, 0, w, h);
    const s = st();
    const x = U.clamp(tlX(s.time, w), 1, w - 1);
    // dim the past part before "now"
    const nx = tlX(Date.now(), w);
    if (nx > 0) { ctx.fillStyle = 'rgba(4,6,12,0.45)'; ctx.fillRect(0, 6, nx, h - 21); }
    ctx.save();
    ctx.strokeStyle = 'rgba(4,6,12,0.75)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 15); ctx.stroke();
    ctx.strokeStyle = '#d9ffe9';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - 15); ctx.stroke();
    ctx.fillStyle = '#62f0a6';
    ctx.strokeStyle = 'rgba(4,6,12,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, 5, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    c.setAttribute('aria-valuenow', String(Math.round((s.time - TL.t0) / U.HOUR)));
    c.setAttribute('aria-valuetext', U.fmtDayTime(s.time));
    UI.updateTimelineHead();
  };
  UI.updateTimelineHead = () => {
    const s = st();
    const t = s.time;
    $('#tlTime').textContent = s.live ? `Now · ${U.fmtClock(Date.now())}` : `${U.relDay(t)} ${U.fmtClock(t)}`;
    $('#tlNow').hidden = s.live;
    const r = TL.rows.find((x) => t >= x.t && t < x.t + U.HOUR) || null;
    const parts = [];
    if (r) {
      if (r.wx && r.wx.cc != null) parts.push(`Clouds ${Math.round(r.wx.cc)}%`);
      if (r.kp != null) parts.push(`Kp ${r.kp.toFixed(1)}`);
      if (r.sunAlt > -6) parts.push(r.sunAlt > 0 ? 'Daylight' : 'Twilight');
      else {
        parts.push(`Aurora ${Math.round(r.scoreA * 100)}`);
        parts.push(`Stars ${Math.round(r.scoreS * 100)}`);
      }
    }
    const p = app().place();
    $('#tlNote').textContent = p ? `${parts.join(' · ')}${parts.length ? ' · ' : ''}${p.name}` : 'Set a home to see the forecast';
  };
  UI.bindTimeline = () => {
    const c = $('#tlCanvas');
    let drag = false;
    const setFromX = (clientX) => {
      const r = c.getBoundingClientRect();
      const f = U.clamp((clientX - r.left) / r.width, 0, 1);
      let t = TL.t0 + f * TL.span;
      if (t < Date.now()) t = Date.now();
      app().setTime(t, { live: Math.abs(t - Date.now()) < 10 * U.MIN });
    };
    c.addEventListener('pointerdown', (e) => { drag = true; c.setPointerCapture(e.pointerId); app().stopPlay(); setFromX(e.clientX); });
    c.addEventListener('pointermove', (e) => { if (drag) setFromX(e.clientX); });
    const end = () => { drag = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('keydown', (e) => {
      const s = st();
      let t = null;
      if (e.key === 'ArrowRight') t = s.time + U.HOUR;
      else if (e.key === 'ArrowLeft') t = s.time - U.HOUR;
      else if (e.key === 'Home') t = Date.now();
      else if (e.key === 'End') t = TL.t0 + TL.span - U.HOUR;
      if (t == null) return;
      e.preventDefault();
      t = U.clamp(t, Date.now(), TL.t0 + TL.span);
      app().setTime(t, { live: Math.abs(t - Date.now()) < 10 * U.MIN });
    });
  };

  // ---------- Legend ----------
  UI.renderLegend = () => {
    const L = st().settings.layers;
    const parts = [];
    if (L.best) {
      const mode = app().mode();
      parts.push(`<div class="lg-block"><div class="lg-title"><span>Best sky for ${mode === 'stars' ? 'stars' : 'aurora'}</span><span>${st().settings.mode === 'auto' ? 'Auto' : ''}</span></div>
        <div class="lg-bar" style="background:linear-gradient(90deg,#0a0f1c,#1f8c9e 30%,#5beb99 62%,#ffcc61)"></div>
        <div class="lg-ticks"><span>Poor</span><span>Fair</span><span>Good</span><span>Golden</span></div>
        <div class="lg-note">${mode === 'stars' ? 'Clear sky × dark sky, at the timeline\'s hour.' : 'Clear sky × dark sky × how far south the forecast Kp reaches, at the timeline\'s hour.'}</div></div>`);
    }
    if (L.aurora) {
      parts.push(`<div class="lg-block"><div class="lg-title"><span>Aurora chance overhead</span><span>NOAA</span></div>
        <div class="lg-bar" style="background:linear-gradient(90deg,rgba(46,209,199,.2),#36d1c8 12%,#5cffa0 34%,#a37aff 72%,#ff6194)"></div>
        <div class="lg-ticks"><span>2%</span><span>15%</span><span>40%</span><span>70%+</span></div>
        <div class="lg-title" style="margin:8px 0 0"><span><span style="color:#ffd38a;letter-spacing:2px">· · ·</span> Reach at the timeline's Kp</span></div></div>`);
    }
    if (L.clouds) {
      parts.push(`<div class="lg-block"><div class="lg-title"><span>Cloud cover</span><span>Open-Meteo</span></div>
        <div class="lg-bar" style="background:linear-gradient(90deg,#0b1222,rgba(120,135,165,.7) 50%,#c3cbdc)"></div>
        <div class="lg-ticks"><span>Clear ✦</span><span>50%</span><span>Overcast</span></div></div>`);
    }
    if (L.lp) {
      parts.push(`<div class="lg-block"><div class="lg-title"><span>Sky brightness, mag/arcsec²</span><span>Lorenz 2025</span></div>
        <div class="lg-zones">${Sky.LP.map((z) => `<i style="background:rgb(${z.rgb.join(',')})" title="Zone ${z.id}: ${z.sqm}"></i>`).join('')}</div>
        <div class="lg-ticks"><span>22.0 dark</span><span>21.3</span><span>20.0</span><span>18.4</span><span>city</span></div></div>`);
    }
    $('#legend').innerHTML = parts.join('');
  };

  // ---------- Inspector ----------
  UI.renderInspector = (d) => {
    const box = $('#inspector');
    if (!d) { box.hidden = true; return; }
    box.hidden = false;
    const s = st();
    const ml = Sky.magLat(d.lat, d.lon), need = Sky.kpNeeded(ml);
    const title = d.title || d.name || 'Dropped pin';
    const w = d.wx ? D.wxAt(d.wx, U.floorHour(s.time)) : null;
    const grid = !w && D.grid ? D.gridAt(D.grid, d.lat, d.lon, s.time) : null;
    const when = s.live ? 'now' : `${U.relDay(s.time).toLowerCase()} ${U.fmtHour(s.time)}`;
    const rows = [];
    // darkness
    if (d.zone === undefined) rows.push(['bulb', 'Sky darkness', skel(110), '']);
    else if (d.zone === null) rows.push(['bulb', 'Sky darkness', 'Unknown', 'The atlas tile did not load']);
    else { const z = Sky.LP[d.zone]; rows.push(['bulb', 'Sky darkness', `<span class="swatch" style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:${Sky.lpColor(d.zone)}"></span>Zone ${z.id} · <span class="mono">${z.sqm} mag/arcsec²</span>`, `≈ Bortle ${z.bortle}. ${Sky.SKY_WORDS[z.bortle]}`]); }
    // clouds
    if (w && w.cc != null) rows.push(['cloud', `Clouds ${when}`, `<span class="mono">${Math.round(w.cc)}%</span>`, `Low ${Math.round(w.low)}% · mid ${Math.round(w.mid)}% · high ${Math.round(w.high)}%`]);
    else if (grid) rows.push(['cloud', `Clouds ${when}`, `<span class="mono">${Math.round(grid.cc)}%</span>`, 'From the regional cloud map']);
    else rows.push(['cloud', `Clouds ${when}`, d.wxErr ? 'Unavailable' : skel(60), '']);
    // aurora
    const v = Sky.ovInView(d.lat, d.lon);
    rows.push(['aurora', 'Aurora', v ? `<span class="mono">${U.pct(v.inView)}</span> in view now` : skel(80), need > 9 ? 'Needs an extreme storm here' : `Needs about Kp ${need.toFixed(1)} · ${Math.abs(ml).toFixed(1)}° magnetic`]);
    // best sky score here (same formula as the map)
    const siteV = D.siteAt(d.lat, d.lon) ?? (Number.isInteger(d.zone) ? Sky.SITE_STARS[d.zone] : null);
    const ccv = w && w.cc != null ? w.cc : grid ? grid.cc : null;
    if (siteV != null && ccv != null) {
      const mode = app().mode();
      const bs = Sky.bestScore({ lat: d.lat, lon: d.lon, t: s.time, cc: ccv, site: siteV, kp: D.kpAt(s.time), mode });
      rows.unshift(['sparkle', `Best sky ${when}`, `<span class="mono">${Math.round(bs * 100)}</span> / 100 · ${Sky.bestLabel(bs)}`, mode === 'stars' ? 'For stargazing: clear and dark' : 'For aurora: clear, dark and in reach']);
    }
    // terrain
    let hzHtml = '';
    if (d.hz === 'loading') hzHtml = 'Checking terrain…';
    else if (d.hz && d.hz.prof) {
      const b = d.hz.block;
      hzHtml = `${b <= 2.5 ? 'Open view' : b <= 6 ? 'Low hills' : 'Terrain blocks'} toward the aurora, about ${b.toFixed(1)}° high. Trees and buildings not included.`;
    } else hzHtml = `<button class="link-btn" type="button" id="insHz">Check the view ${d.lat >= 0 ? 'north' : 'south'}</button>`;
    const elev = d.hz && d.hz.elev != null ? d.hz.elev : d.wx && d.wx.elev != null ? d.wx.elev : null;
    rows.push(['compass', 'Terrain', elev != null ? U.fmtElev(elev) : '–', hzHtml]);
    if (s.home && !(Math.abs(s.home.lat - d.lat) < 1e-5 && Math.abs(s.home.lon - d.lon) < 1e-5)) {
      const km = U.distKm(s.home, d);
      rows.push(['route', 'From home', U.fmtDist(km), `${U.compass(U.bearing(s.home, d))} of home, straight line`]);
    }
    const saved = s.spots.find((p) => Math.abs(p.lat - d.lat) < 1e-4 && Math.abs(p.lon - d.lon) < 1e-4);
    box.innerHTML = `<div class="ins-head"><div style="min-width:0"><span class="eyebrow">${esc(d.kindLabel || (saved ? 'Our spot' : 'Dropped pin'))}</span><h3>${esc(title)}</h3>
        <button class="ins-coords" type="button" id="insCopy" title="Copy coordinates">${U.fmtCoord(d.lat, d.lon)}${icon('copy')}</button></div>
        <button class="icon-btn" type="button" id="insClose" aria-label="Close">${icon('close')}</button></div>
      <div class="ins-rows">${rows.map(([ic, k, v2, sub]) => `<div class="ins-row">${icon(ic)}<div><div class="k">${esc(k)}</div><div class="v">${v2}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div></div>`).join('')}</div>
      <div class="ins-actions">
        ${saved ? `<button class="btn sm" type="button" disabled>${icon('check')}Saved</button>` : `<button class="btn primary sm" type="button" id="insSave">${icon('star')}Save spot</button>`}
        <button class="btn sm" type="button" id="insPlan">${icon('moon')}Plan tonight here</button>
        <a class="btn sm ghost" href="${UI.directionsUrl(d.lat.toFixed(5), d.lon.toFixed(5))}" target="_blank" rel="noopener">${icon('route')}Directions</a>
      </div>`;
    $('#insClose').onclick = () => app().closeInspector();
    $('#insPlan').onclick = () => app().selectPlace({ kind: d.kind || 'pin', lat: d.lat, lon: d.lon, name: title, id: saved ? saved.id : d.id });
    const sv = $('#insSave');
    if (sv) sv.onclick = () => app().saveSpot({ lat: d.lat, lon: d.lon, name: d.name && d.name !== 'Dropped pin' ? d.name : title, kind: d.kindKey || null, zone: d.zone, hz: d.hz && d.hz.prof ? d.hz : null, srcId: d.srcId || null });
    const hb = $('#insHz');
    if (hb) hb.onclick = () => app().checkHorizon(d);
    $('#insCopy').onclick = () => {
      const txt = `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}`;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => UI.toast('Coordinates copied.'), () => UI.toast(txt));
      else UI.toast(txt);
    };
  };
})(window.AA);
