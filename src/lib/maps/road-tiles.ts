import { cachedJson } from "./app-cache";
import { RoadIndex } from "./snap";

export const ROAD_CHUNK_ZOOM = 13;
const CELL = 0.1;

export type RoadFeat = {
  properties?: { name?: string; highway?: string; class?: number; surf?: number };
  geometry?: { type?: string; coordinates?: [number, number][] | [number, number][][] };
};

export function hasSealedOverlay(sealed: { features?: unknown[] } | null | undefined): boolean {
  return Array.isArray(sealed?.features) && sealed.features.length > 0;
}

/** Vicmap sealed lines replace OSM surf===0. Gravel (surf 1 and 2) stays in the earth overlay. */
export function overlayRoadFeatures<T extends { properties?: { surf?: number } }>(
  osm: { features?: T[] } | null | undefined,
  sealed: { features?: T[] } | null | undefined,
): T[] {
  const sealedFeats = sealed?.features ?? [];
  const osmFeats = osm?.features ?? [];
  if (!sealedFeats.length) return osmFeats;
  return [...sealedFeats, ...osmFeats.filter((f) => Number(f.properties?.surf ?? 0) !== 0)];
}

/** Chunk packs still contain OSM sealed copies. Skip those once Vicmap is drawn. */
export function minorRoadsToDraw<T extends { properties?: { surf?: number } }>(features: T[], sealedActive: boolean): T[] {
  if (!sealedActive) return features;
  return features.filter((f) => Number(f.properties?.surf ?? 0) !== 0);
}

const SEALED_CELL = 0.1;

export type SealedIndex = {
  lines: [number, number][][];
  bbox: Float64Array;
  grid: Map<string, number[]>;
};

function lineCoords(coords: [number, number][] | undefined): [number, number][] | null {
  if (!coords || coords.length < 2) return null;
  return coords;
}

/** Grid index so the map can stroke only the sealed lines inside the current view. */
export function buildSealedIndex(data: { features?: RoadFeat[] } | null | undefined): SealedIndex {
  const lines: [number, number][][] = [];
  const boxes: number[] = [];
  const grid = new Map<string, number[]>();
  const add = (coords: [number, number][]) => {
    const line = lineCoords(coords);
    if (!line) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of line) {
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return;
    const id = lines.length;
    lines.push(line);
    boxes.push(minX, minY, maxX, maxY);
    const x0 = Math.floor(minX / SEALED_CELL);
    const x1 = Math.floor(maxX / SEALED_CELL);
    const y0 = Math.floor(minY / SEALED_CELL);
    const y1 = Math.floor(maxY / SEALED_CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}_${y}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(id);
        else grid.set(key, [id]);
      }
    }
  };
  for (const feat of data?.features ?? []) {
    const geom = feat.geometry;
    if (!geom?.coordinates) continue;
    if (geom.type === "MultiLineString") {
      for (const part of geom.coordinates as [number, number][][]) add(part);
    } else {
      add(geom.coordinates as [number, number][]);
    }
  }
  return { lines, bbox: Float64Array.from(boxes), grid };
}

/** Every sealed line whose box meets the view. Missing a crossing line would open a gap. */
export function sealedLinesTouching(
  index: SealedIndex,
  west: number,
  south: number,
  east: number,
  north: number,
): [number, number][][] {
  const x0 = Math.floor(west / SEALED_CELL);
  const x1 = Math.floor(east / SEALED_CELL);
  const y0 = Math.floor(south / SEALED_CELL);
  const y1 = Math.floor(north / SEALED_CELL);
  const seen = new Set<number>();
  const out: [number, number][][] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const bucket = index.grid.get(`${x}_${y}`);
      if (!bucket) continue;
      for (const id of bucket) {
        if (seen.has(id)) continue;
        seen.add(id);
        const o = id * 4;
        const minX = index.bbox[o] ?? Infinity;
        const minY = index.bbox[o + 1] ?? Infinity;
        const maxX = index.bbox[o + 2] ?? -Infinity;
        const maxY = index.bbox[o + 3] ?? -Infinity;
        if (minX > east || maxX < west || minY > north || maxY < south) continue;
        const line = index.lines[id];
        if (line) out.push(line);
      }
    }
  }
  return out;
}

export function roadFeatureName(feat: RoadFeat): string {
  const raw = (feat.properties?.name || "").trim();
  if (raw) return raw;
  const highway = feat.properties?.highway;
  if (highway === "track") return "Track";
  if (highway === "service") return "Service road";
  if (highway === "unclassified") return "Unnamed road";
  return "";
}

export function indexRoadLines(features: RoadFeat[], roads: RoadIndex): void {
  const lines: { name: string; coords: [number, number][] }[] = [];
  for (const feat of features) {
    const geom = feat.geometry;
    if (!geom?.coordinates) continue;
    const name = roadFeatureName(feat);
    if (!name) continue;
    if (geom.type === "MultiLineString") {
      for (const part of geom.coordinates as [number, number][][]) {
        if (part.length >= 2) lines.push({ name, coords: part });
      }
    } else {
      const coords = geom.coordinates as [number, number][];
      if (coords.length >= 2) lines.push({ name, coords });
    }
  }
  roads.loadSegments(lines);
}

const inflight = new Map<string, Promise<{ type: string; features: RoadFeat[] } | null>>();
let indexKeys: Set<string> | null = null;

export async function roadChunkIndex(): Promise<Set<string>> {
  if (indexKeys) return indexKeys;
  try {
    const data = (await cachedJson("/data/roads/index.json")) as { keys?: string[] };
    indexKeys = new Set(data.keys ?? []);
  } catch {
    indexKeys = new Set();
  }
  return indexKeys;
}

export function visibleChunkKeys(west: number, south: number, east: number, north: number, pad = 0.05): string[] {
  const x0 = Math.floor((west - pad) / CELL + 1e-9);
  const x1 = Math.floor((east + pad) / CELL + 1e-9);
  const y0 = Math.floor((south - pad) / CELL + 1e-9);
  const y1 = Math.floor((north + pad) / CELL + 1e-9);
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) keys.push(`${x}_${y}`);
  }
  return keys;
}

export function loadRoadChunk(key: string): Promise<{ type: string; features: RoadFeat[] } | null> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const next = cachedJson(`/data/roads/${key}.json`)
    .then((data) => data as { type: string; features: RoadFeat[] })
    .catch(() => null);
  inflight.set(key, next);
  return next;
}

export function headingPadKeys(lat: number, lng: number, heading: number, km = 1.8): string[] {
  const rad = (heading * Math.PI) / 180;
  const alat = lat + (km * Math.cos(rad)) / 111.32;
  const alng = lng + (km * Math.sin(rad)) / 89.2;
  return visibleChunkKeys(Math.min(lng, alng), Math.min(lat, alat), Math.max(lng, alng), Math.max(lat, alat), 0.06);
}

export function appendRoadSnaps(
  features: RoadFeat[],
  snaps: { name: string; lat: number; lng: number; brg: number }[],
  roads?: RoadIndex,
): void {
  const dest = (a: [number, number], b: [number, number]) => {
    const dLng = ((b[0] - a[0]) * Math.PI) / 180;
    const lat1 = (a[1] * Math.PI) / 180;
    const lat2 = (b[1] * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  for (const f of features) {
    const raw = f.geometry?.coordinates;
    if (!raw || f.geometry?.type === "MultiLineString" || raw.length < 2) continue;
    const coords = raw as [number, number][];
    if (typeof coords[0]?.[0] !== "number") continue;
    const name = roadFeatureName(f);
    if (!name) continue;
    roads?.addLine(name, coords);
    let acc = 0;
    snaps.push({ name, lng: coords[0][0], lat: coords[0][1], brg: dest(coords[0], coords[1]) });
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      acc += Math.hypot((b[1] - a[1]) * 111320, (b[0] - a[0]) * 89200);
      if (acc >= 55 || i === coords.length - 1) {
        snaps.push({ name, lng: b[0], lat: b[1], brg: dest(a, b) });
        acc = 0;
      }
    }
  }
}
