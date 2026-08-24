export function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * Math.min(1, Math.max(0, t)) + 360) % 360;
}

export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** leaflet-rotate uses a clockwise CSS rotate. To put `trueHeading` at the top, rotate the other way. */
export function toLeafletBearing(trueHeading: number): number {
  return wrapDeg(-trueHeading);
}

/** Magnetic → true for the Wimmera (WMM ~2026, Horsham 36.7°S 142.2°E). */
export function magneticDeclinationEast(lat = -36.717, lng = 142.2): number {
  const dLat = lat + 36.717;
  const dLng = lng - 142.2;
  return 11.05 + dLat * 0.04 + dLng * 0.03;
}

function screenAngle(): number {
  const oriented = window.screen?.orientation?.angle;
  if (typeof oriented === "number" && Number.isFinite(oriented)) return oriented;
  const legacy = (window as Window & { orientation?: number }).orientation;
  if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
  return 0;
}

type OrientEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
  absolute?: boolean;
};

export type HeadingSnapshot = {
  heading: number;
  source: "compass" | "gyro" | "gps" | "fused";
  compassLive: boolean;
  gpsLive: boolean;
  needsCalibration: boolean;
};

export async function requestMotionPermissions(): Promise<"granted" | "denied" | "unsupported"> {
  const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<string>;
  };
  const DME = DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<string>;
  };
  if (typeof DOE.requestPermission !== "function") {
    if (typeof DME.requestPermission === "function") {
      try {
        await DME.requestPermission();
      } catch {
        /* gyro optional */
      }
    }
    return "unsupported";
  }
  try {
    const orient = await DOE.requestPermission();
    if (orient !== "granted") return "denied";
    if (typeof DME.requestPermission === "function") {
      try {
        await DME.requestPermission();
      } catch {
        /* gyro optional — heading still works */
      }
    }
    return "granted";
  } catch {
    return "unsupported";
  }
}

/** iOS only delivers compass events after requestPermission() from a tap. */
export function armCompassOnTap(start: () => void): () => void {
  let done = false;
  let pending = false;
  const needsGesture = typeof (DeviceOrientationEvent as { requestPermission?: unknown }).requestPermission === "function";

  const kick = () => {
    if (done) return;
    done = true;
    window.removeEventListener("pointerdown", fromTap, true);
    window.removeEventListener("touchstart", fromTap, true);
    start();
  };

  const fromTap = () => {
    if (done || pending) return;
    pending = true;
    void requestMotionPermissions().then((perm) => {
      pending = false;
      if (perm !== "denied") kick();
    });
  };

  window.addEventListener("pointerdown", fromTap, true);
  window.addEventListener("touchstart", fromTap, true);

  if (!needsGesture) {
    void requestMotionPermissions().finally(kick);
  } else {
    void requestMotionPermissions().then((perm) => {
      if (perm === "granted") kick();
    });
  }

  return () => {
    window.removeEventListener("pointerdown", fromTap, true);
    window.removeEventListener("touchstart", fromTap, true);
  };
}

function compassFromEvent(event: OrientEvent): { magnetic: number; accuracy: number | null } | null {
  if (typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)) {
    const accuracy =
      typeof event.webkitCompassAccuracy === "number" && Number.isFinite(event.webkitCompassAccuracy)
        ? event.webkitCompassAccuracy
        : null;
    return { magnetic: wrapDeg(event.webkitCompassHeading), accuracy };
  }
  if (typeof event.alpha !== "number" || !Number.isFinite(event.alpha)) return null;
  const absolute = event.absolute === true || event.type === "deviceorientationabsolute";
  if (!absolute && event.type !== "deviceorientation") return null;
  return { magnetic: wrapDeg(360 - event.alpha + screenAngle()), accuracy: null };
}

function worldYawRate(event: DeviceMotionEvent): number | null {
  const rate = event.rotationRate;
  const acc = event.accelerationIncludingGravity;
  if (!rate || !acc) return null;
  const ax = acc.x ?? 0;
  const ay = acc.y ?? 0;
  const az = acc.z ?? 0;
  const norm = Math.hypot(ax, ay, az);
  if (norm < 6) return null;
  const alpha = rate.alpha ?? 0;
  const beta = rate.beta ?? 0;
  const gamma = rate.gamma ?? 0;
  if (![alpha, beta, gamma].some((v) => v !== 0)) return null;
  const yaw = -(beta * (ax / norm) + gamma * (ay / norm) + alpha * (az / norm));
  if (!Number.isFinite(yaw) || Math.abs(yaw) > 540) return null;
  return yaw;
}

function angAbs(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Complementary filter only — no animation frame of its own.
 * DriveEngine steps this once per frame.
 */
export class HeadingEngine {
  heading = 0;
  display = 0;
  private seeded = false;
  private compassAt = 0;
  private gpsAt = 0;
  private gyroAt = 0;
  private lastLat = -36.717;
  private lastLng = 142.2;
  private compassHeading: number | null = null;
  private gpsHeading: number | null = null;
  private speedMs = 0;
  private compassAccuracy: number | null = null;
  private lastFrame = 0;
  private running = false;

  start(): void {
    this.stop();
    this.running = true;
    this.lastFrame = performance.now();
    window.addEventListener("deviceorientation", this.onOrient, true);
    window.addEventListener("deviceorientationabsolute", this.onOrient as EventListener, true);
    window.addEventListener("devicemotion", this.onMotion, true);
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("deviceorientation", this.onOrient, true);
    window.removeEventListener("deviceorientationabsolute", this.onOrient as EventListener, true);
    window.removeEventListener("devicemotion", this.onMotion, true);
  }

  pushFix(lat: number, lng: number, heading: number | null, speedMs: number | null): void {
    this.lastLat = lat;
    this.lastLng = lng;
    this.speedMs = typeof speedMs === "number" && speedMs >= 0 ? speedMs : 0;
    if (typeof heading === "number" && heading >= 0 && Number.isFinite(heading) && this.speedMs >= 0.8) {
      this.gpsHeading = wrapDeg(heading);
      this.gpsAt = performance.now();
      if (!this.seeded) {
        this.heading = this.gpsHeading;
        this.display = this.gpsHeading;
        this.seeded = true;
      }
    }
  }

  step(now: number): HeadingSnapshot | null {
    if (!this.running) return null;
    const dt = Math.max(0.008, Math.min(0.04, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const compassFresh = now - this.compassAt < 1200 && this.compassHeading != null;
    const gpsFresh = now - this.gpsAt < 2500 && this.gpsHeading != null;
    const gyroFresh = now - this.gyroAt < 250;
    const cruising = this.speedMs >= 8;

    if (this.seeded && compassFresh && this.compassHeading != null) {
      const tau = gyroFresh ? 0.85 : 0.45;
      this.heading = lerpAngle(this.heading, this.compassHeading, 1 - Math.exp(-dt / tau));
    } else if (this.seeded && gpsFresh && this.gpsHeading != null) {
      const tau = this.speedMs < 2 ? 0.7 : 0.28;
      this.heading = lerpAngle(this.heading, this.gpsHeading, 1 - Math.exp(-dt / tau));
    }

    if (this.seeded && gpsFresh && this.gpsHeading != null && cruising && compassFresh) {
      const err = angAbs(this.heading, this.gpsHeading);
      if (err < 35) this.heading = lerpAngle(this.heading, this.gpsHeading, 1 - Math.exp(-dt / 1.6));
    }

    if (this.seeded) {
      const turn = angAbs(this.display, this.heading) / Math.max(dt, 0.01);
      const tau = turn > 40 ? 0.07 : turn > 18 ? 0.11 : this.speedMs < 1.2 ? 0.32 : 0.16;
      this.display = lerpAngle(this.display, this.heading, 1 - Math.exp(-dt / tau));
    }
    if (!this.seeded || !Number.isFinite(this.display)) return null;
    const source: HeadingSnapshot["source"] =
      !compassFresh && gpsFresh ? "gps" : gpsFresh && cruising ? "gps" : compassFresh && gyroFresh ? "fused" : compassFresh ? "compass" : gpsFresh ? "gps" : "gyro";
    return {
      heading: this.display,
      source,
      compassLive: compassFresh,
      gpsLive: gpsFresh,
      needsCalibration: this.compassAccuracy === -1,
    };
  }

  private onOrient = (event: DeviceOrientationEvent): void => {
    const raw = compassFromEvent(event as OrientEvent);
    if (!raw) return;
    this.compassAccuracy = raw.accuracy;
    const trueHeading = wrapDeg(raw.magnetic + magneticDeclinationEast(this.lastLat, this.lastLng));
    this.compassHeading = trueHeading;
    this.compassAt = performance.now();
    if (!this.seeded) {
      this.heading = trueHeading;
      this.display = trueHeading;
      this.seeded = true;
    }
  };

  private onMotion = (event: DeviceMotionEvent): void => {
    const rate = worldYawRate(event);
    const now = performance.now();
    if (rate == null) return;
    if (this.gyroAt && this.seeded) {
      const dt = Math.min(0.04, (now - this.gyroAt) / 1000);
      this.heading = wrapDeg(this.heading + rate * dt);
    }
    this.gyroAt = now;
  };
}

export async function requestScreenWakeLock(): Promise<{ release: () => void }> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
  };
  if (!nav.wakeLock) return { release() {} };
  try {
    const lock = await nav.wakeLock.request("screen");
    return {
      release() {
        void lock.release();
      },
    };
  } catch {
    return { release() {} };
  }
}

export function deadReckon(lat: number, lng: number, heading: number, speedMs: number, dt: number): [number, number] {
  if (speedMs < 0.4 || dt <= 0) return [lat, lng];
  const rad = (heading * Math.PI) / 180;
  const metres = speedMs * dt;
  return [lat + (metres * Math.cos(rad)) / 111_320, lng + (metres * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180))];
}
