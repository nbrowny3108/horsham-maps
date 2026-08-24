#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(root, "scripts", "data-pack");
const manifestPath = join(packDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.log("no data pack — skip");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const parts = [];
for (let i = 0; i < manifest.parts; i++) {
  const p = join(packDir, `part-${String(i).padStart(2, "0")}.b64`);
  if (!existsSync(p)) {
    console.log("data pack incomplete — skip");
    process.exit(0);
  }
  parts.push(readFileSync(p, "utf8").trim());
}

const archive = join(root, ".inflate-data.tar.gz");
writeFileSync(archive, Buffer.from(parts.join(""), "base64"));
execFileSync("tar", ["-xzf", archive, "-C", root], { stdio: "inherit" });
unlinkSync(archive);
console.log("inflated map data", manifest.archive_bytes, "bytes from", manifest.parts, "parts");
