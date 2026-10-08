/**
 * App shell cache.
 *
 * Safari shows a blank white page when a service worker's respondWith()
 * rejects, or when the Response it returns followed a redirect (`redirected`
 * stays true, including after cache.put). Every navigation answer is copied
 * into a fresh Response, and every handler resolves to some Response.
 */
const APP = "horsham-app-v26";
const TILES = "horsham-tiles-v5";
const DATA = "horsham-data-v1";
const KEEP = new Set([APP, TILES, DATA]);

function shellUrl() {
  return new URL("/", self.location.href).href;
}

function isShellRequest(request) {
  const url = new URL(request.url);
  return url.pathname === "/" && !url.searchParams.has("install");
}

function isNavigation(request) {
  if (request.mode === "navigate" || request.destination === "document") return true;
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/html")) return false;
  const path = new URL(request.url).pathname;
  return !path.includes(".");
}

function isTile(url) {
  return url.pathname.startsWith("/api/tiles/");
}

function isData(url) {
  return url.pathname.startsWith("/data/") || url.pathname === "/api/grading";
}

function isAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/__grok/icon-180.png" ||
    url.pathname.endsWith(".svg")
  );
}

function isGoodAsset(res, url) {
  if (!res || !res.ok) return false;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html")) return false;
  const path = url.pathname;
  if ((path.endsWith(".js") || path.endsWith(".mjs")) && type && !type.includes("javascript") && !type.includes("ecmascript")) {
    return false;
  }
  if (path.endsWith(".css") && type && !type.includes("css")) return false;
  return true;
}

function fallbackHtml() {
  return [
    "<!doctype html><html><head><meta charset=utf-8>",
    '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">',
    "<title>Horsham Maps</title></head>",
    '<body style="margin:0;background:#fff;color:#202124;font:16px/1.45 system-ui,sans-serif">',
    '<main style="max-width:28rem;margin:0 auto;padding:2.5rem 1.25rem">',
    '<h1 style="font-size:1.35rem;margin:0 0 .5rem">Horsham Maps did not start</h1>',
    '<p style="margin:0 0 1rem">The saved copy of the app is missing or out of date. Reload a fresh copy. If this keeps happening, check the connection and try again.</p>',
    '<button id=recover type=button style="height:3rem;padding:0 1rem;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-weight:700">Reload a fresh copy</button>',
    "</main><script>",
    "document.getElementById('recover').onclick=function(){",
    "var done=function(){location.replace('/');};",
    "var jobs=[];",
    "if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}))}",
    "if(window.caches){jobs.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}))}",
    "setTimeout(done,2500);Promise.all(jobs).then(done,done);};",
    "</" + "script></body></html>",
  ].join("");
}

function fallbackHtmlResponse() {
  return new Response(fallbackHtml(), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function missingFile() {
  return new Response("Missing file", {
    status: 504,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Fresh Response so Safari does not see a redirect chain. Body is already decoded. */
async function copyResponse(res) {
  if (!res) return null;
  try {
    const buf = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(buf, {
      status: res.status || 200,
      statusText: res.statusText || "",
      headers,
    });
  } catch {
    return null;
  }
}

function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function precacheShell() {
  const cache = await caches.open(APP);
  const urls = new Set(["/", "/manifest.webmanifest", "/favicon.svg", "/__grok/icon-180.png"]);
  try {
    const home = await fetch(shellUrl(), { cache: "no-store" });
    if (home && home.ok) {
      const copy = await copyResponse(home);
      if (copy) {
        const html = await copy.clone().text();
        cache.put(shellUrl(), copy).catch(() => {});
        for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
          if (match[1]) urls.add(match[1]);
        }
      }
    }
  } catch {
    /* first paint still works from the network */
  }
  await Promise.all(
    [...urls].map(async (url) => {
      if (url === "/") return;
      try {
        const res = await fetch(url);
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (!res.ok || type.includes("text/html")) return;
        const stored = res.redirected ? await copyResponse(res) : res;
        if (stored) await cache.put(url, stored.clone());
      } catch {
        /* skip one file — do not fail install */
      }
    }),
  );
}

async function handleNavigation(request) {
  let cache = null;
  try {
    cache = await caches.open(APP);
  } catch {
    cache = null;
  }
  try {
    const res = await fetchWithTimeout(request, 4000);
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && type.includes("text/html")) {
      const body = await copyResponse(res);
      if (body) {
        if (cache) {
          cache.put(request, body.clone()).catch(() => {});
          if (isShellRequest(request)) cache.put(shellUrl(), body.clone()).catch(() => {});
        }
        return body;
      }
    }
  } catch {
    /* offline, slow, or aborted */
  }
  if (cache) {
    try {
      const cached = (await cache.match(request)) || (await cache.match(shellUrl()));
      if (cached) {
        const copy = await copyResponse(cached);
        if (copy) return copy;
      }
    } catch {
      /* unusable cache entry */
    }
  }
  return fallbackHtmlResponse();
}

async function handleAsset(request) {
  const url = new URL(request.url);
  let cache = null;
  try {
    cache = await caches.open(APP);
  } catch {
    cache = null;
  }
  if (cache) {
    try {
      const hit = await cache.match(request);
      if (hit && !isGoodAsset(hit, url)) cache.delete(request).catch(() => {});
      else if (hit) {
        if (hit.redirected) {
          const copy = await copyResponse(hit);
          if (copy) return copy;
        }
        return hit;
      }
    } catch {
      /* refetch */
    }
  }
  try {
    const res = await fetchWithTimeout(request, 8000);
    if (!isGoodAsset(res, url)) {
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (type.includes("text/html")) {
        return new Response("Missing file", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return res;
    }
    const stored = res.redirected ? await copyResponse(res) : res;
    if (!stored) return res;
    if (cache) cache.put(request, stored.clone()).catch(() => {});
    return stored;
  } catch {
    return missingFile();
  }
}

async function tileOnly(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(TILES);
  const hit = await cache.match(key);
  if (hit) return hit;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    if (res && res.ok) {
      const len = Number(res.headers.get("content-length") || 0);
      if (len === 0 || len >= 4000) cache.put(key, res.clone()).catch(() => {});
    }
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
  const key = url.origin + url.pathname;
  const hit = (await cache.match(key)) || (await cache.match(request));
  if (hit) {
    fetch(request)
      .then((res) => {
        if (res && res.ok && !(res.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
          const stored = res.redirected ? copyResponse(res) : Promise.resolve(res.clone());
          Promise.resolve(stored)
            .then((body) => {
              if (body) cache.put(key, body).catch(() => {});
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return hit.redirected ? (await copyResponse(hit)) || hit : hit;
  }
  const res = await fetch(request);
  if (res && res.ok && !(res.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    const stored = res.redirected ? await copyResponse(res) : res;
    if (stored) cache.put(key, stored.clone()).catch(() => {});
    return stored || res;
  }
  return res;
}

async function handleFetch(request) {
  const url = new URL(request.url);
  try {
    if (isTile(url)) return await tileOnly(request);
    if (isData(url)) return await cacheFirst(DATA, request);
    if (isAsset(url)) return await handleAsset(request);
    if (isNavigation(request)) return await handleNavigation(request);
  } catch {
    if (isNavigation(request)) return fallbackHtmlResponse();
    return missingFile();
  }
  try {
    return await fetch(request);
  } catch {
    return missingFile();
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING" || (data && data.type === "SKIP_WAITING")) self.skipWaiting();
  if (data === "CLEAR_CACHES" || (data && data.type === "CLEAR_CACHES")) {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {}),
    );
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheShell()
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter((key) => !KEEP.has(key));
      await Promise.all(stale.map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!stale.some((key) => key.startsWith("horsham-app-"))) return;
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(
        windows.map(async (client) => {
          try {
            const url = new URL(client.url);
            if (url.searchParams.get("sw") === "1") return;
            url.searchParams.set("sw", "1");
            if (client.navigate) await client.navigate(url.href);
          } catch {
            /* next open uses this worker */
          }
        }),
      );
    })().catch(() => {}),
  );
});

self.__swTest = { handleFetch, copyResponse, isGoodAsset, isNavigation, precacheShell, fallbackHtml };

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!isTile(url) && !isData(url) && !isAsset(url) && !isNavigation(req)) return;
  event.respondWith(
    handleFetch(req).catch(() => (isNavigation(req) ? fallbackHtmlResponse() : missingFile())),
  );
});
