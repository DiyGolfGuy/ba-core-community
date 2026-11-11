// staff-sw.js — service worker for the STAFF surface only (scope: /staff).
//
// Purpose: the home-screen app opens INSTANTLY to the code pad and survives a
// flaky moment. Nothing more. Rules, learned the hard way in production:
//   - GET only. POST/PUT/DELETE are never touched, never cached.
//   - /api/ is never cached — live truth or nothing. Off the facility network
//     the shell still renders and its own wifi panel tells the story.
//   - Network-first for the shell so updates land on next open; cache is the
//     fallback, not the source.
'use strict';

const CACHE = 'staff-shell-v2';   // v2: purge shells cached before the no-cache delivery fix (Aug 14)
const SHELL = ['/staff', '/staff-manifest.json', '/staff-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('staff-shell')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch writes
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;           // live truth only
  const isShell = url.pathname === '/staff' || url.pathname === '/staff-manifest.json' || url.pathname === '/staff-icon.png';
  if (!isShell) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.pathname, copy));
      }
      return res;
    }).catch(() => caches.match(url.pathname))
  );
});
