const APP = "horsham-app-v16";
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
      const data = await caches.open(DATA);
      try {
        const res = await fetch("/data/cache-manifest.json");
        const list = res.ok ? await res.json() : [];
        await Promise.all(
          (Array.isArray(list) ? list : []).slice(0, 24).map(async (url) => {
            try {
              const file = await fetch(url);
              if (file.ok) await data.put(url, file.clone());
            } catch {
              /* skip */
            }
          }),
        );
      } catch {
        /* ok */
      }
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

function isShell(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg" ||
    url.pathname.endsWith(".svg")
  );
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
  const res = await fetch(key);
  if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
  return res;
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const url = new URL(request.url);
  const key = keyOf(url);
  const hit = (await cache.match(key)) || (await cache.match(request));
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const again = await cache.match(key);
    if (again) return again;
    throw err;
  }
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
  if (isShell(url)) {
    event.respondWith(cacheFirst(APP, req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/") || caches.match(req)),
    );
  }
});
