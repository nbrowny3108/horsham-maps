import type { CSSProperties } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { recoverOrReload } from "@/lib/maps/boot-guard";

const frame: CSSProperties = {
  minHeight: "100dvh",
  boxSizing: "border-box",
  background: "#fff",
  color: "#202124",
  fontFamily: "system-ui, sans-serif",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 24,
  textAlign: "center",
};

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main data-boot-error="" style={frame}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Horsham Maps hit a problem</h1>
      <p style={{ maxWidth: 420, margin: 0, fontSize: 15, overflowWrap: "anywhere" }}>
        {error?.message || "Something went wrong while opening the map."}
      </p>
      <button
        type="button"
        onClick={() => recoverOrReload()}
        style={{
          height: 48,
          padding: "0 16px",
          border: 0,
          borderRadius: 8,
          background: "#1a73e8",
          color: "#fff",
          fontWeight: 700,
          fontSize: 16,
        }}
      >
        Reload a fresh copy
      </button>
    </main>
  );
}
