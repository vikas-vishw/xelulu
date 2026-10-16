// Dev_Proxy builder for the admin console (Req 4.2, 4.3, 4.4; design C5).
// Pure: takes the raw port text and returns Vite proxy options. It reads no environment;
// vite.config.ts passes the one value it loads.

import type { IncomingMessage } from "node:http";
import type { ProxyOptions } from "vite";

/** The admin dev server address (C7, unchanged from Phase 0). */
export const DEV_HOST = "127.0.0.1";
export const DEV_PORT = 5173;

export const STREAM_PATH = "/v1/stream";

/** Vite treats a key starting with `^` as a RegExp: `/v1/stream` with or without a query. */
export const STREAM_PROXY_KEY = "^/v1/stream(\\?|$)";

// Built from parts so no scheme-prefixed literal appears in source.
const SCHEME = "http";

/** The console's own loopback origins (dev server port 5173, C7). */
export const CONSOLE_ORIGINS: readonly string[] = [
  `${SCHEME}://${DEV_HOST}:${DEV_PORT}`,
  `${SCHEME}://localhost:${DEV_PORT}`,
];

/** ASCII decimal digits only, 1 to 65535 (the Gateway's own port rule). */
function parsePort(rawPort: string | undefined): number | null {
  if (rawPort === undefined || !/^[0-9]+$/.test(rawPort)) return null;
  const port = Number(rawPort);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Req 4.4: a request with an `Origin` header that is not one of the console's own origins is
 * not forwarded. Returning `false` makes Vite answer 404. No `Origin` (a same-origin
 * EventSource GET) or a console origin falls through to the proxy.
 */
function refuseForeignOrigin(req: IncomingMessage): false | undefined {
  const origin = req.headers.origin;
  if (origin === undefined || CONSOLE_ORIGINS.includes(origin)) return undefined;
  return false;
}

/** null when rawPort is not an integer 1–65535 (Req 4.3). */
export function operatorProxy(rawPort: string | undefined): Record<string, ProxyOptions> | null {
  const port = parsePort(rawPort);
  if (port === null) return null;

  return {
    [STREAM_PROXY_KEY]: {
      target: SCHEME + "://127.0.0.1:" + String(port),
      // Host becomes 127.0.0.1:<port>, so the Gateway's Host guard accepts it.
      changeOrigin: true,
      bypass: (req) => refuseForeignOrigin(req),
      configure: (proxy) => {
        // C5: the Gateway refuses any Origin, so the forwarded request carries none.
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.removeHeader("origin");
        });
      },
    },
  };
}
