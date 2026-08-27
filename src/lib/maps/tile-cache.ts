import { TILE_CACHE, tileCacheKey } from "./offline";
import { quotaAllowsMore } from "./map-library";
import { zoomForSpeed } from "./style";

const inflight = new Set<string>();
let queue: string[] = [];
let workers = 0;
let paused = false;
const MAX_WORKERS = 2;
const QUEUE_MAX = 80;

function tileXY(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function tileUrlsInBounds(
  kind: "street" | "sat" | "vic" | "best",
  z: number,
  west: number,
  south: number,
  east: number,
  north: number,
): string[] {
  const zInt = Math.max(0, Math.min(20, Math.round(z)));
  const nw = tileXY(north, west, zInt);
  const se = tileXY(south, east, zInt);
  const x0 = Math.min(nw.x, se.x);
  const x1 = Math.max(nw.x, se.x);
  const y0 = Math.min(nw.y, se.y);
  const y1 = Math.max(nw.y, se.y);
  const urls: string[] = [];
  const max = 2 ** zInt - 1;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0 || x > max || y > max) continue;
      urls.push(`/api/tiles/${kind}/${zInt}/${x}/${y}`);
    }
  }
  return urls;
}

async function inCache(url: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(TILE_CACHE);
    const key = tileCacheKey(url);
    return Boolean((await cache.match(key)) || (await cache.match(url)));
  } catch {
    return false;
  }
}

async function pump(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  while (workers < MAX_WORKERS && queue.length) {
    const url = queue.shift();
    if (!url) break;
    if (inflight.has(url)) continue;
    inflight.add(url);
    workers += 1;
    void (async () => {
      try {
        if (await inCache(url)) return;
        const res = await fetch(url, { cache: "force-cache", priority: "high" } as RequestInit);
        if (!res.ok || typeof caches === "undefined") return;
        if (!(await quotaAllowsMore())) return;
        const cache = await caches.open(TILE_CACHE);
        await cache.put(tileCacheKey(url), res.clone());
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "QuotaExceededError") paused = true;
      } finally {
        inflight.delete(url);
        workers -= 1;
        void pump();
      }
    })();
  }
}

function pushUnique(urls: string[], front: boolean): void {
  if (paused) return;
  const seen = new Set(queue);
  const next: string[] = [];
  for (const raw of urls) {
    const url = raw.split("?")[0] ?? raw;
    if (inflight.has(url) || seen.has(url)) continue;
    seen.add(url);
    next.push(url);
  }
  queue = front ? [...next, ...queue] : [...queue, ...next];
  if (queue.length > QUEUE_MAX) queue = queue.slice(0, QUEUE_MAX);
  void pump();
}

export function enqueueTiles(urls: string[]): void {
  pushUnique(urls, false);
}

/** After a pan/zoom, quietly fill neighbouring tiles so the next move is instant. */
export function prefetchAround(map: import("leaflet").Map, kind: "street" | "sat" | "vic" | "best"): void {
  if (paused || document.hidden) return;
  const z = map.getZoom();
  const b = map.getBounds().pad(0.45);
  const west = b.getWest();
  const south = b.getSouth();
  const east = b.getEast();
  const north = b.getNorth();
  const urls = tileUrlsInBounds(kind, z, west, south, east, north).slice(0, 18);
  if (z > 10) urls.push(...tileUrlsInBounds(kind, z - 1, west, south, east, north).slice(0, 8));
  pushUnique(urls, false);
}

/**
 * Time-horizon predictive prefetch (Google / Mapbox pattern).
 *
 * Near field (0–8 s) at full zoom, mid (8–25 s) current zoom, far (25–55 s)
 * at parent zooms. A heading cone covers GPS wander; if a route is set the
 * polyline wins because that's the road you actually take.
 */
export function prefetchDrive(opts: {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  zoom: number;
  kind: "street" | "sat" | "vic" | "best";
  route?: [number, number][] | null;
}): void {
  if (paused || document.hidden) return;
  if (opts.speedKmh < 8) return;
  const lat = opts.lat;
  const lng = opts.lng;
  const kind = opts.zoom >= 17 ? "best" : opts.kind;
  const speedMs = Math.max(0, opts.speedKmh) / 3.6;
  const z = Math.max(10, Math.min(20, Math.round(opts.zoom)));
  const nextZ = Math.max(10, Math.min(20, Math.round(zoomForSpeed(opts.speedKmh, opts.zoom))));
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (zz: number, la: number, ln: number, ring: number) => {
    const { x, y } = tileXY(la, ln, zz);
    const max = 2 ** zz - 1;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx > max || yy > max) continue;
        const url = `/api/tiles/${kind}/${zz}/${xx}/${yy}`;
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
  };

  const bands =
    z >= 17
      ? [
          { t0: 0, t1: 18, zoom: z, ring: 1 },
          { t0: 8, t1: 36, zoom: z, ring: 1 },
          { t0: 14, t1: 50, zoom: Math.max(10, z - 1), ring: 1 },
        ]
      : [
          { t0: 0, t1: 12, zoom: z, ring: 2 },
          { t0: 8, t1: 30, zoom: z, ring: 1 },
          { t0: 12, t1: 50, zoom: Math.max(10, z - 1), ring: 1 },
          { t0: 25, t1: 70, zoom: Math.max(10, z - 2), ring: 1 },
        ];
  if (Math.abs(nextZ - z) >= 1) {
    bands.push({ t0: 0, t1: 24, zoom: nextZ, ring: z >= 17 ? 1 : 2 });
  }

  const cruise = Math.max(speedMs, 4);
  const ahead = 55;
  const points: { lat: number; lng: number; t: number }[] = [{ lat, lng, t: 0 }];

  if (opts.route && opts.route.length > 1) {
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < opts.route.length; i++) {
      const p = opts.route[i];
      if (!p) continue;
      const d = Math.hypot((p[0] - lat) * 111.32, (p[1] - lng) * 89.2);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    let acc = 0;
    let lastSample = 0;
    let prev = opts.route[nearest] ?? [lat, lng];
    for (let i = nearest + 1; i < opts.route.length && acc < cruise * ahead; i++) {
      const p = opts.route[i];
      if (!p) continue;
      const step = Math.hypot((p[0] - prev[0]) * 111.32, (p[1] - prev[1]) * 89.2);
      acc += step;
      prev = p;
      if (acc - lastSample >= 0.18 || i === opts.route.length - 1) {
        lastSample = acc;
        points.push({ lat: p[0], lng: p[1], t: acc / cruise });
      }
    }
  }

  const cone = speedMs < 2.5 ? 28 : speedMs < 14 ? 12 : 8;
  const bearings = speedMs < 1.2 ? [opts.heading] : [opts.heading - cone, opts.heading, opts.heading + cone];
  const times = z >= 17 ? [3, 8, 14, 22, 32, 45] : [4, 8, 14, 22, 32, 45, 55];
  for (const brg of bearings) {
    const rad = (brg * Math.PI) / 180;
    for (const t of times) {
      const metres = cruise * t;
      const km = metres / 1000;
      points.push({
        lat: lat + (km * Math.cos(rad)) / 111.32,
        lng: lng + (km * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180)),
        t,
      });
    }
  }

  for (const p of points) {
    for (const band of bands) {
      if (p.t < band.t0 || p.t > band.t1) continue;
      add(band.zoom, p.lat, p.lng, band.ring);
    }
  }
  add(z, lat, lng, z >= 17 ? 1 : 2);
  pushUnique(urls, true);
}

export function resumePrefetch(): void {
  paused = false;
}

export const TILE_LAYER_OPTS = {
  maxZoom: 21,
  maxNativeZoom: 19,
  keepBuffer: 4,
  updateWhenZooming: true,
  updateWhenIdle: false,
  detectRetina: false,
  className: "map-tiles",
};
