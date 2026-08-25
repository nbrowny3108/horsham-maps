import type { Map as LeafletMap } from "leaflet";
import { deadReckon, HeadingEngine, holdScreenWakeLock, toLeafletBearing, type HeadingSnapshot } from "./heading";
import { followCameraLatLng, zoomForSpeed } from "./style";
import { RoadIndex, snapCurrentRoad, snapNextRoad, snapPuckToRoad, type JunctionSnap, type RoadSnap } from "./snap";
import type { GpsFix } from "./gps";

export type DriveHud = {
  heading: number;
  source: HeadingSnapshot["source"];
  compassLive: boolean;
  needsCalibration: boolean;
  speedKmh: number | null;
  tripKm: number;
  road: string;
  next: string;
  gpsLabel: string;
  hasFix: boolean;
};

type DriveMap = LeafletMap & {
  setBearing?: (bearing: number, preserveCenter?: boolean) => LeafletMap;
  getBearing?: () => number;
};

type DriveHooks = {
  map: () => DriveMap | null;
  follow: () => boolean;
  headingUp: () => boolean;
  userZoom: () => boolean;
  canRotate: () => boolean;
  setGpsLatLng: (here: [number, number]) => void;
  paintLabels: () => void;
  onHud: (hud: Partial<DriveHud>) => void;
};

export class DriveEngine {
  readonly compass = new HeadingEngine();
  last: [number, number] | null = null;
  display: [number, number] | null = null;
  heading = 0;
  speed = 0;
  tripKm = 0;
  snaps: RoadSnap[] = [];
  roads = new RoadIndex();
  junctions: JunctionSnap[] = [];
  panning = false;
  private gesturing = false;

  private hooks: DriveHooks | null = null;
  private raf = 0;
  private lastFrame = 0;
  private lastPan = 0;
  private lastCam: [number, number] | null = null;
  private lastNames = 0;
  private lastZoomAt = 0;
  private lastHud = 0;
  private lastBearing = -999;
  private tripLast: [number, number] | null = null;
  private tripShown = 0;
  private road = "";
  private next = "";
  private wake: { release: () => void } | null = null;
  private autoZoom = true;

  attach(hooks: DriveHooks): void {
    this.detach();
    this.hooks = hooks;
    this.compass.start();
    this.lastFrame = performance.now();
    this.raf = window.requestAnimationFrame(this.loop);
    this.wake = holdScreenWakeLock();
  }

  detach(): void {
    this.hooks = null;
    this.compass.stop();
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.wake?.release();
    this.wake = null;
  }

  resetTrip(): void {
    this.tripKm = 0;
    this.tripShown = 0;
    this.tripLast = this.last;
    this.hooks?.onHud({ tripKm: 0 });
  }

  setAutoZoom(on: boolean): void {
    this.autoZoom = on;
    if (on) this.lastZoomAt = 0;
  }

  isAutoZoom(): boolean {
    return this.autoZoom;
  }

  lockView(): void {
    this.panning = true;
  }

  unlockView(): void {
    this.panning = false;
  }

  beginGesture(): void {
    this.gesturing = true;
    this.panning = true;
  }

  endGesture(): void {
    this.gesturing = false;
    this.panning = false;
    this.lastZoomAt = performance.now();
  }

  ingest(fix: GpsFix): void {
    const rawHere: [number, number] = [fix.lat, fix.lng];
    if (this.last) {
      const jump = Math.hypot((rawHere[0] - this.last[0]) * 111.32, (rawHere[1] - this.last[1]) * 89.2);
      if (jump > 0.08 && (fix.accuracy >= 45 || fix.speed < 0.8)) return;
    }
    const snapped = snapPuckToRoad(this.snaps, rawHere, this.heading, this.roads);
    const here: [number, number] = snapped ?? rawHere;
    this.last = here;
    if (!this.display) this.display = here;
    if (this.tripLast) {
      const step = Math.hypot((here[0] - this.tripLast[0]) * 111.32, (here[1] - this.tripLast[1]) * 89.2);
      if (step >= 0.001 && step < 0.22 && fix.accuracy < 45) {
        this.tripKm += step;
        if (this.tripKm - this.tripShown >= 0.001) {
          this.tripShown = this.tripKm;
          this.hooks?.onHud({ tripKm: this.tripKm });
        }
      }
    }
    this.tripLast = here;
    this.speed = fix.speed;
    this.compass.pushFix(here[0], here[1], fix.heading, fix.speed);
    const hd = this.heading;
    const road = snapCurrentRoad(this.snaps, here, hd, this.roads) || this.road;
    if (road && road !== this.road) this.road = road;
    const next = snapNextRoad(this.junctions, this.road, here, hd);
    if (next !== this.next) this.next = next;
    this.hooks?.onHud({
      speedKmh: fix.speed > 0 ? fix.speed * 3.6 : null,
      road: this.road,
      next: this.next,
      gpsLabel: `${Math.abs(fix.lat).toFixed(5)}°S ${Math.abs(fix.lng).toFixed(5)}°E`,
      hasFix: true,
    });
    if (!this.hooks?.follow()) this.hooks?.setGpsLatLng(here);
  }

  private loop = (now: number): void => {
    try {
      if (!document.hidden) this.tick(now);
    } catch {
      /* keep driving */
    }
    this.raf = window.requestAnimationFrame(this.loop);
  };

  private applyBearing(map: DriveMap | null): void {
    const hooks = this.hooks;
    if (!hooks?.headingUp() || !map || !Number.isFinite(this.heading)) return;
    const deg = toLeafletBearing(this.heading);
    const delta = Math.abs(((deg - this.lastBearing + 540) % 360) - 180);
    if (delta < 0.85) return;
    this.lastBearing = deg;
    if (hooks.canRotate() && map.setBearing) {
      try {
        map.setBearing(deg, true);
        return;
      } catch {
        /* fall through */
      }
    }
    const pane = map.getPane?.("rotatePane") ?? map.getPane?.("tilePane");
    if (pane) pane.style.transform = `rotate(${deg}deg)`;
  }

  private tick(now: number): void {
    const hooks = this.hooks;
    if (!hooks) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const snap = this.compass.step(now);
    if (snap) {
      this.heading = snap.heading;
      if (now - this.lastHud > 180) {
        this.lastHud = now;
        hooks.onHud({
          heading: snap.heading,
          source: snap.source,
          compassLive: snap.compassLive,
          needsCalibration: snap.needsCalibration,
        });
      }
    }

    const map = hooks.map();
    if (this.gesturing) return;
    const raw = this.last;
    if (map && raw && hooks.follow() && !hooks.userZoom()) {
      let next = this.display ?? raw;
      if (hooks.headingUp()) next = deadReckon(next[0], next[1], this.heading, this.speed, dt);
      const t = 1 - Math.exp(-dt / 0.16);
      next = [next[0] + (raw[0] - next[0]) * t, next[1] + (raw[1] - next[1]) * t];
      this.display = next;
      hooks.setGpsLatLng(next);
      if (now - this.lastPan >= 140) {
        const cam = followCameraLatLng(map, next, hooks.headingUp());
        const moved =
          !this.lastCam ||
          Math.abs(cam.lat - this.lastCam[0]) > 3.5e-5 ||
          Math.abs(cam.lng - this.lastCam[1]) > 4e-5;
        const zNow = map.getZoom();
        const wantAuto = this.autoZoom && now - this.lastZoomAt > 2200;
        let z = zNow;
        let zooming = false;
        if (wantAuto) {
          const target = zoomForSpeed(this.speed * 3.6, zNow);
          if (Math.abs(target - zNow) >= 0.45) {
            z = target;
            zooming = true;
          }
          this.lastZoomAt = now;
        }
        if (moved || zooming) {
          this.lastPan = now;
          this.lastCam = [cam.lat, cam.lng];
          this.panning = true;
          if (zooming) map.setView(cam, z, { animate: false });
          else map.panTo(cam, { animate: false, duration: 0, noMoveStart: true } as import("leaflet").PanOptions);
          this.panning = false;
        }
      }
      if (hooks.headingUp() && now - this.lastNames > 2200) {
        this.lastNames = now;
        hooks.paintLabels();
      }
    }
    this.applyBearing(map);
  }
}
