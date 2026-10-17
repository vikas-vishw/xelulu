// The Content page's transport (Phase 4 Req 16, 17.6, 17.6a): the ONLY `fetch` call site in the
// console, and the only module that knows a request path.
//
// Four reads and eight writes, all same-origin, all JSON, no credentials. Every call answers a
// discriminated result and NEVER throws, so a page render can never be taken down by a network
// error or a response shape nobody expected.
//
// THE PROXY RULE (Req 17.6a). A write run in plain `pnpm dev:admin` is not proxied, so the dev
// server answers it itself with a body that is not JSON — Vite's HTML fallback handles `GET` and
// `HEAD` only, so an unproxied `POST` is most likely a 404 with a non-JSON body while an
// unproxied `GET` gets the SPA's HTML at 200. The rule therefore keys on the SHAPE and not on a
// status: any response that is not JSON, or any JSON without a boolean `ok`, is the typed refusal
// `proxy_disabled`. Without it, a write outside content-admin mode would look like a silent
// success.
import type {
  AgeStage,
  ContentItem,
  ContentKind,
  ContentStatus,
  ReportSummary,
} from "@xelulu/shared";

/** The twelve Operator_Content_Routes. Every request path literal in the console lives here. */
export const CONTENT_PATHS = Object.freeze({
  content: "/v1/content",
  grandma: "/v1/grandma",
  routines: "/v1/routines",
  reports: "/v1/reports",
  contentCreate: "/v1/content/create",
  contentUpdate: "/v1/content/update",
  contentStatus: "/v1/content/status",
  grandmaConsent: "/v1/grandma/consent",
  grandmaRecording: "/v1/grandma/recording",
  grandmaSchedule: "/v1/grandma/schedule",
  grandmaCall: "/v1/grandma/call",
  routineRun: "/v1/routines/run",
});

/** Shown when a response is not this surface's JSON: the console is not in content-admin mode. */
export const PROXY_DISABLED = "proxy_disabled";
/** Shown when the request itself failed: nothing answered at the console's own origin. */
export const UNREACHABLE = "unreachable";

/** A Content_Gate verdict as the console reads it: closed enums, an id and a field name. */
export type GateVerdictView =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      rule: string;
      age_stage: string;
      lang: string;
      step_id: string;
      field: string;
    }>;

/** The title gate's refusal on a Grandma recording: a rule, a stage and a language. */
export type GateRefusalView = Readonly<{ rule: string; age_stage: string; lang: string }>;

/**
 * What a refusal shows as text (Req 17.6): the wire code, the field path read as
 * `error.issues[0].path.join(".")`, a store reason when the route carried one, and a gate verdict
 * or title-gate refusal when the refusal was the gate's.
 */
export type ClientRefusal = Readonly<{
  code: string;
  field: string | null;
  reason: string | null;
  verdict: GateVerdictView | null;
  gate: GateRefusalView | null;
}>;

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ClientRefusal };

export type ContentSummaryView = Readonly<{
  content_id: string;
  household_id: string | null;
  kind: ContentKind;
  title: string;
  languages: readonly string[];
  age_stages: readonly AgeStage[];
  categories: readonly string[];
  status: ContentStatus;
  licence_note: string;
  source: string;
  created_at: string;
  updated_at: string;
  step_count: number;
  verdict: GateVerdictView | null;
}>;

export type ContentListBody = Readonly<{
  items: readonly ContentSummaryView[];
  write_enabled: boolean;
}>;

export type ContentItemBody = Readonly<{
  item: ContentItem;
  verdict: GateVerdictView | null;
  write_enabled: boolean;
}>;

export type GrandmaRecordingView = Readonly<{
  asset_id: string;
  kind: string;
  title: string;
  lang: string;
  duration_s: number;
  status: string;
  schedule: Readonly<{ at: string; enabled: boolean }> | null;
  created_at: string;
  /** A boolean, so the console shows consent state without ever seeing a consent row. */
  consent_live: boolean;
}>;

export type ConsentView = Readonly<{
  consent_id: string;
  purpose: string;
  version: string;
  verification_method: string;
  given_at: string;
  withdrawn_at: string | null;
}>;

export type CallView = Readonly<{
  call_id: string;
  device_id: string;
  state: string;
  requested_at: string;
  ended_at: string | null;
}>;

export type GrandmaBody = Readonly<{
  recordings: readonly GrandmaRecordingView[];
  consents: readonly ConsentView[];
  call: CallView | null;
  write_enabled: boolean;
}>;

export type RoutineView = Readonly<{
  routine_id: string;
  name: string;
  at: string;
  enabled: boolean;
  behaviour: string;
  actions: number;
  fired_today: boolean;
}>;

export type RoutinesBody = Readonly<{
  routines: readonly RoutineView[];
  play_minutes_used: number;
  write_enabled: boolean;
}>;

export type ReportsBody = Readonly<{
  daily: ReportSummary;
  weekly: ReportSummary;
  write_enabled: boolean;
}>;

/** A write's answer. The console re-reads after a success, so it needs no field of it (Req 16.12). */
export type WriteBody = Readonly<Record<string, unknown>>;

export type ConsentInput = Readonly<{
  purpose: string;
  version: string;
  verification_method: string;
}>;

export type RecordingInput = Readonly<{
  consent_record_id: string;
  kind: string;
  title: string;
  lang: string;
  duration_s: number;
}>;

export interface ContentClient {
  content(): Promise<ClientResult<ContentListBody>>;
  contentItem(contentId: string): Promise<ClientResult<ContentItemBody>>;
  grandma(): Promise<ClientResult<GrandmaBody>>;
  routines(): Promise<ClientResult<RoutinesBody>>;
  reports(): Promise<ClientResult<ReportsBody>>;
  createContent(draft: Readonly<Record<string, unknown>>): Promise<ClientResult<WriteBody>>;
  updateContent(
    contentId: string,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<ClientResult<WriteBody>>;
  setStatus(contentId: string, status: ContentStatus): Promise<ClientResult<WriteBody>>;
  addConsent(input: ConsentInput): Promise<ClientResult<WriteBody>>;
  addRecording(input: RecordingInput): Promise<ClientResult<WriteBody>>;
  scheduleRecording(
    assetId: string,
    at: string,
    enabled: boolean,
  ): Promise<ClientResult<WriteBody>>;
  call(deviceId: string, op: string): Promise<ClientResult<WriteBody>>;
  runRoutine(deviceId: string, routineId: string): Promise<ClientResult<WriteBody>>;
}

/** The fetch this client uses. Injected in tests; the browser's own otherwise. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refuse(code: string): ClientRefusal {
  return { code, field: null, reason: null, verdict: null, gate: null };
}

/** The field path as one dotted string, or null. Never a submitted value: the surface sends none. */
function fieldPath(error: Record<string, unknown>): string | null {
  const issues = error["issues"];
  if (!Array.isArray(issues)) return null;
  const first: unknown = issues[0];
  if (!isRecord(first) || !Array.isArray(first["path"])) return null;
  return first["path"].map((segment) => String(segment)).join(".");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function verdictOf(value: unknown): GateVerdictView | null {
  if (!isRecord(value) || typeof value["ok"] !== "boolean") return null;
  return value as unknown as GateVerdictView;
}

function gateOf(value: unknown): GateRefusalView | null {
  if (!isRecord(value) || typeof value["rule"] !== "string") return null;
  return value as unknown as GateRefusalView;
}

function refusalFrom(body: Record<string, unknown>): ClientRefusal {
  const error = isRecord(body["error"]) ? body["error"] : {};
  return {
    code: text(error["code"]) ?? PROXY_DISABLED,
    field: fieldPath(error),
    reason: text(body["reason"]),
    verdict: verdictOf(body["verdict"]),
    gate: gateOf(body["gate"]),
  };
}

export function createContentClient(fetchImpl?: FetchLike): ContentClient {
  const doFetch: FetchLike =
    fetchImpl ?? ((input, init) => fetch(input, init === undefined ? {} : init));

  async function request<T>(path: string, body?: unknown): Promise<ClientResult<T>> {
    let response: Response;
    try {
      response = await doFetch(
        path,
        body === undefined
          ? { method: "GET", credentials: "omit" }
          : {
              method: "POST",
              credentials: "omit",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
    } catch {
      return { ok: false, refusal: refuse(UNREACHABLE) };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      // Not JSON: the dev server answered instead of the Operator_Surface (Req 17.6a).
      return { ok: false, refusal: refuse(PROXY_DISABLED) };
    }
    if (!isRecord(parsed) || typeof parsed["ok"] !== "boolean") {
      return { ok: false, refusal: refuse(PROXY_DISABLED) };
    }
    if (parsed["ok"] !== true) return { ok: false, refusal: refusalFrom(parsed) };
    return { ok: true, value: parsed as unknown as T };
  }

  return {
    content: () => request<ContentListBody>(CONTENT_PATHS.content),
    contentItem: (contentId) =>
      request<ContentItemBody>(`${CONTENT_PATHS.content}?id=${encodeURIComponent(contentId)}`),
    grandma: () => request<GrandmaBody>(CONTENT_PATHS.grandma),
    routines: () => request<RoutinesBody>(CONTENT_PATHS.routines),
    reports: () => request<ReportsBody>(CONTENT_PATHS.reports),
    createContent: (draft) => request<WriteBody>(CONTENT_PATHS.contentCreate, draft),
    updateContent: (contentId, patch) =>
      request<WriteBody>(CONTENT_PATHS.contentUpdate, { content_id: contentId, patch }),
    setStatus: (contentId, status) =>
      request<WriteBody>(CONTENT_PATHS.contentStatus, { content_id: contentId, status }),
    addConsent: (input) => request<WriteBody>(CONTENT_PATHS.grandmaConsent, input),
    addRecording: (input) => request<WriteBody>(CONTENT_PATHS.grandmaRecording, input),
    scheduleRecording: (assetId, at, enabled) =>
      request<WriteBody>(CONTENT_PATHS.grandmaSchedule, { asset_id: assetId, at, enabled }),
    call: (deviceId, op) =>
      request<WriteBody>(CONTENT_PATHS.grandmaCall, { device_id: deviceId, op }),
    runRoutine: (deviceId, routineId) =>
      request<WriteBody>(CONTENT_PATHS.routineRun, { device_id: deviceId, routine: routineId }),
  };
}
