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

function vicUrls(z: number, bounds: { west: number; south: number; east: number; north: number }): string[] {
  const urls: string[] = [];
  const { x0, x1, y0, y1 } = tileRange(z, bounds);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      urls.push(`/api/tiles/best/${z}/${x}/${y}`);
    }
  }
  return urls;
}

type GradingGeom = {
  type?: string;
  coordinates?: unknown;
};

function walkCoords(geom: GradingGeom | undefined, out: [number, number][]): void {
  if (!geom?.coordinates) return;
  const walk = (node: unknown, depth: number) => {
    if (!Array.isArray(node) || node.length === 0) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      out.push([node[0], node[1]]);
      return;
    }
    if (depth > 4) return;
    for (const child of node) walk(child, depth + 1);
  };
  walk(geom.coordinates, 0);
}

async function gradingVertices(): Promise<[number, number][]> {
  const pts: [number, number][] = [];
  for (const url of ["/api/grading", "/data/grading-programme.geojson"]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as { features?: { geometry?: GradingGeom }[] };
      for (const f of data.features ?? []) walkCoords(f.geometry, pts);
      if (pts.length) return pts;
    } catch {
      /* try the next source */
    }
  }
  return pts;
}

function urlsAlong(points: [number, number][], z: number, padKm: number): string[] {
  const urls: string[] = [];
  let last: [number, number] | null = null;
  for (const [lng, lat] of points) {
    if (last && Math.hypot((lat - last[1]) * 111.32, (lng - last[0]) * 89.2) < padKm * 0.7) continue;
    last = [lng, lat];
    urls.push(...vicUrls(z, around(lat, lng, padKm)));
  }
  return urls;
}

export async function buildOfflineUrls(_here?: [number, number] | null): Promise<string[]> {
  const town = around(HORSHAM_CENTER[0], HORSHAM_CENTER[1], 8);
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
  for (let z = 10; z <= 14; z++) urls.push(...vicUrls(z, SHIRE_BOUNDS));
  for (let z = 15; z <= 16; z++) urls.push(...vicUrls(z, town));
  const jobs = await gradingVertices();
  for (let z = 15; z <= 16; z++) urls.push(...urlsAlong(jobs, z, 0.55));
  for (let z = 17; z <= 18; z++) urls.push(...urlsAlong(jobs, z, 0.4));
  return [...new Set(urls)];
}

export async function estimateOfflineMb(here?: [number, number] | null): Promise<number> {
  return Math.round((await buildOfflineUrls(here)).length * 0.022);
}

export async function saveOfflinePack(
  onProgress: (progress: OfflineProgress) => void,
  here?: [number, number] | null,
): Promise<number> {
  const urls = await buildOfflineUrls(here);
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  const total = urls.length;
  onProgress({ done: 0, total, label: "Starting download" });
  const queue = [...urls];
  const workers = Array.from({ length: 6 }, async () => {
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
          label: done === total ? "Saved on this phone" : `Depot pack ${Math.round((done / total) * 100)}%`,
        });
      }
    }
  });
  await Promise.all(workers);
  onProgress({ done: total, total, label: "Saved on this phone" });
  return total;
}