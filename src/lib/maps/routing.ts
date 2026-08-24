import { haversineKm } from "./geo";
import { cachedJson } from "./app-cache";
import type { Arterial, RouteOption } from "./types";
import { fetchWithBackoff } from "./backoff";

const OSRM_ENDPOINTS = [
  "https://router.project-osrm.org/route/v1/driving",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving",
];
const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";

const VIA_HINTS = [
  { id: "cbd", name: "Via town", lat: -36.716, lng: 142.2 },
  { id: "western", name: "Western Hwy", lat: -36.738, lng: 142.248 },
  { id: "wimmera", name: "Wimmera Hwy", lat: -36.721, lng: 142.155 },
  { id: "henty", name: "Henty Hwy", lat: -36.785, lng: 142.201 },
  { id: "dimboola", name: "Dimboola Rd", lat: -36.678, lng: 142.191 },
  { id: "dooen", name: "Dooen Rd", lat: -36.688, lng: 142.248 },
] as const;

const CORRIDOR_NAMES: { test: RegExp; label: string }[] = [
  { test: /\bA8\b|Western Highway/i, label: "Western Hwy" },
  { test: /\bA200\b|\bB200\b|Henty Highway/i, label: "Henty Hwy" },
  { test: /\bB240\b|Wimmera Highway/i, label: "Wimmera Hwy" },
  { test: /\bB210\b|Warracknabeal/i, label: "Warracknabeal Rd" },
  { test: /\bC221\b|Northern Grampians|Grampians Road/i, label: "N Grampians Rd" },
  { test: /\bC236\b|Horsham–Minyip|Horsham-Minyip|Kalkee/i, label: "Kalkee Rd" },
  { test: /Dimboola Road|Blue Ribbon/i, label: "Dimboola Rd" },
  { test: /Stawell Road/i, label: "Stawell Rd" },
  { test: /Natimuk Road/i, label: "Natimuk Rd" },
  { test: /Dooen Road|Dooen Rd/i, label: "Dooen Rd" },
  { test: /Golf Course Road/i, label: "Golf Course Rd" },
  { test: /Baillie Street/i, label: "Baillie St" },
  { test: /Firebrace Street/i, label: "Firebrace St" },
  { test: /Wilson Street/i, label: "Wilson St" },
  { test: /McPherson Street/i, label: "McPherson St" },
];

const MAX_SLOWER = 1.6;
const CELL = 0.02;
const SNAP_KM = 0.38;
const KM_LAT = 111.32;
const KM_LNG = 89.2;

type RoadQuality = { mainShare: number; highwayShare: number; offShare: number; corridor: string };
type IndexedArterials = { roads: Arterial[]; grid: Map<string, Arterial[]> };

const routeCache = new Map<string, RouteOption[]>();
let indexCache: IndexedArterials | null = null;
let indexPending: Promise<IndexedArterials> | null = null;

function cheapKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((aLat - bLat) * KM_LAT, (aLng - bLng) * KM_LNG);
}

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
}

function corridorLabel(name: string, ref: string): string {
  const hay = `${ref} ${name}`;
  for (const row of CORRIDOR_NAMES) {
    if (row.test.test(hay)) return row.label;
  }
  return name.replace(/Highway/i, "Hwy").replace(/Road/i, "Rd").replace(/Street/i, "St") || ref;
}

function buildIndex(roads: Arterial[]): IndexedArterials {
  const grid = new Map<string, Arterial[]>();
  for (const road of roads) {
    const seen = new Set<string>();
    for (const c of road.coords) {
      const k = cellKey(c[1] ?? 0, c[0] ?? 0);
      if (seen.has(k)) continue;
      seen.add(k);
      const bucket = grid.get(k);
      if (bucket) bucket.push(road);
      else grid.set(k, [road]);
    }
  }
  return { roads, grid };
}

export async function loadArterials(): Promise<void> {
  await loadIndex();
}

async function loadIndex(): Promise<IndexedArterials> {
  if (indexCache) return indexCache;
  if (indexPending) return indexPending;
  indexPending = (async () => {
    try {
      const data = (await cachedJson("/data/vic-arterials.geojson")) as {
        features?: { geometry?: { coordinates?: [number, number][] }; properties?: Record<string, unknown> }[];
      };
      const roads: Arterial[] = [];
      for (const f of data.features ?? []) {
        const coords = f.geometry?.coordinates as [number, number][] | undefined;
        if (!coords?.length) continue;
        const name = String(f.properties?.name ?? "");
        const ref = String(f.properties?.ref ?? "");
        roads.push({
          name,
          ref,
          kind: String(f.properties?.highway ?? f.properties?.kind ?? ""),
          cls: Number(f.properties?.class ?? 3),
          coords,
        });
      }
      indexCache = buildIndex(roads);
      return indexCache;
    } catch {
      indexCache = { roads: [], grid: new Map() };
      return indexCache;
    } finally {
      indexPending = null;
    }
  })();
  return indexPending;
}

function nearbyRoads(lat: number, lng: number, index: IndexedArterials): Arterial[] {
  const out: Arterial[] = [];
  const seen = new Set<Arterial>();
  const i0 = Math.floor(lat / CELL);
  const j0 = Math.floor(lng / CELL);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const road of index.grid.get(`${i0 + di}:${j0 + dj}`) ?? []) {
        if (seen.has(road)) continue;
        seen.add(road);
        out.push(road);
      }
    }
  }
  return out;
}

function scoreAgainstArterials(coords: [number, number][], index: IndexedArterials): RoadQuality {
  if (!coords.length || !index.roads.length) return { mainShare: 0, highwayShare: 0, offShare: 1, corridor: "" };
  const sample = sampleCoords(coords, 16);
  let main = 0;
  let hwy = 0;
  const names = new Map<string, number>();
  for (const p of sample) {
    let best = SNAP_KM;
    let hit: Arterial | null = null;
    for (const road of nearbyRoads(p[0], p[1], index)) {
      for (const c of road.coords) {
        const km = cheapKm(p[0], p[1], c[1] ?? 0, c[0] ?? 0);
        if (km < best) {
          best = km;
          hit = road;
        }
      }
    }
    if (!hit) continue;
    main += 1;
    if (/trunk|motorway|primary/i.test(hit.kind) || hit.cls <= 2) hwy += 1;
    const label = corridorLabel(hit.name, hit.ref);
    if (label) names.set(label, (names.get(label) ?? 0) + 1);
  }
  let corridor = "";
  let bestN = 0;
  for (const [name, n] of names) {
    if (n > bestN) {
      bestN = n;
      corridor = name;
    }
  }
  const n = sample.length;
  return { mainShare: main / n, highwayShare: hwy / n, offShare: 1 - main / n, corridor };
}

function effectiveCost(opt: RouteOption, q: RoadQuality): number {
  const off = 1 + q.offShare * 0.55;
  const main = 1 - q.mainShare * 0.18;
  const hwy = 1 - q.highwayShare * 0.12;
  return opt.durationMin * off * main * hwy;
}

function preferMainRoads(options: RouteOption[], index: IndexedArterials): RouteOption[] {
  if (options.length <= 1) return options;
  const scored = options.map((opt) => ({ opt, q: scoreAgainstArterials(opt.coords, index) }));
  scored.sort((a, b) => effectiveCost(a.opt, a.q) - effectiveCost(b.opt, b.q));
  const preferred = scored[0];
  if (!preferred) return options;
  const used = new Set<string>();
  for (const row of scored) {
    const label = row.q.corridor ? `Via ${row.q.corridor}` : row.opt.label;
    row.opt.label = used.has(label) ? `${label} alt` : label;
    used.add(label);
  }
  return [preferred.opt, ...options.filter((o) => o.id !== preferred.opt.id)];
}

function encodeLatLng(pt: [number, number]): string {
  return `${pt[1]},${pt[0]}`;
}

function cacheKey(from: [number, number], to: [number, number]): string {
  return `${from[0].toFixed(4)},${from[1].toFixed(4)}>${to[0].toFixed(4)},${to[1].toFixed(4)}`;
}

type OsrmRoute = {
  geometry: { coordinates: [number, number][] };
  distance: number;
  duration: number;
};

function fromOsrm(route: OsrmRoute, id: string, label: string): RouteOption {
  return {
    id,
    label,
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

async function fetchOsrm(path: string, alts = true): Promise<OsrmRoute[]> {
  let last: Error | null = null;
  const qs = `alternatives=${alts}&overview=${alts ? "full" : "simplified"}&geometries=geojson&steps=false`;
  for (const base of OSRM_ENDPOINTS) {
    try {
      const res = await fetchWithBackoff(`${base}/${path}?${qs}`, {}, { retries: 2, baseMs: 400, maxMs: 2500, timeoutMs: 8000 });
      if (res.status === 429) continue;
      if (!res.ok) throw new Error("Route failed");
      const data = (await res.json()) as { code?: string; routes?: OsrmRoute[] };
      if (data.code && data.code !== "Ok") throw new Error(data.code);
      if (data.routes?.length) return data.routes;
    } catch (err) {
      last = err instanceof Error ? err : new Error("Route failed");
    }
  }
  if (last) throw last;
  return [];
}

function decodePolyline6(encoded: string): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: [number, number][] = [];
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat * 1e-6, lng * 1e-6]);
  }
  return coords;
}

async function fetchValhalla(from: [number, number], to: [number, number]): Promise<RouteOption[]> {
  try {
    const res = await fetchWithBackoff(
      VALHALLA_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          locations: [
            { lat: from[0], lon: from[1] },
            { lat: to[0], lon: to[1] },
          ],
          costing: "auto",
          costing_options: { auto: { use_highways: 1, use_tolls: 0.35, top_speed: 110 } },
          alternates: 2,
          units: "kilometers",
        }),
      },
      { retries: 2, baseMs: 400, maxMs: 2500, timeoutMs: 8000 },
    );
    if (res.status === 429 || !res.ok) return [];
    const data = (await res.json()) as {
      trip?: { legs?: { shape?: string }[]; summary?: { length?: number; time?: number } };
      alternates?: { trip?: { legs?: { shape?: string }[]; summary?: { length?: number; time?: number } } }[];
    };
    const trips = [data.trip, ...(data.alternates ?? []).map((row) => row.trip)].filter(Boolean) as NonNullable<typeof data.trip>[];
    const out: RouteOption[] = [];
    trips.forEach((trip, i) => {
      const shape = trip.legs?.map((leg) => leg.shape ?? "").join("") ?? "";
      const coords = shape ? decodePolyline6(shape) : [];
      if (coords.length < 2) return;
      out.push({
        id: `valhalla-${i}`,
        label: i === 0 ? "Main roads" : "Alternative",
        coords,
        distanceKm: Number(trip.summary?.length ?? 0),
        durationMin: Number(trip.summary?.time ?? 0) / 60,
      });
    });
    return out;
  } catch {
    return [];
  }
}

function sampleCoords(coords: [number, number][], n = 12): [number, number][] {
  if (coords.length <= n) return coords;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(coords[Math.round((i / (n - 1)) * (coords.length - 1))]!);
  return out;
}

function overlapShare(a: RouteOption, b: RouteOption): number {
  const thresh = Math.min(0.22, Math.max(0.07, Math.min(a.distanceKm, b.distanceKm) * 0.018));
  const sa = sampleCoords(a.coords);
  const sb = sampleCoords(b.coords);
  let hits = 0;
  for (const p of sa) {
    if (sb.some((q) => cheapKm(p[0], p[1], q[0], q[1]) < thresh)) hits += 1;
  }
  return hits / Math.max(sa.length, 1);
}

function tooSimilar(a: RouteOption, b: RouteOption): boolean {
  const sameTime = Math.abs(a.durationMin - b.durationMin) / Math.max(a.durationMin, 0.2) < 0.04;
  const sameDist = Math.abs(a.distanceKm - b.distanceKm) / Math.max(a.distanceKm, 0.2) < 0.04;
  return (sameTime && sameDist) || (overlapShare(a, b) > 0.84 && overlapShare(b, a) > 0.84);
}

function pickDistinct(options: RouteOption[]): RouteOption[] {
  if (!options.length) return [];
  const fastest = options.reduce((a, b) => (a.durationMin <= b.durationMin ? a : b));
  const pool = options.filter((o) => {
    const timeOk = o.durationMin <= fastest.durationMin * MAX_SLOWER || o.durationMin - fastest.durationMin <= 3.5;
    const distOk = o.distanceKm <= fastest.distanceKm * 1.7 || o.distanceKm - fastest.distanceKm <= 2.4;
    return timeOk && distOk;
  });
  const unique: RouteOption[] = [];
  for (const opt of pool.sort((a, b) => a.durationMin - b.durationMin)) {
    if (!unique.some((u) => tooSimilar(u, opt))) unique.push(opt);
  }
  const chosen: RouteOption[] = unique[0] ? [unique[0]] : [fastest];
  while (chosen.length < 3) {
    let best: RouteOption | null = null;
    let bestScore = -1;
    for (const opt of unique) {
      if (chosen.some((c) => c.id === opt.id || tooSimilar(c, opt))) continue;
      const score = chosen.reduce((sum, c) => sum + (1 - overlapShare(opt, c)), 0);
      if (score > bestScore) {
        best = opt;
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.slice(0, 3);
}

async function viaRoute(from: [number, number], to: [number, number], via: [number, number], id: string): Promise<RouteOption | null> {
  try {
    const routes = await fetchOsrm(`${encodeLatLng(from)};${encodeLatLng(via)};${encodeLatLng(to)}`, false);
    return routes[0] ? fromOsrm(routes[0], id, "Alternative") : null;
  } catch {
    return null;
  }
}

function needsMainRoadHelp(opt: RouteOption, index: IndexedArterials): boolean {
  const q = scoreAgainstArterials(opt.coords, index);
  return q.mainShare < 0.62 || q.offShare > 0.28;
}

export async function planRoutes(from: [number, number], to: [number, number]): Promise<RouteOption[]> {
  const key = cacheKey(from, to);
  const hit = routeCache.get(key);
  if (hit) return hit;

  const path = `${encodeLatLng(from)};${encodeLatLng(to)}`;
  const [osrmResult, valhalla, index] = await Promise.all([fetchOsrm(path).catch(() => [] as OsrmRoute[]), fetchValhalla(from, to), loadIndex()]);
  let combined: RouteOption[] = [
    ...osrmResult.slice(0, 3).map((r, i) => fromOsrm(r, `osrm-${i}`, i === 0 ? "Fastest" : "Alternative")),
    ...valhalla,
  ];
  if (!combined.length) throw new Error("No route");
  let picked = preferMainRoads(pickDistinct(combined), index);

  if (!picked.length || needsMainRoadHelp(picked[0]!, index)) {
    const direct = haversineKm(from, to);
    const extras = await Promise.all(
      VIA_HINTS.filter((via) => {
        const v: [number, number] = [via.lat, via.lng];
        if (haversineKm(from, v) < 1.4 || haversineKm(to, v) < 1.4) return false;
        const detour = haversineKm(from, v) + haversineKm(v, to) - direct;
        const cap =
          via.id === "dimboola" || via.id === "dooen" ? Math.min(12, Math.max(4, direct * 0.7)) : Math.min(8, Math.max(3, direct * 0.45));
        return detour <= cap;
      }).map((via) => viaRoute(from, to, [via.lat, via.lng], `via-${via.id}`)),
    );
    combined = [...combined, ...(extras.filter(Boolean) as RouteOption[])];
    picked = preferMainRoads(pickDistinct(combined), index);
  }

  if (!picked.length) throw new Error("No route");
  for (const native of combined.filter((o) => o.id.startsWith("osrm-") || o.id.startsWith("valhalla-"))) {
    if (picked.length >= 3) break;
    if (!picked.some((p) => p.id === native.id || tooSimilar(p, native))) picked.push(native);
  }
  if (picked.length < 2 && combined.length > 1) {
    for (const extra of combined) {
      if (picked.some((p) => p.id === extra.id)) continue;
      picked.push(extra);
      if (picked.length >= 2) break;
    }
  }
  picked = picked.slice(0, 3);
  if (routeCache.size > 24) routeCache.clear();
  routeCache.set(key, picked);
  return picked;
}
