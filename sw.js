/* Aurora Atlas service worker: opens offline at a dark spot with the last forecast it saw.
   App files: network first, so updates show up right away. Map tiles: cached as you browse.
   Live data: network first, falling back to the last copy. */
const SHELL_CACHE = 'aa-shell-v10';
const TILE_CACHE = 'aa-tiles';
const DATA_CACHE = 'aa-data';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=10',
  './js/util.js?v=10',
  './js/sky.js?v=10',
  './js/data.js?v=10',
  './js/fx.js?v=10',
  './js/ui.js?v=10',
  './js/app.js?v=10',
  './manifest.webmanifest',
  './icons/icon-192.png',
];
const MAX_TILES = 1800;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aa-shell') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque') cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type !== 'opaque') cache.put(req, res.clone());
  return res;
}

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
  } finally { trimming = false; }
}

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => {
    if (res && res.ok && res.type !== 'opaque') { cache.put(req, res.clone()).then(trimTiles); }
    return res;
  }).catch(() => null);
  if (hit) return hit;
  const res = await net;
  return res || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req, SHELL_CACHE)); return; }
  if (/(^|\.)cdnjs\.cloudflare\.com$|(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) { e.respondWith(cacheFirst(req, SHELL_CACHE)); return; }
  if (/basemaps\.cartocdn\.com$|arcgisonline\.com$|djlorenz\.github\.io$/.test(url.hostname)) { e.respondWith(tile(req)); return; }
  if (/services\.swpc\.noaa\.gov$|api\.open-meteo\.com$/.test(url.hostname)) { e.respondWith(networkFirst(req, DATA_CACHE)); }
});
