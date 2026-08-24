#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const url = "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: -36.717, longitude: 142.2, accuracy: 8 },
  permissions: ["geolocation"],
});

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  try {
    localStorage.setItem("horsham-maps-sensors", "1");
  } catch {
    /* ignore */
  }
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);

await page.getByLabel("Search address").click({ timeout: 8000 }).catch(async () => {
  await page.getByRole("button", { name: /search/i }).click();
});
await page.waitForTimeout(400);
const input = page.locator("#place-search");
await input.waitFor({ state: "visible", timeout: 8000 });
await input.fill("30 Murray Street Horsham");
await page.waitForTimeout(2500);

const hit = page.locator("button").filter({ hasText: /Murray/i }).first();
if (await hit.count()) {
  await hit.click();
} else {
  await input.press("Enter");
}

await page.waitForTimeout(800);
const go = page.getByRole("button", { name: /^Go/i }).first();
if (await go.count()) await go.click();
await page.waitForTimeout(6000);

const shot = "/workspace/screenshots/route-visibility.png";
await page.screenshot({ path: shot, fullPage: false });

const report = await page.evaluate(() => {
  const footer = document.querySelector("footer");
  const footerBox = footer?.getBoundingClientRect();
  const routeBtns = [...document.querySelectorAll("button")].filter((b) => {
    const t = (b.textContent || "").toLowerCase();
    return t.includes("min") && (t.includes("km") || t.includes("via") || t.includes("hwy") || t.includes("alt") || t.includes("fast") || t.includes("main"));
  });
  const zoom = document.querySelector(".leaflet-control-zoom");
  const hud = [...document.querySelectorAll("p")].find((p) => (p.textContent || "").includes("km/h"));
  const boxes = routeBtns.map((b) => {
    const r = b.getBoundingClientRect();
    return { text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60), top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
  });
  const zoomBox = zoom?.getBoundingClientRect();
  const hudBox = hud?.closest("div")?.getBoundingClientRect();
  const overlapFooter = (r) =>
    footerBox ? r.bottom > footerBox.top + 2 && r.top < footerBox.bottom - 2 && r.right > footerBox.left && r.left < footerBox.right : false;
  return {
    vh: window.innerHeight,
    vw: window.innerWidth,
    footer: footerBox ? { top: footerBox.top, bottom: footerBox.bottom, left: footerBox.left, right: footerBox.right } : null,
    zoom: zoomBox ? { top: zoomBox.top, bottom: zoomBox.bottom, left: zoomBox.left, right: zoomBox.right } : null,
    hud: hudBox ? { top: hudBox.top, bottom: hudBox.bottom } : null,
    routes: boxes,
    routeUnderToolbar: boxes.some(overlapFooter),
    zoomUnderToolbar: zoomBox && footerBox ? overlapFooter({ top: zoomBox.top, bottom: zoomBox.bottom, left: zoomBox.left, right: zoomBox.right }) : false,
    place: document.querySelector("section")?.textContent?.slice(0, 120) || "",
  };
});

writeFileSync("/workspace/screenshots/route-visibility.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("screenshot", shot);
await browser.close();

if (!report.routes.length) {
  console.error("FAIL: no route choice buttons found");
  process.exit(2);
}
if (report.routeUnderToolbar) {
  console.error("FAIL: route buttons overlap toolbar");
  process.exit(3);
}
if (report.zoomUnderToolbar) {
  console.error("FAIL: zoom control overlaps toolbar");
  process.exit(4);
}
console.log("PASS: route choices visible above toolbar");
