export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function lineMostlyInRing(
  geometry: { type?: string; coordinates?: unknown } | null,
  ring: number[][],
): boolean {
  if (!geometry?.coordinates || ring.length < 3) return false;
  const lines: [number, number][][] =
    geometry.type === "LineString"
      ? [geometry.coordinates as [number, number][]]
      : geometry.type === "MultiLineString"
        ? (geometry.coordinates as [number, number][][])
        : [];
  let inside = 0;
  let total = 0;
  for (const line of lines) {
    for (const pt of line) {
      total += 1;
      if (pointInRing(pt[1] ?? 0, pt[0] ?? 0, ring)) inside += 1;
    }
  }
  return total > 0 && inside * 2 >= total;
}

export function lineLengthKm(geometry: { type?: string; coordinates?: unknown } | null): number {
  if (!geometry?.coordinates) return 0;
  const lines: [number, number][][] =
    geometry.type === "LineString"
      ? [geometry.coordinates as [number, number][]]
      : geometry.type === "MultiLineString"
        ? (geometry.coordinates as [number, number][][])
        : [];
  let km = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      km += haversineKm([a[1], a[0]], [b[1], b[0]]);
    }
  }
  return km;
}

export function lineMidpoint(geometry: { type?: string; coordinates?: unknown } | null): [number, number] | null {
  if (!geometry?.coordinates) return null;
  if (geometry.type === "LineString") {
    const coords = geometry.coordinates as [number, number][];
    return coords[Math.floor(coords.length / 2)] ?? null;
  }
  if (geometry.type === "MultiLineString") {
    const first = (geometry.coordinates as [number, number][][])[0];
    return first ? (first[Math.floor(first.length / 2)] ?? null) : null;
  }
  return null;
}

function closestOnSegment(
  a: [number, number],
  b: [number, number],
  p: [number, number],
): { point: [number, number]; t: number; dist: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { point: a, t: 0, dist: haversineKm(p, a) };
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const point: [number, number] = [a[0] + t * dx, a[1] + t * dy];
  return { point, t, dist: haversineKm(p, point) };
}

export function remainingKmAlong(coords: [number, number][], lat: number, lng: number): number {
  if (coords.length < 2) return 0;
  const p: [number, number] = [lat, lng];
  let best = { i: 0, t: 0, dist: Infinity, point: coords[0]! };
  for (let i = 0; i < coords.length - 1; i++) {
    const hit = closestOnSegment(coords[i]!, coords[i + 1]!, p);
    if (hit.dist < best.dist) best = { i, t: hit.t, dist: hit.dist, point: hit.point };
  }
  let remain = haversineKm(best.point, coords[best.i + 1]!);
  for (let i = best.i + 1; i < coords.length - 1; i++) {
    remain += haversineKm(coords[i]!, coords[i + 1]!);
  }
  return remain;
}

export function nearlySame(a: number, b: number): boolean {
  return Math.abs(a - b) < 1.5e-4;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatEta(durationMin: number, from = new Date()): string {
  return new Date(from.getTime() + durationMin * 60_000).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** west, south, east, north in lon/lat */
export type LonLatBBox = [number, number, number, number];

export function geomBBox(geometry: { type?: string; coordinates?: unknown } | null): LonLatBBox | null {
  if (!geometry?.coordinates) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const eat = (pt: unknown) => {
    if (!Array.isArray(pt) || pt.length < 2) return;
    if (typeof pt[0] === "number" && typeof pt[1] === "number") {
      const lng = pt[0];
      const lat = pt[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of pt) eat(child);
  };
  eat(geometry.coordinates);
  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function bboxOverlaps(
  bbox: LonLatBBox | null,
  west: number,
  south: number,
  east: number,
  north: number,
): boolean {
  if (!bbox) return false;
  return bbox[0] <= east && bbox[2] >= west && bbox[1] <= north && bbox[3] >= south;
}

export const CORRIDOR_AHEAD_KM = 10;
export const CORRIDOR_SIDE_KM = 1.5;
export const CORRIDOR_BEHIND_KM = 0.5;

function lineCoords(geometry: { type?: string; coordinates?: unknown } | null): [number, number][][] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "LineString") return [geometry.coordinates as [number, number][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as [number, number][][];
  return [];
}

function toTrack(
  lat: number,
  lng: number,
  oLat: number,
  oLng: number,
  cosH: number,
  sinH: number,
): { along: number; across: number } {
  const dLatKm = (lat - oLat) * 111.32;
  const dLngKm = (lng - oLng) * 89.2;
  return { along: dLatKm * cosH + dLngKm * sinH, across: -dLatKm * sinH + dLngKm * cosH };
}

/** Liang–Barsky: does the along/across segment hit the heading rectangle? */
function segmentHitsCorridor(
  aAlong: number,
  aAcross: number,
  bAlong: number,
  bAcross: number,
  aheadKm: number,
  behindKm: number,
  sideKm: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bAlong - aAlong;
  const dy = bAcross - aAcross;
  const tests: [number, number][] = [
    [-dx, aAlong + behindKm],
    [dx, aheadKm - aAlong],
    [-dy, aAcross + sideKm],
    [dy, sideKm - aAcross],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-15) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/**
 * True if a linestring hits the oriented heading corridor
 * (~10 km ahead, ~1.5 km each side, ~0.5 km behind) — not a fat AABB around puck+tip.
 */
export function geomHitsHeadingCorridor(
  geometry: { type?: string; coordinates?: unknown } | null,
  bbox: LonLatBBox | null,
  originLat: number,
  originLng: number,
  headingDeg: number,
  aheadKm = CORRIDOR_AHEAD_KM,
  sideKm = CORRIDOR_SIDE_KM,
  behindKm = CORRIDOR_BEHIND_KM,
): boolean {
  const rad = (headingDeg * Math.PI) / 180;
  const cosH = Math.cos(rad);
  const sinH = Math.sin(rad);
  const corners: [number, number][] = [];
  for (const along of [-behindKm, aheadKm]) {
    for (const across of [-sideKm, sideKm]) {
      const dLatKm = along * cosH - across * sinH;
      const dLngKm = along * sinH + across * cosH;
      corners.push([originLat + dLatKm / 111.32, originLng + dLngKm / 89.2]);
    }
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lat, lng] of corners) {
    if (lng < west) west = lng;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lat > north) north = lat;
  }
  if (!bboxOverlaps(bbox, west, south, east, north)) return false;
  const lines = lineCoords(geometry);
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      const pa = toTrack(a[1], a[0], originLat, originLng, cosH, sinH);
      const pb = toTrack(b[1], b[0], originLat, originLng, cosH, sinH);
      if (segmentHitsCorridor(pa.along, pa.across, pb.along, pb.across, aheadKm, behindKm, sideKm)) return true;
    }
    if (line.length === 1 && line[0]) {
      const p = toTrack(line[0][1], line[0][0], originLat, originLng, cosH, sinH);
      if (p.along >= -behindKm && p.along <= aheadKm && Math.abs(p.across) <= sideKm) return true;
    }
  }
  return false;
}
