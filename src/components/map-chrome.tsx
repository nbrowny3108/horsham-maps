import type { ReactNode } from "react";
import {
  Clock,
  Download,
  Folder,
  HardDrive,
  Image,
  Layers,
  MapPin,
  Navigation,
  Navigation2,
  Search,
  Settings,
  Share,
  Trash2,
  Waypoints,
  WifiOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDistance, formatDuration, formatEta } from "@/lib/maps/geo";
import {
  ZOOM_STEP_PCT,
  shireLatLngBounds,
  updateShireFitZoom,
  speedBandLabel,
  type SpeedZoomSettings,
} from "@/lib/maps/style";
import { formatLibrarySize, exportLibraryFile, clearMapPhotos, type LibraryFile } from "@/lib/maps/map-library";
import { placeSubtitle, placeTitle, RateLimitError, searchPlaces } from "@/lib/maps/places";
import { saveAlwaysGps, saveAlwaysMotion } from "@/lib/maps/storage";
import { POZI_URL, type NominatimHit, type Place, type RouteOption } from "@/lib/maps/types";

function ToolButton({
  children,
  onClick,
  onPressStart,
  label,
  shortLabel,
  active,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  onPressStart?: () => void;
  label: string;
  shortLabel: string;
  active?: boolean;
  tone?: "grade";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPressStart?.();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-0.5 py-1",
        active && tone === "grade" ? "bg-grade text-grade-fg" : active ? "bg-primary text-primary-fg" : "text-fg",
      )}
    >
      {children}
      <span className="max-w-full truncate text-center text-xs font-medium leading-none">{shortLabel}</span>
    </button>
  );
}

function OverlayToggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {detail ? <span className="block text-xs text-subtle">{detail}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5" />
    </label>
  );
}

export type MapChromeProps = Record<string, any>;

export function MapChrome(p: MapChromeProps) {
  const {
mapEl,
    footerEl,
    searchInput,
    searchPanel,
    drive,
    lastQuery,
    handle,
    locating,
    hasFix,
    pinAim,
    online,
    error,
    routes,
    place,
    remainKm,
    navActive,
    nextTurn,
    pickRoute,
    clearRoute,
    routing,
    searchOpen,
    query,
    hits,
    searching,
    searchNote,
    recents,
    layersOpen,
    settingsOpen,
    tripKm,
    speedKmh,
    headingMode,
    compassLive,
    heading,
    gpsLabel,
    currentRoad,
    nextRoad,
    zoomPct,
    showMapData,
    showPlaces,
    showShire,
    showGrading,
    gradingCount,
    gradingKm,
    gradingNote,
    savingOffline,
    offlineAt,
    autoZoom,
    speedZoom,
    applySpeedZoom,
    geoPerm,
    alwaysGps,
    motionPerm,
    alwaysMotion,
    sensorsReady,
    library,
    libraryBusy,
    libraryUsedMb,
    libraryQuotaMb,
    gpsMode,
    placeSaved,
    activeRoute,
    closeSearch,
    chooseHit,
    setQuery,
    openRecent,
    setTripKm,
    setActiveRouteId,
    drawRoutes,
    nudgeZoom,
    setShowMapData,
    setShowPlaces,
    setShowShire,
    setShowGrading,
    setZoomMode,
    saveOffline,
    setAlwaysGps,
    beginGps,
    setAlwaysMotion,
    enablePermanentSensors,
    dropAtCenter,
    toggleFollow,
    applyMapBearing,
    enableHeadingUp,
    setLayersOpen,
    setSettingsOpen,
    setSearchOpen,
    routeTo,
    savePlace,
    removePlace,
    setError,
    setLibraryBusy,
    refreshLibrary,
    setHits,
    setSearchNote,
    setSearching,
    setZoomPct,
    setHeadingMode,
  } = p;

  return (
    <div className="relative h-full overflow-hidden bg-bg text-fg">
      <div
        className="absolute inset-x-0 top-0 overflow-hidden bottom-[110px]"
      >
      <div ref={mapEl} className="absolute inset-0 z-0" />

      {locating && !hasFix ? (
        <p className="pointer-events-none absolute left-1/2 z-[1600] -translate-x-1/2 rounded-full bg-elevated px-3 py-1.5 text-xs font-medium text-fg shadow-md top-[max(0.75rem,env(safe-area-inset-top))]">
          Locating…
        </p>
      ) : null}

      {pinAim ? (
        <div className="map-crosshair" aria-hidden="true">
          <span className="map-crosshair-dot" />
        </div>
      ) : null}

      {online ? null : (
        <p className="pointer-events-none absolute left-1/2 z-[1600] -translate-x-1/2 rounded-full bg-elevated px-3 py-1 text-xs font-medium text-fg shadow-md top-[max(0.75rem,env(safe-area-inset-top))]">
          <WifiOff className="mr-1 inline size-3.5" /> Offline — shire map and recents still work
        </p>
      )}

      {error && routes.length === 0 ? (
        <p className="absolute left-2 right-2 z-[1500] mx-auto max-w-sm rounded-md bg-elevated px-3 py-2 text-sm text-danger shadow-md top-[max(4.5rem,env(safe-area-inset-top))]">{error}</p>
      ) : null}

      {navActive && nextTurn && !layersOpen && !settingsOpen ? (
        <div className="pointer-events-none absolute inset-x-2 z-[1700] mx-auto max-w-sm top-[max(0.7rem,env(safe-area-inset-top))]">
          <div className="rounded-md bg-primary px-3 py-2 text-primary-fg shadow-md">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-fg/80">Next turn</p>
            <p className="text-base font-semibold leading-tight">{nextTurn.instruction}</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums">
              {formatDistance(nextTurn.km)}
              {remainKm != null ? ` · ${formatDistance(remainKm)} left` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {place && !navActive ? (
        <section className="pointer-events-auto absolute inset-x-2 z-[1600] mx-auto max-w-sm overflow-y-auto top-[max(4.25rem,env(safe-area-inset-top))] max-h-[min(42vh,calc(100%-140px))]">
          <div className="rounded-md bg-elevated p-3 shadow-md">
            <p className="text-sm font-semibold">{place.title}</p>
            <p className="text-xs text-muted">{place.subtitle}</p>
            {activeRoute ? (
              <p className="mt-1 text-xs text-fg">
                {formatDistance(remainKm ?? activeRoute.distanceKm)} · {formatDuration(activeRoute.durationMin)} · ETA {formatEta(activeRoute.durationMin)}
              </p>
            ) : null}
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button type="button" onClick={() => place && void routeTo(place)} className="inline-flex h-11 items-center justify-center gap-1 rounded-md bg-primary text-xs font-medium text-primary-fg">
                <Navigation className="size-3.5" />
                {routing ? "…" : "Go"}
              </button>
              <button type="button" onClick={savePlace} disabled={placeSaved} className="h-11 rounded-md bg-bg text-xs font-medium disabled:text-subtle">
                {placeSaved ? "Saved" : "Save"}
              </button>
              <button type="button" onClick={removePlace} className="inline-flex h-11 items-center justify-center gap-1 rounded-md bg-bg text-xs font-medium text-danger">
                <Trash2 className="size-3.5" />
                Remove
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {pinAim && !place ? (
        <p className="pointer-events-none absolute left-1/2 z-[1500] -translate-x-1/2 rounded-full bg-elevated px-3 py-1 text-xs font-medium text-fg shadow-sm top-[max(0.75rem,env(safe-area-inset-top))]">
          Move the map · tap Pin to drop
        </p>
      ) : null}

      {searchOpen ? (
        <div className="absolute inset-0 z-[4500] bg-black/35" onClick={() => closeSearch()}>
          <div ref={searchPanel} className="absolute inset-x-3 mx-auto w-auto max-w-md overflow-hidden rounded-lg bg-elevated shadow-lg" style={{ top: "28%" }} onClick={(e) => e.stopPropagation()}>
            <form
              className="flex items-center border-b border-border px-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (hits[0]) void chooseHit(hits[0]);
              }}
            >
              <Search className="ml-1 size-4 shrink-0 text-muted" />
              <label className="sr-only" htmlFor="place-search">
                Search address
              </label>
              <input
                id="place-search"
                ref={searchInput}
                value={query}
                onChange={(e) => {
                  lastQuery.current = "";
                  setQuery(e.target.value);
                }}
                placeholder="Search address"
                className="h-12 min-w-0 flex-1 bg-transparent px-1.5 text-base outline-none placeholder:text-subtle"
                autoComplete="off"
                enterKeyHint="search"
              />
              <button type="button" className="inline-flex size-11 items-center justify-center text-muted" aria-label="Close search" onClick={() => closeSearch()}>
                <X className="size-4" />
              </button>
            </form>
            <ul className="max-h-64 overflow-y-auto">
              {hits.length > 0
                ? hits.map((hit: NominatimHit) => (
                    <li key={hit.place_id}>
                      <button type="button" onClick={() => void chooseHit(hit)} className="flex min-h-11 w-full items-start gap-2 border-b border-border px-3 py-2 text-left last:border-b-0">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{placeTitle(hit.display_name)}</span>
                          <span className="block truncate text-xs text-muted">{placeSubtitle(hit.display_name)}</span>
                        </span>
                      </button>
                    </li>
                  ))
                : searching
                  ? [<li key="searching" className="px-3 py-2 text-sm text-muted">Searching…</li>]
                  : searchNote
                    ? [
                        <li key="note" className="px-3 py-2 text-sm text-muted">
                          {searchNote}{" "}
                          {/try again/i.test(searchNote) ? (
                            <button
                              type="button"
                              className="font-semibold text-primary"
                              onClick={() => {
                                setSearching(true);
                                setSearchNote("");
                                void searchPlaces(query)
                                  .then((list) => {
                                    setHits(list);
                                    setSearchNote(list.length ? "" : "No matching addresses");
                                  })
                                  .catch((err) => {
                                    setHits([]);
                                    if (err instanceof RateLimitError) {
                                      setSearchNote(`Search is busy. Try again in ${err.retryAfter}s.`);
                                    } else {
                                      setSearchNote("Search failed. Check the connection and try again.");
                                    }
                                  })
                                  .finally(() => setSearching(false));
                              }}
                            >
                              Retry
                            </button>
                          ) : null}
                        </li>,
                      ]
                  : recents.length === 0
                    ? [<li key="empty" className="px-3 py-2 text-sm text-muted">Type an address · recent places will show here</li>]
                    : recents.map((item: Place) => (
                        <li key={item.id}>
                          <button type="button" onClick={() => void openRecent(item)} className="flex min-h-11 w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0">
                            <Clock className="size-4 shrink-0 text-primary" />
                            <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                          </button>
                        </li>
                      ))}
            </ul>
          </div>
        </div>
      ) : null}

      </div>

      {!layersOpen && !settingsOpen ? (
      <div className="pointer-events-none fixed left-3 z-[10001] flex items-end gap-2 bottom-[118px]" aria-live="polite">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-1 rounded-md bg-elevated/95 px-2.5 py-1.5 shadow-md">
            <div>
              <p className="font-display text-xl font-semibold leading-none tabular-nums">{tripKm.toFixed(3)}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">km trip</p>
            </div>
            <button
              type="button"
              className="pointer-events-auto ml-1 rounded-sm px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
                drive.current.resetTrip();
                setTripKm(0);
              }}
            >
              Reset
            </button>
          </div>
          <div className="rounded-md bg-elevated/95 px-2.5 py-1.5 shadow-md">
            <p className="font-display text-2xl font-semibold leading-none tabular-nums">{speedKmh == null ? "—" : Math.round(speedKmh)}</p>
            <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">km/h</p>
            {headingMode === "heading" ? (
              <p className="mt-0.5 text-[10px] font-medium text-muted">
                {compassLive ? `${Math.round(heading)}° heading` : "Tap once for compass"}
              </p>
            ) : null}
            {gpsLabel ? <p className="mt-0.5 text-[10px] tabular-nums text-muted">{gpsLabel}</p> : <p className="mt-0.5 text-[10px] text-muted">sats —</p>}
          </div>
        </div>
        {currentRoad ? (
          <div className="max-w-[13rem] rounded-md bg-elevated/95 px-2.5 py-1.5 shadow-md">
            <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">On</p>
            <p className="truncate text-sm font-semibold leading-tight">{currentRoad}</p>
            {nextRoad ? (
              <>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">Next</p>
                <p className="truncate text-sm font-semibold leading-tight">{nextRoad}</p>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      ) : null}

      {!layersOpen && !settingsOpen ? (
        <div className="pointer-events-auto fixed right-3 z-[10015] bottom-[118px] flex flex-col overflow-hidden rounded-md bg-elevated shadow-md">
          <p className="px-1 py-1 text-center text-[11px] font-semibold tabular-nums leading-none text-fg" aria-live="polite">
            {zoomPct}%
          </p>
          <button
            type="button"
            aria-label="Zoom in"
            className="flex size-12 items-center justify-center border-t border-border text-2xl font-semibold leading-none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              nudgeZoom(ZOOM_STEP_PCT);
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            className="flex size-12 items-center justify-center border-t border-border text-2xl font-semibold leading-none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              nudgeZoom(-ZOOM_STEP_PCT);
            }}
          >
            −
          </button>
        </div>
      ) : null}

      <footer
        ref={footerEl}
        className={cn("pointer-events-auto fixed z-[10020] border border-border bg-elevated", (layersOpen || settingsOpen) && "dock-open")}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
      >
        {layersOpen ? (
          <div className="max-h-72 overflow-y-auto border-b border-border p-3">
            <p className="mb-3 text-xs text-muted">One satellite photo per tile.</p>
            <OverlayToggle
              label="Map data"
              detail="Road network linework and HRCC grading. Off shows aerial only."
              checked={showMapData}
              onChange={setShowMapData}
            />
            <OverlayToggle
              label="Places"
              detail="Parks, shops, schools and landmarks — same idea as Google Maps labels."
              checked={showPlaces}
              onChange={setShowPlaces}
            />
            <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-subtle">Pozi overlays</p>
            <OverlayToggle label="Horsham shire" checked={showShire} onChange={setShowShire} />
            <OverlayToggle
              label="HRCC grading programme"
              detail={
                gradingCount
                  ? `${gradingCount.toLocaleString("en-AU")} roads · ${Math.round(gradingKm).toLocaleString("en-AU")} km · ${gradingNote || "public Pozi"}`
                  : "Loading…"
              }
              checked={showGrading}
              onChange={setShowGrading}
            />
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className="h-11 rounded-sm bg-bg text-sm"
                onClick={() => {
                  const map = handle.current?.map;
                  if (!map) return;
                  updateShireFitZoom(map);
                  setZoomMode(false);
                  drive.current.lockView();
                  map.fitBounds(handle.current?.boundary?.getBounds() ?? shireLatLngBounds(), {
                    padding: [16, 64],
                    animate: false,
                    maxZoom: map.getMinZoom(),
                  });
                  setZoomPct(0);
                  drive.current.unlockView();
                }}
              >
                Fit shire
              </button>
              <a href={POZI_URL} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center rounded-sm bg-primary text-sm font-medium text-primary-fg">
                Official Pozi
              </a>
            </div>
            <button
              type="button"
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-sm font-medium text-primary-fg disabled:opacity-70"
              disabled={!!savingOffline}
              onClick={() => void saveOffline()}
            >
              <Download className="size-4" />
              {savingOffline ? `Downloading ${savingOffline}` : offlineAt ? "Update driving satellite" : "Download satellite for driving"}
            </button>
          </div>
        ) : null}
        {settingsOpen ? (
          <div className="max-h-[58vh] overflow-y-auto border-b border-border p-3">
            {routes.length > 0 ? (
              <>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Routes</p>
                <ul className="mb-2 grid gap-1.5">
                  {routes.map((opt: RouteOption) => (
                    <li key={opt.id}>
                      <button
                        type="button"
                        onClick={() => pickRoute(opt.id)}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between rounded-sm px-3 text-left text-sm",
                          opt.id === activeRoute?.id ? "bg-primary text-primary-fg" : "bg-bg text-fg",
                        )}
                      >
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-xs tabular-nums">
                          {formatDuration(opt.durationMin)} · {formatDistance(opt.distanceKm)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => clearRoute()} className="mb-1.5 h-11 w-full rounded-sm bg-bg text-sm font-medium">
                  End route
                </button>
              </>
            ) : null}
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Map zoom</p>
            <div className="mb-1 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className={cn("h-11 rounded-sm text-sm font-medium", !autoZoom ? "bg-primary text-primary-fg" : "bg-bg text-fg")}
                onClick={() => setZoomMode(false)}
              >
                Manual
              </button>
              <button
                type="button"
                className={cn("h-11 rounded-sm text-sm font-medium", autoZoom ? "bg-primary text-primary-fg" : "bg-bg text-fg")}
                onClick={() => setZoomMode(true)}
              >
                Auto
              </button>
            </div>
            <p className="mb-3 text-xs text-muted">
              {autoZoom
                ? "Holds a new band for 1.5 s, then steps zoom. Pinch or +/− switches to manual."
                : `Stays at ${zoomPct}% until you tap Auto.`}
            </p>
            <div className="mb-3 space-y-1.5">
              {(["Stopped / trim", "Grading / site", "Local roads", "Highway / travel"] as const).map((note, i) => (
                <div key={note} className="flex items-center gap-2 rounded-sm bg-bg px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold leading-tight">{speedBandLabel(i, speedZoom as SpeedZoomSettings)}</p>
                    <p className="text-[10px] text-muted">{note}</p>
                  </div>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-sm bg-elevated text-lg font-semibold"
                    onClick={() => {
                      const pcts = [...(speedZoom as SpeedZoomSettings).pcts] as SpeedZoomSettings["pcts"];
                      pcts[i] = Math.max(0, pcts[i] - ZOOM_STEP_PCT);
                      applySpeedZoom({ ...(speedZoom as SpeedZoomSettings), pcts });
                    }}
                  >
                    −
                  </button>
                  <p className="w-10 text-center text-sm font-semibold tabular-nums">{(speedZoom as SpeedZoomSettings).pcts[i]}%</p>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-sm bg-elevated text-lg font-semibold"
                    onClick={() => {
                      const pcts = [...(speedZoom as SpeedZoomSettings).pcts] as SpeedZoomSettings["pcts"];
                      pcts[i] = Math.min(100, pcts[i] + ZOOM_STEP_PCT);
                      applySpeedZoom({ ...(speedZoom as SpeedZoomSettings), pcts });
                    }}
                  >
                    +
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-muted">Band edges (km/h). Faster = more zoomed out.</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(speedZoom as SpeedZoomSettings).cuts.map((cut, i) => (
                  <label key={i} className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-subtle">{i === 0 ? "Slow" : i === 1 ? "Mid" : "Fast"}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={120}
                      step={1}
                      value={cut}
                      onChange={(e) => {
                        const cuts = [...(speedZoom as SpeedZoomSettings).cuts] as SpeedZoomSettings["cuts"];
                        cuts[i] = Number(e.target.value);
                        applySpeedZoom({ ...(speedZoom as SpeedZoomSettings), cuts });
                      }}
                      className="h-11 w-full rounded-sm bg-bg px-2 text-sm tabular-nums"
                    />
                  </label>
                ))}
              </div>
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Permissions</p>
            <p className="mb-2 text-xs text-muted">
              iPhone asks once. After you tap Allow, this app keeps GPS and compass on each launch — same idea as Google Maps.
            </p>
            <OverlayToggle
              label="GPS always on"
              detail={
                geoPerm === "granted"
                  ? "Location granted · will not ask again"
                  : geoPerm === "denied"
                    ? "Blocked in iPhone Settings → Horsham Maps → Location"
                    : hasFix
                      ? "Fix live · saved for next open"
                      : "Not enabled yet"
              }
              checked={alwaysGps}
              onChange={(on) => {
                setAlwaysGps(on);
                saveAlwaysGps(on);
                if (on) beginGps();
              }}
            />
            <OverlayToggle
              label="Compass / heading always on"
              detail={
                motionPerm === "granted" || motionPerm === "unsupported"
                  ? "Motion granted · will not ask again"
                  : motionPerm === "denied"
                    ? "Blocked — allow Motion & Orientation"
                    : "Not enabled yet"
              }
              checked={alwaysMotion}
              onChange={(on) => {
                setAlwaysMotion(on);
                saveAlwaysMotion(on);
                if (on) void enablePermanentSensors();
              }}
            />
            <button
              type="button"
              disabled={sensorsReady}
              className={cn(
                "mt-2 inline-flex h-12 w-full items-center justify-center rounded-sm text-sm font-semibold text-white",
                sensorsReady ? "bg-[#1e8e3e]" : "bg-danger",
              )}
              onPointerDown={() => {
                if (!sensorsReady) beginGps();
              }}
              onClick={() => {
                if (!sensorsReady) void enablePermanentSensors();
              }}
            >
              {sensorsReady ? "GPS & compass enabled" : "Waiting on permissions"}
            </button>
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-subtle">
                <Folder className="size-3.5" />
                Map files
              </p>
              <p className="mb-2 text-xs text-muted">
                Download shire aerial (z10–14) plus this week’s grading jobs at driving zoom. Use depot Wi-Fi. z19 fills while you drive.
              </p>
              <p className="mb-2 flex items-center gap-1 text-xs text-muted">
                <HardDrive className="size-3.5 shrink-0" />
                {libraryQuotaMb
                  ? `${formatLibrarySize(libraryUsedMb * 1_048_576)} on this phone${libraryQuotaMb ? ` · ${Math.round(libraryQuotaMb)} MB room` : ""}`
                  : "Saved on this phone as you drive"}
              </p>
              {(["Roads", "Photos", "Council"] as const).map((group) => (
                <div key={group} className="mb-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{group}</p>
                  <div className="overflow-hidden rounded-sm border border-border">
                    {library
                      .filter((f: LibraryFile) => f.group === group)
                      .map((f: LibraryFile) => (
                        <button
                          key={f.id}
                          type="button"
                          className="flex w-full items-center gap-2 border-b border-border bg-bg px-2 py-2 text-left last:border-b-0"
                          onClick={() => {
                            if (!f.url || !f.filename) return;
                            setLibraryBusy(f.id);
                            void exportLibraryFile(f.url, f.filename)
                              .catch(() => setError("Could not open that file"))
                              .finally(() => setLibraryBusy(null));
                          }}
                        >
                          {group === "Photos" ? <Image className="size-4 shrink-0 text-muted" /> : <Folder className="size-4 shrink-0 text-muted" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{f.name}</span>
                            <span className="block truncate text-[11px] text-muted">{libraryBusy === f.id ? "Opening…" : f.detail}</span>
                          </span>
                          {f.url ? <Share className="size-3.5 shrink-0 text-subtle" /> : null}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="mt-1 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-sm font-medium text-primary-fg disabled:opacity-70"
                disabled={!!savingOffline}
                onClick={() => void saveOffline()}
              >
                <Download className="size-4" />
                {savingOffline ? `Saving ${savingOffline}` : "Download satellite for driving"}
              </button>
              <button
                type="button"
                className="mt-1.5 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-sm bg-bg text-sm"
                disabled={!!libraryBusy}
                onClick={() => {
                  setLibraryBusy("clear");
                  void clearMapPhotos()
                    .then(() => refreshLibrary())
                    .finally(() => setLibraryBusy(null));
                }}
              >
                <Trash2 className="size-4" />
                {libraryBusy === "clear" ? "Clearing…" : "Clear saved photos"}
              </button>
            </div>
          </div>
        ) : null}
        <nav className="grid h-[90px] grid-cols-6 gap-0 px-1" aria-label="Map tools">
          <ToolButton label="Drop pin" shortLabel="Pin" active={pinAim} onClick={() => void dropAtCenter()}>
            <MapPin className="size-4" />
          </ToolButton>
          <ToolButton
            label="Heading up"
            shortLabel="Heading"
            active={headingMode === "heading"}
            onClick={() => void enableHeadingUp()}
          >
            <Navigation2 className="size-4" />
          </ToolButton>
          <ToolButton label="HRCC gravel grading" shortLabel="Grading" active={showGrading} tone="grade" onClick={() => setShowGrading((on: boolean) => !on)}>
            <Waypoints className="size-4" />
          </ToolButton>
          <ToolButton
            label="Search address"
            shortLabel="Search"
            active={searchOpen}
            onClick={() => {
              setLayersOpen(false);
              setSettingsOpen(false);
              if (searchOpen) closeSearch();
              else setSearchOpen(true);
            }}
          >
            <Search className="size-4" />
          </ToolButton>
          <ToolButton
            label="Layers"
            shortLabel="Layers"
            active={layersOpen}
            onClick={() => {
              if (searchOpen) closeSearch();
              setSettingsOpen(false);
              setLayersOpen((v: boolean) => !v);
            }}
          >
            <Layers className="size-4" />
          </ToolButton>
          <ToolButton
            label="Settings"
            shortLabel="Settings"
            active={settingsOpen}
            onClick={() => {
              if (searchOpen) closeSearch();
              setLayersOpen(false);
              setSettingsOpen((v: boolean) => !v);
            }}
          >
            <Settings className="size-4" />
          </ToolButton>
        </nav>
      </footer>
    </div>
  );
}

