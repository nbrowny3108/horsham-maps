import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapApp } from "@/components/map-app";
import { PermissionGate, hasSavedSensorGrant } from "@/components/permission-gate";
import { probeExistingGrants, type PermissionAccess } from "@/lib/maps/permissions";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [access, setAccess] = useState<PermissionAccess | "boot">("boot");

  useEffect(() => {
    if (hasSavedSensorGrant()) {
      setAccess("ready");
      return;
    }
    let live = true;
    void probeExistingGrants().then((next) => {
      if (live) setAccess(next);
    });
    return () => {
      live = false;
    };
  }, []);

  if (access === "boot") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg px-6 text-fg">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Horsham Maps</p>
        <p className="mt-2 text-sm text-muted">Loading map…</p>
      </div>
    );
  }
  if (access === "ready") return <MapApp />;
  return <PermissionGate onGranted={() => setAccess("ready")} />;
}
