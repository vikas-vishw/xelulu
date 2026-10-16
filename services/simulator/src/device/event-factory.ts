// Event factory (Req 2.4, 2.6, 16.1–16.4, 16.7, G48). Builds a newly fired event:
//   1. the kind must be one of EVENT_KINDS, else one `invalid_value` issue at ["event"];
//   2. only the omitted `data` fields are filled with the Req 16.7 defaults; supplied values are
//      kept exactly as given, even when invalid, so the contract decides;
//   3. `{ proto_ver, ts, type, event_id, event, data }` with no `time_uncertain`, checked by
//      `serialiseEventMessage`; a ContractError becomes at most 20 Safe_Issues.
// Each default that is a closed-list value is typed by its contract list, and a unit test checks
// it is a member, so no wire value list is restated here.
import {
  ContractError,
  EVENT_KINDS,
  serialiseEventMessage,
  toSafeIssues,
  type ButtonAction,
  type ButtonName,
  type EventKind,
  type EventMessage,
  type MotionKind,
  type SafeIssue,
  type TouchGesture,
  type TouchZone,
  type WakeSource,
} from "@xelulu/shared";

export type EventRequest = Readonly<{
  event: string;
  data?: Readonly<Record<string, unknown>> | undefined;
}>;

export type BuildEventResult =
  | { readonly ok: true; readonly message: EventMessage; readonly payload: string }
  | { readonly ok: false; readonly issues: readonly SafeIssue[] };

const DEFAULT_ZONE: TouchZone = "belly";
const DEFAULT_GESTURE: TouchGesture = "tap";
const DEFAULT_WAKE_SOURCE: WakeSource = "hey_lulu";
const DEFAULT_MOTION: MotionKind = "pickup";
const DEFAULT_BUTTON: ButtonName = "belly_talk";
const DEFAULT_BUTTON_ACTION: ButtonAction = "press";

/** The Req 16.7 defaults per kind. Wake has no `dir_deg` default; interrupt data is `{}`. */
export const EVENT_DATA_DEFAULTS: Readonly<Record<EventKind, Readonly<Record<string, unknown>>>> =
  Object.freeze({
    touch: Object.freeze({ zone: DEFAULT_ZONE, gesture: DEFAULT_GESTURE }),
    wake: Object.freeze({ source: DEFAULT_WAKE_SOURCE }),
    cry: Object.freeze({ confidence: 0.9, duration_s: 6 }),
    motion: Object.freeze({ event: DEFAULT_MOTION, value: 0 }),
    button: Object.freeze({ button: DEFAULT_BUTTON, action: DEFAULT_BUTTON_ACTION }),
    nfc: Object.freeze({ card_id: "sim-card-1" }),
    interrupt: Object.freeze({}),
    error: Object.freeze({ code: "sim_error", detail: "" }),
  });

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The supplied data with only its omitted default fields filled in. */
export function withDefaults(
  kind: EventKind,
  data: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) };
  for (const [key, value] of Object.entries(EVENT_DATA_DEFAULTS[kind])) {
    if (!Object.hasOwn(out, key)) out[key] = value;
  }
  return out;
}

export function buildEvent(req: EventRequest, eventId: string, ts: number): BuildEventResult {
  if (!isEventKind(req.event)) {
    return { ok: false, issues: [{ path: ["event"], kind: "invalid_value" }] };
  }
  if (req.data !== undefined && !isPlainObject(req.data)) {
    return { ok: false, issues: [{ path: ["data"], kind: "invalid_type" }] };
  }
  const candidate = {
    proto_ver: 2,
    ts,
    type: "event",
    event_id: eventId,
    event: req.event,
    data: withDefaults(req.event, req.data),
  } as unknown as EventMessage;
  try {
    const payload = serialiseEventMessage(candidate);
    return { ok: true, message: JSON.parse(payload) as EventMessage, payload };
  } catch (error) {
    // The codec only throws ContractError, whose issues carry paths and kinds, never values.
    const issues: readonly SafeIssue[] =
      error instanceof ContractError ? toSafeIssues(error.issues) : [{ path: [], kind: "custom" }];
    return { ok: false, issues };
  }
}
