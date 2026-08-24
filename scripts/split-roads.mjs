#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CELL = 0.1;
const src = JSON.parse(readFileSync("/workspace/public/data/roads.geojson", "utf8"));
const major = [];
const chunks = new Map();

function cellKey(lng, lat) {
  return `${Math.floor(lng / CELL)}_${Math.floor(lat / CELL)}`;
}

function keysForLine(coords) {
  const keys = new Set();
  for (const [lng, lat] of coords) keys.add(cellKey(lng, lat));
  return keys;
}

for (const f of src.features) {
  const cls = Number(f.properties?.class ?? 5);
  if (cls <= 4) {
    major.push(f);
    continue;
  }
  for (const key of keysForLine(f.geometry.coordinates)) {
    const list = chunks.get(key);
    if (list) list.push(f);
    else chunks.set(key, [f]);
  }
}

mkdirSync("/workspace/public/data/roads", { recursive: true });
const index = { cell: CELL, keys: [...chunks.keys()].sort() };
writeFileSync("/workspace/public/data/roads-major.geojson", JSON.stringify({ type: "FeatureCollection", features: major }));
writeFileSync("/workspace/public/data/roads/index.json", JSON.stringify(index));
for (const [key, features] of chunks) {
  writeFileSync(`/workspace/public/data/roads/${key}.json`, JSON.stringify({ type: "FeatureCollection", features }));
}

const majorBytes = JSON.stringify({ type: "FeatureCollection", features: major }).length;
let chunkBytes = 0;
for (const features of chunks.values()) chunkBytes += JSON.stringify({ type: "FeatureCollection", features }).length;
console.log({
  major: major.length,
  chunks: chunks.size,
  minorFeatures: src.features.length - major.length,
  majorKB: Math.round(majorBytes / 1024),
  chunksKB: Math.round(chunkBytes / 1024),
});
