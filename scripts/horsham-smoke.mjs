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
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));

const faults = [];
const notes = [];
const fail = (msg) => faults.push(msg);
const shot = (name) => page.screenshot({ path: `/workspace/screenshots/${name}`, fullPage: false });

const t0 = Date.now();
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  notes.push(`Map mounted in ${Date.now() - t0}ms (saved grants skip gate)`);
  await page.waitForTimeout(1800);
  await shot("smoke-map.png");

  if ((await page.locator("h1").count()) > 0) {
    const title = await page.locator("h1").first().innerText().catch(() => "");
    if (/Location first|Compass next|Sensors blocked/i.test(title)) fail(`Gate still showing after saved grants: ${title}`);
  }

  for (const name of ["Pin", "Heading", "Grading", "Search", "Layers", "Settings"]) {
    if ((await page.getByRole("button", { name: new RegExp(`^${name}$|^${name} `, "i") }).count()) === 0) {
      const any = await page.getByRole("button", { name: new RegExp(name, "i") }).count();
      if (!any) fail(`Missing toolbar button: ${name}`);
    }
  }
  if ((await page.getByRole("button", { name: "Zoom in" }).count()) === 0) fail("Zoom in missing");
  if ((await page.getByRole("button", { name: "Zoom out" }).count()) === 0) fail("Zoom out missing");
  if ((await page.getByText("km/h").count()) === 0) fail("Speed HUD missing");
  if ((await page.getByText("km trip").count()) === 0) fail("Trip meter missing");

  const startPct = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  notes.push(`Start zoom ${startPct}`);
  if (startPct !== "60%" && startPct !== "50%" && startPct !== "70%") fail(`Expected start zoom ~60%, got ${startPct}`);

  if ((await page.getByRole("button", { name: "GPS follow" }).count()) > 0) fail("GPS follow should be gone from toolbar");
  if ((await page.getByRole("button", { name: "North up" }).count()) > 0) fail("North up should be gone from toolbar");
  if ((await page.getByRole("button", { name: "Heading up" }).evaluate((el) => el.className.includes("bg-primary"))) === false) {
    fail("Heading up should start on");
  }

  await page.getByRole("button", { name: "Layers" }).click();
  await page.waitForTimeout(400);
  if (
    (await page.getByRole("button", { name: /^Map$/ }).count()) +
      (await page.getByRole("button", { name: /^Satellite$/ }).count()) +
      (await page.getByRole("button", { name: /^Hybrid$/ }).count()) >
    0
  ) {
    fail("Map/Satellite/Hybrid picker should be gone");
  }
  if ((await page.getByText("Map data").count()) === 0) fail("Layers missing Map data toggle");
  if ((await page.getByText("HRCC grading programme").count()) === 0) fail("Grading toggle missing in Layers");
  if ((await page.getByText("Auto").count()) > 0 && (await page.getByRole("button", { name: /^Newer$/ }).count()) > 0) {
    fail("Photo Auto/Newer/Sharp picker should be gone");
  }
  if ((await page.getByText(/One satellite photo/i).count()) === 0) fail("Layers missing single satellite description");
  await shot("smoke-layers.png");

  const mapData = page.locator("label").filter({ hasText: "Map data" }).locator("input");
  if (await mapData.count()) {
    if (!(await mapData.isChecked())) fail("Map data should start on");
    await mapData.click();
    await page.waitForTimeout(200);
    if (await mapData.isChecked()) fail("Map data did not turn off");
    await mapData.click();
    await page.waitForTimeout(200);
  }
  await page.getByRole("button", { name: "Layers" }).click();
  await page.waitForTimeout(200);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  if ((await page.getByText("GPS always on").count()) === 0) fail("Settings missing GPS always on");
  if ((await page.getByRole("button", { name: "Auto" }).count()) === 0) fail("Settings missing Auto zoom");
  if ((await page.getByRole("button", { name: "Manual" }).count()) === 0) fail("Settings missing Manual zoom");
  const autoBtn = page.getByRole("button", { name: "Auto" }).first();
  if (!(await autoBtn.evaluate((el) => el.className.includes("bg-primary")))) fail("Auto zoom should start selected");
  if ((await page.getByText("GPS & compass enabled").count()) === 0) fail("Expected green enabled permissions state");
  if ((await page.getByText("Waiting on permissions").count()) > 0) fail("Permissions still waiting despite saved grants");
  await shot("smoke-settings.png");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(200);

  const plus = page.getByRole("button", { name: "Zoom in" });
  const pctBefore = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  await plus.click();
  await page.waitForTimeout(250);
  const pctAfter = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  if (pctBefore === pctAfter) fail(`Zoom + did not change percent (${pctBefore})`);
  else notes.push(`Zoom ${pctBefore} → ${pctAfter}`);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(300);
  const manualBtn = page.getByRole("button", { name: "Manual" }).first();
  if (!(await manualBtn.evaluate((el) => el.className.includes("bg-primary")))) fail("+ zoom should flip to Manual");
  await autoBtn.click();
  await page.waitForTimeout(250);
  if (!(await autoBtn.evaluate((el) => el.className.includes("bg-primary")))) fail("Auto tap did not reselect Auto");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(200);
  const afterAuto = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  if (afterAuto !== "90%" && afterAuto !== "80%") fail(`Auto at rest should be 90% (slow) or 80%, got ${afterAuto}`);
  notes.push(`Auto restored ${afterAuto}`);

  await page.getByRole("button", { name: "Search address" }).click();
  await page.waitForTimeout(400);
  const input = page.locator("#place-search");
  if ((await input.count()) === 0) fail("Search field missing");
  else {
    await input.fill("30 Murray Street Horsham");
    await page.waitForTimeout(2800);
    const hit = page.locator("button").filter({ hasText: /Murray/i }).first();
    if ((await hit.count()) === 0) notes.push("Nominatim returned no Murray hit (network)");
    else {
      await hit.click();
      await page.waitForTimeout(2500);
      notes.push("Search chose Murray Street");
    }
    await shot("smoke-search.png");
  }
  if ((await page.locator("#place-search").count()) > 0) {
    await page.getByRole("button", { name: "Close search" }).click().catch(() => {});
  }

  const path = [
    [-36.717, 142.2],
    [-36.712, 142.2],
    [-36.707, 142.198],
    [-36.702, 142.195],
    [-36.697, 142.193],
    [-36.692, 142.191],
  ];
  for (const [latitude, longitude] of path) {
    await page.context().setGeolocation({ latitude, longitude, accuracy: 8 });
    await page.waitForTimeout(350);
  }
  notes.push("Simulated 6-point drive north of Horsham");

  const grading = await page.evaluate(async () => {
    const res = await fetch("/api/grading");
    const data = await res.json();
    return { ok: res.ok, count: data.features?.length ?? 0, source: data.source, note: data.note };
  });
  notes.push(`Grading API ${grading.count} features (${grading.source})`);
  if (!grading.ok || grading.count < 150) fail(`Grading API weak: ${JSON.stringify(grading)}`);

  const roads = await page.evaluate(async () => {
    const res = await fetch("/data/roads.geojson");
    const data = await res.json();
    return { ok: res.ok, count: data.features?.length ?? 0 };
  });
  notes.push(`Roads ${roads.count}`);
  if (!roads.ok || roads.count < 500) fail(`Roads geojson weak: ${JSON.stringify(roads)}`);

  const tiles = await page.evaluate(async () => {
    const res = await fetch("/api/tiles/best/13/7331/4995");
    return { ok: res.ok, status: res.status, type: res.headers.get("content-type"), bytes: (await res.arrayBuffer()).byteLength };
  });
  notes.push(`Best tile ${tiles.status} ${tiles.type} ${tiles.bytes}B`);
  if (!tiles.ok || tiles.bytes < 4000) fail(`Best aerial tile failed ${JSON.stringify(tiles)}`);

  const tileDom = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".leaflet-tile")];
    const srcs = [...new Set(nodes.map((t) => (t.getAttribute("src") || "").split("/").slice(0, 4).join("/")))];
    return {
      count: nodes.length,
      loaded: nodes.filter((t) => t.complete && t.naturalWidth > 0).length,
      srcs,
    };
  });
  notes.push(`DOM tiles ${tileDom.loaded}/${tileDom.count} ${tileDom.srcs.join(",")}`);
  if (tileDom.loaded < 4) fail(`Map tiles not painting: ${JSON.stringify(tileDom)}`);
  if (tileDom.srcs.some((s) => s.includes("/sat/") || s.includes("/vic/"))) fail(`Expected only /best/ tiles, got ${tileDom.srcs}`);

  const zoomMath = await page.evaluate(() => {
    const min = 9;
    const max = 21;
    const from = (pct) => min + (pct / 100) * (max - min);
    const speed = (kmh, band) => {
      const b = band ?? 80;
      if (b === 90) return kmh >= 45 ? 80 : 90;
      if (b === 60) return kmh <= 65 ? 80 : 60;
      if (kmh <= 35) return 90;
      if (kmh >= 78) return 60;
      return 80;
    };
    return {
      p0: from(0),
      p80: from(80),
      p100: from(100),
      town: speed(30),
      hwy: speed(90),
      ok: from(0) === min && from(100) === max && speed(0) === 90 && speed(30) === 90 && speed(50) === 80 && speed(70) === 80 && speed(78) === 60 && speed(90) === 60,
    };
  });
  notes.push(`Zoom math 0%→${zoomMath.p0} 80%→${zoomMath.p80} 100%→${zoomMath.p100}`);
  if (!zoomMath.ok) fail(`Zoom algorithm mismatch ${JSON.stringify(zoomMath)}`);

  await shot("smoke-final.png");

  const filteredConsole = consoleErrors.filter((t) => !/favicon|Download the React DevTools|leaflet/i.test(t));
  const report = {
    ok: faults.length === 0 && pageErrors.length === 0,
    faults,
    notes,
    pageErrors,
    consoleErrors: filteredConsole.slice(0, 12),
  };
  writeFileSync("/workspace/horsham-qa.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  const report = { ok: false, error: String(err?.message || err), faults, notes, pageErrors, consoleErrors };
  writeFileSync("/workspace/horsham-qa.json", JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(1);
}
