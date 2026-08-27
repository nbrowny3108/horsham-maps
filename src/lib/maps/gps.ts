export type GpsFix = {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number;
  sats: number | null;
};

export function isFramed(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

export function gpsDeniedText(): string {
  if (isFramed()) return "GPS is blocked in the preview — open the Home Screen app";
  return "Settings → Horsham Maps → Location → While Using";
}

export async function queryGeoPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const status = await Promise.race([
      navigator.permissions.query({ name: "geolocation" }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 250)),
    ]);
    if (!status) return "unknown";
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") return status.state;
  } catch {
    /* iOS older */
  }
  return "unknown";
}

function readSats(coords: GeolocationCoordinates): number | null {
  const extra = coords as GeolocationCoordinates & {
    satelliteNumber?: number;
    satellites?: number;
    sats?: number;
  };
  const n = extra.satelliteNumber ?? extra.satellites ?? extra.sats;
  if (typeof n === "number" && Number.isFinite(n) && n > 0 && n < 80) return Math.round(n);
  return null;
}

function readFix(pos: GeolocationPosition): GpsFix {
  const heading = pos.coords.heading;
  const speed = pos.coords.speed;
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: Math.max(8, pos.coords.accuracy || 20),
    heading: typeof heading === "number" && heading >= 0 ? heading : null,
    speed: typeof speed === "number" && Number.isFinite(speed) && speed >= 0 ? speed : 0,
    sats: readSats(pos.coords),
  };
}

export function startGpsWatch(onFix: (fix: GpsFix) => void, onDenied: (message: string) => void): () => void {
  if (isFramed()) {
    return () => {};
  }

  const watches: number[] = [];
  let stopped = false;

  const apply = (pos: GeolocationPosition) => {
    if (stopped) return;
    onFix(readFix(pos));
  };

  const fail = (err: GeolocationPositionError) => {
    if (stopped) return;
    if (err.code === err.PERMISSION_DENIED) {
      onDenied(gpsDeniedText());
      return;
    }
    window.setTimeout(() => {
      if (stopped || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(apply, () => {}, { enableHighAccuracy: false, maximumAge: 60_000 });
    }, 1200);
  };

  if (!navigator.geolocation) {
    onDenied(isFramed() ? gpsDeniedText() : "GPS is not available on this device");
    return () => {};
  }

  navigator.geolocation.getCurrentPosition(apply, fail, { enableHighAccuracy: true, maximumAge: 8_000, timeout: 12_000 });
  watches.push(
    navigator.geolocation.watchPosition(apply, fail, {
      enableHighAccuracy: true,
      maximumAge: 700,
      timeout: 20_000,
    }),
  );

  return () => {
    stopped = true;
    for (const id of watches) navigator.geolocation.clearWatch(id);
  };
}
