import { cachedJson } from "./app-cache";
import type { RoadIndex } from "./snap";

export const ROAD_CHUNK_ZOOM = 13;
const CELL = 0.1;

type RoadFeat = {
  properties?: { name?: string; highway?: string; class?: number };
  geometry?: { coordinates?: [number, number][] };
};

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
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const raw = (f.properties?.name || "").trim();
    const name =
      raw ||
      (f.properties?.highway === "track"
        ? "Track"
        : f.properties?.highway === "service"
          ? "Service road"
          : f.properties?.highway === "unclassified"
            ? "Unnamed road"
            : "");
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