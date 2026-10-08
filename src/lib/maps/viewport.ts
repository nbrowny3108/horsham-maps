/** Pixel height for the map shell. Zero means "leave the CSS 100% height alone". */
export function measureViewportHeight(input: {
  innerHeight?: number;
  clientHeight?: number;
  visualHeight?: number;
  visualOffsetTop?: number;
}): number {
  const visual =
    typeof input.visualHeight === "number" && input.visualHeight > 0
      ? input.visualHeight + (input.visualOffsetTop || 0)
      : 0;
  const h = Math.max(input.innerHeight || 0, input.clientHeight || 0, visual > 0 ? Math.round(visual) : 0);
  if (!Number.isFinite(h) || h < 1) return 0;
  return Math.round(h);
}

type Sized = { style: { height: string; minHeight: string; setProperty?: (name: string, value: string) => void } };

/**
 * Lock the real document to the measured visual viewport.
 * There is no #app node — writing the height only there left html/body on
 * `100lvh`, which collapses the whole UI when that unit computes badly.
 */
export function applyViewportHeight(
  doc: {
    documentElement: Sized;
    body?: Sized | null;
    querySelector: (sel: string) => unknown;
  },
  height: number,
): void {
  if (height < 1) return;
  const px = `${Math.round(height)}px`;
  const root = doc.documentElement;
  root.style.setProperty?.("--app-h", px);
  root.style.height = px;
  root.style.minHeight = px;
  if (doc.body) {
    doc.body.style.height = px;
    doc.body.style.minHeight = px;
  }
  const shell = doc.querySelector("[data-app-shell]") as Sized | null;
  if (shell?.style) {
    shell.style.height = px;
    shell.style.minHeight = px;
  }
}
