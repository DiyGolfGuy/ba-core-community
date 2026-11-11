// ═══════════════════════════════════════════════════════════════════════════════
//  sw.js — Service Worker (PWA)
//  Static assets cached for speed; API + POST always hit the network fresh.
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'booking-system-v6';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // A SERVICE WORKER HAS NO BUSINESS IN FRONT OF STRIPE OR GOOGLE FONTS
  // (maintainer, Sep 20 2026 - found on a live unit). If we respondWith(fetch(req)) for
  // a CROSS-ORIGIN request, that fetch runs under connect-src (a service
  // worker fetches as "connect", whatever the original request was). connect-src
  // is 'self' + api.stripe.com, so the SW's own fetch of js.stripe.com/v3/ and
  // fonts.googleapis.com was REFUSED - Stripe.js never arrived and every
  // checkout on a controlled page died, and every webfont fell back. Left alone,
  // a cross-origin <script>/<link>/<img> is governed by script-src / style-src /
  // img-src, exactly as it should be. So: never touch another origin. (This is
  // the pattern staff-sw.js already follows.)
  if (url.origin !== self.location.origin) return;

  // Never cache API calls or any non-GET request — always fresh from network
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Pages & static: network-first, fall back to cache when offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/');
      }))
  );
});
