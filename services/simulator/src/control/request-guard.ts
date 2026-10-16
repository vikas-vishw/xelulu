// Control_Surface request guard (Req 20.6, 20.7, G46, D10). The gateway's guard (copied: services
// never import each other) with the simulator's differences: an `Origin` equal to the surface's
// own loopback origin is allowed (the panel's own fetches), any other `Origin` is refused, an
// unknown path is `unknown_operation`, and the body cap is 16 KiB. Header-only checks, in order:
//   Host is 127.0.0.1:<port> or localhost:<port> (case-insensitive)  -> 403 forbidden_host
//   no Origin, or exactly the surface's own loopback origin          -> 403 forbidden_origin
//   known operation                                                   -> 404 unknown_operation
//   method defined for it (no GET state change)                       -> 405 method_not_allowed
//   POST with application/json (optional ; charset=utf-8)             -> 415 unsupported_media_type
// The body cap (413) is the transport's; body checks are the routes'. No submitted value is echoed.

/** The Control_Surface body cap (Req 20.6). */
export const CONTROL_BODY_LIMIT_BYTES = 16_384;

export type ControlErrorCode =
  | "forbidden_host"
  | "forbidden_origin"
  | "unknown_operation"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "body_too_large"
  | "invalid_json"
  | "not_object"
  | "invalid_fields"
  | "invalid_event"
  | "battery_out_of_range"
  | "reason_required"
  | "invalid_reason"
  | "offline"
  | "turn_in_progress";

export type GuardHead = Readonly<{
  method: string;
  /** The path without its query. */
  path: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
}>;

export type GuardRefusal = Readonly<{ status: number; code: ControlErrorCode }>;

/** Path -> the methods it defines. */
export type RouteMethods = Readonly<Record<string, readonly string[]>>;

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const LOOPBACK_NAMES = Object.freeze(["127.0.0.1", "localhost"]);

/** `host:port` for each loopback name: the only Host values allowed. */
function loopbackHosts(port: number): readonly string[] {
  return LOOPBACK_NAMES.map((name) => name + ":" + String(port));
}

/**
 * The surface's own origins for `port`, built from parts (never a literal): the plain-HTTP
 * scheme, `://` and each loopback `host:port`.
 */
export function controlOrigins(port: number): readonly string[] {
  const scheme = "http";
  return Object.freeze(loopbackHosts(port).map((host) => scheme + "://" + host));
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  return loopbackHosts(port).includes(host.toLowerCase());
}

/** No `Origin`, or exactly one of the surface's own origins (case-insensitive). */
export function isAllowedOrigin(origin: string | undefined, origins: readonly string[]): boolean {
  return origin === undefined || origins.includes(origin.toLowerCase());
}

export function isJsonContentType(contentType: string | undefined): boolean {
  return contentType !== undefined && JSON_CONTENT_TYPE.test(contentType.trim());
}

export interface ControlGuard {
  readonly port: number;
  /** The allowed `Origin` values, built once when the guard is made. */
  readonly origins: readonly string[];
  /** The first refusal that applies, or null when the request may go on to its route. */
  check(head: GuardHead): GuardRefusal | null;
}

/** A guard for the port the surface listens on, made once at start-up. */
export function createControlGuard(port: number, routes: RouteMethods): ControlGuard {
  const origins = controlOrigins(port);
  return Object.freeze({
    port,
    origins,
    check(head: GuardHead): GuardRefusal | null {
      if (!isAllowedHost(head.host, port)) return { status: 403, code: "forbidden_host" };
      if (!isAllowedOrigin(head.origin, origins)) return { status: 403, code: "forbidden_origin" };
      const methods = Object.hasOwn(routes, head.path) ? routes[head.path] : undefined;
      if (methods === undefined) return { status: 404, code: "unknown_operation" };
      if (!methods.includes(head.method)) return { status: 405, code: "method_not_allowed" };
      if (head.method === "POST" && !isJsonContentType(head.contentType)) {
        return { status: 415, code: "unsupported_media_type" };
      }
      return null;
    },
  });
}
