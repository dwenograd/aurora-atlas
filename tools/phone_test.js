// Phone and small-screen test rig for Aurora Atlas. It drives headless Chromium with real touch gestures
// (taps, drags, flicks) against a running copy of the site, and checks the layout and the bottom sheet.
//
//   1. Serve the folder:     python -m http.server 8765
//   2. Run one screen size:  node tools/phone_test.js 390 664
//      Sizes worth running:  360 640 (small Android), 390 664 (iPhone in Safari), 430 932 (large iPhone),
//                            844 390 (phone on its side), 768 1024 (tablet), 1440 900 (desktop)
//   Against the live site:   AA_URL=https://dwenograd.github.io/aurora-atlas/ node tools/phone_test.js 390 664
//
// Needs Playwright: "npm i -D playwright", or point PLAYWRIGHT_CORE at a playwright-core folder and
// CHROME_PATH at a Chromium or Chrome binary. Screenshots and the browser profile go to the system temp
// folder, and the profile is reused so the cached forecast is not downloaded again on every run.
// It asks for the real GPU: Chromium's software renderer draws the map through the sheet in screenshots.
const path = require('path');
const os = require('os');
function loadPlaywright() {
  for (const name of [process.env.PLAYWRIGHT_CORE, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(name); } catch (e) { /* try the next one */ }
  }
  console.error('Playwright not found. Run "npm i -D playwright", or set PLAYWRIGHT_CORE to a playwright-core folder.');
  process.exit(2);
}
const { chromium } = loadPlaywright();
const WORK = path.join(os.tmpdir(), 'aurora-atlas-phone-test');
const OUT = path.join(WORK, 'shots');
const W = +(process.argv[2] || 390), H = +(process.argv[3] || 664), SUITE = process.argv[4] || 'all';
const URL = process.env.AA_URL || 'http://localhost:8765/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext(path.join(WORK, 'profile'), {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    headless: true,
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], // real GPU: the software renderer mis-composites the sheet
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ServiceWorker|sw\.js/.test(m.text())) errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); // always test the files on disk
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${W}x${H}-${name}.png`) }); };
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) }; }, sel);
  const sheet = () => page.evaluate(() => ({ snap: AA.UI.sheet.snap, vis: Math.round(AA.UI.sheet.vis), h: AA.UI.sheet.heights, on: AA.UI.sheet.enabled }));
  // a real finger drag through the browser's input pipeline
  async function drag(x0, y0, x1, y1, { steps = 12, stepMs = 16, hold = 0 } = {}) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await sleep(stepMs);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    }
    if (hold) await sleep(hold);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(520);
  }
  const tap = async (x, y) => { await page.touchscreen.tap(x, y); await sleep(350); };

  await page.goto(URL + '?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AA && AA.app && AA.UI && AA.UI.sheet, null, { timeout: 30000 });
  const phone = await page.evaluate(() => AA.UI.sheet.enabled);
  console.log(`viewport ${W}x${H}, phone sheet mode: ${phone}`);

  // ---------- welcome ----------
  const hadHome = await page.evaluate(() => !!AA.state.home);
  if (hadHome) await page.evaluate(() => AA.app.showWelcome());
  await sleep(2200);
  await shot('01-welcome');
  {
    const field = await rect('#homeQuery'), btns = await rect('.welcome-actions'), title = await rect('.welcome-title');
    check('welcome: title, search field and buttons all on screen', title.y >= 0 && field.y > 0 && field.r <= W && btns.b <= H && btns.r <= W, JSON.stringify({ title, field, btns }));
    const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#homeQuery')).fontSize));
    check('welcome: search text is 16px or more (no iOS zoom)', fs >= 16, fs + 'px');
  }
  if (hadHome) await page.evaluate(() => document.querySelector('#welcomeBack').click());
  else {
    await page.evaluate(() => AA.app.setHome({ lat: 47.6062, lon: -122.3321, name: 'Seattle' }, { fly: false }));
    await sleep(1500);
    await page.evaluate(() => AA.app.centerOn(AA.state.home.lat, AA.state.home.lon, AA.UI.sheet.enabled ? 6.5 : 7.5));
  }
  await sleep(1300);
  await page.waitForFunction(() => AA.D.grid && AA.D.site && AA.D.ov && AA.D.kpFc.length, null, { timeout: 60000 }).catch(() => console.log('data wait timed out'));
  await sleep(2500);
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); });

  // ---------- layout ----------
  const g = { top: await rect('.topbar'), layers: await rect('#layers'), tl: await rect('#timeline'), panel: await rect('#panel'), ctl: await rect('.mapctl'), map: await rect('#map') };
  const s0 = await sheet();
  await shot('02-home');
  const homePt = await page.evaluate(() => { const p = AA.app.map.latLngToContainerPoint([AA.state.home.lat, AA.state.home.lon]); return { x: Math.round(p.x), y: Math.round(p.y) }; });
  if (phone) {
    check('map fills the screen', g.map.w === W && g.map.h === H, JSON.stringify(g.map));
    check('top bar inside the screen', g.top.x >= 0 && g.top.r <= W && g.top.y >= 0, JSON.stringify(g.top));
    check('timeline sits just above the sheet', Math.abs(g.tl.b + 8 - g.panel.y) <= 2, `timeline bottom ${g.tl.b}, sheet top ${g.panel.y}`);
    const mapVisible = g.tl.y - g.layers.b;
    check('map has room (>= 150px between layer chips and timeline at half)', mapVisible >= 150, mapVisible + 'px');
    check('home is in the visible part of the map', homePt.y > g.layers.b && homePt.y < g.tl.y && homePt.x > 0 && homePt.x < W, JSON.stringify(homePt));
    check('sheet starts at half', s0.snap === 'half' && Math.abs(H - g.panel.y - s0.h.half) <= 2, JSON.stringify(s0));
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth);
    check('no sideways overflow', noOverflow);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.chip span')].map((x) => getComputedStyle(x).display !== 'none' && x.getBoundingClientRect().width > 10));
    check('layer chips show their labels', chips.every(Boolean), JSON.stringify(chips));
    // the one-line map key: always there, says which color is which, and stays out of the way
    const key = await rect('#legend'), strip = await rect('#keyStrip');
    const keyTxt = await page.evaluate(() => [...document.querySelectorAll('#keyStrip .kc')].map((c) => c.textContent));
    check('map key strip sits on the map between the layer chips, the timeline and the map buttons', !!strip && key.y >= g.layers.b && key.b <= g.tl.y && key.x >= 0 && key.r <= g.ctl.x, JSON.stringify({ key, ctl: g.ctl }));
    check('map key strip names stargazing and aurora', keyTxt.some((t) => /Stargazing/.test(t)) && keyTxt.some((t) => /Aurora/.test(t)), JSON.stringify(keyTxt));
    check('map key strip leaves most of the map free', !!strip && g.tl.y - g.layers.b - key.h >= 110, `${g.tl.y - g.layers.b - (key ? key.h : 0)}px above the strip`);
  }

  if (phone && (SUITE === 'all' || SUITE === 'sheet')) {
    // ---------- sheet drags ----------
    const gripY = g.panel.y + 10;
    await drag(W / 2, gripY, W / 2, gripY - 260, { steps: 10 });
    let s = await sheet();
    check('flick up on the grip opens the sheet fully', s.snap === 'full', JSON.stringify(s));
    await shot('03-sheet-full');
    const scrollable = await page.evaluate(() => { const b = document.querySelector('#tab-tonight'); return getComputedStyle(b).overflowY === 'auto' && b.scrollHeight > b.clientHeight; });
    check('content scrolls at full', scrollable);
    // native scroll inside the content
    const p1 = await rect('#panel');
    await drag(W / 2, p1.y + 320, W / 2, p1.y + 120, { steps: 10 });
    const st1 = await page.evaluate(() => document.querySelector('#tab-tonight').scrollTop);
    s = await sheet();
    check('swipe up inside the full sheet scrolls the content', st1 > 40 && s.snap === 'full', `scrollTop ${st1}, snap ${s.snap}`);
    // swipe down scrolls back first...
    await drag(W / 2, p1.y + 150, W / 2, p1.y + 420, { steps: 10 });
    await sleep(400);
    await page.evaluate(() => { document.querySelector('#tab-tonight').scrollTop = 0; });
    // ...and from the top, pulling down shrinks the sheet
    await drag(W / 2, p1.y + 150, W / 2, p1.y + 330, { steps: 10 });
    s = await sheet();
    check('pulling down from the top of the content shrinks the sheet to half', s.snap === 'half', JSON.stringify(s));
    // flick the header down to the tab bar
    const p2 = await rect('#panel');
    await drag(W / 2, p2.y + 12, W / 2, p2.y + 240, { steps: 8 });
    s = await sheet();
    const pk = await rect('#panel');
    check('flick down leaves just the tab bar', s.snap === 'peek' && Math.abs(H - pk.y - s.h.peek) <= 2, JSON.stringify(s));
    await shot('04-sheet-peek');
    const tlPeek = await rect('#timeline');
    check('timeline follows the sheet down', Math.abs(tlPeek.b + 8 - pk.y) <= 2, `timeline bottom ${tlPeek.b}, sheet top ${pk.y}`);
    // tap a tab at peek -> half with that tab
    const tabSpots = await rect('.tab-btn[data-tab="spots"]');
    await tap(tabSpots.x + tabSpots.w / 2, tabSpots.y + tabSpots.h / 2);
    await sleep(400);
    s = await sheet();
    const active = await page.evaluate(() => AA.UI.activeTab);
    check('tapping a tab on the tab bar opens the sheet to it', s.snap === 'half' && active === 'spots', `${s.snap} / ${active}`);
    // drag up from the content at half (finger anywhere on the sheet)
    const p3 = await rect('#panel');
    await drag(W / 2, p3.y + 150, W / 2, p3.y - 120, { steps: 10 });
    s = await sheet();
    check('dragging the content up at half opens the sheet', s.snap === 'full', JSON.stringify(s));
    // slow drag to in-between then release -> nearest stop
    const p4 = await rect('#panel');
    await drag(W / 2, p4.y + 12, W / 2, p4.y + 60, { steps: 12, stepMs: 30, hold: 300 });
    s = await sheet();
    check('a short slow drag springs back to the nearest stop', s.snap === 'full', JSON.stringify(s));
    // grip tap toggles
    const p5 = await rect('#sheetGrip');
    await tap(p5.x + p5.w / 2, p5.y + p5.h / 2);
    await sleep(450);
    s = await sheet();
    check('tapping the grip steps the sheet', s.snap === 'half', JSON.stringify(s));
    // tabs: tap Forecast
    const tabF = await rect('.tab-btn[data-tab="tonight"]');
    await tap(tabF.x + tabF.w / 2, tabF.y + tabF.h / 2);
    await sleep(300);
  }

  if (phone && (SUITE === 'all' || SUITE === 'map')) {
    // ---------- tap the map: place card in the sheet ----------
    await page.evaluate(() => AA.UI.sheet.snapTo('half', { animate: false }));
    await sleep(300);
    const lay = await rect('#layers'), tl = await rect('#timeline');
    await tap(110, Math.round((lay.b + tl.y) / 2));
    await sleep(2200);
    const ins = await rect('#inspector');
    const close = await rect('#insClose');
    const s = await sheet();
    await shot('05-place-card');
    check('map tap opens the place card inside the sheet', await page.evaluate(() => document.querySelector('#inspector').parentElement.id === 'panel' && !document.querySelector('#inspector').hidden));
    check('place card close button is on screen', close && close.y >= (await rect('#panel')).y && close.b <= H && close.r <= W, JSON.stringify(close));
    check('sheet is at half for the place card', s.snap === 'half', s.snap);
    const pin = await page.evaluate(() => { const d = AA.state.inspect; const p = AA.app.map.latLngToContainerPoint([d.lat, d.lon]); return { x: Math.round(p.x), y: Math.round(p.y) }; });
    check('the dropped pin stays visible above the timeline', pin.y > lay.b && pin.y < tl.y, JSON.stringify(pin));
    const acts = await page.evaluate(() => { const a = document.querySelector('.ins-actions'), r = a.getBoundingClientRect(); return { y: Math.round(r.top), b: Math.round(r.bottom), n: a.children.length }; });
    check('place card actions are reachable without scrolling', acts.b <= H, JSON.stringify(acts));
    // tap near the bottom edge of the visible map (beside the key strip): the pin should be nudged into view
    const edgeX = await page.evaluate((y) => { for (let x = innerWidth - 16; x > 16; x -= 6) { const e = document.elementFromPoint(x, y); if (e && e.closest('#map')) return x; } return null; }, tl.y - 14);
    check('there is bare map to tap beside the key strip', edgeX != null, String(edgeX));
    await tap(edgeX == null ? W / 2 : edgeX, tl.y - 14);
    await sleep(1200);
    const pin2 = await page.evaluate(() => { const d = AA.state.inspect; const p = AA.app.map.latLngToContainerPoint([d.lat, d.lon]); return { x: Math.round(p.x), y: Math.round(p.y) }; });
    check('a pin dropped at the map edge is nudged into view', pin2.y < tl.y - 20, JSON.stringify(pin2));
    // "Plan tonight here" swaps the card for the forecast of that place
    await page.evaluate(() => document.querySelector('#insPlan').click());
    await sleep(700);
    const after = await page.evaluate(() => ({ tab: AA.UI.activeTab, inspecting: document.querySelector('#panel').classList.contains('inspecting'), kind: document.querySelector('#placeKind').textContent, back: !document.querySelector('#backHome').hidden }));
    check('"Plan tonight here" shows that place\'s forecast', after.tab === 'tonight' && !after.inspecting && after.back, JSON.stringify(after));
    await page.evaluate(() => document.querySelector('#backHome').click());
    await sleep(1600);
    // close button works
    await tap(110, Math.round((lay.b + tl.y) / 2));
    await sleep(900);
    const c2 = await rect('#insClose');
    await tap(c2.x + c2.w / 2, c2.y + c2.h / 2);
    await sleep(400);
    check('close button dismisses the place card', await page.evaluate(() => document.querySelector('#inspector').hidden && !document.querySelector('#panel').classList.contains('inspecting')));
  }

  if (phone && (SUITE === 'all' || SUITE === 'chrome')) {
    // ---------- night vision keeps the layout ----------
    const before = { panel: await rect('#panel'), tl: await rect('#timeline'), map: await rect('#map') };
    const nb = await rect('#nightBtn');
    await tap(nb.x + nb.w / 2, nb.y + nb.h / 2);
    await sleep(500);
    const nv = { panel: await rect('#panel'), tl: await rect('#timeline'), map: await rect('#map'), on: await page.evaluate(() => document.documentElement.classList.contains('night-vision')) };
    await shot('06-night-vision');
    check('night vision keeps every panel in place', nv.on && JSON.stringify(before.panel) === JSON.stringify(nv.panel) && JSON.stringify(before.tl) === JSON.stringify(nv.tl) && nv.map.h === H, JSON.stringify(nv));
    await tap(nb.x + nb.w / 2, nb.y + nb.h / 2);
    await sleep(300);
    // ---------- map key ----------
    const lb = await rect('#legendBtn');
    check('map key button on screen', lb && lb.y > 0 && lb.b < H && lb.r <= W, JSON.stringify(lb));
    await tap(lb.x + lb.w / 2, lb.y + lb.h / 2);
    await sleep(400);
    await sleep(500);
    const lg = await rect('#legend'), layK = await rect('#layers'), tlK = await rect('#timeline');
    await shot('07-map-key');
    const lgOk = await page.evaluate(() => { const l = document.querySelector('#legend'); return !l.classList.contains('compact') && !!l.querySelector('.lg-credits') && getComputedStyle(l.querySelector('.lg-credits')).display !== 'none'; });
    check('map key opens with the map credits', lgOk, JSON.stringify(lg));
    check('map key fits between the layer chips and the timeline', lg.y >= layK.b && lg.b <= tlK.y, `key ${lg.y}-${lg.b}, chips end ${layK.b}, timeline starts ${tlK.y}`);
    check('sheet steps down to the tab bar while the key is open', (await sheet()).snap === 'peek');
    await tap(W - 40, layK.b + 24);
    await sleep(700);
    check('tapping the map shrinks the key to its strip (no stray pin) and the sheet comes back', await page.evaluate(() => document.querySelector('#legend').classList.contains('compact') && !!document.querySelector('#keyStrip') && !AA.state.inspect && AA.UI.sheet.snap === 'half'));
    // the strip opens the key too, and the key's own close button shrinks it again
    const ks = await rect('#keyStrip');
    await tap(ks.x + ks.w / 2, ks.y + ks.h / 2);
    await sleep(700);
    const opened = await page.evaluate(() => !document.querySelector('#legend').classList.contains('compact') && !AA.state.inspect);
    const kc = await rect('#keyClose');
    await shot('07b-map-key-from-strip');
    if (kc) await tap(kc.x + kc.w / 2, kc.y + kc.h / 2);
    await sleep(700);
    check('tapping the strip opens the key, and its close button shrinks it again', opened && !!kc && await page.evaluate(() => document.querySelector('#legend').classList.contains('compact') && !!document.querySelector('#keyStrip') && AA.UI.sheet.snap === 'half'), JSON.stringify({ opened, kc }));
    // ---------- layer chips ----------
    const chip = await rect('.chip[data-layer="clouds"]');
    await tap(chip.x + chip.w / 2, chip.y + chip.h / 2);
    await sleep(300);
    check('layer chip toggles', await page.evaluate(() => AA.state.settings.layers.clouds === true));
    await tap(chip.x + chip.w / 2, chip.y + chip.h / 2);
    await sleep(200);
    // the chip row scrolls sideways
    const lay2 = await rect('#layers');
    await drag(W - 60, lay2.y + lay2.h / 2, 40, lay2.y + lay2.h / 2, { steps: 8 });
    const sl = await page.evaluate(() => document.querySelector('#layers').scrollLeft);
    check('layer chips scroll sideways', sl > 40, 'scrollLeft ' + sl);
    await page.evaluate(() => { document.querySelector('#layers').scrollLeft = 0; });
    // ---------- timeline scrub ----------
    const cv = await rect('#tlCanvas');
    await drag(cv.x + 30, cv.y + cv.h / 2, cv.x + cv.w * 0.6, cv.y + cv.h / 2, { steps: 8 });
    const tm = await page.evaluate(() => ({ live: AA.state.live, ahead: Math.round((AA.state.time - Date.now()) / 3600e3) }));
    check('dragging the timeline scrubs the forecast', !tm.live && tm.ahead > 10, JSON.stringify(tm));
    await shot('08-scrubbed');
    await page.evaluate(() => document.querySelector('#tlNow').click());
    // ---------- live strip shortcut ----------
    const live = await rect('#live');
    await tap(live.x + 40, live.y + live.h / 2);
    await sleep(500);
    check('tapping the live strip opens space weather', await page.evaluate(() => AA.UI.activeTab === 'space'));
    await shot('09-space');
    // ---------- touch targets ----------
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.topbar button, .layers button, .mapctl button, .tabs button, .timeline button')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.width < 32 || r.height < 32) out.push(`${el.id || el.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    check('main controls are at least 32px', small.length === 0, small.join(', '));
  }

  if (phone && (SUITE === 'all' || SUITE === 'flows')) {
    // ---------- plan a night ----------
    await page.evaluate(() => { AA.UI.setTab('tonight'); AA.UI.sheet.snapTo('full', { animate: false }); });
    await sleep(500);
    const ok = await page.evaluate(() => { const b = document.querySelector('#nights .far, #nights .night:last-child'); if (!b) return false; b.click(); return true; });
    await sleep(2500);
    const plan = await page.evaluate(() => ({ plan: !!AA.state.plan, areas: AA.state.plan ? AA.state.plan.areas.length : 0, snap: AA.UI.sheet.snap, card: (() => { const c = document.querySelector('.plan-card'); if (!c) return null; const r = c.getBoundingClientRect(); return { y: Math.round(r.top), b: Math.round(r.bottom) }; })() }));
    const pnl = await rect('#panel');
    await shot('10-plan-night');
    check('planning a night drops the sheet to half and shows the plan card', ok && plan.plan && plan.snap === 'half' && plan.card && plan.card.y >= pnl.y && plan.card.y < H - 60, JSON.stringify(plan));
    const pins = await page.evaluate(() => { const lay = document.querySelector('#layers').getBoundingClientRect().bottom, tl = document.querySelector('#timeline').getBoundingClientRect().top; return AA.state.plan.areas.map((a) => { const p = AA.app.map.latLngToContainerPoint([a.lat, a.lon]); return p.y > lay - 10 && p.y < tl + 10 && p.x > -5 && p.x < innerWidth + 5; }); });
    await sleep(1600);
    const pins2 = await page.evaluate(() => { const lay = document.querySelector('#layers').getBoundingClientRect().bottom, tl = document.querySelector('#timeline').getBoundingClientRect().top; return AA.state.plan.areas.map((a) => { const p = AA.app.map.latLngToContainerPoint([a.lat, a.lon]); return p.y > lay - 10 && p.y < tl + 10 && p.x > -5 && p.x < innerWidth + 5; }); });
    check('the planned areas A, B, C land in the visible map', pins2.length > 0 && pins2.every(Boolean), JSON.stringify(pins2));
    await shot('11-plan-night-map');
    await page.evaluate(() => AA.app.clearPlan());
    // ---------- journal form: fields are 16px and the sheet opens for typing ----------
    await page.evaluate(() => { AA.UI.setTab('log'); AA.UI.sheet.snapTo('half', { animate: false }); document.querySelector('#logNewBtn').click(); });
    await sleep(600);
    const form = await page.evaluate(() => ({ snap: AA.UI.sheet.snap, fs: [...document.querySelectorAll('#logForm input:not([type=checkbox]), #logForm textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize)), wide: [...document.querySelectorAll('#logForm input:not([type=checkbox]), #logForm textarea')].every((e) => e.getBoundingClientRect().right <= innerWidth) }));
    await shot('12-journal-form');
    check('journal form opens the sheet and uses 16px fields', form.snap === 'full' && form.fs.every((f) => f >= 16) && form.wide, JSON.stringify(form));
    await page.evaluate(() => { document.querySelector('#lgCancel').click(); AA.UI.setTab('tonight'); AA.UI.sheet.snapTo('half', { animate: false }); });
    // ---------- settings modal fits ----------
    await page.evaluate(() => document.querySelector('#settingsBtn').click());
    await sleep(500);
    const mc = await rect('.modal-card');
    await shot('13-settings');
    check('settings fits the screen', mc.x >= 0 && mc.r <= W && mc.y >= 0 && mc.b <= H, JSON.stringify(mc));
    await page.evaluate(() => AA.UI.closeModal());
  }

  if (!phone) {
    await shot('02-layout');
    const r = { panel: await rect('#panel'), tl: await rect('#timeline'), rc: await rect('.rightcol'), top: await rect('.topbar'), ins: null };
    check('panel inside the screen', r.panel.y >= 0 && r.panel.b <= H && r.panel.r <= W, JSON.stringify(r.panel));
    check('timeline inside the screen', r.tl.y >= 0 && r.tl.b <= H && r.tl.r <= W && r.tl.x >= r.panel.r, JSON.stringify(r.tl));
    check('layer buttons inside the screen', r.rc.y >= r.top.b && r.rc.b <= r.tl.y + 2 && r.rc.r <= W, JSON.stringify(r.rc));
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check('no sideways overflow', noOverflow);
    // the map key: strip or full, it is on the map and clear of the panel and the timeline; the key button swaps them
    const onMap = (k) => !!k && k.w > 0 && k.x >= r.panel.r && k.r <= W && k.y >= r.top.b && k.b <= r.tl.y;
    const key1 = await rect('#legend');
    const full1 = await page.evaluate(() => !document.querySelector('#legend').classList.contains('compact'));
    await page.evaluate(() => document.querySelector('#legendBtn').click());
    await sleep(300);
    const key2 = await rect('#legend');
    const full2 = await page.evaluate(() => !document.querySelector('#legend').classList.contains('compact'));
    await shot(full2 ? '02b-key-full' : '02b-key-strip');
    check('map key is on the map as a strip or in full, and the key button swaps them', onMap(key1) && onMap(key2) && full1 !== full2, JSON.stringify({ full1, key1, full2, key2 }));
    const names = await page.evaluate(() => document.querySelector('#legend').textContent);
    check('map key names stargazing and aurora', /Stargazing/.test(names) && /Aurora/.test(names), names.slice(0, 80));
    await page.evaluate(() => document.querySelector('#legendBtn').click());
    await sleep(300);
    const mx = r.panel.r + 70, my = Math.round((r.top.b + r.tl.y) / 2); // clear of the legend and the layer buttons
    await tap(mx, my);
    await sleep(1800);
    const ins = await rect('#inspector'), close = await rect('#insClose');
    await shot('03-place-card');
    check('place card and its close button are on screen', ins && close && ins.y >= 0 && ins.b <= H && close.y >= 0 && close.r <= W, JSON.stringify({ ins, close }));
    await page.evaluate(() => AA.app.closeInspector());
    await page.evaluate(() => document.documentElement.classList.add('night-vision'));
    await sleep(300);
    const nv = await rect('#panel');
    check('night vision keeps the panel in place', JSON.stringify(nv) === JSON.stringify(r.panel), JSON.stringify(nv));
    await page.evaluate(() => document.documentElement.classList.remove('night-vision'));
  }

  check('no script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed. Screenshots: ${OUT}`);
  await ctx.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('RIG ERROR', e); process.exit(2); });
