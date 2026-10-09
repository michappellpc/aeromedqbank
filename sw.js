// Offline support. App files and questions: network first (always fresh when online), cached copy when offline.
// Fonts and icons: cache first. Bump VERSION to force old caches to be dropped.
const VERSION = 'qbank-v134';
const CORE = ['./', 'index.html', 'css/style.css', 'privacy.html', 'terms.html', 'js/store.js', 'js/cloud.js', 'js/qvalidate.js', 'js/related.js', 'js/links.js', 'js/cardsched.js', 'js/cvalidate.js', 'js/calc.js', 'js/calcui.js', 'js/hl.js', 'js/perf.js', 'js/onthisday-data.js', 'js/onthisday.js', 'js/handoff.js', 'js/itemstats.js', 'js/adminitems.js', 'js/insights.js', 'js/outlines-data.js', 'js/objectives.js', 'js/objpicker.js', 'js/hlui.js', 'js/mycards.js', 'js/notebook.js', 'js/cards.js', 'js/admincards.js', 'js/lvalidate.js', 'js/lessons.js', 'js/program.js', 'js/admin.js', 'js/adminlessons.js', 'js/inbox.js', 'js/support.js', 'js/mascot.js', 'js/app.js', 'manifest.webmanifest',
  'fonts/inter-latin-400-normal.woff2', 'fonts/inter-latin-500-normal.woff2', 'fonts/inter-latin-600-normal.woff2', 'fonts/inter-latin-700-normal.woff2', 'fonts/stardos-stencil-latin-400-normal.woff2', 'fonts/stardos-stencil-latin-700-normal.woff2',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'data/manifest.json', 'data/config.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map(async u => { const r = await fetch(u, { cache: 'reload' }); if (!r.ok) throw new Error(u); await cache.put(u, r); }));   // 'reload' skips the browser cache so nothing stale is stored
    try { // also cache every question file listed in the data manifest
      const m = await (await fetch('data/manifest.json', { cache: 'no-store' })).json();
      await Promise.all(m.files.map(f => cache.add('data/' + f).catch(() => {})));
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const cacheFirst = /\/(fonts|icons)\//.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (cacheFirst) {
      const hit = await cache.match(req); if (hit) return hit;
    }
    try {
      const res = await fetch(req, { cache: 'no-cache' });     // always ask the server, so an update is never hidden by the browser's own cache
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
