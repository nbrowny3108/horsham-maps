export const DATA_CACHE = "horsham-data-v1";

type Json = Record<string, unknown>;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const ios = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return Boolean(media || ios);
}

export function registerAppCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          sw.postMessage("SKIP_WAITING");
        }
      });
    });
    if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
  }).catch(() => {});

  if ((registerAppCache as { armed?: boolean }).armed) return;
  (registerAppCache as { armed?: boolean }).armed = true;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    if (isStandalone()) window.location.reload();
  });
}

export async function cachedJson(url: string): Promise<Json> {
  const pending = fetch(url);
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(DATA_CACHE);
      const hit = await cache.match(url);
      if (hit) {
        void pending
          .then((res) => {
            if (res.ok) return cache.put(url, res.clone());
          })
          .catch(() => {});
        return hit.json() as Promise<Json>;
      }
      const res = await pending;
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      void cache.put(url, res.clone());
      return res.json() as Promise<Json>;
    } catch {
      /* network path */
    }
  }
  const res = await pending;
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<Json>;
}

async function putIfMissing(cache: Cache, url: string): Promise<void> {
  try {
    if (await cache.match(url)) return;
    const res = await fetch(url);
    if (res.ok) await cache.put(url, res.clone());
  } catch {
    /* skip */
  }
}

async function dataUrls(): Promise<string[]> {
  try {
    const list = (await cachedJson("/data/cache-manifest.json")) as unknown as string[];
    if (Array.isArray(list) && list.length) return list.filter((u) => typeof u === "string");
  } catch {
    /* fallback */
  }
  return [
    "/data/hrcc-boundary.geojson",
    "/data/grading-programme.geojson",
    "/data/road-labels.geojson",
    "/data/places.geojson",
    "/data/junctions.geojson",
    "/data/vic-arterials.geojson",
    "/data/roads-major.geojson",
    "/data/roads.geojson",
    "/data/roads/index.json",
    "/api/grading",
  ];
}

/** Cache road data only. Aerial tiles are stored as you drive — not the whole shire up front. */
export async function warmAppCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  registerAppCache();
  const data = await caches.open(DATA_CACHE);
  const urls = await dataUrls();
  const queue = [...urls];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        if (url) await putIfMissing(data, url);
      }
    }),
  );
}

let warming = false;

export function startBackgroundCache(_here?: [number, number] | null): void {
  registerAppCache();
  if (warming) return;
  warming = true;
  void warmAppCache().finally(() => {
    warming = false;
  });
}
