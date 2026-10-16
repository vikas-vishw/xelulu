// Test helper (not a test): fast-check generators for the simulator, built from the contract
// constants exported by @xelulu/shared. Command payloads are produced only by the shared
// serialisers; invalid commands are valid ones with one change.
//
// "Sentinel" means a generated string of at least 8 characters that starts with `§`, a character
// no identifier, key name, issue kind or field name in the system contains, so finding one in
// output can only mean a value leaked.
import fc from "fast-check";

import {
  ACK_REASONS,
  BUTTONS,
  BUTTON_ACTIONS,
  CMD_ACTIONS,
  EVENT_KINDS,
  LED_EFFECTS,
  LED_TARGETS,
  MODES,
  MOTION_KINDS,
  MOVE_COMMANDS,
  PLAY_SOURCES,
  SAY_VOICES,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  serialiseCmdMessage,
  type CmdAction,
  type CmdMessage,
  type EventKind,
  type MoveCmdData,
} from "@xelulu/shared";

import type { AckOverride, AckPolicy } from "../../src/device/ack-policy.js";

// ---------------------------------------------------------------------------------------------
// Strings.

export const SENTINEL_PREFIX = "§";

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const alnumChar = fc.constantFrom(...ALNUM.split(""));

/** `§` followed by 7 to 31 letters or digits: 8 to 32 characters in all. */
export const sentinelArb: fc.Arbitrary<string> = fc
  .string({ unit: alnumChar, minLength: 7, maxLength: 31 })
  .map((s) => SENTINEL_PREFIX + s);

/** One printable ASCII character, U+0020 to U+007E. */
export const printableChar: fc.Arbitrary<string> = fc
  .integer({ min: 0x20, max: 0x7e })
  .map((c) => String.fromCharCode(c));

/** One code point outside printable ASCII: a control character or any non-ASCII scalar value. */
export const nonPrintableChar: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 0x00, max: 0x1f }).map((c) => String.fromCharCode(c)),
  fc.constant("\u007f"),
  fc
    .integer({ min: 0x80, max: 0x10ffff })
    .filter((c) => c < 0xd800 || c > 0xdfff)
    .map((c) => String.fromCodePoint(c)),
);

/**
 * Unknown key names: 33 to 200 code points, mixing printable and non-printable characters, so
 * every one is longer than the 32-code-point Safe_Issue limit and is never a declared field name.
 */
export const unknownKeyArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(printableChar, nonPrintableChar), { minLength: 33, maxLength: 200 })
  .map((cps) => cps.join(""));

/** Identifiers (cmd_id): non-empty URL-safe strings. */
export const idArb: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z0-9_-]{1,32}$/);

const finiteArb = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((x) => (Object.is(x, -0) ? 0 : x));
const unitArb = fc.double({ min: 0, max: 1, noNaN: true }).map((x) => (Object.is(x, -0) ? 0 : x));
const nonNegArb = fc
  .double({ min: 0, noNaN: true, noDefaultInfinity: true })
  .map((x) => (Object.is(x, -0) ? 0 : x));
const pctArb = fc.integer({ min: 0, max: 100 });
const langArb = fc.constantFrom("en", "en-IN", "hi-IN", "ta-IN", "hi-Deva-IN", "es-419");
const hhmmArb = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
const colorArb = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => "#" + n.toString(16).padStart(6, "0"));
/** An absolute https URL built from parts, with a sentinel in its path. */
const httpsUrlArb = sentinelArb.map((s) => "https" + "://" + "updates.example/" + s);

// ---------------------------------------------------------------------------------------------
// Event requests (Control_Surface `POST /api/events` bodies).

/** Every contract-valid `data` for one kind, with every field present (wake may carry dir_deg). */
export function fullEventDataArb(kind: EventKind): fc.Arbitrary<Record<string, unknown>> {
  switch (kind) {
    case "touch":
      return fc.record({
        zone: fc.constantFrom(...TOUCH_ZONES),
        gesture: fc.constantFrom(...TOUCH_GESTURES),
      });
    case "wake":
      return fc.record(
        { source: fc.constantFrom(...WAKE_SOURCES), dir_deg: fc.integer({ min: 0, max: 359 }) },
        { requiredKeys: ["source"] },
      );
    case "cry":
      return fc.record({ confidence: unitArb, duration_s: nonNegArb });
    case "motion":
      return fc.record({ event: fc.constantFrom(...MOTION_KINDS), value: finiteArb });
    case "button":
      return fc.record({
        button: fc.constantFrom(...BUTTONS),
        action: fc.constantFrom(...BUTTON_ACTIONS),
      });
    case "nfc":
      return fc.record({ card_id: sentinelArb });
    case "interrupt":
      return fc.constant({});
    case "error":
      return fc.record({ code: sentinelArb, detail: fc.oneof(fc.constant(""), sentinelArb) });
  }
}

export type EventRequestCase = {
  readonly event: EventKind;
  /** The request's `data`, or undefined when the request has no `data` key. */
  readonly data: Readonly<Record<string, unknown>> | undefined;
  /** The fields of the full data that the request leaves out. */
  readonly omitted: readonly string[];
};

/** A valid event request of any kind whose omitted `data` fields are a random subset. */
export const eventRequestArb: fc.Arbitrary<EventRequestCase> = fc
  .constantFrom(...EVENT_KINDS)
  .chain((event) =>
    fc.tuple(
      fc.constant(event),
      fullEventDataArb(event),
      fc.boolean(),
      fc.infiniteStream(fc.boolean()),
    ),
  )
  .map(([event, full, dropData, keep]): EventRequestCase => {
    const keys = Object.keys(full);
    const it = keep[Symbol.iterator]();
    const kept: Record<string, unknown> = {};
    const omitted: string[] = [];
    for (const k of keys) {
      if (it.next().value === true) kept[k] = full[k];
      else omitted.push(k);
    }
    if (dropData && Object.keys(kept).length === 0) return { event, data: undefined, omitted };
    return { event, data: kept, omitted };
  });

// ---------------------------------------------------------------------------------------------
// Commands.

function moveDataArb(): fc.Arbitrary<MoveCmdData> {
  return fc.constantFrom(...MOVE_COMMANDS).chain((cmd): fc.Arbitrary<MoveCmdData> => {
    if (cmd === "stop") {
      return fc.record(
        {
          cmd: fc.constant("stop" as const),
          linear_mms: nonNegArb,
          angular_mrad_s: nonNegArb,
          max_dist_mm: nonNegArb,
        },
        { requiredKeys: ["cmd", "max_dist_mm"] },
      );
    }
    return fc.record({
      cmd: fc.constant(cmd),
      linear_mms: nonNegArb,
      angular_mrad_s: nonNegArb,
      max_dist_mm: nonNegArb,
    });
  });
}

const configDataArb = fc
  .record(
    {
      volume: pctArb,
      quiet_hours: fc.record({ start: hhmmArb, end: hhmmArb }),
      movement_on: fc.boolean(),
      language: langArb,
      active_child_id: fc.option(sentinelArb, { nil: null }),
    },
    { requiredKeys: [] },
  )
  .filter((d) => Object.keys(d).length > 0);

/** The `data` of one action, with sentinels in free-text fields. */
export function cmdDataArb(action: CmdAction): fc.Arbitrary<CmdMessage["data"]> {
  switch (action) {
    case "say":
      return fc.record({
        expression: sentinelArb,
        lang: langArb,
        voice: fc.constantFrom(...SAY_VOICES),
        duration_hint_ms: fc.nat({ max: 60_000 }),
      });
    case "animate":
      return fc.record({ expression: sentinelArb, eyes: sentinelArb, loop: fc.boolean() });
    case "gesture":
      return fc.record({ name: sentinelArb });
    case "move":
      return moveDataArb();
    case "play":
      return fc.record({ content_id: sentinelArb, source: fc.constantFrom(...PLAY_SOURCES) });
    case "set_mode":
      return fc.record({ mode: fc.constantFrom(...MODES) });
    case "led":
      return fc.record({
        target: fc.constantFrom(...LED_TARGETS),
        color: colorArb,
        effect: fc.constantFrom(...LED_EFFECTS),
        brightness: pctArb,
      });
    case "volume":
      return fc.record({ level: pctArb });
    case "config":
      return configDataArb;
    case "stop_audio":
      return fc.constant({});
    case "ota":
      return fc.record({ manifest_url: httpsUrlArb });
  }
}

/** A valid command of the given actions (all 11 by default). */
export function cmdArb(
  opts: { actions?: readonly CmdAction[]; cmdId?: fc.Arbitrary<string> } = {},
): fc.Arbitrary<CmdMessage> {
  return fc.constantFrom(...(opts.actions ?? CMD_ACTIONS)).chain((action) =>
    fc
      .record({
        proto_ver: fc.constant(2 as const),
        cmd_id: opts.cmdId ?? idArb,
        action: fc.constant(action),
        data: cmdDataArb(action),
      })
      .map((m) => m as CmdMessage),
  );
}

/** A valid command serialised with the shared codec. */
export function cmdPayloadArb(
  opts: { actions?: readonly CmdAction[]; cmdId?: fc.Arbitrary<string> } = {},
): fc.Arbitrary<{ message: CmdMessage; payload: string }> {
  return cmdArb(opts).map((message) => ({ message, payload: serialiseCmdMessage(message) }));
}

export type InvalidCmdCase = {
  readonly payload: string;
  /** True when the change is to `proto_ver` (missing or wrong). */
  readonly protoVer: boolean;
};

/** Commands that fail `parseCmdMessage`, each a valid command with one change. */
export const invalidCmdArb: fc.Arbitrary<InvalidCmdCase> = fc
  .tuple(
    cmdArb(),
    fc.constantFrom(
      "unknown_key",
      "unknown_data_key",
      "wrong_proto_ver",
      "drop_proto_ver",
      "drop_cmd_id",
      "empty_cmd_id",
      "unknown_action",
      "data_not_object",
      "has_ts",
      "not_json",
      "not_object",
    ),
    unknownKeyArb,
    sentinelArb,
    fc.constantFrom<unknown>(1, 3, "2", null),
  )
  .map(([message, how, unknownKey, sentinel, protoVer]): InvalidCmdCase => {
    const copy: Record<string, unknown> = JSON.parse(serialiseCmdMessage(message)) as Record<
      string,
      unknown
    >;
    switch (how) {
      case "unknown_key":
        copy[unknownKey] = sentinel;
        break;
      case "unknown_data_key":
        copy["data"] = { ...(copy["data"] as object), [unknownKey]: sentinel };
        break;
      case "wrong_proto_ver":
        copy["proto_ver"] = protoVer;
        break;
      case "drop_proto_ver":
        delete copy["proto_ver"];
        break;
      case "drop_cmd_id":
        delete copy["cmd_id"];
        break;
      case "empty_cmd_id":
        copy["cmd_id"] = "";
        break;
      case "unknown_action":
        copy["action"] = sentinel;
        break;
      case "data_not_object":
        copy["data"] = sentinel;
        break;
      case "has_ts":
        copy["ts"] = 1_760_000_000;
        break;
      case "not_json":
        return { payload: "{" + sentinel, protoVer: false };
      case "not_object":
        return { payload: JSON.stringify([sentinel]), protoVer: false };
    }
    return {
      payload: JSON.stringify(copy),
      protoVer: how === "wrong_proto_ver" || how === "drop_proto_ver",
    };
  });

// ---------------------------------------------------------------------------------------------
// Ack_Policies.

export const ackOverrideArb: fc.Arbitrary<AckOverride> = fc.oneof(
  fc.constantFrom(...ACK_REASONS).map((reason): AckOverride => ({ mode: "reject", reason })),
  fc
    .constantFrom("" as const, ...ACK_REASONS)
    .map((reason): AckOverride => ({ mode: "fail", reason })),
  fc.constant<AckOverride>({ mode: "accept_only" }),
  fc.constant<AckOverride>({ mode: "silent" }),
);

/** Per-action overrides, an all-actions override, both or neither. */
export const ackPolicyArb: fc.Arbitrary<AckPolicy> = fc
  .tuple(
    fc.option(ackOverrideArb, { nil: null }),
    fc.subarray([...CMD_ACTIONS]),
    fc.infiniteStream(ackOverrideArb),
  )
  .map(([all, actions, overrides]): AckPolicy => {
    const it = overrides[Symbol.iterator]();
    const byAction: Partial<Record<CmdAction, AckOverride>> = {};
    for (const a of actions) byAction[a] = it.next().value as AckOverride;
    return { all, byAction };
  });

/** An Ack_Policy scope: all actions or one action. */
export const ackScopeArb: fc.Arbitrary<"all" | CmdAction> = fc.constantFrom(
  "all" as const,
  ...CMD_ACTIONS,
);

// ---------------------------------------------------------------------------------------------
// Control_Surface requests (method, path and body, before any header is added).

export type ControlRequestCase = {
  readonly method: string;
  readonly path: string;
  readonly body: string;
};

const CONTROL_POST_PATHS = [
  "/api/events",
  "/api/audio-turn",
  "/api/connection",
  "/api/duplicate-replay",
  "/api/ack-policy",
  "/api/ack-policy/clear",
  "/api/battery",
] as const;

/** Valid and invalid Control_Surface requests with sentinel values in their bodies. */
export const controlRequestArb: fc.Arbitrary<ControlRequestCase> = fc.oneof(
  // Event requests with sentinels in free-text fields and unknown keys.
  fc
    .tuple(eventRequestArb, fc.option(fc.tuple(unknownKeyArb, sentinelArb), { nil: null }))
    .map(([req, extra]): ControlRequestCase => {
      const data: Record<string, unknown> = { ...(req.data ?? {}) };
      if (extra !== null) data[extra[0]] = extra[1];
      return {
        method: "POST",
        path: "/api/events",
        body: JSON.stringify({ event: req.event, data }),
      };
    }),
  // Invalid overrides.
  fc
    .tuple(ackScopeArb, sentinelArb, fc.constantFrom("reject", "fail", "accept_only"))
    .map(([scope, s, mode]): ControlRequestCase => ({
      method: "POST",
      path: "/api/ack-policy",
      body: JSON.stringify({ scope, override: { mode, reason: s } }),
    })),
  // Non-JSON, non-object and unknown-key bodies on every POST route.
  fc
    .tuple(
      fc.constantFrom(...CONTROL_POST_PATHS),
      sentinelArb,
      unknownKeyArb,
      fc.constantFrom("not_json", "not_object", "unknown_key"),
    )
    .map(([path, s, key, how]): ControlRequestCase => ({
      method: "POST",
      path,
      body:
        how === "not_json"
          ? "{" + s
          : how === "not_object"
            ? JSON.stringify([s])
            : JSON.stringify({ [key]: s }),
    })),
  // Unknown operations and wrong methods.
  sentinelArb.map((s): ControlRequestCase => ({ method: "POST", path: "/api/" + s, body: "{}" })),
  fc
    .constantFrom(...CONTROL_POST_PATHS)
    .map((path): ControlRequestCase => ({ method: "GET", path, body: "" })),
);
