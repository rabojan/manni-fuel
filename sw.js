const CACHE = 'manni-fuel-2-4-20260812-ui-final';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./manifest.json','./manni-world-splash.png','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r=>{ const c=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,c)); return r; }).catch(()=>caches.match(e.request)));
});
