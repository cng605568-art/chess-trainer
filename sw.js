/*
 * sw.js: lets Second Look install like an app and keep working offline.
 *
 * - Site files (HTML, CSS, JS, puzzles): network first, so every visit
 *   gets the latest version; the saved copy is used when offline.
 * - Library files from CDNs (Stockfish, chess.js, pieces, fonts): saved the
 *   first time and reused, so the bot and coach run without a connection.
 */
'use strict';

var VERSION = 'v1';
var SITE_CACHE = 'second-look-site-' + VERSION;
var LIB_CACHE = 'second-look-libs-' + VERSION;

var SHELL = [
  './',
  './style.css',
  './app.js',
  './coach.js',
  './stockfish-worker.js',
  './puzzles.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

var LIB_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'upload.wikimedia.org',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com'
];

// Library URLs without a version number in them: refresh in the background.
var REFRESH_HOSTS = ['fonts.googleapis.com', 'cdn.tailwindcss.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SITE_CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .catch(function () { /* offline during install: pages still cache as they load */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k.indexOf('second-look-') === 0 && k !== SITE_CACHE && k !== LIB_CACHE;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
  });
}

/**
 * Site files: try the network (briefly), fall back to the saved copy.
 * Pages are saved without their ?query so /?source=app opens offline too.
 */
function networkFirst(request, url, isPage) {
  var key = isPage ? url.origin + url.pathname : request;
  return caches.open(SITE_CACHE).then(function (cache) {
    var fromNetwork = fetch(request).then(function (response) {
      if (response && response.ok && !response.redirected) cache.put(key, response.clone());
      return response;
    });
    return withTimeout(fromNetwork, 5000).catch(function () {
      return cache.match(key, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return isPage ? cache.match('./').then(function (home) { return home || fromNetwork; }) : fromNetwork;
      });
    });
  });
}

/** Library files: use the saved copy, fetch and save it the first time. */
function cacheFirst(request, refresh) {
  return caches.open(LIB_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var fetched = fetch(request).then(function (response) {
        if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
        return response;
      });
      if (hit) {
        if (refresh) fetched.catch(function () { /* stay with the saved copy */ });
        return hit;
      }
      return fetched;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/_vercel') === 0) return;
    event.respondWith(networkFirst(request, url, request.mode === 'navigate'));
    return;
  }
  if (LIB_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(request, REFRESH_HOSTS.indexOf(url.hostname) !== -1));
  }
});
