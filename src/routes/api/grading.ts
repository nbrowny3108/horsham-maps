import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

const PUBLIC_JSON = [
  {
    program: "26-27 Grading Programme",
    url: "https://connect.pozi.com/userdata/horsham-publisher/Community/26-27_Grading_Programme.json",
  },
  {
    program: "27-28 Grading Programme",
    url: "https://connect.pozi.com/userdata/horsham-publisher/Community/27-28_Grading_Programme.json",
  },
];

type Feat = { type: string; properties?: Record<string, unknown>; geometry?: unknown };

async function cachedProgramme() {
  const raw = await readFile(join(process.cwd(), "public/data/grading-programme.geojson"), "utf8");
  return JSON.parse(raw) as { type: string; features: Feat[] };
}

function pack(features: Feat[], source: "pozi" | "cache", note: string) {
  const programs = [...new Set(features.map((f) => String(f.properties?.program ?? "")).filter(Boolean))];
  return { type: "FeatureCollection", source, note, programs, features };
}

function asJson(buf: Buffer): { features?: Feat[] } {
  const body = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  return JSON.parse(body.toString("utf8")) as { features?: Feat[] };
}

async function fetchLive(): Promise<Feat[]> {
  const packs = await Promise.all(
    PUBLIC_JSON.map(async (row) => {
      const res = await fetch(row.url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Pozi ${row.program} ${res.status}`);
      const data = asJson(Buffer.from(await res.arrayBuffer()));
      return (data.features ?? []).map((f) => ({
        ...f,
        properties: { ...(f.properties ?? {}), program: String(f.properties?.program || row.program) },
      }));
    }),
  );
  return packs.flat();
}

let memo: { at: number; body: ReturnType<typeof pack> } | null = null;

export const Route = createFileRoute("/api/grading")({
  server: {
    handlers: {
      GET: async () => {
        const headers = { "content-type": "application/json", "cache-control": "public, max-age=900" };
        if (memo && Date.now() - memo.at < 15 * 60_000) {
          return Response.json(memo.body, { headers });
        }
        const cached = await cachedProgramme();
        const fallback = pack(cached.features, "cache", "Saved public Pozi extract · 26–27 and 27–28 grading programmes");
        if (!memo) memo = { at: Date.now(), body: fallback };
        void fetchLive()
          .then((features) => {
            if (features.length < 50) return;
            memo = {
              at: Date.now(),
              body: pack(
                features,
                "pozi",
                `Live public Horsham Pozi · ${features.length.toLocaleString("en-AU")} jobs · 26–27 and 27–28`,
              ),
            };
          })
          .catch(() => {});
        return Response.json(memo.body, { headers });
      },
    },
  },
});
