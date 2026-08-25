import type { Circle, GeoJSON, LayerGroup, Map as LeafletMap, Marker, TileLayer } from "leaflet";
import type { MutableRefObject } from "react";
import { bboxOverlaps, geomBBox, geomHitsHeadingCorridor, lineLengthKm, lineMostlyInRing } from "@/lib/maps/geo";
import { loadLeaflet, mapCanRotate } from "@/lib/maps/leaflet";
import { DriveEngine } from "@/lib/maps/drive-engine";
import {
  gradeStyle,
  hybridGrade,
  roadKey,
  roadLineStyle,
  ZOOM_MAX,
  updateShireFitZoom,
  zoomFromPercent,
  zoomPercent,
} from "@/lib/maps/style";
import { prefetchAround, TILE_LAYER_OPTS } from "@/lib/maps/tile-cache";
import { reverseGeocode } from "@/lib/maps/places";
import { loadArterials } from "@/lib/maps/routing";
import { allMapData, loadGradingJson, loadJunctionsJson, loadLabelsJson, loadPlacesJson, mapAssets } from "@/lib/maps/preload";
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
  driveMode?: boolean;
  syncVisibleRoads?: () => void;
  setDriveMode?: (on: boolean) => void;
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
  } = args;
  let cancelled = false;
  try {
    const L = await (mapAssets?.leaflet ?? loadLeaflet());
    if (cancelled || !mapEl || handle.current) return () => {};

    try {
      delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
    } catch {
      /* default marker icons optional */
    }

    const map = L.map(mapEl, {
      center: HORSHAM_CENTER,
      zoom: zoomFromPercent(80),
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

    const satellite = L.tileLayer("/api/tiles/best/{z}/{x}/{y}", {
      ...TILE_LAYER_OPTS,
      pane: "tilePane",
      maxNativeZoom: 20,
      maxZoom: ZOOM_MAX,
      attribution: "Esri Maxar / Vicmap aerial",
    });
    satellite.addTo(map);
    let prefetchTimer = 0;
    const kickPrefetch = () => {
      window.clearTimeout(prefetchTimer);
      prefetchTimer = window.setTimeout(() => prefetchAround(map, "best"), 350);
    };
    map.on("moveend", kickPrefetch);
    map.on("zoomend", kickPrefetch);
    kickPrefetch();
    window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      updateShireFitZoom(map);
      drive.lockView();
      map.setZoom(zoomFromPercent(80), { animate: false });
      setZoomPct(80);
      drive.unlockView();
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
    if (pendingFix) paintFix({ lat: pendingFix[0], lng: pendingFix[1], accuracy: 20, heading: null, speed: speedRef.current });

    const packed = await allMapData();
    if (cancelled) return () => {};

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

    const paintMidpointLabels = (maxN: number) => {
      const z = map.getZoom();
      const maxCls = z < 11 ? 2 : z < 12 ? 3 : z < 13 ? 4 : z < 15 ? 5 : 6;
      const bounds = map.getBounds().pad(0.08);
      const photo = true;
      let n = 0;
      const seen = new Set<string>();
      for (const lab of labels) {
        if (lab.cls > maxCls || seen.has(lab.name) || !bounds.contains([lab.lat, lab.lng])) continue;
        seen.add(lab.name);
        const cls = ["road-lab", lab.cls <= 2 ? "road-lab-lg" : "", photo ? "road-lab-photo" : ""].filter(Boolean).join(" ");
        ctx.names.addLayer(
          L.marker([lab.lat, lab.lng], {
            interactive: false,
            keyboard: false,
            zIndexOffset: 400 - lab.cls,
            icon: L.divIcon({ className: cls, iconSize: [0, 0], html: `<span>${escape(lab.name)}</span>` }),
          }),
        );
        n += 1;
        if (n >= maxN) break;
      }
    };

    const paintJunctionLabels = (here: [number, number], hd: number) => {
      const photo = true;
      const lookKm = Math.min(1.15, Math.max(0.22, 0.22 + speedRef.current * 0.03));
      let onRoad = "";
      let bestOn = 1e9;
      for (const j of junctions) {
        const km = Math.hypot((j.lat - here[0]) * 111.32, (j.lng - here[1]) * 89.2);
        if (km > 0.14) continue;
        for (const arm of j.roads) {
          const score = km * 10 + angDiff(arm.brg, hd) / 80;
          if (score < bestOn) {
            bestOn = score;
            onRoad = arm.name;
          }
        }
      }
      const hitsLocal: { name: string; cls: number; lat: number; lng: number; km: number }[] = [];
      const seen = new Set<string>();
      for (const j of junctions) {
        const km = Math.hypot((j.lat - here[0]) * 111.32, (j.lng - here[1]) * 89.2);
        if (km < 0.03 || km > lookKm) continue;
        if (angDiff(destBrg(here[0], here[1], j.lat, j.lng), hd) > 72) continue;
        const sides = j.roads.filter((r) => r.name !== onRoad);
        const arm = (sides.length ? sides : j.roads).sort((a, b) => a.cls - b.cls)[0];
        if (!arm || seen.has(arm.name) || arm.name === onRoad) continue;
        seen.add(arm.name);
        const [lat, lng] = offsetPt(j.lat, j.lng, arm.brg, 26);
        hitsLocal.push({ name: arm.name, cls: arm.cls, lat, lng, km });
      }
      hitsLocal.sort((a, b) => a.km - b.km);
      for (const lab of hitsLocal.slice(0, 7)) {
        const cls = ["road-lab", "road-lab-turn", lab.cls <= 2 ? "road-lab-lg" : "", photo ? "road-lab-photo" : ""].filter(Boolean).join(" ");
        ctx.names.addLayer(
          L.marker([lab.lat, lab.lng], {
            interactive: false,
            keyboard: false,
            zIndexOffset: 500 - lab.cls,
            icon: L.divIcon({ className: cls, iconSize: [0, 0], html: `<span>${escape(lab.name)}</span>` }),
          }),
        );
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
      if (ctx.driveMode) {
        if (here && junctions.length) paintJunctionLabels(here, headingRef.current);
        return;
      }
      if (headingModeRef.current === "heading" && here && junctions.length) {
        let nearby = 0;
        for (const j of junctions) {
          if (Math.hypot((j.lat - here[0]) * 111.32, (j.lng - here[1]) * 89.2) < 0.45) nearby += 1;
          if (nearby >= 12) break;
        }
        if (nearby < 12) {
          paintJunctionLabels(here, headingRef.current);
          paintPlaces();
          return;
        }
      }
      paintMidpointLabels(140);
      paintPlaces();
    };
    ctx.paintLabels = paintLabels;
    let labelTimer = 0;
    map.on("moveend zoomend", () => {
      window.clearTimeout(labelTimer);
      if (gpsModeRef.current === "follow" && headingModeRef.current === "heading") {
        labelTimer = window.setTimeout(() => (ctx.driveMode ? paintLabels() : paintPlaces()), 140);
        return;
      }
      labelTimer = window.setTimeout(() => ctx.paintLabels?.(), 140);
    });
    paintLabels();

    try {
      const roads = packed.roads as { features?: { properties?: { name?: string; highway?: string }; geometry?: { coordinates?: [number, number][] } }[] } | null;
      if (cancelled) return () => {};
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
        const loaded = new Set<string>();
        const syncChunks = async () => {
          if (cancelled || ctx.driveMode || map.getZoom() < ROAD_CHUNK_ZOOM) return;
          const b = map.getBounds();
          const index = await roadChunkIndex();
          let keys = visibleChunkKeys(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
          const here = lastGps.current;
          if (here) keys.push(...headingPadKeys(here[0], here[1], headingRef.current));
          keys = keys.filter((k) => index.has(k) && !loaded.has(k)).slice(0, 3);
          for (const key of keys) {
            loaded.add(key);
            const extra = await loadRoadChunk(key);
            if (cancelled || !extra?.features?.length) continue;
            L.geoJSON(extra as import("geojson").GeoJsonObject, {
              pane: "roadsPane",
              renderer: roadRenderer,
              smoothFactor: 1.2,
              style: roadLineStyle("hybrid"),
              interactive: false,
            } as import("leaflet").GeoJSONOptions).addTo(ctx.roadChunks!);
            appendRoadSnaps(extra.features, drive.snaps, drive.roads);
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
      if (cancelled || !data) return;
      const ring = ctx.ring;
      const features = (
        (data.features ?? []) as { geometry: { type?: string; coordinates?: unknown }; properties?: Record<string, string> }[]
      ).filter((f) => !ring || lineMostlyInRing(f.geometry, ring));
      type GradeFeat = {
        feature: { type: "Feature"; geometry: { type?: string; coordinates?: unknown }; properties?: Record<string, string> };
        bbox: [number, number, number, number] | null;
      };
      const indexed: GradeFeat[] = features.map((f) => ({
        feature: { type: "Feature", geometry: f.geometry, properties: f.properties },
        bbox: geomBBox(f.geometry),
      }));
      const overlayParent = map.getPane("overlayPane") ?? map.getPane("rotatePane") ?? map.getContainer();
      if (!map.getPane("roadsPane")) {
        map.createPane("roadsPane", overlayParent);
        const pane = map.getPane("roadsPane");
        if (pane) pane.style.zIndex = "420";
      }
      if (!map.getPane("gradingPane")) {
        map.createPane("gradingPane", overlayParent);
        const pane = map.getPane("gradingPane");
        if (pane) {
          pane.style.zIndex = "450";
          pane.style.pointerEvents = "auto";
        }
      }
      // Empty layer + viewport addData. SVG (not canvas) so orange roads stay visible at MAX zoom.
      ctx.grading = L.geoJSON({ type: "FeatureCollection", features: [] } as import("geojson").FeatureCollection, {
        pane: "gradingPane",
        renderer: L.svg({ padding: 0.8 }),
        smoothFactor: 0.5,
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
      let lastGradeKey = "";
      let gradeTimer = 0;
      const syncVisibleRoads = () => {
        if (cancelled || !ctx.grading) return;
        const b = map.getBounds().pad(0.15);
        const west = b.getWest();
        const south = b.getSouth();
        const east = b.getEast();
        const north = b.getNorth();
        const zoomedIn = map.getZoom() >= 12;
        const here = lastGps.current;
        const heading = headingRef.current;
        const useCorridor = Boolean(ctx.driveMode && here && zoomedIn);
        let visible = indexed.filter((item) => bboxOverlaps(item.bbox, west, south, east, north));
        if (useCorridor && here) {
          visible = visible.filter((item) =>
            geomHitsHeadingCorridor(item.feature.geometry, item.bbox, here[0], here[1], heading),
          );
        }
        const hdKey = useCorridor ? Math.round(heading / 5) * 5 : 0;
        const key = `${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)},${useCorridor ? 1 : 0},${hdKey},${visible.length}`;
        if (key === lastGradeKey) return;
        lastGradeKey = key;
        ctx.grading.clearLayers();
        ctx.grading.addData({ type: "FeatureCollection", features: visible.map((item) => item.feature) } as import("geojson").FeatureCollection);
      };
      ctx.syncVisibleRoads = syncVisibleRoads;
      ctx.setDriveMode = (on: boolean) => {
        if (ctx.driveMode === on) return;
        ctx.driveMode = on;
        lastGradeKey = "";
        syncVisibleRoads();
        ctx.paintLabels?.();
      };
      map.on("moveend zoomend", () => {
        window.clearTimeout(gradeTimer);
        gradeTimer = window.setTimeout(syncVisibleRoads, 120);
      });
      syncVisibleRoads();
      const names = new Map<string, string>();
      for (const f of features) {
        const nm = roadKey(String(f.properties?.Road_name ?? f.properties?.name ?? ""));
        const prog = String(f.properties?.program ?? "");
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
          "26–27 gold · 27–28 blue",
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
        if (cancelled) return () => {};
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
        if (cancelled) return () => {};
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
        if (cancelled) return () => {};
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
      if (!cancelled) setError("Map failed to start — close the app and open it again");
    }

  return () => {
    cancelled = true;
  };
}
