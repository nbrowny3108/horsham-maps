import { useEffect, useRef, useState } from "react";
import { Compass, LocateFixed } from "lucide-react";
import { cn } from "@/lib/cn";
import { isFramed, queryGeoPermission } from "@/lib/maps/gps";
import { markCompassGranted, markGeoGranted, markSensorsReady, requestCompassGrant, requestGeoGrant } from "@/lib/maps/permissions";
import { lastSessionSensorsGranted, loadSensorSession, loadSensorsOnboarded, sensorsReadyThisWindow } from "@/lib/maps/storage";
import { mapAssets } from "@/lib/maps/preload";
import { startBackgroundCache } from "@/lib/maps/app-cache";

type Step = "location" | "compass" | "blocked";

export function PermissionGate({ onGranted }: { onGranted: () => void }) {
  const [step, setStep] = useState<Step>(() => {
    const session = loadSensorSession();
    if (session.compass || session.ready) return "compass";
    if (session.geo) return "compass";
    return "location";
  });
  const [busy, setBusy] = useState(false);
  const [framed] = useState(() => isFramed());
  const [geoOn, setGeoOn] = useState(() => loadSensorSession().geo);
  const [compassOn, setCompassOn] = useState(() => loadSensorSession().compass);
  const [blocked, setBlocked] = useState<"location" | "compass" | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    void mapAssets?.leaflet;
    startBackgroundCache();
    if (framed) return;
    void queryGeoPermission().then((state) => {
      if (state === "granted") {
        setGeoOn(true);
        setStep("compass");
      }
      if (state === "denied") {
        setBlocked("location");
        setStep("blocked");
      }
    });
  }, [framed]);

  async function askLocation() {
    if (framed || lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    const ok = await requestGeoGrant();
    setBusy(false);
    lock.current = false;
    if (!ok) {
      setBlocked("location");
      setStep("blocked");
      return;
    }
    setGeoOn(true);
    setBlocked(null);
    markGeoGranted();
    setStep("compass");
  }

  async function askCompass() {
    if (lock.current || busy) return;
    lock.current = true;
    setBusy(true);
    const ok = await requestCompassGrant();
    setBusy(false);
    lock.current = false;
    if (!ok) {
      setBlocked("compass");
      setStep("blocked");
      return;
    }
    setCompassOn(true);
    setBlocked(null);
    markCompassGranted();
    markSensorsReady();
    onGranted();
  }

  function retry() {
    setBlocked(null);
    setStep(geoOn ? "compass" : "location");
  }

  const action =
    step === "compass"
      ? { label: busy ? "Allow Compass…" : "Enable Compass", run: askCompass }
      : step === "blocked"
        ? { label: "Try again", run: retry }
        : { label: busy ? "Allow Location…" : "Enable Location", run: askLocation };

  if (framed) {
    return (
      <div className="flex h-full flex-col bg-bg text-fg pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Horsham Maps</p>
          <h1 className="mt-2 font-display text-[1.75rem] font-semibold leading-tight tracking-tight">
            Open the Home Screen icon
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            GPS only works from the Horsham Maps icon on your Home Screen. The Grok preview cannot use location.
          </p>
        </div>
        <div className="px-5">
          <button
            type="button"
            onPointerUp={(e) => {
              e.stopPropagation();
              onGranted();
            }}
            className="mx-auto block h-14 w-full max-w-sm rounded-md bg-primary text-base font-semibold text-primary-fg"
          >
            View map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg text-fg pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Horsham Maps</p>
        <h1 className="mt-2 font-display text-[1.75rem] font-semibold leading-tight tracking-tight">
          {step === "compass" ? "Compass next" : step === "blocked" ? "Sensors blocked" : "Location first"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {framed
            ? "GPS does not work inside the Grok preview. Open the Horsham Maps icon on your Home Screen, then allow sensors there."
            : step === "compass"
              ? "Tap Enable Compass, then Allow. The map opens after this."
              : step === "blocked"
                ? blocked === "compass"
                  ? "Settings → Horsham Maps → Motion & Orientation → On."
                  : "Settings → Horsham Maps → Location → While Using."
                : "Tap Enable Location, then Allow. Compass is the next tap — iPhone can only ask one thing at a time."}
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || step !== "location"}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (step === "location") void askLocation();
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left",
              step === "location" ? "bg-elevated ring-2 ring-primary" : "bg-elevated",
            )}
          >
            <LocateFixed className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">1. Location</span>
              <span className="block text-xs text-muted">Blue dot, speed, trip</span>
            </span>
            <span className={cn("text-xs font-semibold", geoOn ? "text-primary" : blocked === "location" ? "text-danger" : "text-subtle")}>
              {geoOn ? "On" : blocked === "location" ? "Blocked" : step === "location" ? "Tap" : "Wait"}
            </span>
          </button>

          <button
            type="button"
            disabled={busy || step !== "compass"}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (step === "compass") void askCompass();
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left",
              step === "compass" ? "bg-elevated ring-2 ring-primary" : "bg-elevated",
            )}
          >
            <Compass className="size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">2. Compass</span>
              <span className="block text-xs text-muted">Heading-up with the road</span>
            </span>
            <span className={cn("text-xs font-semibold", compassOn ? "text-primary" : blocked === "compass" ? "text-danger" : "text-subtle")}>
              {compassOn ? "On" : blocked === "compass" ? "Blocked" : step === "compass" ? "Tap" : "Wait"}
            </span>
          </button>
        </div>
      </div>

      <div className="px-5">
        <button
          type="button"
          disabled={busy && step !== "blocked"}
          onPointerUp={(e) => {
            e.stopPropagation();
            void action.run();
          }}
          className="mx-auto block h-14 w-full max-w-sm rounded-md bg-primary text-base font-semibold text-primary-fg disabled:opacity-70"
        >
          {action.label}
        </button>
      </div>
    </div>
  );
}

export function hasSavedSensorGrant(): boolean {
  if (typeof window === "undefined") return false;
  return lastSessionSensorsGranted() || sensorsReadyThisWindow() || loadSensorsOnboarded();
}
