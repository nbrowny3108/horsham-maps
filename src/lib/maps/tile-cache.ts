import { TILE_CACHE, tileCacheKey } from "./offline";
import { quotaAllowsMore } from "./map-library";
import { zoomForSpeed } from "./style";

const inflight = new Set<string>();
let aheadQ: string[] = [];
let laterQ: string[] = [];
let workers = 0;
let paused = false;
const MAX_WORKERS = 2;
const QUEUE_MAX = 48;

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

/** 20 s creeping, up to 40 s on the highway. Faster = longer corridor, not extra zoom. */
export function lookAheadSeconds(kmh: number): number {
  return Math.min(40, Math.max(20, 20 + Math.max(0, kmh) / 4));
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
  while (workers < MAX_WORKERS && (aheadQ.length || laterQ.length)) {
    const url = aheadQ.shift() || laterQ.shift();
    if (!url) break;
    if (inflight.has(url)) continue;
    inflight.add(url);
    workers += 1;
    void (async () => {
      try {
        if (await inCache(url)) return;
        const res = await fetch(url, { cache: "force-cache", priority: "low" } as RequestInit);
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

function pushLane(urls: string[], lane: "ahead" | "later"): void {
  if (paused) return;
  const seen = new Set([...aheadQ, ...laterQ, ...inflight]);
  const dest = lane === "ahead" ? aheadQ : laterQ;
  for (const raw of urls) {
    const url = raw.split("?")[0] ?? raw;
    if (seen.has(url)) continue;
    seen.add(url);
    dest.push(url);
  }
  while (aheadQ.length + laterQ.length > QUEUE_MAX) {
    if (laterQ.length) laterQ.pop();
    else aheadQ.pop();
  }
  void pump();
}

export function enqueueTiles(urls: string[]): void {
  pushLane(urls, "later");
}

/** After a pan/zoom, quietly fill neighbouring tiles so the next move is instant. */
export function prefetchAround(map: import("leaflet").Map, kind: "street" | "sat" | "vic" | "best"): void {
  if (paused || document.hidden) return;
  const z = map.getZoom();
  const b = map.getBounds().pad(0.2);
  const west = b.getWest();
  const south = b.getSouth();
  const east = b.getEast();
  const north = b.getNorth();
  const urls = tileUrlsInBounds(kind, z, west, south, east, north).slice(0, 12);
  pushLane(urls, "later");
}

function ringUrls(kind: string, z: number, lat: number, lng: number, ring: number, seen: Set<string>, out: string[]): void {
  const { x, y } = tileXY(lat, lng, z);
  const max = 2 ** z - 1;
  for (let dx = -ring; dx <= ring; dx++) {
    for (let dy = -ring; dy <= ring; dy++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx > max || yy > max) continue;
      const url = `/api/tiles/${kind}/${z}/${xx}/${yy}`;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
}

function alongHeading(lat: number, lng: number, heading: number, metres: number): [number, number] {
  const rad = (heading * Math.PI) / 180;
  const km = metres / 1000;
  return [lat + (km * Math.cos(rad)) / 111.32, lng + (km * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180))];
}

/** Corridor tiles: heading cone for 20–40 s, then next speed-band zoom. */
export function drivePrefetchPlan(opts: {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  zoom: number;
  kind?: "street" | "sat" | "vic" | "best";
  route?: [number, number][] | null;
}): { ahead: string[]; nextZoom: string[]; horizonSec: number } {
  const lat = opts.lat;
  const lng = opts.lng;
  const kmh = Math.max(0, opts.speedKmh);
  const kind = (opts.zoom >= 17 ? "best" : opts.kind) || "best";
  const z = Math.max(10, Math.min(20, Math.round(opts.zoom)));
  const nextZ = Math.max(10, Math.min(20, Math.round(zoomForSpeed(kmh, opts.zoom))));
  const horizonSec = lookAheadSeconds(kmh);
  const speedMs = kmh / 3.6;
  const cruise = Math.max(speedMs, 1.5);
  const horizonM = cruise * horizonSec;
  const seen = new Set<string>();
  const ahead: string[] = [];
  const nextZoom: string[] = [];

  const samples: { lat: number; lng: number; t: number }[] = [{ lat, lng, t: 0 }];
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
    for (let i = nearest + 1; i < opts.route.length && acc < horizonM; i++) {
      const p = opts.route[i];
      if (!p) continue;
      const step = Math.hypot((p[0] - prev[0]) * 111.32, (p[1] - prev[1]) * 89.2);
      acc += step;
      prev = p;
      if (acc - lastSample >= 0.12 || i === opts.route.length - 1) {
        lastSample = acc;
        samples.push({ lat: p[0], lng: p[1], t: acc / cruise });
      }
    }
  } else {
    const cone = kmh < 15 ? 12 : kmh < 50 ? 8 : 6;
    const bearings = kmh < 4 ? [opts.heading] : [opts.heading - cone, opts.heading, opts.heading + cone];
    const stepSec = z >= 17 ? 5 : 4;
    for (const brg of bearings) {
      for (let t = stepSec; t <= horizonSec + 0.01; t += stepSec) {
        const [la, ln] = alongHeading(lat, lng, brg, cruise * t);
        samples.push({ lat: la, lng: ln, t });
      }
    }
  }

  const ring = z >= 17 ? 1 : 1;
  for (const p of samples) {
    if (p.t < -0.2) continue;
    ringUrls(kind, z, p.lat, p.lng, ring, seen, ahead);
  }
  ringUrls(kind, z, lat, lng, 1, seen, ahead);

  if (Math.abs(nextZ - z) >= 1) {
    const nextSeen = new Set(seen);
    for (const p of samples) {
      if (p.t > horizonSec * 0.75) continue;
      ringUrls(kind, nextZ, p.lat, p.lng, 1, nextSeen, nextZoom);
    }
  }

  return { ahead: ahead.slice(0, 36), nextZoom: nextZoom.slice(0, 16), horizonSec };
}

export function prefetchDrive(opts: {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  zoom: number;
  kind: "street" | "sat" | "vic" | "best";
  route?: [number, number][] | null;
  force?: boolean;
}): void {
  if (paused || document.hidden) return;
  if (!opts.force && opts.speedKmh < 2) return;
  const plan = drivePrefetchPlan(opts);
  pushLane(plan.ahead, "ahead");
  pushLane(plan.nextZoom, "later");
}

export function resumePrefetch(): void {
  paused = false;
}

export const TILE_LAYER_OPTS = {
  maxZoom: 21,
  maxNativeZoom: 19,
  keepBuffer: 3,
  updateWhenZooming: true,
  updateWhenIdle: false,
  detectRetina: false,
  className: "map-tiles",
};
