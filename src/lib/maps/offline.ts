import { HORSHAM_CENTER, SHIRE_BOUNDS } from "./types";

export const TILE_CACHE = "horsham-tiles-v4";

export function tileCacheKey(url: string): string {
  if (typeof location === "undefined") return url;
  try {
    const parsed = url.startsWith("http") ? new URL(url) : new URL(url, location.origin);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

export type OfflineProgress = { done: number; total: number; label: string };

function tileRange(zoom: number, bounds = SHIRE_BOUNDS) {
  const n = 2 ** zoom;
  const xOf = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const yOf = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  };
  return { x0: xOf(bounds.west), x1: xOf(bounds.east), y0: yOf(bounds.north), y1: yOf(bounds.south) };
}

function around(lat: number, lng: number, km: number) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dLng, east: lng + dLng, south: lat - dLat, north: lat + dLat };
}

function vicUrls(z: number, bounds: typeof SHIRE_BOUNDS): string[] {
  const urls: string[] = [];
  const { x0, x1, y0, y1 } = tileRange(z, bounds);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      urls.push(`/api/tiles/best/${z}/${x}/${y}`);
    }
  }
  return urls;
}

export function buildOfflineUrls(here?: [number, number] | null): string[] {
  const town = around(HORSHAM_CENTER[0], HORSHAM_CENTER[1], 8);
  const local = here ? around(here[0], here[1], 8) : town;
  const drive = here ? around(here[0], here[1], 5) : around(HORSHAM_CENTER[0], HORSHAM_CENTER[1], 5);
  const close = here ? around(here[0], here[1], 2.5) : around(HORSHAM_CENTER[0], HORSHAM_CENTER[1], 2.5);
  const townDrive = around(HORSHAM_CENTER[0], HORSHAM_CENTER[1], 3);
  const urls = [
    "/data/hrcc-boundary.geojson",
    "/data/grading-programme.geojson",
    "/data/road-labels.geojson",
    "/data/junctions.geojson",
    "/data/vic-arterials.geojson",
    "/data/roads-major.geojson",
    "/data/roads.geojson",
    "/data/roads/index.json",
    "/data/cache-manifest.json",
    "/api/grading",
    "/",
  ];
  for (let z = 10; z <= 13; z++) urls.push(...vicUrls(z, SHIRE_BOUNDS));
  for (let z = 13; z <= 16; z++) urls.push(...vicUrls(z, local));
  for (let z = 17; z <= 18; z++) {
    urls.push(...vicUrls(z, drive));
    urls.push(...vicUrls(z, townDrive));
  }
  urls.push(...vicUrls(19, close));
  urls.push(...vicUrls(19, around(HORSHAM_CENTER[0], HORSHAM_CENTER[1], 2)));
  return [...new Set(urls)];
}

export function estimateOfflineMb(here?: [number, number] | null): number {
  return Math.round(buildOfflineUrls(here).length * 0.022);
}

export async function saveOfflinePack(
  onProgress: (progress: OfflineProgress) => void,
  here?: [number, number] | null,
): Promise<number> {
  const urls = buildOfflineUrls(here);
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  const total = urls.length;
  onProgress({ done: 0, total, label: "Starting download" });
  const queue = [...urls];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) break;
      try {
        const key = tileCacheKey(url);
        if (await cache.match(key)) {
          done += 1;
          continue;
        }
        const res = await fetch(key);
        if (res.ok) await cache.put(key, res.clone());
      } catch {
        /* skip failed tile */
      }
      done += 1;
      if (done % 20 === 0 || done === total) {
        onProgress({
          done,
          total,
          label: done === total ? "Saved on this phone" : `Downloading shire map ${Math.round((done / total) * 100)}%`,
        });
      }
    }
  });
  await Promise.all(workers);
  onProgress({ done: total, total, label: "Saved on this phone" });
  return total;
}
