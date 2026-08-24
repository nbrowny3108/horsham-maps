import { createFileRoute } from "@tanstack/react-router";
import { fetchWithBackoff } from "@/lib/maps/backoff";

const VIEWBOX = "141.55,-36.38,142.65,-37.28";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "HorshamMaps/1.0 (HRCC grader navigation)",
};

function retryAfter(res: Response, fallback = 20): number {
  const raw = res.headers.get("retry-after");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(120, Math.round(n)) : fallback;
}

function limited(seconds: number) {
  return new Response(JSON.stringify({ error: "rate_limited", retryAfter: seconds }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(seconds),
      "cache-control": "no-store",
    },
  });
}

async function nominatim(dest: string): Promise<Response> {
  return fetchWithBackoff(dest, { headers: HEADERS }, { retries: 3, baseMs: 400, maxMs: 4000, timeoutMs: 10000 });
}

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const q = u.searchParams.get("q") ?? "";
        const lat = u.searchParams.get("lat");
        const lon = u.searchParams.get("lon");
        if (!lat && !lon && q.trim().length < 3) {
          return new Response("[]", { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
        }
        const dest =
          lat && lon
            ? `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`
            : `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=au&q=${encodeURIComponent(q)}&viewbox=${VIEWBOX}&bounded=0`;
        try {
          const res = await nominatim(dest);
          if (res.status === 429) return limited(retryAfter(res));
          const body = await res.text();
          if (body.trimStart().startsWith("<")) return limited(25);
          return new Response(body, {
            status: res.status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": res.ok ? "public, max-age=120" : "no-store",
            },
          });
        } catch {
          return new Response(JSON.stringify({ error: "search_failed" }), {
            status: 502,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
