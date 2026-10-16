// Control_Surface routes (Req 16.1, 16.2, 16.4, 17.7, 18.8, 19.8, 20.2, 20.5, 20.6, G46) as a
// pure handler. The HTTP listener in transport/ feeds it; it binds 127.0.0.1 only, in every mode,
// except 0.0.0.0 in Local_Mode with the Listen_All_Argument (Phase 1.3 Req 3.2), and caps bodies
// at 16 KiB. Routes:
//   GET  /, /panel.css, /panel.js  -> the panel's static files
//   GET  /api/state                -> SimulatorState
//   POST /api/events               -> { ok, event_id, ts, queued }
//   POST /api/audio-turn           -> { ok, turn_id }   (optional `utterance`, Req 19.1)
//   POST /api/connection           -> { ok, online }
//   POST /api/duplicate-replay     -> { ok, enabled }
//   POST /api/ack-policy           -> { ok, policy }
//   POST /api/ack-policy/clear     -> { ok, policy }
//   POST /api/battery              -> { ok }
// Every refusal is { ok: false, error: { code, issues? } }, adds one `control_rejected` entry
// with Safe_Issues only, never echoes a submitted value, and runs before any side effect, so it
// changes no state and publishes nothing. No response carries an env value except `DEVICE_ID`.
import {
  ACK_REASONS,
  BUTTONS,
  BUTTON_ACTIONS,
  CMD_ACTIONS,
  EVENT_KINDS,
  MOTION_KINDS,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  toSafeIssues,
  type AckReason,
  type AckStatus,
  type ButtonAction,
  type ButtonName,
  type CmdAction,
  type EventKind,
  type Mode,
  type MotionKind,
  type SafeIssue,
  type TouchGesture,
  type TouchZone,
  type WakeSource,
} from "@xelulu/shared";

import type { LastTurn, TurnRequestResult } from "../audio/audio-turn-client.js";
import { findTestUtterance, TEST_UTTERANCE_NAMES } from "../audio/test-utterances.js";
import type { Clock } from "../clock.js";
import {
  clearOverride,
  parseAckOverride,
  parseAckScope,
  setOverride,
  type AckPolicy,
} from "../device/ack-policy.js";
import { copyDeviceState, type DeviceState } from "../device/device-state.js";
import type { EventRequest } from "../device/event-factory.js";
import { serialiseStatus } from "../device/heartbeat.js";
import type { SimLog } from "../log/logger.js";
import type { ToggleResult } from "../mqtt/device-link.js";
import { CONTROL_SECURITY_HEADERS, type PanelAssetName, type PanelAssets } from "./panel-assets.js";
import {
  CONTROL_BODY_LIMIT_BYTES,
  createControlGuard,
  type ControlErrorCode,
  type ControlGuard,
  type GuardHead,
  type RouteMethods,
} from "./request-guard.js";

export { CONTROL_BODY_LIMIT_BYTES };

export const CONTROL_ROUTES: RouteMethods = Object.freeze({
  "/": Object.freeze(["GET"]),
  "/panel.css": Object.freeze(["GET"]),
  "/panel.js": Object.freeze(["GET"]),
  "/api/state": Object.freeze(["GET"]),
  "/api/events": Object.freeze(["POST"]),
  "/api/audio-turn": Object.freeze(["POST"]),
  "/api/connection": Object.freeze(["POST"]),
  "/api/duplicate-replay": Object.freeze(["POST"]),
  "/api/ack-policy": Object.freeze(["POST"]),
  "/api/ack-policy/clear": Object.freeze(["POST"]),
  "/api/battery": Object.freeze(["POST"]),
});

const ASSET_ROUTES: Readonly<Record<string, PanelAssetName>> = Object.freeze({
  "/": "index.html",
  "/panel.css": "panel.css",
  "/panel.js": "panel.js",
});

export type ControlRequestIn = Readonly<{
  method: string;
  path: string;
  query: Readonly<Record<string, string>>;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  /** Already capped by the transport. */
  body: string;
}>;

/** A complete response: the transport writes the status, the headers and the body as given. */
export type ControlResponseOut = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

/**
 * The panel's lists, copied from the contract constants at start-up (no list restated), plus the
 * Simulator's own Test_Utterance names, which are not a wire list (Req 19.6).
 */
export type SimulatorChoices = Readonly<{
  event_kinds: readonly EventKind[];
  touch_zones: readonly TouchZone[];
  touch_gestures: readonly TouchGesture[];
  wake_sources: readonly WakeSource[];
  motion_kinds: readonly MotionKind[];
  buttons: readonly ButtonName[];
  button_actions: readonly ButtonAction[];
  cmd_actions: readonly CmdAction[];
  ack_reasons: readonly AckReason[];
  utterances: readonly string[];
}>;

export type ReceivedCommandView = Readonly<{
  cmd_id: string;
  action: CmdAction;
  acks: readonly Readonly<{ status: AckStatus; reason: "" | AckReason }>[];
}>;

export type SimulatorState = Readonly<{
  ok: true;
  device_id: string;
  online: boolean;
  queue_length: number;
  duplicate_replay: boolean;
  ack_policy: AckPolicy;
  battery_pct: number;
  charging: boolean;
  mode: Mode;
  /** The last 50, oldest first. */
  received_commands: readonly ReceivedCommandView[];
  last_turn: LastTurn | null;
  choices: SimulatorChoices;
}>;

/** What the composition root reports for `/api/state`; the routes add the rest. */
export type SimulatorStateView = Readonly<{
  online: boolean;
  queue_length: number;
  duplicate_replay: boolean;
  received_commands: readonly ReceivedCommandView[];
  last_turn: LastTurn | null;
}>;

export type FireEventResult =
  | {
      readonly ok: true;
      readonly event_id: string;
      readonly ts: number;
      readonly queued: boolean;
    }
  | { readonly ok: false; readonly issues: readonly SafeIssue[] };

export type ControlRouteDeps = Readonly<{
  deviceId: string;
  clock: Clock;
  log: SimLog;
  /** The port actually listened on, for the Host and Origin checks. */
  port: () => number;
  assets: PanelAssets;
  /** The device state; the battery route sets `battery_pct` and `charging` on it. */
  state: DeviceState;
  view: () => SimulatorStateView;
  /** Builds, validates and publishes (or queues) one event; refuses with Safe_Issues. */
  fireEvent: (request: EventRequest) => FireEventResult;
  /** Starts one turn; a named Test_Utterance supplies its upload frames (Req 19.2). */
  startAudioTurn: (utterance?: string) => TurnRequestResult;
  setOnline: (online: boolean) => ToggleResult;
  setDuplicateReplay: (on: boolean) => void;
  ackPolicy: () => AckPolicy;
  setAckPolicy: (policy: AckPolicy) => void;
}>;

/** The Control_Surface listener (implemented in transport/http-listener.ts). */
export type ControlListen = (opts: {
  readonly host: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  /** Header checks, run before any body byte is read; null lets the request go on. */
  preflight(head: GuardHead): ControlResponseOut | null;
  /** The answer to a body over the 16 KiB cap. */
  bodyTooLarge(): ControlResponseOut;
  handle(request: ControlRequestIn): ControlResponseOut;
}) => Promise<{ readonly port: number; close(): Promise<void> }>;

export interface ControlRoutes {
  preflight(head: GuardHead): ControlResponseOut | null;
  bodyTooLarge(): ControlResponseOut;
  handle(request: ControlRequestIn): ControlResponseOut;
}

export const SIMULATOR_CHOICES: SimulatorChoices = Object.freeze({
  event_kinds: Object.freeze([...EVENT_KINDS]),
  touch_zones: Object.freeze([...TOUCH_ZONES]),
  touch_gestures: Object.freeze([...TOUCH_GESTURES]),
  wake_sources: Object.freeze([...WAKE_SOURCES]),
  motion_kinds: Object.freeze([...MOTION_KINDS]),
  buttons: Object.freeze([...BUTTONS]),
  button_actions: Object.freeze([...BUTTON_ACTIONS]),
  cmd_actions: Object.freeze([...CMD_ACTIONS]),
  ack_reasons: Object.freeze([...ACK_REASONS]),
  utterances: Object.freeze([...TEST_UTTERANCE_NAMES]),
});

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  ...CONTROL_SECURITY_HEADERS,
});

function json(status: number, body: unknown): ControlResponseOut {
  return { status, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type FieldCheck = (value: unknown) => boolean;
type FieldSpec = Readonly<Record<string, Readonly<{ required: boolean; valid: FieldCheck }>>>;

const isBoolean: FieldCheck = (v) => typeof v === "boolean";
const isString: FieldCheck = (v) => typeof v === "string";
const isNumber: FieldCheck = (v) => typeof v === "number" && Number.isFinite(v);
const isAnything: FieldCheck = () => true;

/** Missing or wrongly typed fields, then unknown keys, as Safe_Issues. */
function fieldIssues(body: Record<string, unknown>, spec: FieldSpec): SafeIssue[] {
  const issues: SafeIssue[] = [];
  for (const [name, rule] of Object.entries(spec)) {
    if (!Object.hasOwn(body, name)) {
      if (rule.required) issues.push({ path: [name], kind: "invalid_type" });
      continue;
    }
    if (!rule.valid(body[name])) issues.push({ path: [name], kind: "invalid_type" });
  }
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(spec, key)) issues.push({ path: [key], kind: "unrecognized_keys" });
  }
  return issues;
}

export function createControlRoutes(deps: ControlRouteDeps): ControlRoutes {
  let guard: ControlGuard | null = null;

  /** Built once for the listening port, so the allowed origins are made at start-up. */
  function currentGuard(): ControlGuard {
    const port = deps.port();
    if (guard === null || guard.port !== port) guard = createControlGuard(port, CONTROL_ROUTES);
    return guard;
  }

  function refuse(
    status: number,
    code: ControlErrorCode,
    issues?: readonly SafeIssue[],
  ): ControlResponseOut {
    const safe = issues === undefined ? [] : toSafeIssues(issues);
    deps.log.add({ kind: "control_rejected", code, issues: safe });
    return json(status, {
      ok: false,
      error: issues === undefined ? { code } : { code, issues: safe },
    });
  }

  /** The JSON object body checked against `spec`, or the refusal. */
  function readBody(
    req: ControlRequestIn,
    spec: FieldSpec,
  ): { ok: true; body: Record<string, unknown> } | { ok: false; response: ControlResponseOut } {
    let value: unknown;
    try {
      value = JSON.parse(req.body);
    } catch {
      // The parser's message can quote the body, so it is discarded.
      return { ok: false, response: refuse(400, "invalid_json") };
    }
    if (!isPlainObject(value)) return { ok: false, response: refuse(400, "not_object") };
    const issues = fieldIssues(value, spec);
    if (issues.length > 0) {
      return { ok: false, response: refuse(400, "invalid_fields", issues) };
    }
    return { ok: true, body: value };
  }

  function state(): ControlResponseOut {
    const v = deps.view();
    const body: SimulatorState = {
      ok: true,
      device_id: deps.deviceId,
      online: v.online,
      queue_length: v.queue_length,
      duplicate_replay: v.duplicate_replay,
      ack_policy: deps.ackPolicy(),
      battery_pct: deps.state.battery_pct,
      charging: deps.state.charging,
      mode: deps.state.mode,
      received_commands: v.received_commands,
      last_turn: v.last_turn,
      choices: SIMULATOR_CHOICES,
    };
    return json(200, body);
  }

  function events(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, {
      event: { required: true, valid: isString },
      data: { required: false, valid: isPlainObject },
    });
    if (!read.ok) return read.response;
    const data = read.body["data"];
    const request: EventRequest = {
      event: read.body["event"] as string,
      data: data === undefined ? undefined : (data as Readonly<Record<string, unknown>>),
    };
    const result = deps.fireEvent(request);
    if (!result.ok) return refuse(422, "invalid_event", result.issues);
    return json(200, {
      ok: true,
      event_id: result.event_id,
      ts: result.ts,
      queued: result.queued,
    });
  }

  function audioTurn(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, { utterance: { required: false, valid: isString } });
    if (!read.ok) return read.response;
    const name = read.body["utterance"] as string | undefined;
    // An unknown name names the field and echoes no value, and starts no turn (Req 19.1).
    if (name !== undefined && findTestUtterance(name) === null) {
      return refuse(400, "invalid_fields", [{ path: ["utterance"], kind: "invalid_value" }]);
    }
    const result = deps.startAudioTurn(name);
    if (!result.ok) return refuse(409, result.code);
    return json(200, { ok: true, turn_id: result.turn_id });
  }

  function connection(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, { online: { required: true, valid: isBoolean } });
    if (!read.ok) return read.response;
    const result = deps.setOnline(read.body["online"] as boolean);
    return json(200, { ok: true, online: result.online });
  }

  function duplicateReplay(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, { enabled: { required: true, valid: isBoolean } });
    if (!read.ok) return read.response;
    const enabled = read.body["enabled"] as boolean;
    deps.setDuplicateReplay(enabled);
    return json(200, { ok: true, enabled });
  }

  function ackPolicy(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, {
      scope: { required: true, valid: isAnything },
      override: { required: true, valid: isAnything },
    });
    if (!read.ok) return read.response;
    const scope = parseAckScope(read.body["scope"]);
    if (scope === null) {
      return refuse(400, "invalid_fields", [{ path: ["scope"], kind: "invalid_value" }]);
    }
    const check = parseAckOverride(read.body["override"]);
    if (!check.ok) {
      if (check.code === "invalid_override") {
        return refuse(400, "invalid_fields", [{ path: ["override"], kind: "invalid_value" }]);
      }
      return refuse(422, check.code);
    }
    const policy = setOverride(deps.ackPolicy(), scope, check.override);
    deps.setAckPolicy(policy);
    return json(200, { ok: true, policy });
  }

  function ackPolicyClear(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, { scope: { required: true, valid: isAnything } });
    if (!read.ok) return read.response;
    const scope = parseAckScope(read.body["scope"]);
    if (scope === null) {
      return refuse(400, "invalid_fields", [{ path: ["scope"], kind: "invalid_value" }]);
    }
    const policy = clearOverride(deps.ackPolicy(), scope);
    deps.setAckPolicy(policy);
    return json(200, { ok: true, policy });
  }

  function battery(req: ControlRequestIn): ControlResponseOut {
    const read = readBody(req, {
      battery_pct: { required: true, valid: isNumber },
      charging: { required: true, valid: isBoolean },
    });
    if (!read.ok) return read.response;
    const pct = read.body["battery_pct"] as number;
    const charging = read.body["charging"] as boolean;
    // The contract decides the range: a status with the new values must serialise.
    const candidate = copyDeviceState(deps.state);
    candidate.battery_pct = pct;
    candidate.charging = charging;
    try {
      serialiseStatus(candidate, deps.clock.now());
    } catch {
      return refuse(422, "battery_out_of_range");
    }
    deps.state.battery_pct = pct;
    deps.state.charging = charging;
    return json(200, { ok: true });
  }

  function asset(name: PanelAssetName): ControlResponseOut {
    const a = deps.assets[name];
    return {
      status: 200,
      headers: Object.freeze({ "Content-Type": a.contentType, ...CONTROL_SECURITY_HEADERS }),
      body: a.body,
    };
  }

  function preflight(head: GuardHead): ControlResponseOut | null {
    const refusal = currentGuard().check(head);
    return refusal === null ? null : refuse(refusal.status, refusal.code);
  }

  return {
    preflight,

    bodyTooLarge: () => refuse(413, "body_too_large"),

    handle(req) {
      const refused = preflight(req);
      if (refused !== null) return refused;
      const queryKeys = Object.keys(req.query);
      if (queryKeys.length > 0) {
        return refuse(
          400,
          "invalid_fields",
          queryKeys.map((k): SafeIssue => ({ path: [k], kind: "unrecognized_keys" })),
        );
      }
      const assetName = Object.hasOwn(ASSET_ROUTES, req.path) ? ASSET_ROUTES[req.path] : undefined;
      if (assetName !== undefined) return asset(assetName);
      switch (req.path) {
        case "/api/state":
          return state();
        case "/api/events":
          return events(req);
        case "/api/audio-turn":
          return audioTurn(req);
        case "/api/connection":
          return connection(req);
        case "/api/duplicate-replay":
          return duplicateReplay(req);
        case "/api/ack-policy":
          return ackPolicy(req);
        case "/api/ack-policy/clear":
          return ackPolicyClear(req);
        default:
          return battery(req);
      }
    },
  };
}
