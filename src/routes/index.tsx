import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapApp } from "@/components/map-app";
import { PermissionGate, hasSavedSensorGrant } from "@/components/permission-gate";
import { isFramed } from "@/lib/maps/gps";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [needGate, setNeedGate] = useState(false);

  useEffect(() => {
    if (isFramed()) return;
    if (!hasSavedSensorGrant()) setNeedGate(true);
  }, []);

  return (
    <div className="relative h-full">
      <MapApp />
      {needGate ? (
        <div className="absolute inset-0 z-[3000]">
          <PermissionGate onGranted={() => setNeedGate(false)} />
        </div>
      ) : null}
    </div>
  );
}