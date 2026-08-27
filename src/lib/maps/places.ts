import { HORSHAM_CENTER, type NominatimHit, type Place } from "./types";
import { fetchWithBackoff } from "./backoff";
import { cachedJson } from "./app-cache";

function stripCountry(name: string): string {
  return name
    .replace(/, Victoria,? Australia$/i, "")
    .replace(/, Australia$/i, "")
    .trim();
}

export function placeTitle(displayName: string): string {
  return stripCountry(displayName).split(",").map((p) => p.trim()).filter(Boolean)[0] ?? displayName;
}

export function placeSubtitle(displayName: string): string {
  return (
    stripCountry(displayName)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(1)
      .join(", ") || "Dropped pin"
  );
}

export class RateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter = 20) {
    super("rate_limited");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

function readRetryAfter(res: Response, fallback = 20): number {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? Math.min(120, Math.round(n)) : fallback;
}

const ABBR: Record<string, string> = {
  rd: "road",
  st: "street",
  ave: "avenue",
  av: "avenue",
  hwy: "highway",
  mt: "mount",
  ck: "creek",
  crk: "creek",
  ln: "lane",
  tce: "terrace",
  dr: "drive",
  pl: "place",
  ct: "court",
  cres: "crescent",
  cr: "crescent",
};

export function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBR[t] ?? t);
}

type LocalRow = { name: string; lat: number; lng: number; kind: "road" | "place" };

function wordMatches(word: string, token: string): boolean {
  if (word === token) return true;
  if (word.startsWith(token)) return true;
  if (token.length >= 4 && word.length >= 4 && token.startsWith(word)) return true;
  return false;
}

export function scoreLocalName(query: string, name: string): number {
  const qt = searchTokens(query);
  const words = searchTokens(name);
  if (!qt.length || !words.length) return 0;
  let score = 0;
  for (const q of qt) {
    const idx = words.findIndex((w) => wordMatches(w, q));
    if (idx < 0) return 0;
    score += wExactBonus(words[idx] ?? "", q) + (idx === 0 ? 6 : 3);
  }
  if (words[0] && qt[0] && (words[0] === qt[0] || words[0].startsWith(qt[0]))) score += 12;
  return score;
}

function wExactBonus(word: string, token: string): number {
  return word === token ? 6 : 2;
}

export function matchLocalHits(query: string, rows: LocalRow[], here?: [number, number] | null): NominatimHit[] {
  const q = query.trim();
  if (q.length < 3) return [];
  const origin = here ?? HORSHAM_CENTER;
  const best = new Map<string, { row: LocalRow; score: number; dist: number }>();
  for (const row of rows) {
    const score = scoreLocalName(q, row.name);
    if (score <= 0) continue;
    const dist = Math.hypot((row.lat - origin[0]) * 111.32, (row.lng - origin[1]) * 89.2);
    const key = row.name.toLowerCase();
    const prev = best.get(key);
    if (!prev || score > prev.score || (score === prev.score && dist < prev.dist)) {
      best.set(key, { row, score, dist });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.dist - b.dist)
    .slice(0, 8)
    .map((hit, i) => ({
      place_id: 900_000 + i,
      lat: String(hit.row.lat),
      lon: String(hit.row.lng),
      display_name: `${hit.row.name}, Horsham Rural City`,
    }));
}

let indexPromise: Promise<LocalRow[]> | null = null;

function readPointRows(data: unknown, kind: LocalRow["kind"]): LocalRow[] {
  const feats = (data as { features?: { properties?: { name?: string }; geometry?: { coordinates?: number[] } }[] })?.features ?? [];
  const rows: LocalRow[] = [];
  for (const f of feats) {
    const name = String(f.properties?.name ?? "").trim();
    const n = f.geometry?.coordinates;
    if (!name || !n || n.length < 2) continue;
    const lng = Number(n[0]);
    const lat = Number(n[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.push({ name, lat, lng, kind });
  }
  return rows;
}

async function localIndex(): Promise<LocalRow[]> {
  if (!indexPromise) {
    indexPromise = Promise.all([
      cachedJson("/data/road-labels.geojson").catch(() => null),
      cachedJson("/data/places.geojson").catch(() => null),
    ]).then(([labels, places]) => [...readPointRows(labels, "road"), ...readPointRows(places, "place")]);
  }
  return indexPromise;
}

function mergeHits(local: NominatimHit[], remote: NominatimHit[]): NominatimHit[] {
  const seen = new Set(local.map((h) => placeTitle(h.display_name).toLowerCase()));
  const extra = remote.filter((h) => {
    const title = placeTitle(h.display_name).toLowerCase();
    if (seen.has(title)) return false;
    seen.add(title);
    return true;
  });
  return [...local, ...extra].slice(0, 8);
}

export async function searchPlaces(query: string, here?: [number, number] | null): Promise<NominatimHit[]> {
  const local = matchLocalHits(query, await localIndex(), here);
  const url = `/api/search?q=${encodeURIComponent(query)}`;
  const hasLocal = local.length > 0;
  try {
    const res = await fetchWithBackoff(
      url,
      { headers: { Accept: "application/json" } },
      { retries: hasLocal ? 0 : 2, baseMs: 400, maxMs: 2000, timeoutMs: hasLocal ? 2500 : 12000 },
    );
    if (res.status === 429) {
      if (local.length) return local;
      throw new RateLimitError(readRetryAfter(res));
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (data && typeof data === "object" && (data as { error?: string }).error === "rate_limited") {
        if (local.length) return local;
        throw new RateLimitError(Number((data as { retryAfter?: number }).retryAfter) || 20);
      }
      if (local.length) return local;
      throw new Error("Search failed");
    }
    if (!Array.isArray(data)) {
      if (local.length) return local;
      throw new Error("Search failed");
    }
    return mergeHits(local, data as NominatimHit[]);
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    if (local.length) return local;
    throw err;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  const fallback: Place = {
    lat,
    lng,
    title: "Dropped pin",
    subtitle: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    source: "pin",
  };
  try {
    const url = `/api/search?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`;
    const res = await fetchWithBackoff(url, { headers: { Accept: "application/json" } }, { retries: 2, baseMs: 400, maxMs: 2500, timeoutMs: 8000 });
    if (res.status === 429 || !res.ok) return fallback;
    const data = (await res.json()) as { display_name?: string; error?: string };
    if (!data || data.error || !data.display_name) return fallback;
    const name = data.display_name ?? "Dropped pin";
    return { lat, lng, title: placeTitle(name), subtitle: placeSubtitle(name), source: "pin" };
  } catch {
    return fallback;
  }
}
