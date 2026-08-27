import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";
import "./horsham-test-shim.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const geo = await jiti.import("../src/lib/maps/geo.ts");
const style = await jiti.import("../src/lib/maps/style.ts");
const snap = await jiti.import("../src/lib/maps/snap.ts");
const backoff = await jiti.import("../src/lib/maps/backoff.ts");
const heading = await jiti.import("../src/lib/maps/heading.ts");
const gps = await jiti.import("../src/lib/maps/gps.ts");
const drive = await jiti.import("../src/lib/maps/drive-engine.ts");
const storage = await jiti.import("../src/lib/maps/storage.ts");
const roads = await jiti.import("../src/lib/maps/road-tiles.ts");
const places = await jiti.import("../src/lib/maps/places.ts");
const offline = await jiti.import("../src/lib/maps/offline.ts");
const tiles = await jiti.import("../src/lib/maps/tile-cache.ts");
const types = await jiti.import("../src/lib/maps/types.ts");
const lib = await jiti.import("../src/lib/maps/map-library.ts");
const grading = await jiti.import("../src/routes/api/grading.ts");

test("geo: haversine ~20 m walk in Horsham", () => {
  const a = [-36.7044, 142.2425];
  const b = [-36.7044 + 20 / 111_320, 142.2425];
  const km = geo.haversineKm(a, b);
  assert.ok(km > 0.018 && km < 0.022, `got ${km}`);
});

test("geo: formatters, ring, remaining km", () => {
  assert.equal(geo.formatDistance(0.02), "20 m");
  assert.equal(geo.formatDistance(3.2), "3.200 km");
  assert.equal(geo.formatDuration(12), "12 min");
  assert.equal(geo.formatDuration(90), "1 h 30 min");
  assert.equal(geo.nearlySame(-36.7044, -36.7044), true);
  const line = [
    [-36.7, 142.24],
    [-36.71, 142.24],
    [-36.72, 142.24],
  ];
  const remain = geo.remainingKmAlong(line, -36.7, 142.24);
  assert.ok(remain > 2 && remain < 3, `remain ${remain}`);
  const ring = [
    [142.0, -36.5],
    [142.5, -36.5],
    [142.5, -37.0],
    [142.0, -37.0],
    [142.0, -36.5],
  ];
  assert.equal(geo.pointInRing(-36.7044, 142.2425, ring), true);
  assert.equal(geo.pointInRing(-30, 140, ring), false);
  assert.ok(geo.lineLengthKm({ type: "LineString", coordinates: [[142.2, -36.7], [142.3, -36.7]] }) > 8);
  assert.deepEqual(geo.lineMidpoint({ type: "LineString", coordinates: [[0, 0], [1, 1], [2, 2]] }), [1, 1]);
});

test("style: zoom bands 90/80/60", () => {
  const z80 = style.zoomFromPercent(80);
  assert.equal(style.zoomPercent(z80), 80);
  assert.equal(style.zoomPercent(style.zoomFromPercent(90)), 90);
  assert.equal(style.zoomPercent(style.zoomFromPercent(60)), 60);
  const slow = style.zoomForSpeed(20, z80);
  const mid = style.zoomForSpeed(55, z80);
  const fast = style.zoomForSpeed(90, z80);
  assert.ok(Math.abs(slow - style.zoomFromPercent(90)) < 0.6, `slow ${slow}`);
  assert.ok(Math.abs(mid - z80) < 0.6, `mid ${mid}`);
  assert.ok(Math.abs(fast - style.zoomFromPercent(60)) < 0.6, `fast ${fast}`);
  assert.equal(style.ZOOM_MAX, 21);
  const b = style.shireLatLngBounds();
  assert.ok(b[0][0] < types.SHIRE_BOUNDS.north);
});

test("style: names and grading colours", () => {
  assert.equal(style.sameRoadName("Natimuk Road", "Natimuk Rd"), true);
  assert.equal(style.roadKey("Natimuk Road"), "natimuk rd");
  assert.equal(style.isNextProgramme("27-28 Grading Programme"), true);
  assert.equal(style.isNextProgramme("26-27 Grading Programme"), false);
  assert.equal(style.gradeProgramOf({ properties: { program: "26-27 Grading Programme" } }), "26-27 Grading Programme");
  assert.equal(style.gradeColor("26-27 Grading Programme", "hybrid"), types.MAP_COLORS.gradeHybrid);
  assert.equal(style.gradeColor("27-28 Grading Programme", "hybrid"), types.MAP_COLORS.gradeHybrid);
  const gold = style.gradeStyle("hybrid")({ properties: { program: "26-27 Grading Programme" } });
  assert.equal(gold.color, types.MAP_COLORS.gradeHybrid);
  style.roadLineStyle("hybrid")({ properties: { class: 5, surf: 1, name: "Dirt Track" } });
  assert.match(style.gpsIconHtml(90, true, true), /gps-mark-cone/);
});

test("snap: 15 m offset snaps onto Riverside Rd", () => {
  const index = new snap.RoadIndex();
  const lat = -36.7044;
  const lng = 142.2425;
  index.addLine("Riverside Rd", [
    [lng, lat - 0.01],
    [lng, lat],
    [lng, lat + 0.01],
  ]);
  const offLng = lng + 15 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const hit = index.nearest(lat, offLng, 0, 40);
  assert.ok(hit);
  assert.equal(hit.name, "Riverside Rd");
  assert.ok(hit.metres < 20);
  const puck = snap.snapPuckToRoad([], [lat, offLng], 0, index);
  assert.ok(puck);
  assert.ok(Math.abs(puck[1] - lng) < 0.0002);
  assert.equal(snap.snapCurrentRoad([], [lat, lng], 0, index), "Riverside Rd");
  const next = snap.snapNextRoad(
    [{ lat: lat + 0.005, lng, roads: [{ name: "Riverside Rd", cls: 4 }, { name: "Side Rd", cls: 5 }] }],
    "Riverside Rd",
    [lat, lng],
    0,
  );
  assert.equal(next, "Side Rd");
});

test("heading wrap, leaflet bearing, 20 m dead-reckon", () => {
  assert.equal(heading.wrapDeg(-10), 350);
  assert.equal(heading.toLeafletBearing(90), 270);
  assert.ok(Math.abs(heading.lerpAngle(350, 10, 0.5) - 0) < 1);
  const dec = heading.magneticDeclinationEast();
  assert.ok(dec > 10 && dec < 12.5);
  const next = heading.deadReckon(-36.7044, 142.2425, 0, 1.4, 14.3);
  const km = geo.haversineKm([-36.7044, 142.2425], next);
  assert.ok(km > 0.018 && km < 0.022, `deadReckon ${km}`);
});

test("backoff + framed GPS", () => {
  assert.equal(backoff.shouldRetryHttp(429), true);
  assert.equal(backoff.shouldRetryHttp(200), false);
  const d = backoff.exponentialDelay(2, 400, 8000);
  assert.ok(d >= 200 && d <= 8000);
  const res = new Response(null, { status: 429, headers: { "retry-after": "2" } });
  assert.equal(backoff.retryAfterMs(res, 0), 2000);
  assert.equal(gps.isFramed(), false);
  assert.match(gps.gpsDeniedText(), /While Using|Home Screen/);
  const stop = gps.startGpsWatch(
    () => {
      throw new Error("must not fire GPS without geolocation");
    },
    () => {},
  );
  stop();
});

test("storage round-trip", () => {
  storage.saveBaseLayer("hybrid");
  assert.equal(storage.loadBaseLayer(), "hybrid");
  storage.saveGradingOn(false);
  assert.equal(storage.loadGradingOn(), false);
  storage.saveGradingOn(true);
  assert.equal(storage.loadGradingOn(), true);
  storage.saveAutoZoom(false);
  assert.equal(storage.loadAutoZoom(), false);
  storage.saveAutoZoom(true);
  assert.equal(storage.loadAutoZoom(), true);
  storage.savePins([{ name: "Depot", lat: -36.7, lng: 142.2 }]);
  assert.equal(storage.loadPins()[0]?.name, "Depot");
  assert.equal(storage.pushRecent({ name: "IGA", lat: -36.71, lng: 142.2 }, [])[0]?.name, "IGA");
});

test("DriveEngine: 20 m walk accumulates trip; 200 m noisy jump ignored", () => {
  const engine = new drive.DriveEngine();
  engine.setAutoZoom(true);
  const start = [-36.7044, 142.2425];
  engine.ingest({ lat: start[0], lng: start[1], accuracy: 10, heading: 0, speed: 1.4, sats: 12 });
  engine.ingest({ lat: start[0] + 20 / 111_320, lng: start[1], accuracy: 10, heading: 0, speed: 1.4, sats: 12 });
  assert.ok(engine.tripKm > 0.015 && engine.tripKm < 0.03, `trip ${engine.tripKm}`);
  engine.ingest({ lat: start[0] + 200 / 111_320, lng: start[1], accuracy: 80, heading: 0, speed: 0.2, sats: 4 });
  assert.ok(engine.tripKm < 0.05, "noisy jump must not add to trip");
});

test("tiles helpers, road chunks, places, library size", () => {
  const urls = tiles.tileUrlsInBounds("best", 16, 142.24, -36.71, 142.25, -36.7);
  assert.ok(urls.length > 0);
  assert.ok(urls.every((u) => u.startsWith("/api/tiles/best/16/")));
  assert.ok(roads.visibleChunkKeys(142.2, -36.72, 142.25, -36.7).length >= 1);
  assert.ok(roads.headingPadKeys(-36.7044, 142.2425, 0, 1.8).length >= 1);
  assert.equal(places.placeTitle("IGA Horsham, Firebrace Street, Horsham VIC"), "IGA Horsham");
  assert.match(places.placeSubtitle("IGA Horsham, Firebrace Street, Horsham VIC"), /Firebrace|Horsham/);
  assert.match(offline.tileCacheKey("/api/tiles/best/17/1/2"), /\/api\/tiles\/best\/17\/1\/2/);
  assert.match(lib.formatLibrarySize(2_000_000), /MB/);
  assert.ok(types.HORSHAM_CENTER[0] < 0);
});

test("Pozi normalizeGradingProps maps Road_name", () => {
  const props = grading.normalizeGradingProps(
    { Road_name: "Natimuk Rd", From: "Horsham", To: "Natimuk", Grading_re: "Zone 2", Length_m: 4120, Sequence: 12, Asset_id: "A1" },
    "26-27 Grading Programme",
  );
  assert.equal(props.name, "Natimuk Rd");
  assert.equal(props.Road_name, "Natimuk Rd");
  assert.equal(props.From, "Horsham");
  assert.equal(props.program, "26-27 Grading Programme");
  assert.equal(props.Length_m, 4120);
});

test("sleep resolves", async () => {
  const t0 = Date.now();
  await backoff.sleep(15);
  assert.ok(Date.now() - t0 >= 10);
});
