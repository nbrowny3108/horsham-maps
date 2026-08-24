# Horsham Maps

Private repo: https://github.com/nbrowny3108/horsham-maps

Field GPS map for Horsham Rural City Council grader operators.

- Heading-up driving HUD
- Hybrid satellite (Esri / Vicmap picker)
- HRCC Pozi grading overlay
- Speed-adaptive zoom, trip meter, current road / next intersection
- Offline satellite download for 80–90% driving zoom
- Predictive tile prefetch and exponential backoff on search/tiles

## Clone

```bash
git clone https://github.com/nbrowny3108/horsham-maps.git
cd horsham-maps
npm install
npm run dev
```

The repo is **private**. Sign in as `nbrowny3108` on GitHub to see it.

iPhone: add to Home Screen from the preview URL.

## Stack

TanStack Start, Vite, Leaflet, service worker cache.
