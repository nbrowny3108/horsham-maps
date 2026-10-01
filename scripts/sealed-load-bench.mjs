/**
 * Baseline bomb test for Vicmap sealed overlay.
 * iPhone-sized viewport, 4x CPU throttle, cold fetch of the real GeoJSON.
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium, devices } from "playwright";

const ROOT = "/workspace";
const sealedPath = `${ROOT}/public/data/sealed-roads.geojson`;
const majorPath = `${ROOT}/public/data/roads-major.geojson`;
const sealedBytes = statSync(sealedPath).size;
const sealedGz = gzipSync(readFileSync(sealedPath)).length;
const majorBytes = statSync(majorPath).size;

const server = createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="map" style="width:390px;height:700px"></div><script src="/leaflet.js"></script>`,
    );
    return;
  }
  const file =
    url === "/leaflet.js"
      ? `${ROOT}/node_modules/leaflet/dist/leaflet.js`
      : url === "/sealed-roads.geojson"
        ? sealedPath
        : url === "/roads-major.geojson"
          ? majorPath
          : null;
  if (!file) {
    res.writeHead(404);
    res.end("no");
    return;
  }
  const body = readFileSync(file);
  const type = url.endsWith(".js") ? "application/javascript" : "application/geo+json";
  const enc = String(req.headers["accept-encoding"] || "");
  if (enc.includes("gzip") && body.length > 1000) {
    const gz = gzipSync(body);
    res.writeHead(200, {
      "content-type": type,
      "content-encoding": "gzip",
      "content-length": String(gz.length),
      "cache-control": "no-store",
    });
    res.end(gz);
    return;
  }
  res.writeHead(200, {
    "content-type": type,
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
});

await new Promise((resolve) => server.listen(8765, "127.0.0.1", resolve));

const browser = await chromium.launch({ headless: true });
const iphone = devices["iPhone 13"];
const context = await browser.newContext({
  ...iphone,
  serviceWorkers: "block",
});
const page = await context.newPage();
const client = await context.newCDPSession(page);
await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await client.send("Network.enable");
await client.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 180,
  downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
  uploadThroughput: Math.round((0.4 * 1024 * 1024) / 8),
});

await page.goto("http://127.0.0.1:8765/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.L);

const result = await page.evaluate(async () => {
  const time = async (fn) => {
    const t0 = performance.now();
    const value = await fn();
    return { ms: Math.round(performance.now() - t0), value };
  };

  const fetchText = await time(async () => {
    const res = await fetch("/sealed-roads.geojson", { cache: "no-store" });
    return res.text();
  });
  const parsed = await time(() => JSON.parse(fetchText.value));
  const data = parsed.value;
  const majorRes = await fetch("/roads-major.geojson", { cache: "no-store" });
  const major = await majorRes.json();

  const L = window.L;
  const map = L.map("map", {
    center: [-36.717, 142.2],
    zoom: 16,
    zoomControl: false,
    fadeAnimation: false,
    zoomAnimation: false,
    preferCanvas: true,
    zoomSnap: 0.5,
  });
  const renderer = L.canvas({ padding: 0.5, tolerance: 2 });
  const style = () => ({
    color: "#d93025",
    weight: 2.4,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
  });

  const drawAll = await time(() => {
    const layer = L.geoJSON(data, {
      renderer,
      smoothFactor: 1.2,
      interactive: false,
      style,
    }).addTo(map);
    map.invalidateSize();
    return layer.getLayers().length;
  });

  const pan = await time(() => {
    map.panBy([80, 40], { animate: false });
    map.panBy([-40, 20], { animate: false });
    return map.getCenter().lat;
  });

  map.setView([-36.717, 142.2], 20, { animate: false });
  const panZoom20All = await time(() => {
    map.panBy([40, 24], { animate: false });
    map.panBy([-20, 12], { animate: false });
    return true;
  });

  map.setView([-36.717, 142.2], 9, { animate: false });
  const panZoomedOut = await time(() => {
    map.panBy([30, 20], { animate: false });
    return true;
  });

  // Remove the heavy layer and draw only the street viewport.
  map.eachLayer((layer) => {
    if (layer.getLayers) map.removeLayer(layer);
  });
  map.setView([-36.717, 142.2], 16, { animate: false });

  const CELL = 0.1;
  const indexBuild = await time(() => {
    const grid = new Map();
    const lines = [];
    for (const f of data.features) {
      const c = f.geometry.coordinates;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of c) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
      const id = lines.length;
      lines.push({
        c,
        minX,
        minY,
        maxX,
        maxY,
        name: f.properties.name || "",
        cls: f.properties.class,
      });
      const x0 = Math.floor(minX / CELL);
      const x1 = Math.floor(maxX / CELL);
      const y0 = Math.floor(minY / CELL);
      const y1 = Math.floor(maxY / CELL);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = x + "_" + y;
          const bucket = grid.get(key);
          if (bucket) bucket.push(id);
          else grid.set(key, [id]);
        }
      }
    }
    return { grid, lines };
  });

  const query = (west, south, east, north) => {
    const { grid, lines } = indexBuild.value;
    const x0 = Math.floor(west / CELL);
    const x1 = Math.floor(east / CELL);
    const y0 = Math.floor(south / CELL);
    const y1 = Math.floor(north / CELL);
    const seen = new Set();
    const coords = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const bucket = grid.get(x + "_" + y);
        if (!bucket) continue;
        for (const id of bucket) {
          if (seen.has(id)) continue;
          const line = lines[id];
          if (line.maxX < west || line.minX > east || line.maxY < south || line.minY > north)
            continue;
          seen.add(id);
          coords.push(line.c);
        }
      }
    }
    return coords;
  };

  const b = map.getBounds().pad(0.6);
  const visibleQuery = await time(() =>
    query(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()),
  );
  const drawVisible = await time(() => {
    const layer = L.geoJSON(
      {
        type: "Feature",
        properties: { surf: 0, class: 1, name: "" },
        geometry: { type: "MultiLineString", coordinates: visibleQuery.value },
      },
      { renderer, smoothFactor: 1.2, interactive: false, style },
    ).addTo(map);
    return layer.getLayers().length;
  });
  const panVisible = await time(() => {
    map.panBy([80, 40], { animate: false });
    map.panBy([-40, 20], { animate: false });
    return true;
  });

  map.eachLayer((layer) => {
    if (layer.getLayers) map.removeLayer(layer);
  });
  map.setView([-36.717, 142.2], 20, { animate: false });
  const street = map.getBounds().pad(0.8);
  const streetQuery = await time(() =>
    query(street.getWest(), street.getSouth(), street.getEast(), street.getNorth()),
  );
  const drawStreet = await time(() => {
    L.geoJSON(
      {
        type: "Feature",
        properties: { surf: 0, class: 1, name: "" },
        geometry: { type: "MultiLineString", coordinates: streetQuery.value },
      },
      { renderer: L.canvas({ padding: 0.5, tolerance: 2 }), smoothFactor: 1.2, interactive: false, style },
    ).addTo(map);
    return streetQuery.value.length;
  });
  const panStreet = await time(() => {
    map.panBy([40, 24], { animate: false });
    map.panBy([-20, 12], { animate: false });
    return true;
  });

  map.setView([-36.717, 142.2], 9, { animate: false });
  const shire = map.getBounds().pad(0.2);
  const shireQuery = await time(() =>
    query(shire.getWest(), shire.getSouth(), shire.getEast(), shire.getNorth()),
  );
  const drawShire = await time(() => {
    map.eachLayer((layer) => {
      if (layer.getLayers) map.removeLayer(layer);
    });
    L.geoJSON(
      {
        type: "Feature",
        properties: { surf: 0, class: 1 },
        geometry: { type: "MultiLineString", coordinates: shireQuery.value },
      },
      {
        renderer: L.canvas({ padding: 0.5, tolerance: 2 }),
        smoothFactor: 1.2,
        interactive: false,
        style,
      },
    ).addTo(map);
    return shireQuery.value.length;
  });
  const panShireCulled = await time(() => {
    map.panBy([40, 20], { animate: false });
    return true;
  });

  // Snap array cost, same spacing as appendRoadSnaps (55 m).
  const snaps = await time(() => {
    const out = [];
    const dest = (a, b) => {
      const dLng = ((b[0] - a[0]) * Math.PI) / 180;
      const lat1 = (a[1] * Math.PI) / 180;
      const lat2 = (b[1] * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    };
    for (const f of data.features) {
      const coords = f.geometry.coordinates;
      const name = f.properties.name || "Unnamed road";
      if (!name || coords.length < 2) continue;
      let acc = 0;
      out.push({ name, lng: coords[0][0], lat: coords[0][1], brg: dest(coords[0], coords[1]) });
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1];
        const b = coords[i];
        acc += Math.hypot((b[1] - a[1]) * 111320, (b[0] - a[0]) * 89200);
        if (acc >= 55 || i === coords.length - 1) {
          out.push({ name, lng: b[0], lat: b[1], brg: dest(a, b) });
          acc = 0;
        }
      }
    }
    return out;
  });

  const labelScan = await time(() => {
    const hereLat = -36.717;
    const hereLng = 142.2;
    let hits = 0;
    for (let n = 0; n < 40; n++) {
      let bestD = Infinity;
      for (const sn of snaps.value) {
        const d = Math.hypot((sn.lat - hereLat) * 111.32, (sn.lng - hereLng) * 89.2);
        if (d < bestD) bestD = d;
      }
      if (bestD < 1) hits++;
    }
    return hits;
  });

  const majorSealed = major.features.filter((f) => Number(f.properties?.surf ?? 0) === 0).length;
  const majorGravel = major.features.length - majorSealed;

  return {
    features: data.features.length,
    chars: fetchText.value.length,
    fetchMs: fetchText.ms,
    parseMs: parsed.ms,
    drawAllLayers: drawAll.value,
    drawAllMs: drawAll.ms,
    panStreetAllMs: pan.ms,
    panZoom20AllMs: panZoom20All.ms,
    panShireAllMs: panZoomedOut.ms,
    indexMs: indexBuild.ms,
    visibleLines: visibleQuery.value.length,
    visibleQueryMs: visibleQuery.ms,
    drawVisibleMs: drawVisible.ms,
    panStreetVisibleMs: panVisible.ms,
    zoom20Lines: streetQuery.value.length,
    zoom20QueryMs: streetQuery.ms,
    zoom20DrawMs: drawStreet.ms,
    zoom20PanMs: panStreet.ms,
    shireLines: shireQuery.value.length,
    shireQueryMs: shireQuery.ms,
    drawShireMs: drawShire.ms,
    panShireOneLayerMs: panShireCulled.ms,
    snaps: snaps.value.length,
    snapsMs: snaps.ms,
    labelScan40Ms: labelScan.ms,
    majorFeatures: major.features.length,
    majorSealed,
    majorGravel,
  };
});

// Repeat fetch with cache-friendly second request (still no-store on server) to see warm parse only.
const warm = await page.evaluate(async () => {
  const t0 = performance.now();
  const res = await fetch("/sealed-roads.geojson", { cache: "no-store" });
  const text = await res.text();
  const fetchMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const data = JSON.parse(text);
  return { fetchMs, parseMs: Math.round(performance.now() - t1), features: data.features.length };
});

console.log(
  JSON.stringify(
    {
      sealedBytes,
      sealedGz,
      majorBytes,
      throttled: "cpu 4x, net 1.6Mbps/180ms, iPhone 13 390x844",
      ...result,
      warm,
    },
    null,
    2,
  ),
);

await browser.close();
server.close();
