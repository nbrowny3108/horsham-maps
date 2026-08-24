#!/usr/bin/env node
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["src/components/map-chrome.tsx", "scripts/map-chrome.tsx.gz.b64"],
  ["src/components/map-app.tsx", "scripts/map-app.tsx.gz.b64"],
  ["src/components/map-boot.ts", "scripts/map-boot.ts.gz.b64"],
];
for (const [outRel, inRel] of files) {
  const dest = join(root, outRel);
  const src = join(root, inRel);
  if (!existsSync(src)) continue;
  if (existsSync(dest) && readFileSync(dest).length > 1000) {
    console.log("keep existing", outRel);
    continue;
  }
  const buf = gunzipSync(Buffer.from(readFileSync(src, "utf8"), "base64"));
  writeFileSync(dest, buf);
  console.log("inflated", outRel, buf.length, "bytes");
}

const data = spawnSync(process.execPath, [join(root, "scripts", "inflate-data.mjs")], { stdio: "inherit" });
if (data.status && data.status !== 0) process.exit(data.status);
