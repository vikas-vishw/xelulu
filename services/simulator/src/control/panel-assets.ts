// The web panel's three static files (Req 20.3, 20.5, 21.1). `loadPanelAssets` reads them once,
// when the simulator starts (never at import), with `readFileSync` from
// `new URL("../../panel/", import.meta.url)`: a read, not a write. The reader can be injected, so
// tests need no panel files on disk. The files hold no env value and load no external resource;
// every response carries the design's Content-Security-Policy and security headers.
import { readFileSync } from "node:fs";

export const PANEL_ASSET_NAMES = Object.freeze(["index.html", "panel.css", "panel.js"] as const);
export type PanelAssetName = (typeof PANEL_ASSET_NAMES)[number];

/** Reads one panel file as UTF-8 text. Throws if it cannot be read. */
export type PanelFileReader = (name: PanelAssetName) => string;

export type PanelAsset = Readonly<{ contentType: string; body: string }>;

export type PanelAssets = Readonly<Record<PanelAssetName, PanelAsset>>;

/** Sent with every Control_Surface response (design "Control_Surface"). */
export const PANEL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

export const CONTROL_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": PANEL_CSP,
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

const CONTENT_TYPES: Readonly<Record<PanelAssetName, string>> = Object.freeze({
  "index.html": "text/html; charset=utf-8",
  "panel.css": "text/css; charset=utf-8",
  "panel.js": "text/javascript; charset=utf-8",
});

/** The panel folder next to `src/` and `dist/`: services/simulator/panel/. */
export function panelDirectory(): URL {
  return new URL("../../panel/", import.meta.url);
}

/** The default reader: the file in the panel folder, read synchronously. */
export const readPanelFile: PanelFileReader = (name) =>
  readFileSync(new URL(name, panelDirectory()), "utf8");

/** Reads the three files once. Throws (with no detail) if any cannot be read. */
export function loadPanelAssets(read: PanelFileReader = readPanelFile): PanelAssets {
  const out: Partial<Record<PanelAssetName, PanelAsset>> = {};
  for (const name of PANEL_ASSET_NAMES) {
    let body: string;
    try {
      body = read(name);
    } catch {
      // The error text can carry a path; it is dropped.
      throw new Error();
    }
    out[name] = Object.freeze({ contentType: CONTENT_TYPES[name], body });
  }
  return Object.freeze(out as Record<PanelAssetName, PanelAsset>);
}
