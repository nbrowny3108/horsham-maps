import type { Map as LeafletMap } from "leaflet";

type LeafletNS = typeof import("leaflet");
type RotateMap = LeafletMap & {
  setBearing?: (bearing: number, preserveCenter?: boolean) => LeafletMap;
  getBearing?: () => number;
  _rotate?: boolean;
};

function asLeaflet(mod: unknown): LeafletNS {
  const m = mod as { default?: { default?: LeafletNS } & LeafletNS } & LeafletNS;
  if (typeof m.map === "function") return m;
  if (m.default && typeof m.default.map === "function") return m.default;
  if (m.default?.default && typeof m.default.default.map === "function") return m.default.default;
  return m;
}

export async function loadLeaflet(): Promise<LeafletNS> {
  const mod = await import("leaflet");
  const L = asLeaflet(mod);
  try {
    (window as Window & { L: LeafletNS }).L = L;
    await import("leaflet-rotate");
  } catch {
    /* heading-up still works via CSS on the tile pane */
  }
  return L;
}

export function mapCanRotate(map: LeafletMap): boolean {
  const m = map as RotateMap;
  return typeof m.setBearing === "function" && m._rotate === true;
}
