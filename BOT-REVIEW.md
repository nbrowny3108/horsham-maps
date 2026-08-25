# Horsham Maps — bot review brief

Review this repo as a field GPS PWA for HRCC grader operators. Do not rewrite the stack.

## Keep

- DriveEngine + Leaflet 1.9 + leaflet-rotate heading-up
- Vicmap aerial at driving zoom (z>16); never dual-fetch Esri+Vicmap for one tile
- Live Pozi programmes (not flattened `name`/`locality` GeoJSON as source of truth)
- cheap-ruler + rbush puck snap; CSS-rotate GPS cone; recreate DivIcon only on mode change
- App name Horsham Maps; no geolocation in an iframe
- Honour `loadAutoZoom()`; follow-off must `clearWatch`

## Live Pozi

- https://connect.pozi.com/userdata/horsham-publisher/Community/26-27_Grading_Programme.json
- https://connect.pozi.com/userdata/horsham-publisher/Community/27-28_Grading_Programme.json
- Fields: `Road_name`, `From`, `To`, `Grading_re`, `Length_m` / `Length__m`, `Sequence`, `Asset_id`
- 26–27 gold, 27–28 blue

## Pending (not implemented yet)

Drive-mode clutter + viewport-cull + 10 km ahead corridor for orange grading roads. Spec:

When GPS follow is on, heading-up is on, and speed ≥ ~8 km/h: keep satellite + heading-up + GPS marker + next-road HUD; hide extra place labels and non-orange road lines.

Always only draw grading roads in (or slightly around) the current map view.

When in drive mode AND zoomed in (~z12+): only orange roads ~10 km ahead along heading, ~1.5 km each side, ~0.5 km behind. Not a tiny bubble around the puck. Zoomed out while moving: orange roads across the visible map (still viewport-culled).

Do not remove satellite, heading-up, grading toggle, or shire outline.

## Key files

- `src/components/map-app.tsx` — map screen
- `src/components/map-boot.ts` — Leaflet boot + Pozi overlay
- `src/lib/maps/drive-engine.ts` — RAF follow
- `src/lib/maps/snap.ts` — RoadIndex
- `src/routes/api/tiles/$.ts` — single-source tiles
- `src/routes/api/grading.ts` — live Pozi
- `public/manifest.webmanifest` + `scripts/grok-pwa-shared.mjs`
- `public/sw.js`
