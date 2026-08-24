#!/usr/bin/env node
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["src/components/map-chrome.tsx", "scripts/map-chrome.tsx.gz.b64"],
  ["src/components/map-app.tsx", "scripts/map-app.tsx.gz.b64"],
];
for (const [outRel, inRel] of files) {
  const dest = join(root, outRel);
  const src = join(root, inRel);
  if (!existsSync(src)) continue;
  const buf = gunzipSync(Buffer.from(readFileSync(src, "utf8"), "base64"));
  writeFileSync(dest, buf);
  console.log("inflated", outRel, buf.length, "bytes");
}
