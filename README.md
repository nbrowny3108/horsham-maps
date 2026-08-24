# Horsham Maps

Private repo: https://github.com/nbrowny3108/horsham-maps

Field GPS map for Horsham Rural City Council grader operators.

- Heading-up driving HUD
- Hybrid satellite (Esri / Vicmap)
- HRCC Pozi grading overlay
- Speed-adaptive zoom, trip meter, current road / next intersection
- Offline satellite download for 80–90% driving zoom

## Run

```bash
git clone https://github.com/nbrowny3108/horsham-maps.git
cd horsham-maps
npm install
npm run dev
```

`npm install` restores `src/components/map-app.tsx` and `map-chrome.tsx` from the compressed copies in git (`node scripts/inflate-map.mjs`).

iPhone: add to Home Screen from the preview URL.

## Stack

TanStack Start, Vite, Leaflet, service worker cache.

## Data notes

Road overlay tiles live in `public/data/roads/*.json`. A few large tiles and the full `roads.geojson` / `road-labels.geojson` / `junctions.geojson` extracts are too big for this GitHub upload path; the live Grok preview still has the complete set. `scripts/split-roads.mjs` rebuilds the tiles from `public/data/roads.geojson` if you add that file later.
