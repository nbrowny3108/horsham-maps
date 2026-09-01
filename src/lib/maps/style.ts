import type { Map as LeafletMap } from "leaflet";
import { MAP_COLORS, SHIRE_BOUNDS, type BaseLayer } from "./types";

export const ZOOM_MAX = 21;
export const ZOOM_STEP_PCT = 10;
const FALLBACK_FIT = 9;

let shireFitZoom = FALLBACK_FIT;

export function shireLatLngBounds(): [[number, number], [number, number]] {
  return [
    [SHIRE_BOUNDS.south, SHIRE_BOUNDS.west],
    [SHIRE_BOUNDS.north, SHIRE_BOUNDS.east],
  ];
}

export function getShireFitZoom(): number {
  return shireFitZoom;
}

/** 0% = whole shire on this screen. Recalculate after rotate / resize. */
export function updateShireFitZoom(map: LeafletMap): number {
  const bearing = (map as LeafletMap & { getBearing?: () => number }).getBearing?.() ?? 0;
  const rotated = Math.abs(((bearing % 360) + 360) % 360) > 2 && Math.abs(((bearing % 360) + 360) % 360) < 358;
  if (!rotated) {
    try {
      const z = map.getBoundsZoom(shireLatLngBounds(), false, { x: 16, y: 64 } as unknown as import("leaflet").Point);
      if (Number.isFinite(z)) shireFitZoom = Math.min(ZOOM_MAX - 2, Math.max(6, z));
    } catch {
      /* map not sized yet */
    }
    map.setMinZoom(shireFitZoom);
  }
  return shireFitZoom;
}

export function zoomPercent(zoom: number): number {
  const span = ZOOM_MAX - shireFitZoom;
  if (span <= 0.01) return 100;
  const t = (zoom - shireFitZoom) / span;
  const pct = Math.min(100, Math.max(0, t * 100));
  return Math.round(pct / ZOOM_STEP_PCT) * ZOOM_STEP_PCT;
}

export function zoomFromPercent(pct: number): number {
  const t = Math.min(100, Math.max(0, pct)) / 100;
  return shireFitZoom + t * (ZOOM_MAX - shireFitZoom);
}

export type SpeedZoomSettings = {
  cuts: [number, number, number];
  pcts: [number, number, number, number];
};

export const DEFAULT_SPEED_ZOOM: SpeedZoomSettings = {
  cuts: [5, 20, 50],
  pcts: [90, 80, 60, 40],
};

let speedZoom: SpeedZoomSettings = { cuts: [...DEFAULT_SPEED_ZOOM.cuts], pcts: [...DEFAULT_SPEED_ZOOM.pcts] };

function clampPct(n: number): number {
  const x = Math.round(n / ZOOM_STEP_PCT) * ZOOM_STEP_PCT;
  return Math.min(100, Math.max(0, x));
}

export function normalizeSpeedZoom(raw: Partial<SpeedZoomSettings> | null | undefined): SpeedZoomSettings {
  const cutsIn = Array.isArray(raw?.cuts) ? raw.cuts : DEFAULT_SPEED_ZOOM.cuts;
  const pctsIn = Array.isArray(raw?.pcts) ? raw.pcts : DEFAULT_SPEED_ZOOM.pcts;
  const c0 = Math.max(1, Math.min(30, Number(cutsIn[0]) || 5));
  const c1 = Math.max(c0 + 1, Math.min(80, Number(cutsIn[1]) || 20));
  const c2 = Math.max(c1 + 1, Math.min(120, Number(cutsIn[2]) || 50));
  const p0 = clampPct(Number(pctsIn[0]) || 90);
  const p1 = clampPct(Number(pctsIn[1]) || 80);
  const p2 = clampPct(Number(pctsIn[2]) || 60);
  const p3 = clampPct(Number(pctsIn[3]) || 40);
  return { cuts: [c0, c1, c2], pcts: [p0, p1, p2, p3] };
}

export function getSpeedZoom(): SpeedZoomSettings {
  return speedZoom;
}

export function setSpeedZoom(next: SpeedZoomSettings): SpeedZoomSettings {
  speedZoom = normalizeSpeedZoom(next);
  return speedZoom;
}

export const SPEED_ZOOM_HOLD_MS = 1500;
export const SPEED_ZOOM_EASE_S = 0.8;
export const SPEED_ZOOM_FLICKER_KMH = 4;
export const SPEED_ZOOM_EDGE_KMH = 3;

export function zoomPctForSpeed(kmh: number, currentPct?: number | null): number {
  const v = Math.max(0, kmh);
  const { cuts, pcts } = speedZoom;
  const rawBand = v <= cuts[0] ? 0 : v <= cuts[1] ? 1 : v <= cuts[2] ? 2 : 3;
  if (currentPct == null) return pcts[rawBand];
  let curBand = 0;
  let best = Infinity;
  for (let i = 0; i < pcts.length; i++) {
    const d = Math.abs(pcts[i] - currentPct);
    if (d < best) {
      best = d;
      curBand = i;
    }
  }
  if (rawBand === curBand) return pcts[curBand];
  if (rawBand > curBand) {
    const edge = curBand === 0 ? cuts[0] : curBand === 1 ? cuts[1] : curBand === 2 ? cuts[2] : null;
    if (edge != null && v < edge + SPEED_ZOOM_EDGE_KMH) return pcts[curBand];
  } else {
    const edge = rawBand === 0 ? cuts[0] : rawBand === 1 ? cuts[1] : cuts[2];
    if (v > edge - SPEED_ZOOM_EDGE_KMH) return pcts[curBand];
  }
  return pcts[rawBand];
}

export function speedBandLabel(i: number, settings: SpeedZoomSettings = speedZoom): string {
  const { cuts } = settings;
  if (i <= 0) return `0–${cuts[0]} km/h`;
  if (i === 1) return `${cuts[0]}–${cuts[1]} km/h`;
  if (i === 2) return `${cuts[1]}–${cuts[2]} km/h`;
  return `${cuts[2]}+ km/h`;
}

/** Leaflet zoom for this speed. Speed only picks the level — tiles stay the same. */
export function zoomForSpeed(kmh: number, _currentZoom?: number): number {
  return Math.round(zoomFromPercent(zoomPctForSpeed(kmh)) * 2) / 2;
}

export function dockHeightPx(): number {
  const footer = document.querySelector("footer");
  const box = footer?.getBoundingClientRect();
  const h = box?.height ?? 90;
  const gap = box ? Math.max(0, window.innerHeight - box.bottom) : 10;
  return (Number.isFinite(h) && h > 0 ? h : 90) + gap;
}

/** Heading-up: puck lower on the screen so more road is ahead (Google-style). */
export function followPuckY(height: number, headingUp: boolean, dock = 90): number {
  if (headingUp) return Math.min(height - dock - 44, height * 0.78);
  return Math.max(height * 0.5, height - dock - 129);
}

export function followCameraLatLng(map: LeafletMap, here: [number, number], headingUp: boolean) {
  const size = map.getSize();
  if (size.x < 8 || size.y < 8) return { lat: here[0], lng: here[1] };
  const desiredY = followPuckY(size.y, headingUp, dockHeightPx());
  const centerPt = map.latLngToContainerPoint(map.getCenter());
  const herePt = map.latLngToContainerPoint(here);
  return map.containerPointToLatLng([centerPt.x + herePt.x - size.x / 2, centerPt.y + herePt.y - desiredY]);
}

export const hybridGrade = {
  names: new Map<string, string>(),
  show: true,
  zoom: 17,
};

export function roadKey(s: string) {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sameRoadName(a: string, b: string) {
  return roadKey(a) === roadKey(b);
}

export function gradeProgramOf(feat?: import("geojson").Feature | { properties?: Record<string, unknown> } | null): string {
  return String((feat?.properties as { program?: string } | null)?.program ?? "");
}

export function isNextProgramme(program: string): boolean {
  return program.includes("27-28");
}

export function gradeColor(_program: string, _base: BaseLayer): string {
  return MAP_COLORS.gradeHybrid;
}

export function gradeStyle(base: BaseLayer) {
  return (feat?: import("geojson").Feature) => {
    const prog = gradeProgramOf(feat);
    return {
      color: gradeColor(prog, base),
      weight: base === "hybrid" ? 5 : 5.5,
      opacity: 1,
      lineCap: "round" as const,
      lineJoin: "round" as const,
    };
  };
}

export function roadLineStyle(base: BaseLayer) {
  return (feat?: import("geojson").Feature) => {
    const props = (feat?.properties ?? {}) as { class?: number; surf?: number; name?: string };
    const cls = Number(props.class ?? 5);
    const surf = Number(props.surf ?? 0);
    const z = hybridGrade.zoom;
    if (z < 11 && cls >= 4) return { opacity: 0, weight: 0 };
    if (z < 13 && cls >= 5) return { opacity: 0, weight: 0 };
    if (base === "satellite") {
      return { color: MAP_COLORS.roadSat, weight: cls <= 2 ? 1.5 : cls <= 4 ? 1.05 : 0.7, opacity: 0.52, lineCap: "round" as const, lineJoin: "round" as const };
    }
    if (base === "hybrid") {
      const name = String(props.name ?? "");
      const prog = name ? hybridGrade.names.get(roadKey(name)) : undefined;
      if (hybridGrade.show && prog) {
        return { opacity: 0, weight: 0 };
      }
      if (surf === 2) return { color: MAP_COLORS.roadEarth, weight: 1.4, opacity: 1, lineCap: "round" as const, lineJoin: "round" as const };
      if (surf === 1) return { color: MAP_COLORS.grade, weight: 1.7, opacity: 1, lineCap: "round" as const, lineJoin: "round" as const };
      return { color: MAP_COLORS.roadHybrid, weight: 1.35, opacity: 1, lineCap: "round" as const, lineJoin: "round" as const };
    }
    return { color: MAP_COLORS.road, weight: cls <= 2 ? 2.1 : cls <= 4 ? 1.55 : 1.15, opacity: 0.82, lineCap: "round" as const, lineJoin: "round" as const };
  };
}

export function gpsIconHtml(heading: number, headingUp: boolean, canRotate: boolean) {
  const cone = headingUp && canRotate ? 0 : heading;
  const opacity = headingUp ? 1 : 0.4;
  return `<div class="gps-mark"><div class="gps-mark-cone" style="transform:rotate(${cone}deg);opacity:${opacity}"></div><div class="gps-mark-dot"></div></div>`;
}
