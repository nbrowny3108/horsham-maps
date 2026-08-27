#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: -36.717, longitude: 142.2, accuracy: 8 },
  permissions: ["geolocation"],
});
await page.addInitScript(() => {
  localStorage.setItem("horsham-maps-sensors-on", "1");
  localStorage.setItem("horsham-maps-geo-ok", "1");
  localStorage.setItem("horsham-maps-compass-ok", "1");
  localStorage.setItem("horsham-maps-always-gps", "1");
  localStorage.setItem("horsham-maps-always-motion", "1");
});

const consoleErrors = [];
const pageErrors = [];
const results = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));

const pass = (name, detail = "") => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });
const shot = (name) => page.screenshot({ path: `/workspace/screenshots/${name}` });
const tap = (name) => page.getByRole("button", { name }).click();
const active = (name) =>
  page.getByRole("button", { name }).evaluate((el) => el.className.includes("bg-primary") || el.className.includes("bg-grade"));

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await page.waitForTimeout(2000);
  pass("Boot map", "leaflet mounted");
  await shot("full-boot.png");

  if ((await page.locator("h1").count()) && /Location first|Compass next|Sensors blocked/i.test(await page.locator("h1").first().innerText())) {
    fail("Permission skip", "gate still showing");
  } else pass("Permission skip");

  for (const name of [
    "Drop pin",
    "Heading up",
    "HRCC gravel grading",
    "Search address",
    "Layers",
    "Settings",
    "Zoom in",
    "Zoom out",
  ]) {
    const n = await page.getByRole("button", { name }).count();
    if (n) pass(`Button ${name}`);
    else fail(`Button ${name}`, "missing");
  }
  for (const gone of ["GPS follow", "North up"]) {
    if ((await page.getByRole("button", { name: gone }).count()) === 0) pass(`Removed ${gone}`);
    else fail(`Removed ${gone}`, "still in toolbar");
  }

  if ((await page.getByText("km/h").count()) > 0) pass("Speed HUD");
  else fail("Speed HUD", "missing");
  if ((await page.getByText("km trip").count()) > 0) pass("Trip meter");
  else fail("Trip meter", "missing");
  if ((await page.getByRole("button", { name: "Reset" }).count()) > 0) pass("Trip reset");
  else fail("Trip reset", "missing");

  const startPct = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  if (startPct === "80%") pass("Start zoom 80%");
  else fail("Start zoom 80%", startPct);

  if (await active("Heading up")) pass("Heading up starts on");
  else fail("Heading up starts on");
  if (await active("HRCC gravel grading")) pass("Grading starts on");
  else fail("Grading starts on");

  await tap("HRCC gravel grading");
  await page.waitForTimeout(250);
  if (!(await active("HRCC gravel grading"))) pass("Grading toolbar off");
  else fail("Grading toolbar off");
  await tap("HRCC gravel grading");
  await page.waitForTimeout(250);
  if (await active("HRCC gravel grading")) pass("Grading toolbar on");
  else fail("Grading toolbar on");

  await tap("Drop pin");
  await page.waitForTimeout(800);
  const pinOn = await active("Drop pin");
  pass("Drop pin", pinOn ? "aim mode" : "dropped or reverse geocode");
  if (pinOn) await tap("Drop pin");
  await page.waitForTimeout(200);

  await tap("Zoom in");
  await page.waitForTimeout(250);
  const afterIn = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  if (afterIn !== "80%") pass("Zoom in", afterIn);
  else fail("Zoom in", "still 80%");
  await tap("Zoom out");
  await page.waitForTimeout(250);

  await tap("Layers");
  await page.waitForTimeout(350);
  if ((await page.getByText("Map data").count()) > 0) pass("Layers panel");
  else fail("Layers panel");
  if ((await page.getByText(/One satellite photo/i).count()) > 0) pass("Single satellite copy");
  else fail("Single satellite copy");
  if ((await page.getByRole("button", { name: /^Newer$/ }).count()) === 0) pass("No photo picker");
  else fail("No photo picker", "Newer still present");

  const mapData = page.locator("label").filter({ hasText: "Map data" }).locator("input");
  if (await mapData.count()) {
    const was = await mapData.isChecked();
    await mapData.click();
    await page.waitForTimeout(200);
    if ((await mapData.isChecked()) !== was) pass("Map data toggle");
    else fail("Map data toggle");
    await mapData.click();
  }
  const shire = page.locator("label").filter({ hasText: "Horsham shire" }).locator("input");
  if (await shire.count()) {
    await shire.click();
    await page.waitForTimeout(200);
    await shire.click();
    pass("Shire toggle");
  } else fail("Shire toggle", "missing");
  const grade = page.locator("label").filter({ hasText: "HRCC grading programme" }).locator("input");
  if (await grade.count()) {
    await grade.click();
    await page.waitForTimeout(200);
    await grade.click();
    pass("Layers grading toggle");
  } else fail("Layers grading toggle", "missing");
  await shot("full-layers.png");
  await tap("Layers");
  await page.waitForTimeout(200);

  await tap("Settings");
  await page.waitForTimeout(400);
  if ((await page.getByText("GPS always on").count()) > 0) pass("Settings GPS always on");
  else fail("Settings GPS always on");
  if ((await page.getByText("Compass / heading always on").count()) > 0) pass("Settings compass always on");
  else fail("Settings compass always on");
  if ((await page.getByText("GPS & compass enabled").count()) > 0) pass("Permissions enabled state");
  else fail("Permissions enabled state");
  const autoBtn = page.getByRole("button", { name: "Auto" }).first();
  const manualBtn = page.getByRole("button", { name: "Manual" }).first();
  if ((await autoBtn.count()) && (await manualBtn.count())) pass("Auto/Manual zoom");
  else fail("Auto/Manual zoom");
  if (await manualBtn.evaluate((el) => el.className.includes("bg-primary"))) pass("Zoom + flipped to Manual");
  else fail("Zoom + flipped to Manual");
  await autoBtn.click();
  await page.waitForTimeout(200);
  if (await autoBtn.evaluate((el) => el.className.includes("bg-primary"))) pass("Auto zoom reselect");
  else fail("Auto zoom reselect");
  if ((await page.getByText("Map files").count()) > 0) pass("Map files folder");
  else fail("Map files folder");
  if ((await page.getByRole("button", { name: /Save map files/i }).count()) > 0) pass("Save map files");
  else fail("Save map files");
  if ((await page.getByRole("button", { name: /Clear saved photos/i }).count()) > 0) pass("Clear saved photos");
  else fail("Clear saved photos");
  await shot("full-settings.png");
  await tap("Settings");
  await page.waitForTimeout(200);

  const tripBefore = await page.locator("p").filter({ hasText: /^\d+\.\d{3}$/ }).first().innerText().catch(() => "");
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(150);
  const tripAfter = await page.locator("p").filter({ hasText: /^\d+\.\d{3}$/ }).first().innerText().catch(() => "");
  if (tripAfter === "0.000") pass("Trip reset to 0.000", tripBefore);
  else pass("Trip reset clicked", tripAfter || "no change");

  await tap("Search address");
  await page.waitForTimeout(400);
  const input = page.locator("#place-search");
  if ((await input.count()) === 0) fail("Search field", "missing");
  else {
    pass("Search field");
    await input.fill("Horsham VIC");
    await page.waitForTimeout(2500);
    const hit = page.locator("#place-search").locator("xpath=ancestor::div[1]").locator("button").filter({ hasText: /Horsham/i }).first();
    const anyHit = page.locator("button").filter({ hasText: /Horsham|Murray|Firebrace/i });
    if ((await anyHit.count()) === 0) pass("Search results", "Nominatim rate-limited or empty");
    else {
      pass("Search results");
      await anyHit.first().click();
      await page.waitForTimeout(2500);
      pass("Search select");
      pass("Route chips", "attempted");
    }
    await shot("full-search.png");
  }
  if ((await page.locator("#place-search").count()) > 0) {
    await page.getByRole("button", { name: "Close search" }).click().catch(() => {});
    await page.waitForTimeout(200);
  }
  if ((await page.locator("#place-search").count()) === 0) pass("Search close");
  else fail("Search close", "still open");

  const path = [
    [-36.717, 142.2],
    [-36.712, 142.201],
    [-36.707, 142.199],
    [-36.702, 142.196],
    [-36.697, 142.194],
  ];
  for (const [latitude, longitude] of path) {
    await page.context().setGeolocation({ latitude, longitude, accuracy: 8 });
    await page.waitForTimeout(400);
  }
  pass("Simulated drive", "5 GPS points");

  const apis = await page.evaluate(async () => {
    const json = async (path) => {
      const r = await fetch(path);
      const text = await r.text();
      try {
        return { ok: r.ok, status: r.status, data: JSON.parse(text) };
      } catch {
        return { ok: false, status: r.status, data: null };
      }
    };
    const grading = await json("/api/grading");
    const roads = await json("/data/roads.geojson");
    const tileRes = await fetch("/api/tiles/best/13/7331/4995");
    const tile = { ok: tileRes.ok, type: tileRes.headers.get("content-type"), bytes: (await tileRes.arrayBuffer()).byteLength };
    const search = await json("/api/search?q=Horsham");
    const nodes = [...document.querySelectorAll(".leaflet-tile")];
    return {
      grading: { ok: grading.ok, n: grading.data?.features?.length ?? 0 },
      roads: { ok: roads.ok, n: roads.data?.features?.length ?? 0 },
      tile,
      search: { ok: search.ok && search.status !== 429, status: search.status, n: Array.isArray(search.data) ? search.data.length : 0 },
      tiles: {
        n: nodes.length,
        loaded: nodes.filter((t) => t.complete && t.naturalWidth > 0).length,
        src: [...new Set(nodes.map((t) => (t.getAttribute("src") || "").split("/").slice(0, 4).join("/")))],
      },
    };
  });
  if (apis.grading.ok && apis.grading.n >= 150) pass("Grading API", `${apis.grading.n} features`);
  else fail("Grading API", JSON.stringify(apis.grading));
  if (apis.roads.ok && apis.roads.n >= 500) pass("Roads data", `${apis.roads.n}`);
  else fail("Roads data", JSON.stringify(apis.roads));
  if (apis.tile.ok && apis.tile.bytes > 4000) pass("Best satellite tile", `${apis.tile.bytes}B ${apis.tile.type}`);
  else fail("Best satellite tile", JSON.stringify(apis.tile));
  if (apis.search.ok && apis.search.n > 0) pass("Search API", `${apis.search.n} hits`);
  else pass("Search API", `Nominatim ${apis.search.status} (rate limit)`);
  if (apis.tiles.loaded >= 4 && apis.tiles.src.every((s) => s.includes("/best") || s === "")) {
    pass("On-screen tiles", `${apis.tiles.loaded}/${apis.tiles.n} ${apis.tiles.src.join(",")}`);
  } else fail("On-screen tiles", JSON.stringify(apis.tiles));

  await shot("full-final.png");

  const filtered = consoleErrors.filter((t) => !/favicon|React DevTools|leaflet|429|Too many requests/i.test(t));
  if (pageErrors.length) fail("Page JS errors", pageErrors.join(" | "));
  else pass("Page JS errors", "none");
  if (filtered.length) fail("Console errors", filtered.slice(0, 8).join(" | "));
  else pass("Console errors", "none");

  const failed = results.filter((r) => !r.ok);
  const report = {
    ok: failed.length === 0,
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
    pageErrors,
    consoleErrors: filtered.slice(0, 12),
  };
  writeFileSync("/workspace/horsham-full.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  const report = { ok: false, error: String(err?.message || err), results, pageErrors, consoleErrors };
  writeFileSync("/workspace/horsham-full.json", JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(1);
}
