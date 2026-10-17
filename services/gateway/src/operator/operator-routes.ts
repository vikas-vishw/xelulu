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
//
// Phase 4 adds the twelve Operator_Content_Routes — four reads and eight writes (Req 16.1, 16.2):
//   GET  /v1/content[?id=<content_id>]  GET /v1/grandma  GET /v1/routines  GET /v1/reports
//   POST /v1/content/create  /v1/content/update  /v1/content/status
//   POST /v1/grandma/consent  /v1/grandma/recording  /v1/grandma/schedule  /v1/grandma/call
//   POST /v1/routines/run
// Three rules hold for all twelve:
//
//  1. EVERY write begins with the Content_Admin_Argument check, BEFORE any body parse, so a
//     disabled surface reads no submitted byte (Req 16.3, C23). The 8 KiB transport cap is
//     earlier still and is unchanged, so an oversize POST is 413 before a handler runs.
//  2. EVERY field refusal answers 400 `invalid_fields` through the UNCHANGED
//     `errorResponse`/`invalidFields`/`toSafeIssues` helpers, with one Safe_Issue whose `path` is
//     the store's dotted field split on `.` (Req 16.4a). No `field` member is added to any body.
//     Where a refusal MEANS something beyond "this field is wrong" — a Gate_Verdict, a Grandma
//     refusal reason — that meaning travels as a sibling of `error` carrying closed enums, ids
//     and a stage only, because the three new `OperatorErrorCode` members are fixed and a reason
//     collapsed into `invalid_fields` would leave the console unable to say what happened.
//  3. NO response carries a transcript, a child's answer, a Media_Handle, a step text, a token or
//     an env value (Req 16.10). Every summary is built with an explicit field list in snapshot.ts.
import {
  CONTENT_STATUSES,
  toSafeIssues,
  type ContentItem,
  type ContentStatus,
  type ConversationTurnView,
  type GatewayLogEntry,
  type ReportSummary,
  type SafeIssue,
} from "@xelulu/shared";

import type { GateVerdict } from "../content/content-gate.js";
import type {
  ContentDraft,
  ContentPatch,
  ContentWriteResult,
  ContentWriteRefusal,
} from "../content/content-store.js";
import { CONTENT_MAX_DRAFT_STEPS } from "../content/content-store.js";
import type { ConsentRecordResult } from "../grandma/consent-store.js";
import type { CallOp, GrandmaCall } from "../grandma/grandma-call.js";
import { CALL_OPS } from "../grandma/grandma-call.js";
import type { GrandmaRecording, GrandmaResult } from "../grandma/grandma-store.js";
import type { FireResult } from "../routines/routine-behaviours.js";
import type { RoutineSummary } from "../routines/routine-store.js";
import type { CommandError, CommandRequest, CommandResult } from "../mqtt/command-sender.js";
import {
  checkRequest,
  type GuardHead,
  type OperatorErrorCode,
  type RouteMethods,
} from "./request-guard.js";
import type { StreamSink } from "./operator-stream.js";
import type {
  BrainSnapshot,
  ConsentSummary,
  ContentSummary,
  DevicesSnapshot,
  GrandmaSummary,
} from "./snapshot.js";

/** The request body cap the transport enforces (Req 13.7, G46). */
export const OPERATOR_BODY_LIMIT_BYTES = 8_192;

/** The Operator_Stream route (Phase 1.3 Req 1.1). It needs the transport, so the pure handler 404s it. */
export const OPERATOR_STREAM_PATH = "/v1/stream";

/** The four content reads, in the order the console asks for them (Req 16.1). */
export const OPERATOR_CONTENT_READ_PATHS: readonly string[] = Object.freeze([
  "/v1/content",
  "/v1/grandma",
  "/v1/routines",
  "/v1/reports",
]);

/** The eight content writes, every one of them behind the Content_Admin_Argument (Req 16.2). */
export const OPERATOR_CONTENT_WRITE_PATHS: readonly string[] = Object.freeze([
  "/v1/content/create",
  "/v1/content/update",
  "/v1/content/status",
  "/v1/grandma/consent",
  "/v1/grandma/recording",
  "/v1/grandma/schedule",
  "/v1/grandma/call",
  "/v1/routines/run",
]);

/** The twelve Operator_Content_Routes: the four reads then the eight writes (Req 16.1, 17.7). */
export const OPERATOR_CONTENT_ROUTES: readonly string[] = Object.freeze([
  ...OPERATOR_CONTENT_READ_PATHS,
  ...OPERATOR_CONTENT_WRITE_PATHS,
]);

export const OPERATOR_ROUTES: RouteMethods = Object.freeze({
  "/v1/devices": Object.freeze(["GET"]),
  "/v1/log": Object.freeze(["GET"]),
  "/v1/commands": Object.freeze(["POST"]),
  [OPERATOR_STREAM_PATH]: Object.freeze(["GET"]),
  "/v1/conversation": Object.freeze(["GET"]),
  "/v1/brain": Object.freeze(["GET"]),
  "/v1/transcripts/delete-all": Object.freeze(["POST"]),
  "/v1/content": Object.freeze(["GET"]),
  "/v1/grandma": Object.freeze(["GET"]),
  "/v1/routines": Object.freeze(["GET"]),
  "/v1/reports": Object.freeze(["GET"]),
  "/v1/content/create": Object.freeze(["POST"]),
  "/v1/content/update": Object.freeze(["POST"]),
  "/v1/content/status": Object.freeze(["POST"]),
  "/v1/grandma/consent": Object.freeze(["POST"]),
  "/v1/grandma/recording": Object.freeze(["POST"]),
  "/v1/grandma/schedule": Object.freeze(["POST"]),
  "/v1/grandma/call": Object.freeze(["POST"]),
  "/v1/routines/run": Object.freeze(["POST"]),
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
  /**
   * Every query key as it arrived, in order and WITH its repeats. `query` keeps the FIRST value
   * of a repeated key, so this is the only thing a route can read to refuse `?id=a&id=b` instead
   * of silently resolving it to one of the two values (Req 16.1a). Keys only: no value is
   * carried twice, and nothing echoes either.
   */
  queryKeys: readonly string[];
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
  // ----- the Phase 4 Operator_Content_Routes (Req 16).
  /**
   * Local_Mode AND the Content_Admin_Argument, and nothing else (Req 16.3, C23). Read once at the
   * top of every write handler, before any body byte is parsed, and reported by every read as
   * `write_enabled` so the console knows which controls to render.
   */
  contentAdmin: () => boolean;
  /** Summaries only: no step text and no choice prompt (Req 16.5). */
  contentSummaries: () => readonly ContentSummary[];
  /** One item in full for the editor, with its last Gate_Verdict, or null (Req 16.5). */
  contentItem: (contentId: string) => ContentItemRead | null;
  contentCreate: (draft: ContentDraft) => ContentWriteResult;
  contentUpdate: (contentId: string, patch: ContentPatch) => ContentWriteResult;
  /** The one path to `active`, and it runs the Content_Gate first (Req 16.6). */
  contentStatus: (contentId: string, status: ContentStatus) => ContentWriteResult;
  grandmaSnapshot: () => GrandmaRead;
  /**
   * Records a Consent_Record for the resolved household and `DEV_USER_ID`; null when no household
   * resolves (Req 6.6, 7.9a). It records the SHAPE of consent and is not verifiable parental
   * consent under the DPDP Act, which arrives in Phase 5 (Req 6.7, F7).
   */
  recordConsent: (input: ConsentRouteInput) => ConsentRecordResult | null;
  /** Null when no household resolves for the registered device (Req 7.9). */
  addRecording: (input: RecordingRouteInput) => GrandmaResult<GrandmaRecording> | null;
  scheduleRecording: (
    assetId: string,
    at: string,
    enabled: boolean,
  ) => GrandmaResult<GrandmaRecording>;
  applyCall: (deviceId: string, op: CallOp) => GrandmaResult<GrandmaCall>;
  routinesSnapshot: () => RoutinesRead;
  /** Trigger `manual`, no once-per-day mark (Req 16.7). */
  runRoutine: (deviceId: string, routineId: string) => RoutineRunResult;
  /** Both periods, computed on this request, with one `report_built` entry each (Req 16.9). */
  reports: () => ReportsRead;
}>;

/**
 * `GET /v1/content?id=` — the whole row the editor round-trips, plus its verdict. A `ContentItem`
 * rather than a `ContentItemBase`, so `household_id` survives the round trip (Req 16.5).
 */
export type ContentItemRead = Readonly<{
  item: ContentItem;
  verdict: GateVerdict | null;
}>;

export type GrandmaRead = Readonly<{
  recordings: readonly GrandmaSummary[];
  /** The ids the console cites when adding a recording (Req 6.6, 17.3). */
  consents: readonly ConsentSummary[];
  call: GrandmaCall | null;
}>;

export type RoutinesRead = Readonly<{
  routines: readonly RoutineSummary[];
  play_minutes_used: number;
}>;

export type ReportsRead = Readonly<{ daily: ReportSummary; weekly: ReportSummary }>;

/** What the consent route may submit. The household and the user are resolved server-side. */
export type ConsentRouteInput = Readonly<{
  purpose: string;
  version: string;
  verification_method: string;
}>;

/** What the recording route may submit. No `media_handle`, no `asset_id`, no household, no user. */
export type RecordingRouteInput = Readonly<{
  consent_record_id: string;
  kind: string;
  title: string;
  lang: string;
  duration_s: unknown;
}>;

export type RoutineRunResult =
  | { readonly ok: true; readonly result: FireResult }
  /** The dotted field path of what could not be resolved — `device_id` or `routine`. */
  | { readonly ok: false; readonly field: string };

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

// ---------------------------------------------------------------------------------------------
// The Phase 4 Operator_Content_Routes (Req 16).

const CONTENT_QUERY_KEYS: ReadonlySet<string> = new Set(["id"]);

/** The keys a content draft may carry. `status`, `household_id` and the times are the store's. */
const CONTENT_DRAFT_FIELDS: ReadonlySet<string> = new Set([
  "content_id",
  "kind",
  "title",
  "languages",
  "age_stages",
  "categories",
  "steps",
  "licence_note",
  "source",
]);

const CONTENT_UPDATE_FIELDS: ReadonlySet<string> = new Set(["content_id", "patch"]);
/** A patch may touch any draft field except the id, which identifies the row it edits. */
const CONTENT_PATCH_FIELDS: ReadonlySet<string> = new Set(
  [...CONTENT_DRAFT_FIELDS].filter((field) => field !== "content_id"),
);
const CONTENT_STATUS_FIELDS: ReadonlySet<string> = new Set(["content_id", "status"]);
const CONSENT_FIELDS: ReadonlySet<string> = new Set(["purpose", "version", "verification_method"]);
const RECORDING_FIELDS: ReadonlySet<string> = new Set([
  "consent_record_id",
  "kind",
  "title",
  "lang",
  "duration_s",
]);
const SCHEDULE_FIELDS: ReadonlySet<string> = new Set(["asset_id", "at", "enabled"]);
const CALL_FIELDS: ReadonlySet<string> = new Set(["device_id", "op"]);
const ROUTINE_RUN_FIELDS: ReadonlySet<string> = new Set(["device_id", "routine"]);

/** One refusal naming a dotted store field, mapped by `split(".")` and nothing else (Req 16.4a). */
function fieldRefusal(field: string, kind: SafeIssue["kind"] = "invalid_value"): HttpResponseOut {
  return invalidFields([{ path: field.split("."), kind }]);
}

/**
 * A capacity refusal names the collection that is full rather than a submitted field, because
 * nothing the operator sent is wrong: the library, the Grandma shelf or the consent ledger simply
 * has no room. `too_big` is the Req 16.4a kind for a cap.
 */
function atCapacity(collection: string): HttpResponseOut {
  return invalidFields([{ path: [collection], kind: "too_big" }]);
}

/**
 * A Gate_Verdict refusal: the Req 16.4a `invalid_fields` body, plus the verdict as a sibling of
 * `error`. The verdict is a Safety_Rule, an Age_Stage, a language, a step id and a field name —
 * closed enums and ids, never the text that failed (Req 16.6, 17.6).
 */
function gateRefusal(verdict: Extract<GateVerdict, { ok: false }>): HttpResponseOut {
  const path = verdict.step_id === "" ? [verdict.field] : ["steps", verdict.step_id, verdict.field];
  const refused = invalidFields([{ path, kind: "invalid_value" }]);
  return { status: refused.status, body: { ...(refused.body as object), verdict } };
}

/** The response for a Content_Store write, refusal codes mapped onto the wire (Req 16.4a). */
function contentWriteResponse(result: ContentWriteResult): HttpResponseOut {
  if (result.ok) {
    return { status: 200, body: { ok: true, item: result.item, verdict: result.verdict } };
  }
  const refusal: ContentWriteRefusal = result.refusal;
  switch (refusal.code) {
    case "invalid_field":
      return fieldRefusal(refusal.field ?? "content_id");
    case "at_capacity":
      return atCapacity("items");
    case "unknown_content":
      return errorResponse(404, "unknown_content");
    case "gate_refused":
      return refusal.verdict === null || refusal.verdict.ok
        ? fieldRefusal("title")
        : gateRefusal(refusal.verdict);
  }
}

/**
 * The response for a Grandma_Store or Grandma_Call refusal. The store's reason travels as a
 * sibling of `error`, with the title gate's rule, stage and language beside it when there was
 * one: a reason collapsed into the single wire code would leave the console unable to tell a
 * missing consent record apart from a withdrawn one, and those are different things for the
 * adult reading it.
 */
function grandmaRefusal<T>(result: Extract<GrandmaResult<T>, { ok: false }>): HttpResponseOut {
  if (result.reason === "invalid_transition") {
    return errorResponse(409, "invalid_transition");
  }
  const refused =
    result.reason === "at_capacity"
      ? atCapacity("recordings")
      : fieldRefusal(result.field ?? "consent_record_id");
  return {
    status: refused.status,
    body: {
      ...(refused.body as object),
      reason: result.reason,
      ...(result.gate === null ? {} : { gate: result.gate }),
    },
  };
}

/** Local_Mode and the argument, checked before any body byte is parsed (Req 16.3, 16.13). */
function requireContentAdmin(deps: OperatorRouteDeps): HttpResponseOut | null {
  return deps.contentAdmin() ? null : errorResponse(403, "content_admin_disabled");
}

type ParsedBody =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly response: HttpResponseOut };

/** JSON, an object, and only the keys the route allows. The parser's message is never shown. */
function parseBody(req: HttpRequestIn, allowed: ReadonlySet<string>): ParsedBody {
  let value: unknown;
  try {
    value = JSON.parse(req.body);
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json") };
  }
  if (!isPlainObject(value)) return { ok: false, response: errorResponse(400, "not_object") };
  const issues = unknownKeyIssues(Object.keys(value), allowed);
  if (issues.length > 0) return { ok: false, response: invalidFields(issues) };
  return { ok: true, value };
}

/** The query refusal for `GET /v1/content`: any other key, or a repeated `id` (Req 16.1a). */
function contentQuery(req: HttpRequestIn): HttpResponseOut | null {
  const issues = unknownKeyIssues(Object.keys(req.query), CONTENT_QUERY_KEYS);
  if (issues.length > 0) return invalidFields(issues);
  const ids = req.queryKeys.filter((key) => key === "id");
  if (ids.length > 1) return invalidFields([{ path: ["id"], kind: "invalid_value" }]);
  return null;
}

function content(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = contentQuery(req);
  if (refused !== null) return refused;
  const writeEnabled = deps.contentAdmin();
  const id = Object.hasOwn(req.query, "id") ? req.query["id"] : undefined;
  if (id === undefined) {
    return {
      status: 200,
      body: { ok: true, items: deps.contentSummaries(), write_enabled: writeEnabled },
    };
  }
  const read = deps.contentItem(id);
  if (read === null) return errorResponse(404, "unknown_content");
  return {
    status: 200,
    body: { ok: true, item: read.item, verdict: read.verdict, write_enabled: writeEnabled },
  };
}

function grandma(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  return {
    status: 200,
    body: { ok: true, ...deps.grandmaSnapshot(), write_enabled: deps.contentAdmin() },
  };
}

function routines(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  return {
    status: 200,
    body: { ok: true, ...deps.routinesSnapshot(), write_enabled: deps.contentAdmin() },
  };
}

function reports(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const refused = noQuery(req);
  if (refused !== null) return refused;
  // Computed on this request, both periods, with one `report_built` entry each (Req 16.9, C20).
  return {
    status: 200,
    body: { ok: true, ...deps.reports(), write_enabled: deps.contentAdmin() },
  };
}

/** The route's own step cap, which the 8 KiB body cap makes necessary (Req 16.13). */
function draftStepsRefusal(steps: unknown, path: readonly string[]): HttpResponseOut | null {
  if (Array.isArray(steps) && steps.length > CONTENT_MAX_DRAFT_STEPS) {
    return invalidFields([{ path: [...path], kind: "too_big" }]);
  }
  return null;
}

function contentCreate(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, CONTENT_DRAFT_FIELDS);
  if (!parsed.ok) return parsed.response;
  const steps = draftStepsRefusal(own(parsed.value, "steps"), ["steps"]);
  if (steps !== null) return steps;
  // Always a draft, whatever the gate says: only `setStatus` can reach `active` (Req 2.4a, C23).
  return contentWriteResponse(deps.contentCreate(parsed.value as unknown as ContentDraft));
}

function contentUpdate(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, CONTENT_UPDATE_FIELDS);
  if (!parsed.ok) return parsed.response;
  const contentId = own(parsed.value, "content_id");
  const patch = own(parsed.value, "patch");
  if (typeof contentId !== "string") return fieldRefusal("content_id");
  if (!isPlainObject(patch)) return fieldRefusal("patch");
  const unknown = unknownKeyIssues(Object.keys(patch), CONTENT_PATCH_FIELDS).map(
    (issue): SafeIssue => ({ path: ["patch", ...issue.path], kind: issue.kind }),
  );
  if (unknown.length > 0) return invalidFields(unknown);
  const steps = draftStepsRefusal(own(patch, "steps"), ["patch", "steps"]);
  if (steps !== null) return steps;
  return contentWriteResponse(deps.contentUpdate(contentId, patch as unknown as ContentPatch));
}

function contentStatus(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, CONTENT_STATUS_FIELDS);
  if (!parsed.ok) return parsed.response;
  const contentId = own(parsed.value, "content_id");
  const status = own(parsed.value, "status");
  if (typeof contentId !== "string") return fieldRefusal("content_id");
  if (typeof status !== "string" || !(CONTENT_STATUSES as readonly string[]).includes(status)) {
    return fieldRefusal("status");
  }
  // Repeating the same status succeeds and changes nothing (Req 16.14).
  return contentWriteResponse(deps.contentStatus(contentId, status as ContentStatus));
}

function grandmaConsent(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, CONSENT_FIELDS);
  if (!parsed.ok) return parsed.response;
  const purpose = own(parsed.value, "purpose");
  const version = own(parsed.value, "version");
  const method = own(parsed.value, "verification_method");
  if (typeof purpose !== "string") return fieldRefusal("purpose");
  if (typeof version !== "string") return fieldRefusal("version");
  if (typeof method !== "string") return fieldRefusal("verification_method");
  const result = deps.recordConsent({
    purpose,
    version,
    verification_method: method,
  });
  // No household resolved for the registered device: nothing is recorded (Req 7.9).
  if (result === null) return fieldRefusal("device_id");
  if (!result.ok) return fieldRefusal(result.field);
  const consent = result.consent;
  return {
    status: 200,
    body: {
      ok: true,
      // Ids, closed enums and times. No `user_id` and no `household_id` (Req 16.2).
      consent: {
        consent_id: consent.consent_id,
        purpose: consent.purpose,
        version: consent.version,
        verification_method: consent.verification_method,
        given_at: consent.given_at,
        withdrawn_at: consent.withdrawn_at,
      },
    },
  };
}

function grandmaRecording(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, RECORDING_FIELDS);
  if (!parsed.ok) return parsed.response;
  const consentId = own(parsed.value, "consent_record_id");
  const kind = own(parsed.value, "kind");
  const title = own(parsed.value, "title");
  const lang = own(parsed.value, "lang");
  if (typeof consentId !== "string") return fieldRefusal("consent_record_id");
  if (typeof kind !== "string") return fieldRefusal("kind");
  if (typeof title !== "string") return fieldRefusal("title");
  if (typeof lang !== "string") return fieldRefusal("lang");
  const result = deps.addRecording({
    consent_record_id: consentId,
    kind,
    title,
    lang,
    duration_s: own(parsed.value, "duration_s"),
  });
  if (result === null) return fieldRefusal("device_id");
  if (!result.ok) return grandmaRefusal(result);
  return { status: 200, body: { ok: true, recording: recordingBody(result.value) } };
}

/** The stored recording as the route answers it: no Media_Handle, ever (Req 7.5, 16.10). */
function recordingBody(recording: GrandmaRecording): unknown {
  return {
    asset_id: recording.asset_id,
    household_id: recording.household_id,
    recorded_by_user_id: recording.recorded_by_user_id,
    kind: recording.kind,
    title: recording.title,
    lang: recording.lang,
    duration_s: recording.duration_s,
    status: recording.status,
    schedule: recording.schedule === null ? null : { ...recording.schedule },
    created_at: recording.created_at,
  };
}

function grandmaSchedule(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, SCHEDULE_FIELDS);
  if (!parsed.ok) return parsed.response;
  const assetId = own(parsed.value, "asset_id");
  const at = own(parsed.value, "at");
  const enabled = own(parsed.value, "enabled");
  if (typeof assetId !== "string") return fieldRefusal("asset_id");
  if (typeof at !== "string") return fieldRefusal("at");
  if (typeof enabled !== "boolean") return fieldRefusal("enabled");
  const result = deps.scheduleRecording(assetId, at, enabled);
  if (!result.ok) return grandmaRefusal(result);
  return { status: 200, body: { ok: true, recording: recordingBody(result.value) } };
}

function grandmaCall(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, CALL_FIELDS);
  if (!parsed.ok) return parsed.response;
  const deviceId = own(parsed.value, "device_id");
  const op = own(parsed.value, "op");
  if (typeof deviceId !== "string") return fieldRefusal("device_id");
  if (typeof op !== "string" || !(CALL_OPS as readonly string[]).includes(op)) {
    return fieldRefusal("op");
  }
  const result = deps.applyCall(deviceId, op as CallOp);
  if (!result.ok) return grandmaRefusal(result);
  return { status: 200, body: { ok: true, call: result.value } };
}

function routinesRun(deps: OperatorRouteDeps, req: HttpRequestIn): HttpResponseOut {
  const disabled = requireContentAdmin(deps);
  if (disabled !== null) return disabled;
  const parsed = parseBody(req, ROUTINE_RUN_FIELDS);
  if (!parsed.ok) return parsed.response;
  const deviceId = own(parsed.value, "device_id");
  const routineId = own(parsed.value, "routine");
  if (typeof deviceId !== "string") return fieldRefusal("device_id");
  if (typeof routineId !== "string") return fieldRefusal("routine");
  const result = deps.runRoutine(deviceId, routineId);
  if (!result.ok) return fieldRefusal(result.field);
  // The counts and any Policy_Refusal, which is what proves the gate decided it (Req 16.7).
  return { status: 200, body: { ok: true, ...result.result } };
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
    // The twelve Operator_Content_Routes. Each needs its own case for the same reason as above:
    // the default branch is the command handler (Req 16.1, 16.2).
    case "/v1/content":
      return content(deps, req);
    case "/v1/grandma":
      return grandma(deps, req);
    case "/v1/routines":
      return routines(deps, req);
    case "/v1/reports":
      return reports(deps, req);
    case "/v1/content/create":
      return contentCreate(deps, req);
    case "/v1/content/update":
      return contentUpdate(deps, req);
    case "/v1/content/status":
      return contentStatus(deps, req);
    case "/v1/grandma/consent":
      return grandmaConsent(deps, req);
    case "/v1/grandma/recording":
      return grandmaRecording(deps, req);
    case "/v1/grandma/schedule":
      return grandmaSchedule(deps, req);
    case "/v1/grandma/call":
      return grandmaCall(deps, req);
    case "/v1/routines/run":
      return routinesRun(deps, req);
    case OPERATOR_STREAM_PATH:
      // A stream needs the transport; the listener sends it to openStream, never here.
      return errorResponse(404, "unknown_route");
    default:
      return commands(deps, req);
  }
}
