import RBush from "rbush";
import CheapRuler from "cheap-ruler";
import { sameRoadName } from "./style";
import { HORSHAM_CENTER } from "./types";

export type RoadSnap = { name: string; lat: number; lng: number; brg: number };
export type JunctionSnap = { lat: number; lng: number; roads: { name: string; cls: number }[] };

type Seg = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  name: string;
  a: [number, number];
  b: [number, number];
};

const ruler = new CheapRuler(HORSHAM_CENTER[0], "metres");

function headingDelta(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(d, 180 - d);
}

function boxAround(lng: number, lat: number, metres: number) {
  const sw = ruler.offset([lng, lat], -metres, -metres);
  const ne = ruler.offset([lng, lat], metres, metres);
  return {
    minX: Math.min(sw[0], ne[0]),
    minY: Math.min(sw[1], ne[1]),
    maxX: Math.max(sw[0], ne[0]),
    maxY: Math.max(sw[1], ne[1]),
  };
}

export class RoadIndex {
  private tree = new RBush<Seg>(9);

  addLine(name: string, coords: [number, number][]): void {
    if (!name || coords.length < 2) return;
    const items: Seg[] = [];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      if (!a || !b) continue;
      items.push({
        minX: Math.min(a[0], b[0]),
        minY: Math.min(a[1], b[1]),
        maxX: Math.max(a[0], b[0]),
        maxY: Math.max(a[1], b[1]),
        name,
        a,
        b,
      });
    }
    if (items.length) this.tree.load(items);
  }

  nearest(lat: number, lng: number, heading: number, maxM: number): { lat: number; lng: number; name: string; metres: number } | null {
    const hits = this.tree.search(boxAround(lng, lat, maxM));
    let best: { lat: number; lng: number; name: string; metres: number } | null = null;
    let bestScore = 1e9;
    const here: [number, number] = [lng, lat];
    for (const s of hits) {
      const on = ruler.pointOnLine([s.a, s.b], here);
      const metres = on.dist;
      if (metres > maxM) continue;
      const brg = ruler.bearing(s.a, s.b);
      const score = metres + headingDelta(brg, heading) * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = { lat: on.point[1], lng: on.point[0], name: s.name, metres };
      }
    }
    return best;
  }
}

export function snapCurrentRoad(snaps: RoadSnap[], here: [number, number], heading: number, roads?: RoadIndex): string {
  const hit = roads?.nearest(here[0], here[1], heading, 90);
  if (hit) return hit.name;
  let best = "";
  let bestScore = 1e9;
  for (const s of snaps) {
    const metres = ruler.distance([here[1], here[0]], [s.lng, s.lat]);
    if (metres > 90) continue;
    const score = metres + headingDelta(s.brg, heading) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = s.name;
    }
  }
  return best;
}

export function snapNextRoad(junctions: JunctionSnap[], on: string, here: [number, number], heading: number): string {
  if (!on) return "";
  let cross = "";
  let crossScore = 1e9;
  for (const j of junctions) {
    const others = j.roads.filter((r) => !sameRoadName(r.name, on));
    if (others.length === j.roads.length || others.length === 0) continue;
    const side = [...others].sort((a, b) => a.cls - b.cls)[0]?.name;
    if (!side) continue;
    const metres = ruler.distance([here[1], here[0]], [j.lng, j.lat]);
    if (metres < 40 || metres > 3200) continue;
    const brg = ruler.bearing([here[1], here[0]], [j.lng, j.lat]);
    const off = headingDelta(brg, heading);
    if (off > 95) continue;
    const score = metres + off * 4;
    if (score < crossScore) {
      crossScore = score;
      cross = side;
    }
  }
  return cross;
}

/** Project the puck onto the nearest local road segment (≤40 m, heading-aligned). */
export function snapPuckToRoad(
  snaps: RoadSnap[],
  here: [number, number],
  heading: number,
  roads?: RoadIndex,
): [number, number] | null {
  const hit = roads?.nearest(here[0], here[1], heading, 40);
  if (hit) return [hit.lat, hit.lng];
  if (snaps.length < 2) return null;
  let bestLat = here[0];
  let bestLng = here[1];
  let bestScore = 1e9;
  const p: [number, number] = [here[1], here[0]];
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1];
    const b = snaps[i];
    if (!a || !b || a.name !== b.name) continue;
    if (headingDelta(a.brg, heading) > 60 && headingDelta(b.brg, heading) > 60) continue;
    const on = ruler.pointOnLine(
      [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
      p,
    );
    const metres = ruler.distance(p, on.point);
    if (metres > 40) continue;
    const score = metres + headingDelta(a.brg, heading) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      bestLat = on.point[1];
      bestLng = on.point[0];
    }
  }
  return bestScore < 1e9 ? [bestLat, bestLng] : null;
}