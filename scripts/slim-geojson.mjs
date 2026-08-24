#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function r5(n) {
  return Math.round(Number(n) * 1e5) / 1e5;
}

function slimCoords(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return coords;
  if (typeof coords[0] === "number") return coords.map(r5);
  const out = [];
  let px;
  let py;
  for (const pt of coords) {
    if (!Array.isArray(pt)) {
      out.push(slimCoords(pt));
      continue;
    }
    if (typeof pt[0] === "number") {
      const x = r5(pt[0]);
      const y = r5(pt[1]);
      if (x === px && y === py) continue;
      out.push([x, y]);
      px = x;
      py = y;
    } else {
      out.push(slimCoords(pt));
    }
  }
  return out.length ? out : coords;
}

function slimGeom(geom) {
  if (!geom) return geom;
  if (geom.coordinates) return { type: geom.type, coordinates: slimCoords(geom.coordinates) };
  return geom;
}

function slimProps(p, kind) {
  if (!p) return p;
  if (kind === "road") {
    const next = { name: p.name || "", class: Number(p.class ?? 5), surf: Number(p.surf ?? 0), highway: p.highway || "" };
    if (p.ref) next.ref = p.ref;
    return next;
  }
  return p;
}

function slimFile(path, kind) {
  const before = readFileSync(path);
  const data = JSON.parse(before.toString("utf8"));
  if (Array.isArray(data.features)) {
    data.features = data.features.map((f) => ({
      type: "Feature",
      properties: slimProps(f.properties, kind),
      geometry: slimGeom(f.geometry),
    }));
  }
  const json = JSON.stringify(data);
  writeFileSync(path, json);
  console.log(path, before.length, "→", json.length, `(${Math.round((100 * json.length) / before.length)}%)`);
}

slimFile("/workspace/public/data/roads.geojson", "road");
slimFile("/workspace/public/data/hrcc-boundary.geojson", "other");
slimFile("/workspace/public/data/road-labels.geojson", "other");
slimFile("/workspace/public/data/junctions.geojson", "other");
slimFile("/workspace/public/data/grading-programme.geojson", "other");
slimFile("/workspace/public/data/vic-arterials.geojson", "other");
