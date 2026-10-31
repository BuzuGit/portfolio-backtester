/*
  SERVICE WORKER (phones only): makes the app open instantly, even with no signal.

  What a service worker is: a small script the browser keeps installed for this site, which sits
  between the app and the internet. Every file the app asks for passes through it, so it can answer
  from a copy kept on the phone instead of downloading it again. Think of a personal assistant who
  keeps photocopies of the documents you use every day and hands you a copy straight away.

  What it keeps:
    - the page itself ("/"): answered from the copy at once, while a fresh copy is downloaded in the
      background for next time. So after a new version is published, the phone shows it from the
      SECOND opening on (the first one quietly fetches it).
    - the app's code and styles (/_next/static/...): their names change with every new version, so
      a kept copy can never be out of date. Kept until a new version no longer uses them.
  What it leaves alone: everything else, above all the Google Sheet. The data has its own saved
  copy (lib/savedSheet.ts), which the app shows while it fetches fresh numbers.

  Only phones install it: the app registers it on a phone (narrow screen + touch) and removes it
  anywhere else, so desktop keeps loading straight from the internet, as always.
*/

// Rename this (v2, v3...) to throw away everything kept and start over, e.g. after changing this file
const CACHE = 'backtester-v1';

self.addEventListener('install', event => {
  // Take over straight away rather than waiting for every open copy of the app to close
  self.skipWaiting();
  // Keep a first copy of the page, so the very next opening already works without signal
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/')).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Drop the copies kept by an older version of this file
    for (const name of await caches.keys()) {
      if (name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// After a fresh copy of the page arrives: forget kept code files the new version no longer uses,
// so the phone doesn't collect old versions forever. The page lists every code file it needs
// (as "static/chunks/..." paths), so anything kept that isn't named in it is from an old version.
async function forgetOldFiles(cache, pageHtml) {
  const used = new Set(pageHtml.match(/static\/[\w\-./%]+\.(?:js|css)/g) || []);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/_next/static/') && !used.has(path.slice('/_next/'.length))) {
      await cache.delete(request);
    }
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other sites (the Google Sheet): not touched, straight to the internet
  if (url.origin !== self.location.origin) return;

  // The page itself: the kept copy at once, a fresh one fetched in the background for next time
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const kept = await cache.match('/');
      const fresh = fetch(request).then(async response => {
        if (response.ok) {
          await cache.put('/', response.clone());
          await forgetOldFiles(cache, await response.clone().text());
        }
        return response;
      });
      if (kept) {
        event.waitUntil(fresh.catch(() => {})); // no signal: fine, the kept copy is already showing
        return kept;
      }
      return fresh; // nothing kept yet (the very first visit): the internet as usual
    })());
    return;
  }

  // The app's code and styles: the kept copy if there is one, otherwise download it and keep it
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const kept = await cache.match(request);
      if (kept) return kept;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })());
  }
  // Anything else: not touched
});
