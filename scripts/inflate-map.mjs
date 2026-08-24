#!/usr/bin/env node
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPacked(rel) {
  const parts = [join(root, `${rel}.p1`), join(root, `${rel}.p2`)];
  if (parts.every((p) => existsSync(p))) {
    return parts.map((p) => readFileSync(p, "utf8").trim()).join("");
  }
  const single = join(root, rel);
  if (existsSync(single)) return readFileSync(single, "utf8").trim();
  return null;
}

const files = [
  ["src/components/map-chrome.tsx", "scripts/map-chrome.tsx.gz.b64"],
  ["src/components/map-app.tsx", "scripts/map-app.tsx.gz.b64"],
  ["src/components/map-boot.ts", "scripts/map-boot.ts.gz.b64"],
];
for (const [outRel, inRel] of files) {
  const dest = join(root, outRel);
  const packed = readPacked(inRel);
  if (!packed) continue;
  if (existsSync(dest) && readFileSync(dest).length > 1000) {
    console.log("keep existing", outRel);
    continue;
  }
  const buf = gunzipSync(Buffer.from(packed, "base64"));
  writeFileSync(dest, buf);
  console.log("inflated", outRel, buf.length, "bytes");
}

const data = spawnSync(process.execPath, [join(root, "scripts", "inflate-data.mjs")], { stdio: "inherit" });
if (data.status && data.status !== 0) process.exit(data.status);
