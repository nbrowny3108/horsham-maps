import { createFileRoute } from "@tanstack/react-router";
import { fetchWithBackoff } from "@/lib/maps/backoff";

const UPSTREAM = {
  street: (z: string, x: string, y: string) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  sat: (z: string, x: string, y: string) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  vic: (z: string, x: string, y: string) =>
    `https://base.maps.vic.gov.au/service?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=AERIAL_WM_256&STYLE=default&TILEMATRIXSET=EPSG:3857:256&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`,
  vicPng: (z: string, x: string, y: string) =>
    `https://base.maps.vic.gov.au/service?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=AERIAL_WM_256&STYLE=default&TILEMATRIXSET=EPSG:3857:256&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/png`,
};

const CACHE_HEADERS = {
  "cache-control": "public, max-age=31536000, immutable",
  "access-control-allow-origin": "*",
} as const;

const tileMemo = new Map<string, { body: ArrayBuffer; type: string }>();
const TILE_MEMO_MAX = 2400;

function remember(key: string, body: ArrayBuffer, type: string) {
  if (tileMemo.size >= TILE_MEMO_MAX) {
    const first = tileMemo.keys().next().value;
    if (first) tileMemo.delete(first);
  }
  tileMemo.set(key, { body, type });
}

type Grab = { ok: boolean; body: ArrayBuffer; type: string };

async function grab(url: string): Promise<Grab> {
  try {
    const res = await fetchWithBackoff(
      url,
      { headers: { Accept: "image/*" } },
      { retries: 1, baseMs: 200, maxMs: 800, timeoutMs: 6000 },
    );
    if (!res.ok) return { ok: false, body: new ArrayBuffer(0), type: "" };
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return { ok: false, body: new ArrayBuffer(0), type };
    const body = await res.arrayBuffer();
    return { ok: body.byteLength > 32, body, type };
  } catch {
    return { ok: false, body: new ArrayBuffer(0), type: "" };
  }
}

function useful(tile: Grab, min = 6000): boolean {
  return tile.ok && tile.body.byteLength >= min;
}

let vicStreak = 0;

/** One imagery source per tile. Driving zoom (z>16) is Vicmap only. */
async function pickBest(z: string, x: string, y: string): Promise<Grab> {
  const zoom = Number(z);
  if (zoom > 16) {
    const vic = await grab(UPSTREAM.vic(z, x, y));
    if (useful(vic, 4000)) {
      vicStreak += 1;
      return vic;
    }
    const png = await grab(UPSTREAM.vicPng(z, x, y));
    if (useful(png, 4000)) {
      vicStreak += 1;
      return png;
    }
    return vic.ok ? vic : png;
  }

  const esri = await grab(UPSTREAM.sat(z, x, y));
  if (useful(esri)) {
    vicStreak = 0;
    return esri;
  }
  const vic = await grab(UPSTREAM.vic(z, x, y));
  if (useful(vic, 4000)) {
    vicStreak += 1;
    return vic;
  }
  const png = await grab(UPSTREAM.vicPng(z, x, y));
  if (useful(png, 4000)) {
    vicStreak += 1;
    return png;
  }
  return esri;
}

export const Route = createFileRoute("/api/tiles/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).pathname;
        const match = path.match(/^\/api\/tiles\/(street|sat|vic|best)\/(\d+)\/(\d+)\/(\d+)/);
        if (!match) return new Response("not found", { status: 404 });
        const [, kind, z, x, y] = match;
        if (!kind || !z || !x || !y) return new Response("not found", { status: 404 });
        const key = `${kind}/${z}/${x}/${y}`;
        const hit = tileMemo.get(key);
        if (hit) {
          return new Response(hit.body, {
            status: 200,
            headers: { "content-type": hit.type, ...CACHE_HEADERS },
          });
        }
        try {
          let tile: Grab;
          if (kind === "best") {
            tile = await pickBest(z, x, y);
          } else {
            const build = UPSTREAM[kind as "street" | "sat" | "vic"];
            tile = await grab(build(z, x, y));
            if (!tile.ok && kind === "vic") tile = await grab(UPSTREAM.vicPng(z, x, y));
          }
          if (!tile.ok) return new Response("tile error", { status: 502 });
          remember(key, tile.body, tile.type);
          return new Response(tile.body, {
            status: 200,
            headers: { "content-type": tile.type, ...CACHE_HEADERS },
          });
        } catch {
          return new Response("tile error", { status: 502 });
        }
      },
    },
  },
});
