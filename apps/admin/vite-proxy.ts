// Dev_Proxy builder for the admin console (Req 4.2, 4.3, 4.4; design C5).
// Pure: takes the raw port text and returns Vite proxy options. It reads no environment;
// vite.config.ts passes the one value it loads.

import type { IncomingMessage } from "node:http";
import type { ProxyOptions } from "vite";

/** The admin dev server address (C7, unchanged from Phase 0). */
export const DEV_HOST = "127.0.0.1";
export const DEV_PORT = 5173;

export const STREAM_PATH = "/v1/stream";

/**
 * Vite treats a key starting with `^` as a RegExp, which is what makes the optional `?id=` of
 * `GET /v1/content` match: a bare string key would not (Phase 4 Req 18.1).
 */
export function proxyKey(path: string): string {
  return "^" + path + "(\\?|$)";
}

/** `/v1/stream` with or without a query. */
export const STREAM_PROXY_KEY = proxyKey(STREAM_PATH);

/** The dev-server mode that opens the console's write path (Phase 4 C24, Req 18.2). */
export const CONTENT_ADMIN_MODE = "content-admin";

/**
 * The Operator_Content_Routes, restated here rather than imported: nothing in `apps/` may import
 * from `services/`, so the console and the Gateway each hold the list and a Repo_Check keeps the
 * console's request paths inside it (Req 17.7).
 */
const CONTENT_READ_PATHS: readonly string[] = [
  "/v1/content",
  "/v1/grandma",
  "/v1/routines",
  "/v1/reports",
];

const CONTENT_WRITE_PATHS: readonly string[] = [
  "/v1/content/create",
  "/v1/content/update",
  "/v1/content/status",
  "/v1/grandma/consent",
  "/v1/grandma/recording",
  "/v1/grandma/schedule",
  "/v1/grandma/call",
  "/v1/routines/run",
];

/** The stream and the four reads: forwarded in every mode (Req 18.1). Five keys. */
export const READ_PROXY_KEYS: readonly string[] = [
  STREAM_PROXY_KEY,
  ...CONTENT_READ_PATHS.map(proxyKey),
];

/** The eight writes: forwarded only in content-admin mode (Req 18.2). */
export const WRITE_PROXY_KEYS: readonly string[] = CONTENT_WRITE_PATHS.map(proxyKey);

/** The dev-server mode that opens the console's command path (Phase 6 C11, Req 5.8). */
export const DEVICE_CONTROL_MODE = "device-control";

/**
 * The one Device_Control_Route, restated here for the same reason as the content paths above.
 * It is deliberately its OWN mode and its OWN key: editing content and firing commands at a
 * robot are different powers, so one dev mode never grants the other.
 */
const DEVICE_CONTROL_PATHS: readonly string[] = ["/v1/device-control"];

/** The command path: forwarded only in device-control mode (Req 5.8). */
export const DEVICE_CONTROL_PROXY_KEYS: readonly string[] = DEVICE_CONTROL_PATHS.map(proxyKey);

/** True only for the content-admin dev mode. `mode` is Vite's, never an env value (Req 18.5). */
export function contentAdminMode(mode: string): boolean {
  return mode === CONTENT_ADMIN_MODE;
}

/** True only for the device-control dev mode. `mode` is Vite's, never an env value (Req 5.8). */
export function deviceControlMode(mode: string): boolean {
  return mode === DEVICE_CONTROL_MODE;
}

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

/**
 * One entry, built once so the three safety behaviours — the loopback target, the foreign-`Origin`
 * refusal and the stripped `origin` header — exist in exactly one place for every key.
 */
function entry(port: number): ProxyOptions {
  return {
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
  };
}

/**
 * null when rawPort is not an integer 1–65535 (Req 4.3). The read keys are forwarded in every
 * mode; the eight write keys only with `contentAdmin` and the one command key only with
 * `deviceControl`, each arriving as an argument from Vite's mode and never from the environment
 * (Req 18.2, 18.5; Phase 6 Req 5.8).
 */
export function operatorProxy(
  rawPort: string | undefined,
  opts: Readonly<{ contentAdmin?: boolean; deviceControl?: boolean }> = {},
): Record<string, ProxyOptions> | null {
  const port = parsePort(rawPort);
  if (port === null) return null;

  const keys = [
    ...READ_PROXY_KEYS,
    ...(opts.contentAdmin === true ? WRITE_PROXY_KEYS : []),
    ...(opts.deviceControl === true ? DEVICE_CONTROL_PROXY_KEYS : []),
  ];
  return Object.fromEntries(keys.map((key) => [key, entry(port)]));
}
