// Offline support. The app shell is cached on install; everything then runs with no connection.
// GitHub API calls always go to the network and are never cached.

const VERSION = 'mt-1.1.0';
const SHELL_CACHE = 'mt-shell-' + VERSION;
const FONT_CACHE = 'mt-fonts-v1';
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './js/main.js', './js/app.js', './js/util.js', './js/db.js', './js/merge.js', './js/state.js', './js/sync.js', './js/ui.js',
  './js/print.js', './js/cardsheet.js', './js/shift.js', './js/msgs.js',
  './js/views/now.js', './js/views/book.js', './js/views/count.js', './js/views/lead.js', './js/views/more.js', './js/views/quick.js'
];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Sofia+Sans+Extra+Condensed:wght@700;800&display=swap';

async function cacheFonts() {
  try {
    const cache = await caches.open(FONT_CACHE);
    if (await cache.match(FONT_CSS)) return;
    const res = await fetch(FONT_CSS, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    const urls = Array.from(new Set((css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g) || []).map((u) => u.slice(4, -1))));
    await Promise.all(urls.map(async (u) => { try { const r = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (r.ok) await cache.put(u, r); } catch (e) { /* fonts are optional */ } }));
  } catch (e) { /* offline install: system fonts are used instead */ }
}

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await cacheFonts();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('mt-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (ev) => { if (ev.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return; // always live
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    ev.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; } catch (e) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  ev.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (e) { return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
