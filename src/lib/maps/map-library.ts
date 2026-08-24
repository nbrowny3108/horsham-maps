import { DATA_CACHE } from "./app-cache";
import { TILE_CACHE, saveOfflinePack, type OfflineProgress } from "./offline";

export type LibraryFile = {
  id: string;
  name: string;
  group: "Roads" | "Photos" | "Council";
  detail: string;
  bytes: number;
  count: number;
  saved: boolean;
  url?: string;
  filename?: string;
};

const DATA_ITEMS: { id: string; name: string; group: LibraryFile["group"]; url: string; filename: string }[] = [
  { id: "roads-major", name: "Main roads", group: "Roads", url: "/data/roads-major.geojson", filename: "horsham-main-roads.geojson" },
  { id: "roads", name: "All roads", group: "Roads", url: "/data/roads.geojson", filename: "horsham-all-roads.geojson" },
  { id: "chunks", name: "Local road packs", group: "Roads", url: "/data/roads/index.json", filename: "horsham-road-packs.json" },
  { id: "grading", name: "HRCC grading programme", group: "Council", url: "/data/grading-programme.geojson", filename: "hrcc-grading.geojson" },
  { id: "boundary", name: "Shire boundary", group: "Council", url: "/data/hrcc-boundary.geojson", filename: "hrcc-boundary.geojson" },
  { id: "labels", name: "Road names", group: "Council", url: "/data/road-labels.geojson", filename: "horsham-road-names.geojson" },
  { id: "junctions", name: "Intersections", group: "Council", url: "/data/junctions.geojson", filename: "horsham-intersections.geojson" },
];

function fmtMb(bytes: number): string {
  if (bytes < 10_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function formatLibrarySize(bytes: number): string {
  return fmtMb(bytes);
}

async function hasUrl(cacheName: string, url: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(cacheName);
    return Boolean(await cache.match(url));
  } catch {
    return false;
  }
}

async function countTiles(): Promise<{ vic: number; street: number; sat: number; total: number }> {
  const empty = { vic: 0, street: 0, sat: 0, total: 0 };
  if (typeof caches === "undefined") return empty;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    let vic = 0;
    let street = 0;
    let sat = 0;
    for (const req of keys) {
      const path = new URL(req.url, "https://local").pathname;
      if (path.includes("/api/tiles/vic/")) vic += 1;
      else if (path.includes("/api/tiles/street/")) street += 1;
      else if (path.includes("/api/tiles/sat/")) sat += 1;
    }
    return { vic, street, sat, total: vic + street + sat };
  } catch {
    return empty;
  }
}

export async function storageBudget(): Promise<{ usedMb: number; quotaMb: number }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const used = est?.usage ?? 0;
    const quota = est?.quota ?? 0;
    return { usedMb: used / 1_048_576, quotaMb: quota / 1_048_576 };
  } catch {
    return { usedMb: 0, quotaMb: 0 };
  }
}

export async function listMapLibrary(): Promise<{ files: LibraryFile[]; usedMb: number; quotaMb: number }> {
  const [budget, tiles] = await Promise.all([storageBudget(), countTiles()]);
  const files: LibraryFile[] = [];
  for (const item of DATA_ITEMS) {
    const saved = await hasUrl(DATA_CACHE, item.url);
    files.push({
      id: item.id,
      name: item.name,
      group: item.group,
      detail: saved ? "On this phone" : "Not saved yet",
      bytes: 0,
      count: saved ? 1 : 0,
      saved,
      url: item.url,
      filename: item.filename,
    });
  }
  files.push({
    id: "photos-sat",
    name: "Satellite photos",
    group: "Photos",
    detail: tiles.sat ? `${tiles.sat.toLocaleString("en-AU")} images · ~${fmtMb(tiles.sat * 18_000)}` : "None saved yet",
    bytes: tiles.sat * 18_000,
    count: tiles.sat,
    saved: tiles.sat > 0,
  });
  if (tiles.vic) {
    files.push({
      id: "photos-vic",
      name: "Vicmap aerial (older)",
      group: "Photos",
      detail: `${tiles.vic.toLocaleString("en-AU")} images · ~${fmtMb(tiles.vic * 28_000)}`,
      bytes: tiles.vic * 28_000,
      count: tiles.vic,
      saved: true,
    });
  }
  return { files, usedMb: budget.usedMb, quotaMb: budget.quotaMb };
}

export async function exportLibraryFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not open file");
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || "application/geo+json" });
  const nav = navigator as Navigator & { share?: (data: { files?: File[]; title?: string }) => Promise<void>; canShare?: (data: { files?: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: filename });
    return;
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 4_000);
}

export async function saveMapLibrary(onProgress: (p: OfflineProgress) => void, here?: [number, number] | null): Promise<void> {
  await saveOfflinePack(onProgress, here);
}

export async function clearMapPhotos(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(TILE_CACHE);
  await caches.open(TILE_CACHE);
}

export async function quotaAllowsMore(): Promise<boolean> {
  const { usedMb, quotaMb } = await storageBudget();
  if (quotaMb <= 0) return true;
  return usedMb / quotaMb < 0.82 && usedMb < 380;
}
