import { useEffect, useRef, useState } from "react";
import type { GeoJSON, LayerGroup } from "leaflet";
import { MapChrome } from "./map-chrome";
import { bootMap, type MapHandle } from "./map-boot";
import { remainingKmAlong, nextRouteTurn } from "@/lib/maps/geo";
import { armCompassOnTap, requestMotionPermissions, toLeafletBearing } from "@/lib/maps/heading";
import { queryGeoPermission, startGpsWatch, isFramed, type GpsFix } from "@/lib/maps/gps";
import { DriveEngine } from "@/lib/maps/drive-engine";
import {
  gpsIconHtml,
  gradeStyle,
  hybridGrade,
  roadLineStyle,
  ZOOM_STEP_PCT,
  shireLatLngBounds,
  updateShireFitZoom,
  zoomFromPercent,
  zoomForSpeed,
  zoomPercent,
} from "@/lib/maps/style";
import { startBackgroundCache } from "@/lib/maps/app-cache";
import { listMapLibrary, saveMapLibrary, type LibraryFile } from "@/lib/maps/map-library";
import { prefetchDrive } from "@/lib/maps/tile-cache";
import { placeSubtitle, placeTitle, RateLimitError, reverseGeocode, searchPlaces } from "@/lib/maps/places";
import { planRoutes } from "@/lib/maps/routing";
import {
  loadAlwaysGps,
  loadAlwaysMotion,
  loadAutoZoom,
  loadCompassOk,
  loadGeoOk,
  loadGradingOn,
  loadMapDataOn,
  loadOfflineAt,
  loadPins,
  loadPlacesOn,
  loadRecents,
  loadSensorsOnboarded,
  loadTrack,
  appendTrackPoint,
  clearTrack,
  pushRecent,
  saveAlwaysGps,
  saveAlwaysMotion,
  saveAutoZoom,
  saveGradingOn,
  saveMapDataOn,
  saveOfflineAt,
  savePins,
  savePlacesOn,
  saveSensorsOnboarded,
} from "@/lib/maps/storage";
import {
  MAP_COLORS,
  type GpsMode,
  type HeadingMode,
  type NominatimHit,
  type Place,
  type RouteOption,
} from "@/lib/maps/types";

function nearly(a: Place, b: Place) {
  return Math.abs(a.lat - b.lat) < 1.5e-4 && Math.abs(a.lng - b.lng) < 1.5e-4;
}

export function MapApp() {
  const mapEl = useRef<HTMLDivElement>(null);
  const footerEl = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchPanel = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const drive = useRef(new DriveEngine());
  const lastGps = useRef<[number, number] | null>(null);
  const headingRef = useRef(0);
  const speedRef = useRef(0);
  const gpsModeRef = useRef<GpsMode>("follow");
  const headingModeRef = useRef<HeadingMode>("heading");
  const showPlacesRef = useRef(true);
  const userZoomRef = useRef(false);
  const routeCoords = useRef<[number, number][] | null>(null);
  const gpsOnRef = useRef(false);
  const lastQuery = useRef("");
  const needStartRef = useRef(true);
  const startGpsRef = useRef<() => void>(() => {});
  const stopGpsRef = useRef<() => void>(() => {});
  const setZoomPctRef = useRef<(n: number) => void>(() => {});
  const setZoomModeRef = useRef<(auto: boolean) => void>(() => {});
  const remainAtRef = useRef(0);
  const trackPts = useRef<[number, number][]>(loadTrack());
  const drivePrefetchAt = useRef(0);
  const paintFixRef = useRef<(fix: GpsFix) => void>(() => {});
  const gpsIconKeyRef = useRef("");

  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinAim, setPinAim] = useState(false);
  const pinAimRef = useRef(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [pins, setPins] = useState<Place[]>(() => loadPins());
  const [recents, setRecents] = useState<Place[]>(() => loadRecents());
  const [gpsMode, setGpsMode] = useState<GpsMode>("follow");
  const [headingMode, setHeadingMode] = useState<HeadingMode>("heading");
  const [heading, setHeading] = useState(0);
  const [compassLive, setCompassLive] = useState(false);
  const [headingSource, setHeadingSource] = useState<"compass" | "gyro" | "gps" | "fused">("compass");
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [nextTurn, setNextTurn] = useState<{ instruction: string; km: number } | null>(null);
  const navRef = useRef(false);
  const routesRef = useRef(routes);
  const activeIdRef = useRef(activeRouteId);
  routesRef.current = routes;
  activeIdRef.current = activeRouteId;
  navRef.current = navActive;
  const [routing, setRouting] = useState(false);
  const [showShire, setShowShire] = useState(true);
  const [showMapData, setShowMapData] = useState(() => loadMapDataOn());
  const [showPlaces, setShowPlaces] = useState(() => loadPlacesOn());
  const [showGrading, setShowGrading] = useState(() => loadGradingOn());
  const [gradingCount, setGradingCount] = useState(0);
  const [gradingKm, setGradingKm] = useState(0);
  const [gradingNote, setGradingNote] = useState("");
  const [speedKmh, setSpeedKmh] = useState<number | null>(null);
  const [tripKm, setTripKm] = useState(0);
  const [currentRoad, setCurrentRoad] = useState("");
  const [nextRoad, setNextRoad] = useState("");
  const [remainKm, setRemainKm] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [savingOffline, setSavingOffline] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryFile[]>([]);
  const [libraryUsedMb, setLibraryUsedMb] = useState(0);
  const [libraryQuotaMb, setLibraryQuotaMb] = useState(0);
  const [libraryBusy, setLibraryBusy] = useState<string | null>(null);
  const [offlineAt, setOfflineAt] = useState<number | null>(() => loadOfflineAt());
  const [needStart, setNeedStart] = useState(false);
  const [zoomPct, setZoomPct] = useState(80);
  const [autoZoom, setAutoZoom] = useState(() => loadAutoZoom());
  const [locating, setLocating] = useState(false);
  const [hasFix, setHasFix] = useState(false);
  const [gpsLabel, setGpsLabel] = useState("");
  const [alwaysGps, setAlwaysGps] = useState(() => loadAlwaysGps());
  const [alwaysMotion, setAlwaysMotion] = useState(() => loadAlwaysMotion());
  const [geoPerm, setGeoPerm] = useState<"granted" | "denied" | "prompt" | "unknown">(() =>
    loadGeoOk() ? "granted" : "unknown",
  );
  const [motionPerm, setMotionPerm] = useState<"granted" | "denied" | "unsupported" | "unknown">(() =>
    loadCompassOk() ? "granted" : "unknown",
  );

  gpsModeRef.current = gpsMode;
  headingModeRef.current = headingMode;
  showPlacesRef.current = showPlaces;
  pinAimRef.current = pinAim;
  needStartRef.current = needStart;
  setZoomPctRef.current = setZoomPct;

  function setZoomMode(auto: boolean) {
    setAutoZoom(auto);
    saveAutoZoom(auto);
    drive.current.setAutoZoom(auto);
    if (!auto) return;
    const map = handle.current?.map;
    if (!map) return;
    const z = zoomForSpeed(speedRef.current * 3.6, map.getZoom());
    drive.current.lockView();
    map.setZoom(z, { animate: false });
    setZoomPct(zoomPercent(z));
    drive.current.unlockView();
  }
  setZoomModeRef.current = setZoomMode;

  function nudgeZoom(deltaPct: number) {
    const map = handle.current?.map;
    if (!map) return;
    updateShireFitZoom(map);
    const next = Math.min(100, Math.max(0, zoomPercent(map.getZoom()) + deltaPct));
    setZoomMode(false);
    userZoomRef.current = true;
    drive.current.lockView();
    if (next <= 0) {
      map.fitBounds(shireLatLngBounds(), { padding: [16, 64], animate: false, maxZoom: map.getMinZoom() });
    } else {
      map.setZoom(zoomFromPercent(next), { animate: false });
    }
    drive.current.unlockView();
    setZoomPct(next);
  }

  function styleRoadLayers() {
    const ctx = handle.current;
    if (!ctx) return;
    const style = roadLineStyle("hybrid");
    ctx.roadLines?.setStyle(style);
    ctx.roadChunks?.eachLayer((layer) => {
      (layer as GeoJSON).setStyle(style);
    });
  }

  function applyOverlays() {
    const ctx = handle.current;
    if (!ctx) return;
    const dataOn = showMapData;
    const gradeOn = dataOn && showGrading;
    hybridGrade.show = gradeOn;
    styleRoadLayers();
    ctx.grading?.setStyle(gradeStyle("hybrid"));
    const showLayer = (layer: GeoJSON | LayerGroup | undefined, on: boolean) => {
      if (!layer) return;
      if (on && !ctx.map.hasLayer(layer)) layer.addTo(ctx.map);
      if (!on && ctx.map.hasLayer(layer)) ctx.map.removeLayer(layer);
    };
    showLayer(ctx.roadLines, dataOn);
    showLayer(ctx.roadChunks, dataOn);
    showLayer(ctx.grading, gradeOn);
    showLayer(ctx.places, showPlacesRef.current);
  }

  function applyMapBearing(trueHeading: number) {
    const ctx = handle.current;
    if (!ctx?.canRotate || !ctx.map.setBearing) return;
    if (!Number.isFinite(trueHeading)) return;
    try {
      const next = toLeafletBearing(trueHeading);
      const prev = ctx.map.getBearing?.() ?? 0;
      const d = Math.abs(((next - prev + 540) % 360) - 180);
      if (d < 0.08) return;
      ctx.map.setBearing(next, true);
    } catch {
      /* rotate can throw on a torn-down map */
    }
  }

  function applyGpsCone() {
    const ctx = handle.current;
    if (!ctx?.gps) return;
    const cone = ctx.gps.getElement()?.querySelector(".gps-mark-cone") as HTMLElement | null;
    if (!cone) return;
    const headingUp = headingModeRef.current === "heading";
    cone.style.transform = `rotate(${headingUp && ctx.canRotate ? 0 : headingRef.current}deg)`;
    cone.style.opacity = headingUp ? "1" : "0.4";
  }

  function rebuildGpsIcon() {
    const ctx = handle.current;
    if (!ctx?.gps) return;
    const headingUp = headingModeRef.current === "heading";
    const key = `${headingModeRef.current}|${ctx.canRotate ? 1 : 0}`;
    if (key === gpsIconKeyRef.current) {
      applyGpsCone();
      return;
    }
    gpsIconKeyRef.current = key;
    ctx.gps.setIcon(
      ctx.L.divIcon({
        className: "",
        iconSize: [36, 36],
        html: gpsIconHtml(headingRef.current, headingUp, ctx.canRotate),
      }),
    );
    window.requestAnimationFrame(applyGpsCone);
  }

  function beginGps() {
    if (isFramed()) {
      setLocating(false);
      setError("GPS only works from the Home Screen app — open the Horsham Maps icon");
      return;
    }
    setLocating(true);
    setGpsMode("follow");
    if (gpsOnRef.current) return;
    gpsOnRef.current = true;
    stopGpsRef.current();
    stopGpsRef.current = startGpsWatch(
      (fix) => paintFixRef.current(fix),
      (message) => {
        gpsOnRef.current = false;
        setLocating(false);
        setError(message);
      },
    );
  }
  startGpsRef.current = beginGps;

  paintFixRef.current = (fix: GpsFix) => {
    const here: [number, number] = [fix.lat, fix.lng];
    lastGps.current = here;
    speedRef.current = fix.speed;
    headingRef.current = drive.current.heading || (fix.heading ?? headingRef.current);
    drive.current.ingest(fix);
    trackPts.current = appendTrackPoint(trackPts.current, here[0], here[1]);
    const ctxTrack = handle.current;
    if (ctxTrack?.track) {
      ctxTrack.track.setLatLngs(trackPts.current);
      const showTrack = trackPts.current.length >= 2 && !navRef.current;
      if (showTrack && !ctxTrack.map.hasLayer(ctxTrack.track)) ctxTrack.track.addTo(ctxTrack.map);
      if (!showTrack && ctxTrack.map.hasLayer(ctxTrack.track)) ctxTrack.map.removeLayer(ctxTrack.track);
    }
    const ctxNow = handle.current;
    if (ctxNow) {
      const t = performance.now();
      if (t - drivePrefetchAt.current > 700) {
        drivePrefetchAt.current = t;
        const z = ctxNow.map.getZoom();
        const kind = "best" as const;
        prefetchDrive({
          lat: here[0],
          lng: here[1],
          heading: drive.current.heading || headingRef.current,
          speedKmh: fix.speed * 3.6,
          zoom: z,
          kind,
          route: routeCoords.current,
        });
      }
    }
    const path = routeCoords.current;
    if (path) {
      const now = performance.now();
      if (now - remainAtRef.current > 700) {
        remainAtRef.current = now;
        setRemainKm(remainingKmAlong(path, here[0], here[1]));
        if (navRef.current) {
          const opt = routesRef.current.find((r) => r.id === activeIdRef.current);
          setNextTurn(nextRouteTurn(opt?.steps, path, here[0], here[1]));
        }
      }
    }
    if (headingModeRef.current !== "heading" && fix.heading != null) {
      headingRef.current = fix.heading;
      setHeading(fix.heading);
    }
    const ctx = handle.current;
    if (ctx) {
      const acc = Math.max(12, fix.accuracy);
      if (!ctx.gps) {
        ctx.accuracy = ctx.L.circle(here, {
          radius: acc,
          pane: "gpsPane",
          color: MAP_COLORS.gps,
          weight: 1,
          fillColor: MAP_COLORS.gps,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(ctx.map);
        ctx.gps = ctx.L.marker(here, {
          pane: "gpsPane",
          icon: ctx.L.divIcon({ className: "", iconSize: [36, 36], html: gpsIconHtml(headingRef.current, headingModeRef.current === "heading", ctx.canRotate) }),
          zIndexOffset: 2200,
          interactive: false,
        }).addTo(ctx.map);
        gpsIconKeyRef.current = "";
        rebuildGpsIcon();
      } else {
        ctx.accuracy?.setRadius(acc);
      }
      applyGpsCone();
    }
    setHasFix(true);
    setLocating(false);
    setGeoPerm("granted");
    setError(null);
  };

  function pinToolbar() {
    const el = footerEl.current;
    if (el) {
      el.style.bottom = "10px";
      el.style.left = "10px";
      el.style.right = "10px";
      el.style.paddingBottom = "0px";
      el.style.height = "";
      el.style.maxHeight = "";
      el.style.transform = "";
      el.style.marginBottom = "0px";
    }
    const app = document.getElementById("app");
    if (app) app.style.transform = "";
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function closeSearch() {
    lastQuery.current = "";
    setQuery("");
    setHits([]);
    setSearchNote("");
    setSearchOpen(false);
    searchInput.current?.blur();
    pinToolbar();
    window.setTimeout(pinToolbar, 160);
  }

  useEffect(() => {
    let t = 0;
    const fill = () => {
      const vv = window.visualViewport;
      const h = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, vv ? Math.round(vv.height + vv.offsetTop) : 0);
      document.documentElement.style.setProperty("--app-h", `${h}px`);
      const app = document.getElementById("app");
      if (app) {
        app.style.height = `${h}px`;
        app.style.minHeight = `${h}px`;
      }
      pinToolbar();
      const map = handle.current?.map;
      if (map) {
        map.invalidateSize({ animate: false });
        drive.current.lockView();
        updateShireFitZoom(map);
        drive.current.unlockView();
        setZoomPctRef.current(zoomPercent(map.getZoom()));
      }
    };
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(fill, 120);
    };
    fill();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    let dead = false;
    let stopBoot: (() => void) | undefined;

    const waitFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    void (async () => {
      for (let i = 0; i < 8 && !dead && !mapEl.current; i += 1) await waitFrame();
      if (dead || !mapEl.current) return;
      try {
        stopBoot = await bootMap({
          mapEl: mapEl.current,
          handle,
          drive: drive.current,
          lastGps,
          speedRef,
          headingRef,
          gpsModeRef,
          headingModeRef,
          showPlacesRef,
          needStartRef,
          userZoomRef,
          pinAimRef,
          setReady,
          setZoomPct: (n) => setZoomPctRef.current(n),
          setError,
          setGpsMode,
          setPlace,
          setGradingCount,
          setGradingKm,
          setGradingNote,
          paintFix: (fix) => paintFixRef.current(fix),
          dropPlace,
          styleRoadLayers,
          isDead: () => dead,
        });
      } catch {
        if (!dead) setError("Map failed to start — close the app and open it again");
      }
      if (dead) stopBoot?.();
    })();
    return () => {
      dead = true;
      stopBoot?.();
      try {
        handle.current?.map.remove();
      } catch {
        /* already gone */
      }
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => handle.current?.map.invalidateSize({ animate: false }), 60);
    return () => window.clearTimeout(t);
  }, [ready, layersOpen]);

  useEffect(() => {
    const ctx = handle.current;
    if (!ctx?.boundary) return;
    if (showShire) {
      if (!ctx.map.hasLayer(ctx.boundary)) ctx.boundary.addTo(ctx.map);
    } else if (ctx.map.hasLayer(ctx.boundary)) ctx.map.removeLayer(ctx.boundary);
  }, [showShire, ready]);

  useEffect(() => {
    saveMapDataOn(showMapData);
    saveGradingOn(showGrading);
    savePlacesOn(showPlaces);
    applyOverlays();
    handle.current?.paintLabels?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapData, showGrading, showPlaces, ready]);

  useEffect(() => {
    const ctx = handle.current;
    if (!ctx || !ready) return;
    ctx.saved.clearLayers();
    for (const p of pins) ctx.saved.addLayer(ctx.L.marker([p.lat, p.lng]));
  }, [pins, ready]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (lastQuery.current === query) return;
    if (query.trim().length < 3) {
      setHits([]);
      setSearchNote("");
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      setSearchNote("");
      void searchPlaces(query, lastGps.current)
        .then((list) => {
          setHits(list);
          setSearchNote(list.length ? "" : "No matching addresses");
        })
        .catch((err) => {
          setHits([]);
          if (err instanceof RateLimitError) {
            setSearchNote(`Search is busy. Try again in ${err.retryAfter}s.`);
          } else {
            setSearchNote("Search failed. Check the connection and try again.");
          }
        })
        .finally(() => setSearching(false));
    }, 450);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!ready) return;
    const engine = drive.current;
    engine.attach({
      map: () => handle.current?.map ?? null,
      follow: () => gpsModeRef.current === "follow",
      headingUp: () => headingModeRef.current === "heading",
      userZoom: () => userZoomRef.current,
      canRotate: () => Boolean(handle.current?.canRotate),
      setGpsLatLng: (here) => {
        headingRef.current = engine.heading;
        handle.current?.gps?.setLatLng(here);
        handle.current?.accuracy?.setLatLng(here);
      },
      paintLabels: () => handle.current?.paintLabels?.(),
      onHud: (hud) => {
        if (hud.heading != null) {
          headingRef.current = hud.heading;
          setHeading(hud.heading);
        }
        if (hud.source) setHeadingSource(hud.source);
        if (hud.compassLive != null) setCompassLive(hud.compassLive);
        if (hud.needsCalibration != null) setNeedsCalibration(hud.needsCalibration);
        if (hud.speedKmh !== undefined) setSpeedKmh(hud.speedKmh);
        if (hud.tripKm != null) setTripKm(hud.tripKm);
        if (hud.road != null) setCurrentRoad(hud.road);
        if (hud.next != null) setNextRoad(hud.next);
        if (hud.gpsLabel != null) setGpsLabel(hud.gpsLabel);
        if (hud.hasFix) setHasFix(true);
      },
    });
    if (headingModeRef.current !== "heading") applyMapBearing(0);
    const auto = loadAutoZoom();
    setAutoZoom(auto);
    engine.setAutoZoom(auto);
    return () => engine.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (headingMode !== "heading") applyMapBearing(0);
    rebuildGpsIcon();
    applyGpsCone();
  }, [headingMode, heading, ready]);

  useEffect(() => {
    if (!ready) return;
    handle.current?.paintLabels?.();
  }, [headingMode, gpsMode, ready]);

  useEffect(() => {
    if (!settingsOpen) return;
    void refreshLibrary();
  }, [settingsOpen]);

  useEffect(() => {
    const onErr = (event: PromiseRejectionEvent) => {
      const msg = String(event.reason ?? "");
      if (/Failed to fetch|Load failed|abort|QuotaExceeded/i.test(msg)) return;
      setError("Map recovered from a glitch — keep driving");
    };
    window.addEventListener("unhandledrejection", onErr);
    return () => window.removeEventListener("unhandledrejection", onErr);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!loadSensorsOnboarded()) setNeedStart(true);
    startBackgroundCache(lastGps.current);
    if (!isFramed()) {
      beginGps();
      void queryGeoPermission().then(setGeoPerm);
    }
    const stopArm = armCompassOnTap(() => {
      drive.current.compass.start();
      saveSensorsOnboarded();
      setNeedStart(false);
      setMotionPerm("granted");
    });
    return () => stopArm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!searchOpen) {
      pinToolbar();
      return;
    }
    const t = window.setTimeout(() => searchInput.current?.focus(), 40);
    const placePanel = () => {
      const panel = searchPanel.current;
      const vv = window.visualViewport;
      if (!panel || !vv) return;
      panel.style.top = `${vv.offsetTop + Math.max(72, vv.height * 0.28)}px`;
    };
    placePanel();
    window.visualViewport?.addEventListener("resize", placePanel);
    window.visualViewport?.addEventListener("scroll", placePanel);
    return () => {
      window.clearTimeout(t);
      window.visualViewport?.removeEventListener("resize", placePanel);
      window.visualViewport?.removeEventListener("scroll", placePanel);
      pinToolbar();
    };
  }, [searchOpen]);

  async function dropPlace(next: Place) {
    setPlace(next);
    setRecents(pushRecent(next, recents));
    const ctx = handle.current;
    if (ctx) {
      ctx.pin?.remove();
      ctx.pin = ctx.L.marker([next.lat, next.lng]).addTo(ctx.map);
    }
    closeSearch();
  }

  async function dropAtCenter() {
    if (!pinAim) {
      setPinAim(true);
      setGpsMode("off");
      closeSearch();
      setLayersOpen(false);
      return;
    }
    const map = handle.current?.map;
    if (!map) return;
    const c = map.getCenter();
    setPinAim(false);
    await dropPlace(await reverseGeocode(c.lat, c.lng));
  }

  async function chooseHit(hit: NominatimHit) {
    lastQuery.current = placeTitle(hit.display_name);
    setQuery(placeTitle(hit.display_name));
    const next: Place = {
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      title: placeTitle(hit.display_name),
      subtitle: placeSubtitle(hit.display_name),
      source: "search",
    };
    await dropPlace(next);
    handle.current?.map.setView([next.lat, next.lng], Math.max(handle.current.map.getZoom(), 16));
    await routeTo(next);
  }

  function toggleFollow() {
    if (gpsMode === "follow") {
      setGpsMode("off");
      gpsOnRef.current = false;
      stopGpsRef.current();
      stopGpsRef.current = () => {};
      return;
    }
    if (!navigator.geolocation) {
      setError("GPS is not available on this device");
      return;
    }
    beginGps();
  }

  async function enableHeadingUp() {
    if (headingMode === "heading" && gpsMode === "follow" && compassLive && !needStart) {
      setHeadingMode("north");
      applyMapBearing(0);
      return;
    }
    await startDriving();
  }

  async function enablePermanentSensors() {
    beginGps();
    setAlwaysGps(true);
    saveAlwaysGps(true);
    const motion = await requestMotionPermissions();
    setMotionPerm(motion === "denied" ? "denied" : motion);
    if (motion !== "denied") {
      setAlwaysMotion(true);
      saveAlwaysMotion(true);
      saveSensorsOnboarded();
      setNeedStart(false);
      drive.current.compass.start();
    }
    const geo = await queryGeoPermission();
    setGeoPerm(geo);
    if (geo === "granted" || hasFix) setError(null);
  }

  async function startDriving() {
    setPinAim(false);
    setHeadingMode("heading");
    setGpsMode("follow");
    beginGps();
    const perm = await requestMotionPermissions();
    if (perm === "denied") {
      setError("Allow Motion & Orientation for heading up");
    } else {
      saveSensorsOnboarded();
      setNeedStart(false);
      setAlwaysGps(true);
      setAlwaysMotion(true);
      saveAlwaysGps(true);
      saveAlwaysMotion(true);
      setMotionPerm(perm === "unsupported" ? "unsupported" : "granted");
      drive.current.compass.start();
    }
    void queryGeoPermission().then(setGeoPerm);
    pinToolbar();
    window.setTimeout(pinToolbar, 80);
    window.setTimeout(pinToolbar, 240);
  }

  async function routeTo(target: Place) {
    const here = lastGps.current;
    if (!here) {
      setError("Turn on GPS to get directions");
      void startDriving();
      return;
    }
    setRouting(true);
    setError(null);
    setNavActive(false);
    setNextTurn(null);
    try {
      const opts = await planRoutes(here, [target.lat, target.lng]);
      setRoutes(opts);
      setActiveRouteId(opts[0]?.id ?? null);
      if (opts[0]) pickRoute(opts, opts[0].id);
    } catch {
      setError("Could not get a route");
    } finally {
      setRouting(false);
    }
  }

  function pickRoute(opts: RouteOption[], id: string) {
    setActiveRouteId(id);
    setNavActive(true);
    drawRoutes(opts, id, "nav");
    setSearchOpen(false);
    setLayersOpen(false);
    setSettingsOpen(false);
    setPlace(null);
    const trk = handle.current?.track;
    if (trk && handle.current?.map.hasLayer(trk)) handle.current.map.removeLayer(trk);
    if (!isFramed()) {
      setGpsMode("follow");
      setHeadingMode("heading");
      beginGps();
    }
    const chosen = opts.find((o) => o.id === id) ?? opts[0];
    const here = lastGps.current;
    if (chosen && here) {
      setRemainKm(remainingKmAlong(chosen.coords, here[0], here[1]));
      setNextTurn(nextRouteTurn(chosen.steps, chosen.coords, here[0], here[1]));
    }
  }

  function drawRoutes(opts: RouteOption[], activeId: string | null, mode: "preview" | "nav" = "preview") {
    const ctx = handle.current;
    if (!ctx) return;
    ctx.routes.clearLayers();
    const chosen = opts.find((o) => o.id === activeId) ?? opts[0];
    routeCoords.current = chosen?.coords ?? null;
    const draw = mode === "nav" ? opts.filter((o) => o.id === chosen?.id) : opts;
    for (const opt of draw) {
      const selected = opt.id === (activeId ?? chosen?.id);
      ctx.L.polyline(opt.coords, {
        color: selected ? MAP_COLORS.route : MAP_COLORS.routeMuted,
        weight: selected ? 6 : 4,
        opacity: selected ? 1 : 0.4,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(ctx.routes);
    }
    if (chosen && mode === "preview") {
      setGpsMode("off");
      const b = ctx.L.latLngBounds(chosen.coords);
      if (b.isValid()) ctx.map.fitBounds(b, { padding: [80, 48], maxZoom: 16 });
    }
  }

  function clearRoute() {
    setRoutes([]);
    setActiveRouteId(null);
    setNavActive(false);
    setNextTurn(null);
    routeCoords.current = null;
    handle.current?.routes.clearLayers();
    setRemainKm(null);
    const ctx = handle.current;
    if (ctx?.track && trackPts.current.length >= 2 && !ctx.map.hasLayer(ctx.track)) ctx.track.addTo(ctx.map);
  }

  function wipeTrack() {
    trackPts.current = [];
    clearTrack();
    const ctx = handle.current;
    if (ctx?.track) {
      ctx.track.setLatLngs([]);
      if (ctx.map.hasLayer(ctx.track)) ctx.map.removeLayer(ctx.track);
    }
  }

  function savePlace() {
    if (!place) return;
    const id = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
    const list = [{ ...place, id }, ...pins.filter((p) => p.id !== id)];
    setPins(list);
    savePins(list);
  }

  function removePlace() {
    const ctx = handle.current;
    ctx?.pin?.remove();
    if (ctx) ctx.pin = undefined;
    if (place?.id) {
      const list = pins.filter((p) => p.id !== place.id);
      setPins(list);
      savePins(list);
    }
    setPlace(null);
    clearRoute();
  }

  async function openRecent(item: Place) {
    await dropPlace(item);
    handle.current?.map.setView([item.lat, item.lng], Math.max(handle.current.map.getZoom(), 16));
    await routeTo(item);
  }

  async function saveOffline() {
    setSavingOffline("0%");
    try {
      await saveMapLibrary((p) => setSavingOffline(`${Math.round((p.done / Math.max(p.total, 1)) * 100)}%`), lastGps.current);
      saveOfflineAt();
      setOfflineAt(Date.now());
      setSavingOffline(null);
      await refreshLibrary();
    } catch {
      setSavingOffline(null);
      setError("Could not finish offline save");
    }
  }

  async function refreshLibrary() {
    try {
      const next = await listMapLibrary();
      setLibrary(next.files);
      setLibraryUsedMb(next.usedMb);
      setLibraryQuotaMb(next.quotaMb);
    } catch {
      /* ignore */
    }
  }

  const sensorsReady =
    (geoPerm === "granted" || hasFix || loadGeoOk()) &&
    (motionPerm === "granted" || motionPerm === "unsupported" || loadCompassOk() || compassLive);

  const activeRoute = routes.find((r) => r.id === activeRouteId) ?? routes[0];
  const placeSaved = !!(place && pins.some((p) => nearly(p, place)));

  return (
    <MapChrome
      mapEl={mapEl}
      footerEl={footerEl}
      searchInput={searchInput}
      searchPanel={searchPanel}
      drive={drive}
      lastQuery={lastQuery}
      handle={handle}
      locating={locating}
      hasFix={hasFix}
      pinAim={pinAim}
      online={online}
      error={error}
      routes={routes}
      place={place}
      remainKm={remainKm}
      navActive={navActive}
      nextTurn={nextTurn}
      pickRoute={(id: string) => pickRoute(routes, id)}
      clearRoute={clearRoute}
      wipeTrack={wipeTrack}
      routing={routing}
      searchOpen={searchOpen}
      query={query}
      hits={hits}
      searching={searching}
      searchNote={searchNote}
      recents={recents}
      layersOpen={layersOpen}
      settingsOpen={settingsOpen}
      tripKm={tripKm}
      speedKmh={speedKmh}
      headingMode={headingMode}
      compassLive={compassLive}
      heading={heading}
      gpsLabel={gpsLabel}
      currentRoad={currentRoad}
      nextRoad={nextRoad}
      zoomPct={zoomPct}
      showMapData={showMapData}
      showPlaces={showPlaces}
      showShire={showShire}
      showGrading={showGrading}
      gradingCount={gradingCount}
      gradingKm={gradingKm}
      gradingNote={gradingNote}
      savingOffline={savingOffline}
      offlineAt={offlineAt}
      autoZoom={autoZoom}
      geoPerm={geoPerm}
      alwaysGps={alwaysGps}
      motionPerm={motionPerm}
      alwaysMotion={alwaysMotion}
      sensorsReady={sensorsReady}
      library={library}
      libraryBusy={libraryBusy}
      libraryUsedMb={libraryUsedMb}
      libraryQuotaMb={libraryQuotaMb}
      gpsMode={gpsMode}
      placeSaved={placeSaved}
      activeRoute={activeRoute}
      closeSearch={closeSearch}
      chooseHit={chooseHit}
      setQuery={setQuery}
      openRecent={openRecent}
      setTripKm={setTripKm}
      setActiveRouteId={setActiveRouteId}
      drawRoutes={drawRoutes}
      nudgeZoom={nudgeZoom}
      setShowMapData={setShowMapData}
      setShowPlaces={setShowPlaces}
      setShowShire={setShowShire}
      setShowGrading={setShowGrading}
      setZoomMode={setZoomMode}
      saveOffline={saveOffline}
      setAlwaysGps={setAlwaysGps}
      beginGps={beginGps}
      setAlwaysMotion={setAlwaysMotion}
      enablePermanentSensors={enablePermanentSensors}
      dropAtCenter={dropAtCenter}
      toggleFollow={toggleFollow}
      applyMapBearing={applyMapBearing}
      enableHeadingUp={enableHeadingUp}
      setLayersOpen={setLayersOpen}
      setSettingsOpen={setSettingsOpen}
      setSearchOpen={setSearchOpen}
      routeTo={routeTo}
      savePlace={savePlace}
      removePlace={removePlace}
      setError={setError}
      setLibraryBusy={setLibraryBusy}
      refreshLibrary={refreshLibrary}
      setHits={setHits}
      setSearchNote={setSearchNote}
      setSearching={setSearching}
      setZoomPct={setZoomPct}
      setHeadingMode={setHeadingMode}
    />
  );
}
