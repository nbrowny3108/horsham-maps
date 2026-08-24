import { isFramed, queryGeoPermission } from "./gps";
import { requestMotionPermissions } from "./heading";
import {
  lastSessionSensorsGranted,
  loadSensorSession,
  loadSensorsOnboarded,
  saveAlwaysGps,
  saveAlwaysMotion,
  saveCompassOk,
  saveGeoOk,
  saveSensorSession,
  saveSensorsOnboarded,
  sensorsReadyThisWindow,
} from "./storage";

export type PermissionAccess = "checking" | "gate" | "denied" | "ready";

export function markSensorsReady(): void {
  saveSensorSession({ geo: true, compass: true, ready: true });
  saveSensorsOnboarded();
  saveAlwaysGps(true);
  saveAlwaysMotion(true);
}

export function markGeoGranted(): void {
  saveSensorSession({ geo: true });
  saveGeoOk();
  saveAlwaysGps(true);
}

export function markCompassGranted(): void {
  saveSensorSession({ compass: true });
  saveCompassOk();
  saveAlwaysMotion(true);
}

/** Location only. Call from a tap. Timeout / no-fix still counts as allowed. */
export function requestGeoGrant(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    navigator.geolocation.getCurrentPosition(
      () => done(true),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          done(false);
          return;
        }
        done(true);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  });
}

export async function requestCompassGrant(): Promise<boolean> {
  const motion = await requestMotionPermissions();
  return motion !== "denied";
}

export async function probeExistingGrants(): Promise<Exclude<PermissionAccess, "checking">> {
  if (typeof window === "undefined") return "gate";
  if (lastSessionSensorsGranted() || sensorsReadyThisWindow()) return "ready";
  if (isFramed()) return "gate";
  const geo = await queryGeoPermission();
  if (geo === "denied") return "denied";
  const session = loadSensorSession();
  if (session.ready || (session.geo && session.compass) || loadSensorsOnboarded()) return "ready";
  return "gate";
}

export { loadSensorSession, sensorsReadyThisWindow };
