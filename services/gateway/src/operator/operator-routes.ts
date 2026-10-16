// Operator_Surface routes (Req 13.3–13.5, 13.7, 13.9, 13.10, G24) as a pure handler. The HTTP
// listener in transport/ feeds it; it exists in Local_Mode only, binds 127.0.0.1 (0.0.0.0 only
// with the Listen_All_Argument, Phase 1.3 Req 3.1) and caps bodies at 8 KiB. Routes:
//   GET  /v1/devices          -> { ok: true, devices: [DeviceSnapshot] }
//   GET  /v1/log[?after=<n>]  -> { ok: true, entries: [GatewayLogEntry] }
//   POST /v1/commands         -> { ok: true, cmd_id } from the synchronous sendCommand
//   GET  /v1/stream           -> SSE, served by the transport through openStream (Phase 1.3)
//   GET  /v1/conversation     -> { ok: true, turns: [ConversationTurnView] } (Phase 3 Req 18)
//   GET  /v1/brain            -> { ok: true, transcripts, alerts, deferred, providers }
//   POST /v1/transcripts/delete-all -> { ok: true, removed }
// Every refusal is { ok: false, error: { code, issues? } } and never echoes a submitted value.
// A refused request changes no state and publishes nothing. No route waits for an ack.
import {
  toSafeIssues,
  type ConversationTurnView,
  type GatewayLogEntry,
  type SafeIssue,
} from "@xelulu/shared";

import type { CommandError, CommandRequest, CommandResult } from "../mqtt/command-sender.js";
import {
  checkRequest,
  type GuardHead,
  type OperatorErrorCode,
  type RouteMethods,
} from "./request-guard.js";
import type { StreamSink } from "./operator-stream.js";
import type { BrainSnapshot, DevicesSnapshot } from "./snapshot.js";

/** The request body cap the transport enforces (Req 13.7, G46). */
export const OPERATOR_BODY_LIMIT_BYTES = 8_192;

/** The Operator_Stream route (Phase 1.3 Req 1.1). It needs the transport, so the pure handler 404s it. */
export const OPERATOR_STREAM_PATH = "/v1/stream";

export const OPERATOR_ROUTES: RouteMethods = Object.freeze({
  "/v1/devices": Object.freeze(["GET"]),
  "/v1/log": Object.freeze(["GET"]),
  "/v1/commands": Object.freeze(["POST"]),
  [OPERATOR_STREAM_PATH]: Object.freeze(["GET"]),
  "/v1/conversation": Object.freeze(["GET"]),
  "/v1/brain": Object.freeze(["GET"]),
  "/v1/transcripts/delete-all": Object.freeze(["POST"]),
});

/** Sent with every response. */
export const OPERATOR_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

/** Sent with the 200 that opens an Operator_Stream, on the stream's first write (Req 1.1). */
export const OPERATOR_STREAM_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

export type HttpRequestIn = Readonly<{
  method: string;
  path: string;
  query: Readonly<Record<string, string>>;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  /** Already capped by the transport. */
  body: string;
}>;

export type HttpResponseOut = Readonly<{ status: number; body: unknown }>;

export type OperatorRouteDeps = Readonly<{
  /** The port actually listened on, for the Host check. */
  port: () => number;
  snapshot: () => DevicesSnapshot;
  logSince: (after?: number) => readonly GatewayLogEntry[];
  sendCommand: (request: CommandRequest) => CommandResult;
  /**
   * The retained Conversation_Turn_Views, returned unchanged (D2). The views were built with the
   * Transcripts_Argument already applied, so this route adds no second text check that could
   * drift from the first.
   */
  conversation: () => readonly ConversationTurnView[];
  brain: () => BrainSnapshot;
  /** Really deletes every held Transcript and returns how many went (safety.md §1). */
  deleteAllTranscripts: () => number;
}>;

/** The Operator_Surface listener (implemented in transport/http-listener.ts). */
export type OperatorListen = (opts: {
  /** 0.0.0.0 only in Local_Mode with the Listen_All_Argument (see listen-host.ts). */
  readonly host: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  /** Header checks, run before any body byte is read; null lets the request go on. */
  preflight(head: GuardHead): HttpResponseOut | null;
  handle(request: HttpRequestIn): HttpResponseOut;
  /**
   * For OPERATOR_STREAM_PATH only: a refusal to send, or null once the stream is open on sink.
   * The transport sends the stream path here instead of to handle.
   */
  openStream(request: HttpRequestIn, sink: StreamSink): HttpResponseOut | null;
}) => Promise<{ readonly port: number; close(): Promise<void> }>;

export function errorResponse(
  status: number,
  code: OperatorErrorCode,
  issues?: readonly SafeIssue[],
): HttpResponseOut {
  return {
    status,
    body: { ok: false, error: issues === undefined ? { code } : { code, issues } },
  };
}

/** The transport's answer to a body over the cap. */
export const BODY_TOO_LARGE_RESPONSE: HttpResponseOut = errorResponse(413, "body_too_large");

const COMMAND_FIELDS: ReadonlySet<string> = new Set(["device_id", "action", "data"]);
const LOG_QUERY_KEYS: ReadonlySet<string> = new Set(["after"]);
const NO_QUERY_KEYS: ReadonlySet<string> = new Set();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function unknownKeyIssues(keys: readonly string[], allowed: ReadonlySet<string>): SafeIssue[] {
  return keys
    .filter((k) => !allowed.has(k))
    .map((k): SafeIssue => ({ path: [k], kind: "unrecognized_keys" }));
}

function invalidFields(issues: readonly SafeIssue[]): HttpResponseOut {
  return errorResponse(400, "invalid_fields", toSafeIssues(issues));
}

const COMMAND_ERROR_STATUS: Readonly<Record<CommandError["code"], number>> = Object.freeze({
  unknown_device: 404,
  device_offline: 409,
  broker_disconnected: 503,
  invalid_command: 422,
});

/** The refusal for a route that takes no query, or null. The key's value is never echoed. */
function noQuery(req: HttpRequestIn): HttpResponseOut | null {
  const issues = unknownKeyIssues(Object.keys(req.query), NO_QUERY_KEYS);
  return issues.length > 0 ? invalidFields(issues) : null;
}

function devices(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  return { status: 200, body: { ok: true, devices: deps.snapshot().devices } };
}

function conversation(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  return { status: 200, body: { ok: true, turns: deps.conversation() } };
}

function brain(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  return { status: 200, body: { ok: true, ...deps.brain() } };
}

/**
 * Deletes every held Transcript. It reads no body field — an empty object is enough — so there is
 * nothing to validate and nothing to echo; the guard has already required a JSON content type, a
 * loopback Host and no Origin, and a request it refuses never reaches here, so nothing is deleted.
 */
function deleteAllTranscripts(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  return { status: 200, body: { ok: true, removed: deps.deleteAllTranscripts() } };
}

function log(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const issues = unknownKeyIssues(Object.keys(req.query), LOG_QUERY_KEYS);
  const raw = Object.hasOwn(req.query, "after") ? req.query["after"] : undefined;
  let after: number | undefined;
  if (raw !== undefined) {
    after = /^[0-9]+$/.test(raw) ? Number(raw) : undefined;
    if (after === undefined || !Number.isSafeInteger(after)) {
      issues.unshift({ path: ["after"], kind: "invalid_type" });
    }
  }
  if (issues.length > 0) return invalidFields(issues);
  return { status: 200, body: { ok: true, entries: deps.logSince(after) } };
}

function commands(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  let value: unknown;
  try {
    value = JSON.parse(req.body);
  } catch {
    // The parser's message can quote the body, so it is discarded.
    return errorResponse(400, "invalid_json");
  }
  if (!isPlainObject(value)) return errorResponse(400, "not_object");

  const deviceId = own(value, "device_id");
  const action = own(value, "action");
  const data = own(value, "data");
  const issues: SafeIssue[] = [];
  if (typeof deviceId !== "string") issues.push({ path: ["device_id"], kind: "invalid_type" });
  if (typeof action !== "string") issues.push({ path: ["action"], kind: "invalid_type" });
  if (!isPlainObject(data)) issues.push({ path: ["data"], kind: "invalid_type" });
  issues.push(...unknownKeyIssues(Object.keys(value), COMMAND_FIELDS));
  if (issues.length > 0 || typeof deviceId !== "string" || typeof action !== "string") {
    return invalidFields(issues);
  }

  const result = deps.sendCommand({ device_id: deviceId, action, data });
  if (result.ok) return { status: 200, body: { ok: true, cmd_id: result.cmd_id } };
  const error = result.error;
  return errorResponse(
    COMMAND_ERROR_STATUS[error.code],
    error.code,
    error.code === "invalid_command" ? toSafeIssues(error.issues) : undefined,
  );
}

/** The Operator_Stream takes no query: each key is refused, its value never echoed (Req 1.6). */
export function checkStreamRequest(req: HttpRequestIn): HttpResponseOut | null {
  return noQuery(req);
}

/** The header checks of the request guard, for the transport to run before reading a body. */
export function preflightOperatorRequest(port: number, head: GuardHead): HttpResponseOut | null {
  const refusal = checkRequest(head, port, OPERATOR_ROUTES);
  return refusal === null ? null : errorResponse(refusal.status, refusal.code);
}

export function handleOperatorRequest(
  deps: OperatorRouteDeps,
  req: HttpRequestIn,
): HttpResponseOut {
  const refused = preflightOperatorRequest(deps.port(), req);
  if (refused !== null) return refused;
  switch (req.path) {
    case "/v1/devices":
      return devices(deps, req);
    case "/v1/log":
      return log(deps, req);
    // Every route needs its own case: the default branch is the command handler, so a missing
    // one would route a GET silently into it.
    case "/v1/conversation":
      return conversation(deps, req);
    case "/v1/brain":
      return brain(deps, req);
    case "/v1/transcripts/delete-all":
      return deleteAllTranscripts(deps, req);
    case OPERATOR_STREAM_PATH:
      // A stream needs the transport; the listener sends it to openStream, never here.
      return errorResponse(404, "unknown_route");
    default:
      return commands(deps, req);
  }
}
