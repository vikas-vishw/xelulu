// Operator_Surface request guard (Req 13.7, 13.10, G46, D10). Header-only checks, in this order:
//   Host is 127.0.0.1:<port> or localhost:<port> (case-insensitive)  -> 403 forbidden_host
//   no Origin header at all                                           -> 403 forbidden_origin
//   known route                                                       -> 404 unknown_route
//   method defined for the route                                      -> 405 method_not_allowed
//   POST with application/json (optional ; charset=utf-8)             -> 415 unsupported_media_type
// The body cap (413) is the transport's; body checks are the routes'. No submitted value is echoed.

export type OperatorErrorCode =
  | "forbidden_host"
  | "forbidden_origin"
  | "unknown_route"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "body_too_large"
  | "invalid_json"
  | "not_object"
  | "invalid_fields"
  | "unknown_device"
  | "device_offline"
  | "broker_disconnected"
  | "invalid_command"
  | "too_many_streams"
  // Phase 4 adds exactly these three, and deliberately no `invalid_field`: the singular name is
  // the Content_Store's and the Grandma_Store's own refusal code, which the route maps onto the
  // existing `invalid_fields` wire code and its one body shape (Req 16.4a).
  | "content_admin_disabled"
  | "unknown_content"
  | "invalid_transition";

export type GuardHead = Readonly<{
  method: string;
  /** The path without its query. */
  path: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
}>;

export type GuardRefusal = Readonly<{ status: number; code: OperatorErrorCode }>;

/** Route path -> the methods it defines. */
export type RouteMethods = Readonly<Record<string, readonly string[]>>;

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

export function isJsonContentType(contentType: string | undefined): boolean {
  return contentType !== undefined && JSON_CONTENT_TYPE.test(contentType.trim());
}

/** The first refusal that applies, or null when the request may go on to its route. */
export function checkRequest(
  head: GuardHead,
  port: number,
  routes: RouteMethods,
): GuardRefusal | null {
  if (!isAllowedHost(head.host, port)) return { status: 403, code: "forbidden_host" };
  if (head.origin !== undefined) return { status: 403, code: "forbidden_origin" };
  const methods = Object.hasOwn(routes, head.path) ? routes[head.path] : undefined;
  if (methods === undefined) return { status: 404, code: "unknown_route" };
  if (!methods.includes(head.method)) return { status: 405, code: "method_not_allowed" };
  if (head.method === "POST" && !isJsonContentType(head.contentType)) {
    return { status: 415, code: "unsupported_media_type" };
  }
  return null;
}
