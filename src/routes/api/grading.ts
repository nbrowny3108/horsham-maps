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

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Map live Pozi fields. Do not rely on flattened name/locality. */
export function normalizeGradingProps(raw: Record<string, unknown> | undefined, program: string): Record<string, unknown> {
  const p = raw ?? {};
  const name = str(p.Road_name || p.name);
  const from = str(p.From || p.locality);
  const to = str(p.To || p.to);
  const zone = str(p.Grading_re || p.zone);
  const length = num(p.Length_m ?? p.Length__m ?? p.length_m);
  return {
    ...p,
    Road_name: name,
    name,
    From: from,
    To: to,
    Grading_re: zone,
    Length_m: length,
    Sequence: p.Sequence ?? p.sequence ?? "",
    Asset_id: str(p.Asset_id ?? p.asset),
    program: str(p.program) || program,
  };
}

function normalizeFeat(f: Feat, program: string): Feat {
  return {
    ...f,
    properties: normalizeGradingProps(f.properties, program),
  };
}

async function cachedProgramme(): Promise<Feat[]> {
  const raw = await readFile(join(process.cwd(), "public/data/grading-programme.geojson"), "utf8");
  const data = JSON.parse(raw) as { type: string; features: Feat[] };
  return (data.features ?? []).map((f) => normalizeFeat(f, str(f.properties?.program) || "26-27 Grading Programme"));
}

function pack(features: Feat[], source: "pozi" | "cache", note: string) {
  const programs = [...new Set(features.map((f) => str(f.properties?.program)).filter(Boolean))];
  return { type: "FeatureCollection", source, note, programs, features };
}

function asJson(buf: Buffer): { features?: Feat[] } {
  const body = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  return JSON.parse(body.toString("utf8")) as { features?: Feat[] };
}

async function fetchLive(): Promise<Feat[]> {
  const packs = await Promise.all(
    PUBLIC_JSON.map(async (row) => {
      const res = await fetch(row.url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Pozi ${row.program} ${res.status}`);
      const data = asJson(Buffer.from(await res.arrayBuffer()));
      return (data.features ?? []).map((f) => normalizeFeat(f, row.program));
    }),
  );
  return packs.flat();
}

let memo: { at: number; body: ReturnType<typeof pack> } | null = null;

export const Route = createFileRoute("/api/grading")({
  server: {
    handlers: {
      GET: async () => {
        const headers = { "content-type": "application/json", "cache-control": "public, max-age=300" };
        if (memo && Date.now() - memo.at < 15 * 60_000 && memo.body.source === "pozi") {
          return Response.json(memo.body, { headers });
        }
        try {
          const features = await fetchLive();
          if (features.length >= 50) {
            memo = {
              at: Date.now(),
              body: pack(
                features,
                "pozi",
                `Live public Horsham Pozi · ${features.length.toLocaleString("en-AU")} jobs · 26–27 and 27–28`,
              ),
            };
            return Response.json(memo.body, { headers });
          }
        } catch {
          /* fall through to saved extract */
        }
        const cached = await cachedProgramme();
        const fallback = pack(cached, "cache", "Saved public Pozi extract · 26–27 and 27–28 grading programmes");
        memo = { at: Date.now(), body: fallback };
        return Response.json(fallback, { headers });
      },
    },
  },
});
