#!/usr/bin/env node
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const loops = Number(process.argv[3] || 3);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const faults = [];
const notes = [];

async function oneLoop(i) {
  const page = await browser.newPage({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: -36.717, longitude: 142.2, accuracy: 6 },
    permissions: ["geolocation"],
  });
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err?.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("horsham-maps-sensors-on", "1");
    localStorage.setItem("horsham-maps-geo-ok", "1");
    localStorage.setItem("horsham-maps-compass-ok", "1");
    localStorage.setItem("horsham-maps-always-gps", "1");
    localStorage.setItem("horsham-maps-always-motion", "1");
    localStorage.removeItem("horsham-maps-last-view");
    const speeds = [0, 0, 0, 3, 3, 12, 12, 12, 38, 38, 38, 72, 72, 72, 12, 12, 0, 0];
    let n = 0;
    let lat = -36.717;
    const lng = 142.2;
    const fix = () => {
      const kmh = speeds[Math.min(n, speeds.length - 1)];
      n += 1;
      lat -= 0.00018;
      return {
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy: 8,
          altitude: null,
          altitudeAccuracy: null,
          heading: 0,
          speed: kmh / 3.6,
        },
        timestamp: Date.now(),
      };
    };
    navigator.geolocation.getCurrentPosition = (ok) => ok(fix());
    navigator.geolocation.watchPosition = (ok) => {
      ok(fix());
      return window.setInterval(() => ok(fix()), 450);
    };
    navigator.geolocation.clearWatch = (id) => window.clearInterval(id);
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await page.waitForTimeout(1500);
  const zoomEvents = await page.evaluate(() => {
    window.__zoomEvents = 0;
    const el = document.querySelector(".leaflet-container");
    if (!el) return -1;
    el.addEventListener("zoomend", () => {
      window.__zoomEvents = (window.__zoomEvents || 0) + 1;
    }, true);
    return 0;
  });
  void zoomEvents;
  await page.waitForTimeout(8500);
  const tiles = await page.locator(".leaflet-tile-pane img").count();
  const loaded = await page.locator(".leaflet-tile-pane img").evaluateAll((imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 8).length);
  const pct = await page.locator("p").filter({ hasText: /^\d+%$/ }).first().innerText();
  const zoomCount = await page.evaluate(() => window.__zoomEvents || 0);
  const hud = await page.locator("text=km/h").count();
  const mounted = Date.now() - t0;

  if (tiles < 4) faults.push(`loop ${i}: only ${tiles} tiles`);
  if (loaded < 3) faults.push(`loop ${i}: loaded tiles ${loaded}`);
  if (!hud) faults.push(`loop ${i}: speed HUD missing`);
  if (zoomCount > 12) faults.push(`loop ${i}: zoom hunted ${zoomCount} times`);
  if (errors.some((e) => /Leaflet|undefined|removeLayer/i.test(e))) faults.push(`loop ${i}: ${errors[0]}`);

  notes.push(`loop ${i}: ${mounted}ms tiles=${loaded}/${tiles} zoomEvents=${zoomCount} pct=${pct} err=${errors.length}`);
  await page.close();
}

for (let i = 1; i <= loops; i++) await oneLoop(i);
await browser.close();
console.log(JSON.stringify({ ok: faults.length === 0, faults, notes }, null, 2));
if (faults.length) process.exit(1);
