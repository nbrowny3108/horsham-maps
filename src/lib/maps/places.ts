import { type NominatimHit, type Place } from "./types";
import { fetchWithBackoff } from "./backoff";

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

export async function searchPlaces(query: string): Promise<NominatimHit[]> {
  const url = `/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetchWithBackoff(url, { headers: { Accept: "application/json" } }, { retries: 2, baseMs: 500, maxMs: 4000, timeoutMs: 12000 });
  if (res.status === 429) throw new RateLimitError(readRetryAfter(res));
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (data && typeof data === "object" && (data as { error?: string }).error === "rate_limited") {
      throw new RateLimitError(Number((data as { retryAfter?: number }).retryAfter) || 20);
    }
    throw new Error("Search failed");
  }
  if (!Array.isArray(data)) throw new Error("Search failed");
  return data as NominatimHit[];
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
