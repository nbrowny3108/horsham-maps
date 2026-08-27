const APP = "horsham-app-v21";
const TILES = "horsham-tiles-v4";
const DATA = "horsham-data-v1";
const KEEP = new Set([APP, TILES, DATA]);

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function precacheShell() {
  const cache = await caches.open(APP);
  const urls = new Set(["/", "/manifest.webmanifest", "/favicon.svg", "/__grok/icon-180.png"]);
  try {
    const home = await fetch("/", { cache: "no-store" });
    if (home.ok) {
      await cache.put("/", home.clone());
      const html = await home.text();
      for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
        if (m[1]) urls.add(m[1]);
      }
    }
  } catch {
    /* first paint still works without a full precache */
  }
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        if (url === "/") return;
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res.clone());
      } catch {
        /* skip */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheShell();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isTile(url) {
  return url.pathname.startsWith("/api/tiles/");
}

function isData(url) {
  return url.pathname.startsWith("/data/") || url.pathname === "/api/grading";
}

function isAsset(url) {
  return url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg" || url.pathname.endsWith(".svg");
}

function keyOf(url) {
  return url.origin + url.pathname;
}

async function tileOnly(request) {
  const url = new URL(request.url);
  const key = keyOf(url);
  const cache = await caches.open(TILES);
  const hit = await cache.match(key);
  if (hit) return hit;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response("", { status: 504 });
  } finally {
    clearTimeout(t);
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const url = new URL(request.url);
  const key = keyOf(url);
  const hit = (await cache.match(key)) || (await cache.match(request));
  if (hit) {
    fetch(request)
      .then((res) => {
        if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
      })
      .catch(() => {});
    return hit;
  }
  const res = await fetch(request);
  if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
  return res;
}

function networkWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isTile(url)) {
    event.respondWith(tileOnly(req));
    return;
  }
  if (isData(url)) {
    event.respondWith(cacheFirst(DATA, req));
    return;
  }
  if (isAsset(url)) {
    event.respondWith(cacheFirst(APP, req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP);
        try {
          const res = await networkWithTimeout(req, 1800);
          if (res && res.ok) cache.put("/", res.clone()).catch(() => {});
          return res;
        } catch {
          return (await cache.match("/")) || (await cache.match(req)) || fetch(req);
        }
      })(),
    );
  }
});
