import type { Circle, GeoJSON, LayerGroup, Map as LeafletMap, Marker, TileLayer } from "leaflet";
import type { MutableRefObject } from "react";
import { lineLengthKm, lineMostlyInRing } from "@/lib/maps/geo";
import { loadLeaflet, mapCanRotate } from "@/lib/maps/leaflet";
import { DriveEngine } from "@/lib/maps/drive-engine";
import {
  gradeStyle,
  hybridGrade,
  roadKey,
  roadLineStyle,
  sameRoadName,
  ZOOM_MAX,
  updateShireFitZoom,
  zoomPercent,
} from "@/lib/maps/style";
import { prefetchAround, TILE_LAYER_OPTS } from "@/lib/maps/tile-cache";
import { reverseGeocode } from "@/lib/maps/places";
import { loadArterials } from "@/lib/maps/routing";
import { allMapData, loadGradingJson, loadJunctionsJson, loadLabelsJson, loadPlacesJson, mapAssets } from "@/lib/maps/preload";
import { loadLastView, saveLastView } from "@/lib/maps/storage";
import { snapCurrentRoad } from "@/lib/maps/snap";
import { appendRoadSnaps, headingPadKeys, loadRoadChunk, ROAD_CHUNK_ZOOM, roadChunkIndex, visibleChunkKeys } from "@/lib/maps/road-tiles";
import {
  HORSHAM_CENTER,
  MAP_COLORS,
  type GpsMode,
  type HeadingMode,
  type Place,
} from "@/lib/maps/types";
import type { GpsFix } from "@/lib/maps/gps";

type LeafletNS = typeof import("leaflet");
export type RotatableMap = LeafletMap & {
  setBearing?: (bearing: number, preserveCenter?: boolean) => LeafletMap;
  getBearing?: () => number;
};

export type MapHandle = {
  L: LeafletNS;
  map: RotatableMap;
  satellite: TileLayer;
  names: LayerGroup;
  saved: LayerGroup;
  routes: LayerGroup;
  places?: LayerGroup;
  boundary?: GeoJSON;
  grading?: GeoJSON;
  roadLines?: GeoJSON;
  roadChunks?: LayerGroup;
  ring: number[][] | null;
  pin?: Marker;
  gps?: Marker;
  accuracy?: Circle;
  canRotate: boolean;
  paintLabels?: () => void;
};

export type BootArgs = {
  mapEl: HTMLDivElement;
  handle: MutableRefObject<MapHandle | null>;
  drive: DriveEngine;
  lastGps: MutableRefObject<[number, number] | null>;
  speedRef: MutableRefObject<number>;
  headingRef: MutableRefObject<number>;
  gpsModeRef: MutableRefObject<GpsMode>;
  headingModeRef: MutableRefObject<HeadingMode>;
  showPlacesRef: MutableRefObject<boolean>;
  needStartRef: MutableRefObject<boolean>;
  userZoomRef: MutableRefObject<boolean>;
  pinAimRef: MutableRefObject<boolean>;
  setReady: (v: boolean) => void;
  setZoomPct: (n: number) => void;
  setError: (v: string | null) => void;
  setGpsMode: (v: GpsMode) => void;
  setPlace: (p: Place) => void;
  setGradingCount: (n: number) => void;
  setGradingKm: (n: number) => void;
  setGradingNote: (s: string) => void;
  paintFix: (fix: GpsFix) => void;
  dropPlace: (next: Place) => Promise<void>;
  styleRoadLayers: () => void;
  onManualZoom?: () => void;
  isDead?: () => boolean;
};

export async function bootMap(args: BootArgs): Promise<() => void> {
  const {
    mapEl,
    handle,
    drive,
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
    setZoomPct,
    setError,
    setGpsMode,
    setPlace,
    setGradingCount,
    setGradingKm,
    setGradingNote,
    paintFix,
    dropPlace,
    styleRoadLayers,
    onManualZoom,
    isDead,
  } = args;
  let cancelled = false;
  const dead = () => cancelled || Boolean(isDead?.());
  try {
    const L = await (mapAssets?.leaflet ?? loadLeaflet());
    if (dead() || !mapEl) return () => {};
    if (handle.current?.map) {
      const live = handle.current.map.getContainer?.();
      if (live === mapEl) return () => { cancelled = true; };
      try {
        handle.current.map.remove();
      } catch {
        /* leftover */
      }
      handle.current = null;
    }
    try {
      const leaked = mapEl as HTMLDivElement & { _leaflet_id?: number };
      if (leaked._leaflet_id) {
        leaked._leaflet_id = undefined;
        mapEl.innerHTML = "";
      }
    } catch {
      /* ok */
    }

    const lastView = loadLastView();
    const startLatLng: [number, number] = lastView ? [lastView.lat, lastView.lng] : HORSHAM_CENTER;
    const startZoom = lastView && lastView.zoom >= 6 && lastView.zoom <= ZOOM_MAX ? lastView.zoom : 16;

    const map = L.map(mapEl, {
      center: startLatLng,
      zoom: startZoom,
      zoomControl: false,
      attributionControl: true,
      tap: false,
      bounceAtZoomLimits: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      preferCanvas: true,
      maxZoom: ZOOM_MAX,
      minZoom: 6,
      zoomSnap: 0.5,
      zoomDelta: 1,
      rotate: true,
      bearing: 0,
      rotateControl: false,
      compassBearing: false,
      touchZoom: true,
      touchRotate: false,
      shiftKeyRotate: false,
    } as import("leaflet").MapOptions);
    map.createPane("gpsPane");
    const gpsPane = map.getPane("gpsPane");
    if (gpsPane) gpsPane.style.zIndex = "650";

    if (dead()) {
      try {
        map.remove();
      } catch {
        /* torn down */
      }
      return () => {};
    }

    const satellite = L.tileLayer("/api/tiles/best/{z}/{x}/{y}", {
      ...TILE_LAYER_OPTS,
      maxNativeZoom: 19,
      maxZoom: ZOOM_MAX,
      attribution: "Esri Maxar / Vicmap aerial",
    });
    satellite.on("tileerror", (ev: { tile?: HTMLImageElement; coords?: { z: number; x: number; y: number } }) => {
      const img = ev.tile;
      const src = img?.getAttribute("src") || "";
      if (!img) return;
      const step = img.dataset.fallback || "";
      if (!step && src.includes("/tiles/best/")) {
        img.dataset.fallback = "vic";
        img.src = src.replace("/tiles/best/", "/tiles/vic/");
        return;
      }
      if (step === "vic" && src.includes("/tiles/vic/")) {
        img.dataset.fallback = "sat";
        img.src = src.replace("/tiles/vic/", "/tiles/sat/");
      }
    });
    satellite.addTo(map);
    window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      updateShireFitZoom(map);
      setZoomPct(zoomPercent(map.getZoom()));
    });
    let prefetchTimer = 0;
    const kickPrefetch = () => {
      if (gpsModeRef.current === "follow") return;
      window.clearTimeout(prefetchTimer);
      prefetchTimer = window.setTimeout(() => prefetchAround(map, "best"), 800);
    };
    map.on("moveend", kickPrefetch);
    map.on("zoomend", kickPrefetch);
    window.setTimeout(kickPrefetch, 2500);
    let viewTimer = 0;
    map.on("moveend zoomend", () => {
      window.clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        const c = map.getCenter();
        saveLastView(c.lat, c.lng, map.getZoom());
      }, 1200);
    });

    const ctx: MapHandle = {
      L,
      map,
      satellite,
      names: L.layerGroup().addTo(map),
      saved: L.layerGroup().addTo(map),
      routes: L.layerGroup().addTo(map),
      places: L.layerGroup().addTo(map),
      ring: null,
      canRotate: mapCanRotate(map),
    };
    handle.current = ctx;
    setReady(true);
    void loadArterials();
    const pendingFix = lastGps.current;
    if (pendingFix) paintFix({ lat: pendingFix[0], lng: pendingFix[1], accuracy: 20, heading: null, speed: speedRef.current, sats: null });

    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    if (dead()) return () => {};

    const packed = await allMapData();
    if (dead()) return () => {};

    try {
      const data = packed.boundary as { features?: { geometry?: { coordinates?: number[][][] } }[] } | null;
      const ring = data?.features?.[0]?.geometry?.coordinates?.[0];
      if (ring) ctx.ring = ring;
      ctx.boundary = L.geoJSON(data as import("geojson").GeoJsonObject, {
        style: { color: MAP_COLORS.shire, weight: 2, opacity: 0.9, fillColor: MAP_COLORS.primary, fillOpacity: 0.05 },
      }).addTo(map);
    } catch {
      /* optional */
    }

    type RoadLabel = { name: string; cls: number; lat: number; lng: number };
    type Junction = { lat: number; lng: number; roads: { name: string; cls: number; brg: number }[] };
    type PlaceLabel = { name: string; cat: string; rank: number; lat: number; lng: number };
    const labels: RoadLabel[] = [];
    const junctions: Junction[] = [];
    const pois: PlaceLabel[] = [];

    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    const destBrg = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const dLng = ((bLng - aLng) * Math.PI) / 180;
      const lat1 = (aLat * Math.PI) / 180;
      const lat2 = (bLat * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    };
    const offsetPt = (lat: number, lng: number, brg: number, metres: number): [number, number] => {
      const rad = (brg * Math.PI) / 180;
      return [lat + (metres * Math.cos(rad)) / 111_320, lng + (metres * Math.sin(rad)) / 89_200];
    };

    const labelAngle = (roadBrg: number) => {
      const mapBrg = (map as RotatableMap).getBearing?.() ?? 0;
      let css = roadBrg - 90 - mapBrg;
      css = ((css + 540) % 360) - 180;
      if (css > 90) css -= 180;
      if (css <= -90) css += 180;
      return css;
    };

    const addAlongLabel = (lat: number, lng: number, name: string, roadBrg: number, extra: string, zOff: number) => {
      const [sideLat, sideLng] = offsetPt(lat, lng, roadBrg + 90, 18);
      const css = labelAngle(roadBrg);
      const cls = ["road-lab", "road-lab-along", extra, "road-lab-photo"].filter(Boolean).join(" ");
      ctx.names.addLayer(
        L.marker([sideLat, sideLng], {
          interactive: false,
          keyboard: false,
          zIndexOffset: zOff,
          icon: L.divIcon({
            className: cls,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
            html: `<span><b style="display:inline-block;transform:rotate(${css.toFixed(1)}deg)">${escape(name)}</b></span>`,
          }),
        }),
      );
    };

    const paintMidpointLabels = (maxN: number) => {
      const z = map.getZoom();
      const maxCls = z < 11 ? 2 : z < 12 ? 3 : z < 13 ? 4 : z < 15 ? 5 : 6;
      const bounds = map.getBounds().pad(0.08);
      let n = 0;
      const seen = new Set<string>();
      for (const lab of labels) {
        if (lab.cls > maxCls || seen.has(lab.name) || !bounds.contains([lab.lat, lab.lng])) continue;
        seen.add(lab.name);
        addAlongLabel(lab.lat, lab.lng, lab.name, 90, lab.cls <= 2 ? "road-lab-lg" : "", 400 - lab.cls);
        n += 1;
        if (n >= maxN) break;
      }
    };

    const paintDriveLabels = (here: [number, number], hd: number) => {
      const onRoad = snapCurrentRoad(drive.snaps, here, hd, drive.roads);
      if (onRoad) {
        const aheadM = Math.min(260, Math.max(80, speedRef.current * 3.6 * 2.4));
        const [alat, alng] = offsetPt(here[0], here[1], hd, aheadM);
        addAlongLabel(alat, alng, onRoad, hd, "road-lab-now", 700);
      }

      const lookKm = Math.min(2.2, Math.max(0.4, 0.4 + speedRef.current * 0.035));
      const seen = new Set<string>();
      if (onRoad) seen.add(roadKey(onRoad));
      const hits: { name: string; brg: number; lat: number; lng: number; km: number }[] = [];

      for (const j of junctions) {
        const km = Math.hypot((j.lat - here[0]) * 111.32, (j.lng - here[1]) * 89.2);
        if (km < 0.05 || km > lookKm) continue;
        if (angDiff(destBrg(here[0], here[1], j.lat, j.lng), hd) > 68) continue;
        for (const arm of j.roads) {
          if (!arm.name) continue;
          if (onRoad && sameRoadName(arm.name, onRoad)) continue;
          if (angDiff(arm.brg, hd) < 30 || angDiff(arm.brg, hd + 180) < 30) continue;
          const key = roadKey(arm.name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const [lat, lng] = offsetPt(j.lat, j.lng, arm.brg, 62);
          hits.push({ name: arm.name, brg: arm.brg, lat, lng, km });
        }
      }
      hits.sort((a, b) => a.km - b.km);
      for (const lab of hits.slice(0, 8)) {
        addAlongLabel(lab.lat, lab.lng, lab.name, lab.brg, "road-lab-turn", 560);
      }
    };

    const poiSubtitle = (cat: string) =>
      (
        {
          water: "Water",
          park: "Park",
          sport: "Sport & leisure",
          health: "Health",
          edu: "School",
          civic: "Civic",
          fuel: "Fuel",
          shop: "Shop",
          stay: "Stay",
          place: "Horsham",
        } as Record<string, string>
      )[cat] ?? "Horsham";

    const paintPlaces = () => {
      const layer = ctx.places;
      if (!layer) return;
      layer.clearLayers();
      if (!showPlacesRef.current) return;
      const z = map.getZoom();
      const driving = headingModeRef.current === "heading" && gpsModeRef.current === "follow";
      const maxRank = driving ? (z >= 16 ? 3 : 2) : z < 13 ? 0 : z < 14 ? 1 : z < 15 ? 2 : z < 16 ? 3 : z < 17 ? 4 : 5;
      const maxN = driving ? 18 : z < 14 ? 12 : z < 15 ? 22 : z < 16 ? 40 : z < 17 ? 64 : 90;
      const minPx = driving ? 64 : z < 15 ? 70 : z < 17 ? 54 : 42;
      const bounds = map.getBounds().pad(0.12);
      const placed: { x: number; y: number }[] = [];
      let n = 0;
      for (const p of pois) {
        if (p.rank > maxRank || !bounds.contains([p.lat, p.lng])) continue;
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        if (placed.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < minPx)) continue;
        placed.push({ x: pt.x, y: pt.y });
        const cls = ["poi-lab", `poi-lab-${p.cat}`, p.rank <= 2 ? "poi-lab-lg" : ""].filter(Boolean).join(" ");
        const marker = L.marker([p.lat, p.lng], {
          keyboard: false,
          zIndexOffset: 280 - p.rank,
          icon: L.divIcon({ className: cls, iconSize: [0, 0], html: `<span>${escape(p.name)}</span>` }),
        });
        marker.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          void dropPlace({
            lat: p.lat,
            lng: p.lng,
            title: p.name,
            subtitle: `${poiSubtitle(p.cat)} · Horsham`,
            source: "search",
          });
        });
        layer.addLayer(marker);
        n += 1;
        if (n >= maxN) break;
      }
    };

    const paintLabels = () => {
      ctx.names.clearLayers();
      const here = lastGps.current;
      const driving = headingModeRef.current === "heading" && gpsModeRef.current === "follow";
      if (driving && here) {
        paintDriveLabels(here, headingRef.current);
        paintPlaces();
        return;
      }
      paintMidpointLabels(140);
      paintPlaces();
    };
    ctx.paintLabels = paintLabels;
    let labelTimer = 0;
    map.on("moveend zoomend", () => {
      window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => ctx.paintLabels?.(), 120);
    });
    paintLabels();

    try {
      const roads = packed.roads as { features?: { properties?: { name?: string; highway?: string }; geometry?: { coordinates?: [number, number][] } }[] } | null;
      if (dead()) return () => {};
      if (roads) {
        if (!map.getPane("roadsPane")) {
          const parent = map.getPane("overlayPane") ?? map.getPane("rotatePane") ?? map.getContainer();
          map.createPane("roadsPane", parent);
          const pane = map.getPane("roadsPane");
          if (pane) pane.style.zIndex = "420";
        }
        const roadRenderer = L.canvas({ padding: 0.35, tolerance: 2 });
        ctx.roadLines = L.geoJSON(roads as import("geojson").GeoJsonObject, {
          pane: "roadsPane",
          renderer: roadRenderer,
          smoothFactor: 1.2,
          style: roadLineStyle("hybrid"),
          interactive: false,
        } as import("leaflet").GeoJSONOptions).addTo(map);
        ctx.roadChunks = L.layerGroup().addTo(map);
        const snaps: { name: string; lat: number; lng: number; brg: number }[] = [];
        appendRoadSnaps(roads.features ?? [], snaps, drive.roads);
        drive.snaps = snaps;
        const drawnNames = new Set(
          (roads.features ?? []).map((f) => roadKey(String(f.properties?.name ?? ""))).filter(Boolean),
        );
        const loaded = new Set<string>();
        const syncChunks = async () => {
          if (dead() || map.getZoom() < ROAD_CHUNK_ZOOM) return;
          const b = map.getBounds();
          const index = await roadChunkIndex();
          let keys = visibleChunkKeys(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
          const here = lastGps.current;
          if (here) keys.push(...headingPadKeys(here[0], here[1], headingRef.current));
          keys = keys.filter((k) => index.has(k) && !loaded.has(k)).slice(0, 3);
          for (const key of keys) {
            loaded.add(key);
            const extra = await loadRoadChunk(key);
            if (dead() || !extra?.features?.length) continue;
            const fresh = extra.features.filter((f) => {
              const nm = roadKey(String(f.properties?.name ?? ""));
              if (!nm) return true;
              if (drawnNames.has(nm)) return false;
              drawnNames.add(nm);
              return true;
            });
            if (!fresh.length) continue;
            L.geoJSON({ type: "FeatureCollection", features: fresh } as import("geojson").FeatureCollection, {
              pane: "roadsPane",
              renderer: roadRenderer,
              smoothFactor: 1.2,
              style: roadLineStyle("hybrid"),
              interactive: false,
            } as import("leaflet").GeoJSONOptions).addTo(ctx.roadChunks!);
            appendRoadSnaps(fresh, drive.snaps, drive.roads);
            if (drive.snaps.length > 12_000) drive.snaps = drive.snaps.slice(-8_000);
          }
        };
        map.on("moveend zoomend", () => {
          void syncChunks();
        });
        void syncChunks();
      }
    } catch {
      /* optional */
    }

    const attachGrading = (data: { features?: unknown[]; source?: string } | null) => {
      if (dead() || !data) return;
      const ring = ctx.ring;
      const raw = (
        (data.features ?? []) as { geometry: { type?: string; coordinates?: unknown }; properties?: Record<string, string | number> }[]
      ).filter((f) => !ring || lineMostlyInRing(f.geometry, ring));

      const lineCoords = (geom: { type?: string; coordinates?: unknown } | undefined): [number, number][][] => {
        if (!geom?.coordinates) return [];
        if (geom.type === "LineString") return [geom.coordinates as [number, number][]];
        if (geom.type === "MultiLineString") return geom.coordinates as [number, number][][];
        return [];
      };
      const grouped = new Map<string, { props: Record<string, string | number>; lines: [number, number][][] }>();
      const unnamed: typeof raw = [];
      for (const f of raw) {
        const nm = roadKey(String(f.properties?.Road_name ?? f.properties?.name ?? ""));
        const lines = lineCoords(f.geometry);
        if (!nm) {
          unnamed.push(f);
          continue;
        }
        const prev = grouped.get(nm);
        if (prev) prev.lines.push(...lines);
        else grouped.set(nm, { props: { ...(f.properties ?? {}) }, lines: [...lines] });
      }
      const features = [
        ...[...grouped.entries()].map(([nm, row]) => ({
          type: "Feature" as const,
          properties: { ...row.props, name: row.props.Road_name || row.props.name || nm },
          geometry: row.lines.length > 1 ? { type: "MultiLineString", coordinates: row.lines } : { type: "LineString", coordinates: row.lines[0] ?? [] },
        })),
        ...unnamed,
      ];
      if (!map.getPane("roadsPane")) {
        const parent = map.getPane("overlayPane") ?? map.getPane("rotatePane") ?? map.getContainer();
        map.createPane("roadsPane", parent);
        const pane = map.getPane("roadsPane");
        if (pane) pane.style.zIndex = "420";
      }
      ctx.grading = L.geoJSON({ type: "FeatureCollection", features } as import("geojson").FeatureCollection, {
        pane: "roadsPane",
        renderer: L.canvas({ padding: 0.35, tolerance: 2 }),
        style: gradeStyle("hybrid"),
        onEachFeature: (feat, layer) => {
          const props = (feat.properties ?? {}) as Record<string, string | number>;
          layer.on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            const ll = "latlng" in ev ? (ev as { latlng: { lat: number; lng: number } }).latlng : map.getCenter();
            const title = String(props.Road_name || props.name || "").trim();
            const from = String(props.From || "").trim();
            const to = String(props.To || "").trim();
            const zone = String(props.Grading_re || "").trim();
            const metres = Number(props.Length_m || 0);
            void dropPlace({
              lat: ll.lat,
              lng: ll.lng,
              title: title || "Unnamed road",
              subtitle: [
                String(props.program || ""),
                from && to ? `${from} → ${to}` : from || to,
                zone,
                metres > 0 ? `${metres.toLocaleString("en-AU")} m` : "",
                "HRCC public Pozi",
              ]
                .filter(Boolean)
                .join(" · "),
              source: "search",
            });
          });
        },
      } as import("leaflet").GeoJSONOptions).addTo(map);
      const names = new Map<string, string>();
      for (const f of features) {
        const props = (f.properties ?? {}) as Record<string, string | number>;
        const nm = roadKey(String(props.Road_name ?? props.name ?? ""));
        const prog = String(props.program ?? "");
        if (nm && prog) names.set(nm, prog);
      }
      hybridGrade.names = names;
      styleRoadLayers();
      setGradingCount(features.length);
      setGradingKm(features.reduce((sum, f) => sum + lineLengthKm(f.geometry), 0));
      const programs = [...new Set(features.map((f) => String((f.properties as { program?: string } | undefined)?.program ?? "")).filter(Boolean))];
      setGradingNote(
        [
          data.source === "pozi" ? "Live from Pozi" : "Saved Pozi extract",
          "26–27 and 27–28 · pink",
          programs.join(" · "),
        ].filter(Boolean).join(" · "),
      );
    };

    void loadGradingJson()
      .then((data) => attachGrading(data as { features?: unknown[]; source?: string }))
      .catch(() => {
        setGradingCount(0);
        setGradingKm(0);
      });

    void loadLabelsJson()
      .then((data) => {
        if (dead()) return () => {};
        const feats = (data as { features?: { properties?: { name?: string; cls?: number }; geometry?: { coordinates?: [number, number] } }[] }).features ?? [];
        for (const f of feats) {
          const name = f.properties?.name;
          const n = f.geometry?.coordinates;
          if (!name || !n) continue;
          labels.push({ name, cls: Number(f.properties?.cls ?? 6), lat: n[1], lng: n[0] });
        }
        labels.sort((a, b) => a.cls - b.cls || a.name.localeCompare(b.name));
        ctx.paintLabels?.();
      })
      .catch(() => {});

    void loadPlacesJson()
      .then((data) => {
        if (dead()) return () => {};
        const feats =
          (
            data as {
              features?: {
                properties?: { name?: string; cat?: string; rank?: number };
                geometry?: { coordinates?: [number, number] };
              }[];
            }
          ).features ?? [];
        for (const f of feats) {
          const name = f.properties?.name;
          const n = f.geometry?.coordinates;
          if (!name || !n) continue;
          pois.push({
            name,
            cat: String(f.properties?.cat ?? "place"),
            rank: Number(f.properties?.rank ?? 5),
            lat: n[1],
            lng: n[0],
          });
        }
        pois.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
        ctx.paintLabels?.();
      })
      .catch(() => {});

    void loadJunctionsJson()
      .then((data) => {
        if (dead()) return () => {};
        const feats = (data as { features?: { properties?: { roads?: Junction["roads"] }; geometry?: { coordinates?: [number, number] } }[] }).features ?? [];
        for (const f of feats) {
          const n = f.geometry?.coordinates;
          const roads = f.properties?.roads;
          if (!n || !roads?.length) continue;
          junctions.push({ lng: n[0], lat: n[1], roads });
        }
        drive.junctions = junctions;
      })
      .catch(() => {});

    map.on("click", (e) => {
      if (needStartRef.current || pinAimRef.current) return;
      void dropPlace({ lat: e.latlng.lat, lng: e.latlng.lng, title: "Dropped pin", subtitle: "", source: "pin" }).then(() =>
        reverseGeocode(e.latlng.lat, e.latlng.lng).then((p) => setPlace(p)),
      );
    });

    let dragFrom: { lat: number; lng: number } | null = null;
    map.on("dragstart", () => {
      if (drive.panning) return;
      const c = map.getCenter();
      dragFrom = { lat: c.lat, lng: c.lng };
    });
    map.on("dragend", () => {
      if (drive.panning || !dragFrom) {
        dragFrom = null;
        return;
      }
      const c = map.getCenter();
      if (map.distance(dragFrom, c) > 45 && gpsModeRef.current === "follow") setGpsMode("off");
      dragFrom = null;
    });
    const root = map.getContainer();
    const pinchStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      drive.beginGesture();
      userZoomRef.current = true;
      onManualZoom?.();
    };
    const pinchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) return;
      drive.endGesture();
      window.setTimeout(() => {
        userZoomRef.current = false;
      }, 350);
    };
    root.addEventListener("touchstart", pinchStart, { passive: true });
    root.addEventListener("touchend", pinchEnd, { passive: true });
    root.addEventListener("touchcancel", pinchEnd, { passive: true });
    const pushZoomPct = () => setZoomPct(zoomPercent(map.getZoom()));
    map.on("zoom", pushZoomPct);
    map.on("zoomend", pushZoomPct);
    pushZoomPct();
    let roadBand = 2;
    map.on("zoomend", () => {
      hybridGrade.zoom = map.getZoom();
      const band = hybridGrade.zoom < 11 ? 0 : hybridGrade.zoom < 13 ? 1 : 2;
      if (band !== roadBand) {
        roadBand = band;
        styleRoadLayers();
      }
      window.setTimeout(() => {
        userZoomRef.current = false;
      }, 500);
    });
    } catch {
      if (!dead()) setError("Map failed to start — close the app and open it again");
    }

  return () => {
    cancelled = true;
  };
}
