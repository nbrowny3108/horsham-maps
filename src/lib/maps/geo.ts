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

export function nextRouteTurn(
  steps: { instruction: string; lat: number; lng: number }[] | undefined,
  coords: [number, number][],
  lat: number,
  lng: number,
): { instruction: string; km: number } | null {
  if (!coords.length) return null;
  const remainHere = remainingKmAlong(coords, lat, lng);
  if (steps?.length) {
    for (const step of steps) {
      const km = remainHere - remainingKmAlong(coords, step.lat, step.lng);
      if (km > 0.035) return { instruction: step.instruction, km };
    }
    const last = steps[steps.length - 1];
    if (last) return { instruction: last.instruction, km: Math.max(0, remainHere) };
  }
  if (remainHere > 0.05) return { instruction: "Continue", km: remainHere };
  return { instruction: "Arrive", km: Math.max(0, remainHere) };
}

export function nearlySame(a: number, b: number): boolean {
  return Math.abs(a - b) < 1.5e-4;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(3)} km`;
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
