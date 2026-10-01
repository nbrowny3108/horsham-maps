import { cachedJson } from "./app-cache";
import { loadLeaflet } from "./leaflet";

type Json = Record<string, unknown>;

function loadJson(url: string): Promise<Json> {
  return cachedJson(url);
}

const browser = typeof window !== "undefined";

/** Starts while the permission gate is still on screen — only the first-paint files. */
export const mapAssets = browser
  ? {
      leaflet: loadLeaflet().catch(async () => asFallbackLeaflet()),
      roads: loadJson("/data/roads-major.geojson"),
      sealed: loadJson("/data/sealed-roads.geojson"),
      boundary: loadJson("/data/hrcc-boundary.geojson"),
    }
  : null;

async function asFallbackLeaflet() {
  const mod = await import("leaflet");
  return ((mod as { default?: typeof import("leaflet") }).default ?? mod) as typeof import("leaflet");
}

export async function allMapData() {
  if (!mapAssets) {
    return { roads: null, boundary: null, sealed: null };
  }
  const [roads, boundary, sealed] = await Promise.all([
    mapAssets.roads.catch(() => null),
    mapAssets.boundary.catch(() => null),
    mapAssets.sealed.catch(() => null),
  ]);
  return { roads, boundary, sealed };
}

export function loadLabelsJson() {
  return loadJson("/data/road-labels.geojson");
}

export function loadPlacesJson() {
  return loadJson("/data/places.geojson");
}

export function loadJunctionsJson() {
  return loadJson("/data/junctions.geojson");
}

export function loadGradingJson() {
  return loadJson("/api/grading");
}
