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

export function zoomForSpeed(kmh: number, currentZoom?: number): number {
  const z90 = Math.round(zoomFromPercent(90) * 2) / 2;
  const z80 = Math.round(zoomFromPercent(80) * 2) / 2;
  const z60 = Math.round(zoomFromPercent(60) * 2) / 2;
  const cur = currentZoom ?? z80;
  const d90 = Math.abs(cur - z90);
  const d80 = Math.abs(cur - z80);
  const d60 = Math.abs(cur - z60);
  const band = d90 <= d80 && d90 <= d60 ? 90 : d60 < d80 ? 60 : 80;
  if (band === 90) return kmh >= 45 ? z80 : z90;
  if (band === 60) return kmh <= 65 ? z80 : z60;
  if (kmh <= 35) return z90;
  if (kmh >= 78) return z60;
  return z80;
}

export function dockHeightPx(): number {
  const footer = document.querySelector("footer");
  const h = footer?.getBoundingClientRect().height ?? 90;
  return Number.isFinite(h) && h > 0 ? h : 90;
}

export function followCameraLatLng(map: LeafletMap, here: [number, number], headingUp: boolean) {
  const size = map.getSize();
  if (size.x < 8 || size.y < 8) return { lat: here[0], lng: here[1] };
  const dock = dockHeightPx();
  const gap = headingUp ? 93 : 129;
  const low = Math.max(size.y * 0.62, size.y - dock - gap);
  const desiredY = Math.max(size.y * 0.5, low - 100);
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

export function gradeColor(program: string, base: BaseLayer): string {
  if (base === "hybrid") return isNextProgramme(program) ? MAP_COLORS.gradeHybridNext : MAP_COLORS.gradeHybrid;
  return isNextProgramme(program) ? MAP_COLORS.gradeNext : MAP_COLORS.grade;
}

export function gradeStyle(base: BaseLayer) {
  return (feat?: import("geojson").Feature) => {
    const prog = gradeProgramOf(feat);
    return {
      color: gradeColor(prog, base),
      weight: base === "hybrid" ? 4.2 : 5,
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
        return { color: gradeColor(prog, "hybrid"), weight: 3.6, opacity: 1, lineCap: "round" as const, lineJoin: "round" as const };
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
