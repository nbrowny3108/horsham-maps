#!/usr/bin/env python3
"""Build public/data/sealed-roads.geojson from Vicmap Transport TR_ROAD.

Authoritative sealed centreline for Horsham Rural City: road_seal = 1
(sealed), feature types road/bridge/connector/tunnel/ford, class 0–6.
Clipped to the HRCC boundary. Unsealed, natural, and unknown seals are omitted.

Requires: shapely
Source: https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Transport/FeatureServer/1
Licence: Creative Commons Attribution 4.0 (Department of Transport and Planning).
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import LineString, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "sealed-roads.geojson"
BOUNDARY = ROOT / "public" / "data" / "hrcc-boundary.geojson"
QUERY = (
    "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/"
    "Vicmap_Transport/FeatureServer/1/query"
)
WHERE = (
    "road_seal='1' AND feature_type_code IN ('road','bridge','connector','tunnel','ford') "
    "AND class_code<=6"
)
HIGHWAY = {
    0: "motorway",
    1: "trunk",
    2: "primary",
    3: "secondary",
    4: "tertiary",
    5: "unclassified",
    6: "unclassified",
}


def title_road(raw: str) -> str:
    text = (raw or "").strip()
    if not text or text.upper() == "UNNAMED":
        return ""

    def piece(part: str) -> str:
        if not part:
            return part
        if part.startswith("MC") and len(part) > 2:
            return "Mc" + part[2:].capitalize()
        if "'" in part:
            return "'".join(p.capitalize() for p in part.split("'"))
        return part.capitalize()

    def word(token: str) -> str:
        return "-".join(piece(p) for p in token.split("-"))

    return " ".join(word(w) for w in text.split())


def km_of(coords: list) -> float:
    total = 0.0
    for i in range(1, len(coords)):
        a, b = coords[i - 1], coords[i]
        total += (((b[1] - a[1]) * 111.32) ** 2 + ((b[0] - a[0]) * 89.2) ** 2) ** 0.5
    return total


def r5(n: float) -> float:
    return round(float(n), 5)


def slim_line(line: LineString) -> list | None:
    simple = line.simplify(0.00004, preserve_topology=True)
    if simple.geom_type != "LineString":
        return None
    coords = []
    prev = None
    for x, y, *_ in simple.coords:
        pt = [r5(x), r5(y)]
        if pt == prev:
            continue
        coords.append(pt)
        prev = pt
    if len(coords) < 2 or km_of(coords) < 0.004:
        return None
    return coords


def fetch_vicmap() -> list:
    geom = json.dumps(
        {"xmin": 141.55, "ymin": -37.30, "xmax": 142.70, "ymax": -36.35, "spatialReference": {"wkid": 4326}}
    )
    features = []
    offset = 0
    page = 2000
    while True:
        params = {
            "where": WHERE,
            "geometry": geom,
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "ezi_road_name,class_code,feature_type_code,route_no",
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "5",
            "maxAllowableOffset": "0.00004",
            "orderByFields": "OBJECTID",
            "resultOffset": str(offset),
            "resultRecordCount": str(page),
            "f": "geojson",
        }
        url = QUERY + "?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=120) as res:
            data = json.load(res)
        if data.get("error"):
            raise SystemExit(data["error"])
        batch = data.get("features") or []
        features.extend(batch)
        print(f"fetched {len(features)}", flush=True)
        if len(batch) < page:
            break
        offset += page
    return features


def lines_of(geom):
    if geom.is_empty:
        return
    if geom.geom_type == "LineString":
        yield geom
    elif geom.geom_type == "MultiLineString":
        yield from geom.geoms
    elif geom.geom_type == "GeometryCollection":
        for part in geom.geoms:
            yield from lines_of(part)


def main() -> None:
    boundary = shape(json.loads(BOUNDARY.read_text())["features"][0]["geometry"]).buffer(0.00025)
    raw = fetch_vicmap()
    out = []
    seen = set()
    km = 0.0
    for feat in raw:
        geom = shape(feat["geometry"]).intersection(boundary)
        props = feat.get("properties") or {}
        cls = int(props.get("class_code") or 5)
        name = title_road(str(props.get("ezi_road_name") or ""))
        highway = HIGHWAY.get(cls, "unclassified")
        ref = str(props.get("route_no") or "").strip()
        for line in lines_of(geom):
            coords = slim_line(line)
            if not coords:
                continue
            key = (coords[0][0], coords[0][1], coords[-1][0], coords[-1][1], len(coords))
            if key in seen:
                continue
            seen.add(key)
            row = {"name": name, "class": cls, "surf": 0, "highway": highway}
            if ref and ref.lower() != "none":
                row["ref"] = ref
            out.append(
                {
                    "type": "Feature",
                    "properties": row,
                    "geometry": {"type": "LineString", "coordinates": coords},
                }
            )
            km += km_of(coords)
    collection = {
        "type": "FeatureCollection",
        "name": "HRCC sealed roads",
        "source": "Vicmap Transport TR_ROAD road_seal=1, clipped to Horsham Rural City",
        "features": out,
    }
    text = json.dumps(collection, separators=(",", ":"))
    OUT.write_text(text)
    print({"features": len(out), "km": round(km, 1), "bytes": len(text)})


if __name__ == "__main__":
    main()
