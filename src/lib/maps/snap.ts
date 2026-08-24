import { sameRoadName } from "./style";

export type RoadSnap = { name: string; lat: number; lng: number; brg: number };
export type JunctionSnap = { lat: number; lng: number; roads: { name: string; cls: number }[] };

export function snapCurrentRoad(snaps: RoadSnap[], here: [number, number], heading: number): string {
  let best = "";
  let bestScore = 1e9;
  for (const s of snaps) {
    const km = Math.hypot((s.lat - here[0]) * 111.32, (s.lng - here[1]) * 89.2);
    if (km > 0.09) continue;
    const d = Math.abs(((s.brg - heading + 540) % 360) - 180);
    const align = Math.min(d, 180 - d);
    const score = km * 16 + align / 110;
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
    const km = Math.hypot((j.lat - here[0]) * 111.32, (j.lng - here[1]) * 89.2);
    if (km < 0.04 || km > 3.2) continue;
    const dLng = ((j.lng - here[1]) * Math.PI) / 180;
    const lat1 = (here[0] * Math.PI) / 180;
    const lat2 = (j.lat * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const brg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const off = Math.abs(((brg - heading + 540) % 360) - 180);
    if (off > 95) continue;
    const score = km + off / 250;
    if (score < crossScore) {
      crossScore = score;
      cross = side;
    }
  }
  return cross;
}
