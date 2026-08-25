# Horsham Maps

Private repo: https://github.com/nbrowny3108/horsham-maps

iPhone Home Screen PWA for Horsham Rural City Council grader operators.

- Heading-up driving HUD (leaflet-rotate + DriveEngine)
- Hybrid satellite (Esri at z≤16, Vicmap-only at z>16)
- Live public Pozi 26–27 (gold) and 27–28 (blue) grading overlay
- GPS puck snapped to nearest local road (cheap-ruler + rbush)
- Speed-adaptive zoom, trip meter, current road / next intersection
- Offline depot pack (shire overview + jobs along the programme)

Home Screen name is **Horsham Maps**. GPS does not run in the Grok preview iframe.

## Run

```bash
git clone https://github.com/nbrowny3108/horsham-maps.git
cd horsham-maps
npm install
npm run dev
```

`npm install` restores `src/components/map-app.tsx`, `map-boot.ts`, and `map-chrome.tsx` from `scripts/*.gz.b64` if those files are missing (`node scripts/inflate-map.mjs`).

## Stack

TanStack Start, Vite, Leaflet 1.9, leaflet-rotate, cheap-ruler, rbush, service worker cache.

## Bot review

Paste [horsham-maps-grok-bot.txt](horsham-maps-grok-bot.txt) into a Grok chat, or open [BOT-REVIEW.md](BOT-REVIEW.md).

## Data notes

Road overlay tiles live in `public/data/roads/*.json`. Large extracts (`roads.geojson`, labels, junctions, full grading GeoJSON) are not in this repo; the live Grok preview has the complete set. Live Pozi JSON is fetched at runtime from connect.pozi.com.
