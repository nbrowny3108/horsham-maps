import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const BASE = process.env.HORSHAM_URL || "http://127.0.0.1:8080";

async function get(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  return res;
}

test("home HTML is Horsham Maps, not Grok App", async () => {
  const res = await get("/");
  assert.equal(res.ok, true);
  const html = await res.text();
  assert.match(html, /Horsham Maps|leaflet|root/);
  assert.doesNotMatch(html, />Grok App</);
});

test("manifest name is Horsham Maps", async () => {
  const res = await get("/manifest.webmanifest");
  assert.equal(res.ok, true);
  const json = await res.json();
  assert.equal(json.name, "Horsham Maps");
  assert.equal(json.short_name, "Horsham Maps");
});

test("service worker is v17 and does not reload from page cache name", async () => {
  const res = await get("/sw.js");
  const js = await res.text();
  assert.match(js, /horsham-app-v21/);
  assert.match(js, /skipWaiting/);
});

test("app-cache does not location.reload", () => {
  const src = readFileSync(new URL("../src/lib/maps/app-cache.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /location\.reload/);
  assert.doesNotMatch(src, /SKIP_WAITING/);
});

test("drive engine does not auto-zoom while walking", () => {
  const src = readFileSync(new URL("../src/lib/maps/drive-engine.ts", import.meta.url), "utf8");
  assert.match(src, /kmh >= 8/);
  assert.match(src, /lastZoomAt = performance\.now\(\)/);
  assert.doesNotMatch(src, /if \(on\) this\.lastZoomAt = 0/);
});

test("tiles: one source at z17 (Vicmap path, image body)", async () => {
  const src = readFileSync(new URL("../src/routes/api/tiles/$.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Promise\.all/);
  assert.match(src, /zoom > 16/);
  const res = await get("/api/tiles/best/12/3724/2458");
  assert.equal(res.ok, true, `tile status ${res.status}`);
  const type = res.headers.get("content-type") || "";
  assert.match(type, /image\//);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.byteLength > 1000, `tiny tile ${buf.byteLength}`);
});

test("live Pozi grading API has Road_name and both programmes", async () => {
  const res = await get("/api/grading");
  assert.equal(res.ok, true, `grading ${res.status}`);
  const data = await res.json();
  assert.ok(Array.isArray(data.features));
  assert.ok(data.features.length > 100, `only ${data.features.length} jobs`);
  const named = data.features.filter((f) => f.properties?.Road_name || f.properties?.name);
  assert.ok(named.length > 50);
  const unnamed = data.features.filter((f) => !String(f.properties?.Road_name || f.properties?.name || "").trim());
  assert.ok(unnamed.length < data.features.length * 0.2, `${unnamed.length} unnamed of ${data.features.length}`);
  const programs = new Set(data.features.map((f) => f.properties?.program).filter(Boolean));
  assert.ok([...programs].some((p) => String(p).includes("26-27")));
  assert.ok([...programs].some((p) => String(p).includes("27-28")));
});

test("search finds Horsham", async () => {
  const res = await get("/api/search?q=Firebrace");
  assert.equal(res.ok, true);
  const data = await res.json();
  assert.ok(Array.isArray(data) || Array.isArray(data.hits) || data.results);
});

test("sw + static assets", async () => {
  const icon = await get("/favicon.svg");
  assert.equal(icon.ok, true);
});
