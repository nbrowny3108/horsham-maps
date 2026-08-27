import type { BaseLayer, Place } from "./types";
import { DEFAULT_SPEED_ZOOM, normalizeSpeedZoom, type SpeedZoomSettings } from "./style";

const BASE_KEY = "horsham-maps-base";
const RECENT_KEY = "horsham-maps-recent";
const PINS_KEY = "horsham-maps-pins";
const OFFLINE_KEY = "horsham-maps-offline-at";
const GRADING_KEY = "horsham-maps-grading-v2";
const MAPDATA_KEY = "horsham-maps-mapdata";
const PHOTO_KEY = "horsham-maps-photo";
const AUTOZOOM_KEY = "horsham-maps-auto-zoom";
const SPEED_ZOOM_KEY = "horsham-maps-speed-zoom-v1";
const SENSORS_KEY = "horsham-maps-sensors-on";
const GEO_OK_KEY = "horsham-maps-geo-ok";
const COMPASS_OK_KEY = "horsham-maps-compass-ok";
const SENSOR_SESSION_KEY = "horsham-maps-sensor-session";
const ALWAYS_GPS_KEY = "horsham-maps-always-gps";
const ALWAYS_MOTION_KEY = "horsham-maps-always-motion";
const VIEW_KEY = "horsham-maps-last-view";
const TRACK_KEY = "horsham-maps-last-track";

export function loadBaseLayer(): BaseLayer {
  if (typeof window === "undefined") return "hybrid";
  try {
    const v = window.localStorage.getItem(BASE_KEY);
    if (v === "map" || v === "satellite" || v === "hybrid") return v;
  } catch {
    /* ignore */
  }
  return "hybrid";
}

export function saveBaseLayer(layer: BaseLayer): void {
  try {
    window.localStorage.setItem(BASE_KEY, layer);
  } catch {
    /* ignore */
  }
}

export function loadGradingOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(GRADING_KEY);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveGradingOn(on: boolean): void {
  try {
    window.localStorage.setItem(GRADING_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export function loadMapDataOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(MAPDATA_KEY);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveMapDataOn(on: boolean): void {
  try {
    window.localStorage.setItem(MAPDATA_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

const PLACES_KEY = "horsham-maps-places";

export function loadPlacesOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(PLACES_KEY);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function savePlacesOn(on: boolean): void {
  try {
    window.localStorage.setItem(PLACES_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export type PhotoMode = "auto" | "sat" | "vic";

export function loadPhotoMode(): PhotoMode {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(PHOTO_KEY);
    if (v === "sat" || v === "vic" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function savePhotoMode(mode: PhotoMode): void {
  try {
    window.localStorage.setItem(PHOTO_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function loadAutoZoom(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(AUTOZOOM_KEY);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveAutoZoom(on: boolean): void {
  try {
    window.localStorage.setItem(AUTOZOOM_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export function loadSpeedZoom(): SpeedZoomSettings {
  if (typeof window === "undefined") return DEFAULT_SPEED_ZOOM;
  try {
    const raw = window.localStorage.getItem(SPEED_ZOOM_KEY);
    if (!raw) return DEFAULT_SPEED_ZOOM;
    return normalizeSpeedZoom(JSON.parse(raw) as Partial<SpeedZoomSettings>);
  } catch {
    return DEFAULT_SPEED_ZOOM;
  }
}

export function saveSpeedZoom(next: SpeedZoomSettings): void {
  try {
    window.localStorage.setItem(SPEED_ZOOM_KEY, JSON.stringify(normalizeSpeedZoom(next)));
  } catch {
    /* ignore */
  }
}

export function loadRecents(): Place[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Place[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(place: Place, current: Place[]): Place[] {
  const id = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  const next = [{ ...place, id }, ...current.filter((p) => p.id !== id)].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function loadPins(): Place[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINS_KEY);
    return raw ? (JSON.parse(raw) as Place[]) : [];
  } catch {
    return [];
  }
}

export function savePins(pins: Place[]): void {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* ignore */
  }
}

export function loadOfflineAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(OFFLINE_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function saveOfflineAt(at = Date.now()): void {
  try {
    window.localStorage.setItem(OFFLINE_KEY, String(at));
  } catch {
    /* ignore */
  }
}

export function loadSensorsOnboarded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SENSORS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSensorsOnboarded(): void {
  try {
    window.localStorage.setItem(SENSORS_KEY, "1");
    window.localStorage.setItem(GEO_OK_KEY, "1");
    window.localStorage.setItem(COMPASS_OK_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function loadGeoOk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GEO_OK_KEY) === "1" || loadSensorsOnboarded();
  } catch {
    return false;
  }
}

export function saveGeoOk(): void {
  try {
    window.localStorage.setItem(GEO_OK_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function loadCompassOk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COMPASS_OK_KEY) === "1" || loadSensorsOnboarded();
  } catch {
    return false;
  }
}

export function saveCompassOk(): void {
  try {
    window.localStorage.setItem(COMPASS_OK_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function lastSessionSensorsGranted(): boolean {
  return (loadGeoOk() && loadCompassOk()) || loadSensorsOnboarded();
}

export type SensorSession = {
  geo: boolean;
  compass: boolean;
  ready: boolean;
};

let sensorSessionMem: SensorSession | null = null;

export function loadSensorSession(): SensorSession {
  if (sensorSessionMem) return sensorSessionMem;
  if (typeof window === "undefined") return { geo: false, compass: false, ready: false };
  try {
    const raw = window.sessionStorage.getItem(SENSOR_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SensorSession>;
      sensorSessionMem = {
        geo: Boolean(parsed.geo),
        compass: Boolean(parsed.compass),
        ready: Boolean(parsed.ready),
      };
      return sensorSessionMem;
    }
  } catch {
    /* ignore */
  }
  sensorSessionMem = { geo: false, compass: false, ready: false };
  return sensorSessionMem;
}

export function saveSensorSession(part: Partial<SensorSession>): SensorSession {
  const next: SensorSession = { ...loadSensorSession(), ...part };
  if (next.geo && next.compass) next.ready = true;
  sensorSessionMem = next;
  try {
    window.sessionStorage.setItem(SENSOR_SESSION_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function sensorsReadyThisWindow(): boolean {
  const session = loadSensorSession();
  return session.ready || lastSessionSensorsGranted();
}

function loadFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === "off") return false;
    if (v === "on") return true;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function loadAlwaysGps(): boolean {
  return loadFlag(ALWAYS_GPS_KEY, loadSensorsOnboarded());
}

export function saveAlwaysGps(on: boolean): void {
  try {
    window.localStorage.setItem(ALWAYS_GPS_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export function loadAlwaysMotion(): boolean {
  return loadFlag(ALWAYS_MOTION_KEY, loadSensorsOnboarded());
}

export function saveAlwaysMotion(on: boolean): void {
  try {
    window.localStorage.setItem(ALWAYS_MOTION_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export type LastView = { lat: number; lng: number; zoom: number };

export function loadLastView(): LastView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastView>;
    if (typeof v.lat !== "number" || typeof v.lng !== "number" || typeof v.zoom !== "number") return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || !Number.isFinite(v.zoom)) return null;
    return { lat: v.lat, lng: v.lng, zoom: v.zoom };
  } catch {
    return null;
  }
}

export function saveLastView(lat: number, lng: number, zoom: number): void {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify({ lat, lng, zoom }));
  } catch {
    /* ignore */
  }
}

export function loadTrack(): [number, number][] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TRACK_KEY);
    if (!raw) return [];
    const pts = JSON.parse(raw) as [number, number][];
    if (!Array.isArray(pts)) return [];
    return pts.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  } catch {
    return [];
  }
}

export function saveTrack(pts: [number, number][]): void {
  try {
    window.localStorage.setItem(TRACK_KEY, JSON.stringify(pts));
  } catch {
    /* ignore */
  }
}

export function appendTrackPoint(pts: [number, number][], lat: number, lng: number): [number, number][] {
  const last = pts[pts.length - 1];
  if (last) {
    const m = Math.hypot((lat - last[0]) * 111_320, (lng - last[1]) * 89_200);
    if (m < 12) return pts;
  }
  const next: [number, number][] = pts.length >= 4000 ? pts.slice(-3200) : pts.slice();
  next.push([lat, lng]);
  saveTrack(next);
  return next;
}

export function clearTrack(): void {
  saveTrack([]);
}
