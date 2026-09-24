// Bump on every deploy that changes anything this worker serves. The browser
// only sees an update when this file changes byte for byte, so a version left
// alone is an update bar nobody ever sees.
const VERSION = "2026-09-24.1";

// One cache per version. The new worker precaches into its own cache while
// the old one keeps serving the page on screen from the old cache.
const CACHE = `countdown-${VERSION}`;

// "/" rather than "/index.html": cleanUrls redirects the latter, and a cached
// redirect cannot answer a navigation.
const ASSETS = [
  "/",
  "/style.css",
  "/script.js",
  "/js/theme.js",
  "/js/icons.js",
  "/js/ui.js",
  "/js/update.js",
  "/XCT-192.png",
  "/XCT-512.png",
  "/favicon.ico",
  "/manifest.json"
];

/* -- Install: cache shell, then wait -- */

// No skipWaiting here. A new worker waits until the reader presses Reload in
// the update bar, which posts "skip-waiting" below.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
    .then(cache => cache.addAll(ASSETS.map(url => new Request(url, {
      cache: 'reload'
    }))))
  );
});

/* -- Activate: clean old caches -- */

// No clients.claim here either; claiming on activation would do silently what
// the update bar exists to ask about.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
    .then(keys =>
      Promise.all(
        keys
        .filter(k => k !== CACHE)
        .map(k => caches.delete(k))
      )
    )
  );
});

/* -- Message: the only place skipWaiting is called -- */

self.addEventListener('message', event => {
  const type = typeof event.data === 'string' ? event.data : event.data?.type;

  if (type === 'skip-waiting') {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

/* -- Fetch: strategy per route -- */

self.addEventListener('fetch', event => {
  const {
    request
  } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Page navigations - the cached shell, so the app opens offline
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(navigate(request));
    return;
  }

  if (url.origin === self.location.origin) {
    // API - network-first
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(networkFirst(request));
      return;
    }

    // static assets - cache-first
    event.respondWith(cacheFirst(request));
    return;
  }

  // Google Fonts - cache-first (immutable)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (analytics, ads, background image URLs) goes straight to
  // the network, uncached.
});

/* -- Strategies -- */

async function navigate(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);

  if (url.pathname === '/' || url.pathname === '/index' || url.pathname === '/index.html') {
    const shell = await cache.match('/');
    if (shell) return shell;
  }

  try {
    return await fetch(request);
  } catch {
    // offline - fallback for navigation
    return (await cache.match('/')) || new Response('Offline', {
      status: 503
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'You appear to be offline.'
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json'
        },
      }
    );
  }
}

// Reads and writes this version's cache only, so a waiting worker's cache
// never leaks into the page the old worker is still serving.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', {
      status: 503
    });
  }
}
