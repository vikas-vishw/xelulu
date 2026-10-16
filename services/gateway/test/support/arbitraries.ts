// Test helper (not a test): fast-check generators built from the contract and Gateway_Log
// constants exported by @xelulu/shared. Wire payloads are produced only by the shared serialisers.
//
// "Sentinel" means a generated string of at least 8 characters that starts with `§`, a character
// no identifier, key name, issue kind or field name in the system contains, so finding one in
// output can only mean a value leaked.
import fc from "fast-check";

import {
  ABORT_CAUSES,
  ACK_REASONS,
  ACK_RESULT_OUTCOMES,
  ACK_STATUSES,
  AUDIO_TURN_PHASES,
  BUTTONS,
  BUTTON_ACTIONS,
  CMD_ACTIONS,
  EVENT_KINDS,
  GATEWAY_ISSUE_KINDS,
  GATEWAY_STATES,
  MODES,
  MOTION_KINDS,
  PRESENCE_CAUSES,
  TIMEOUT_CAUSES,
  TOPIC_PREFIX,
  TOPIC_SUFFIXES,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  buildTopic,
  serialiseAckMessage,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  serialiseEventMessage,
  serialiseHelloMessage,
  serialiseStatusMessage,
  type AckMessage,
  type AudioEndMessage,
  type AudioStartMessage,
  type ContractIssueKind,
  type EventMessage,
  type HelloMessage,
  type LoggedEvent,
  type MessageVariantName,
  type SafeIssue,
  type SafeIssueKind,
  type StatusMessage,
  type TopicSuffix,
} from "@xelulu/shared";

import type { LogEntryFields } from "../../src/log/gateway-log.js";

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

/** Device ids that make a valid topic: non-empty, no `/`, `+` or `#`. */
export const deviceIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^xlu_[0-9]{6}$/),
  fc.string({ unit: alnumChar, minLength: 1, maxLength: 24 }),
);

/** Identifiers (event_id, cmd_id, turn_id): non-empty URL-safe strings. */
export const idArb: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z0-9_-]{1,32}$/);

// ---------------------------------------------------------------------------------------------
// Valid wire messages (objects). Free-text and Open_Vocabulary strings are sentinels by default.

export const tsArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(0, Number.MAX_SAFE_INTEGER),
  fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }),
  fc.maxSafeNat(),
);

const finiteArb = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((x) => (Object.is(x, -0) ? 0 : x));
const unitArb = fc.double({ min: 0, max: 1, noNaN: true }).map((x) => (Object.is(x, -0) ? 0 : x));
const nonNegArb = fc
  .double({ min: 0, noNaN: true, noDefaultInfinity: true })
  .map((x) => (Object.is(x, -0) ? 0 : x));

export function helloArb(
  opts: { deviceId?: fc.Arbitrary<string>; auth?: fc.Arbitrary<string> } = {},
): fc.Arbitrary<HelloMessage> {
  return fc.record({
    proto_ver: fc.constant(2 as const),
    ts: tsArb,
    type: fc.constant("hello" as const),
    device_id: opts.deviceId ?? deviceIdArb,
    fw_ver: sentinelArb,
    auth: opts.auth ?? sentinelArb,
    proto: fc.constant(2 as const),
  });
}

export const statusArb: fc.Arbitrary<StatusMessage> = fc.record({
  proto_ver: fc.constant(2 as const),
  ts: tsArb,
  type: fc.constant("status" as const),
  battery_pct: fc.integer({ min: 0, max: 100 }),
  charging: fc.boolean(),
  mode: fc.constantFrom(...MODES),
  wifi_rssi: fc.integer({ min: -100, max: 0 }),
  fault: fc.array(sentinelArb, { maxLength: 3 }),
  active_child_id: fc.option(sentinelArb, { nil: null }),
  temp_c: finiteArb,
});

/** The `data` of each event kind; free text is a sentinel. */
function eventDataArb(kind: EventMessage["event"]): fc.Arbitrary<EventMessage["data"]> {
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
      return fc.record({ code: sentinelArb, detail: sentinelArb });
  }
}

/** A valid event of the given kinds (all kinds by default). */
export function eventArb(
  opts: {
    kinds?: readonly EventMessage["event"][];
    eventId?: fc.Arbitrary<string>;
    ts?: fc.Arbitrary<number>;
  } = {},
): fc.Arbitrary<EventMessage> {
  return fc.constantFrom(...(opts.kinds ?? EVENT_KINDS)).chain((kind) =>
    fc
      .record(
        {
          proto_ver: fc.constant(2 as const),
          ts: opts.ts ?? tsArb,
          type: fc.constant("event" as const),
          event_id: opts.eventId ?? idArb,
          event: fc.constant(kind),
          time_uncertain: fc.boolean(),
          data: eventDataArb(kind),
        },
        { requiredKeys: ["proto_ver", "ts", "type", "event_id", "event", "data"] },
      )
      .map((m) => m as EventMessage),
  );
}

export const ackArb: fc.Arbitrary<AckMessage> = fc
  .record({
    proto_ver: fc.constant(2 as const),
    ts: tsArb,
    type: fc.constant("ack" as const),
    cmd_id: idArb,
    status: fc.constantFrom(...ACK_STATUSES),
    reason: fc.oneof(fc.constant("" as const), fc.constantFrom(...ACK_REASONS)),
  })
  .filter((m) => !(m.status === "rejected" && m.reason === ""));

export const audioStartArb: fc.Arbitrary<AudioStartMessage> = fc.record({
  proto_ver: fc.constant(2 as const),
  ts: tsArb,
  type: fc.constant("audio_start" as const),
  turn_id: idArb,
});

export const audioEndArb: fc.Arbitrary<AudioEndMessage> = fc.record({
  proto_ver: fc.constant(2 as const),
  ts: tsArb,
  type: fc.constant("audio_end" as const),
  turn_id: idArb,
});

// ---------------------------------------------------------------------------------------------
// Valid inbound MQTT messages, serialised with the shared codecs.

export type InboundCase = {
  readonly topic: string;
  readonly suffix: Exclude<TopicSuffix, "cmd">;
  readonly variant: MessageVariantName;
  readonly payload: string;
};

/** A valid hello, status, event or ack on `deviceId`'s topics; hellos carry `deviceId`. */
export function validInboundArb(
  deviceId: string,
  opts: { auth?: fc.Arbitrary<string> } = {},
): fc.Arbitrary<InboundCase> {
  const hello = helloArb({ deviceId: fc.constant(deviceId), auth: opts.auth }).map(
    (m): InboundCase => ({
      topic: buildTopic(deviceId, "status"),
      suffix: "status",
      variant: "hello",
      payload: serialiseHelloMessage(m),
    }),
  );
  const status = statusArb.map((m): InboundCase => ({
    topic: buildTopic(deviceId, "status"),
    suffix: "status",
    variant: "status",
    payload: serialiseStatusMessage(m),
  }));
  const event = eventArb().map((m): InboundCase => ({
    topic: buildTopic(deviceId, "event"),
    suffix: "event",
    variant: m.event,
    payload: serialiseEventMessage(m),
  }));
  const ack = ackArb.map((m): InboundCase => ({
    topic: buildTopic(deviceId, "ack"),
    suffix: "ack",
    variant: "ack",
    payload: serialiseAckMessage(m),
  }));
  return fc.oneof(hello, status, event, ack);
}

/** Valid audio markers, serialised with the shared codecs. */
export const audioControlTextArb: fc.Arbitrary<string> = fc.oneof(
  audioStartArb.map(serialiseAudioStartMessage),
  audioEndArb.map(serialiseAudioEndMessage),
);

// ---------------------------------------------------------------------------------------------
// Invalid inbound MQTT messages.

/** The Safe_Issue kind the first failing step must report, or null for "any contract kind". */
export type RejectionCase = {
  readonly topic: string;
  readonly payload: Uint8Array;
  readonly expectedKind: SafeIssueKind | null;
  /** Null when the entry's device_id must be null (unparsable topic or unregistered device). */
  readonly expectedDeviceId: string | null;
};

const encoder = new TextEncoder();
const MAX_PAYLOAD_BYTES = 8_192;

/** A JSON-object payload with one invalid change; the result always fails the topic's parser. */
function mutate(
  message: Record<string, unknown>,
  how: "drop_proto_ver" | "wrong_proto_ver" | "unknown_key" | "wrong_type",
  extras: { unknownKey: string; sentinel: string; protoVer: unknown },
): string {
  const copy: Record<string, unknown> = { ...message };
  switch (how) {
    case "drop_proto_ver":
      delete copy["proto_ver"];
      break;
    case "wrong_proto_ver":
      copy["proto_ver"] = extras.protoVer;
      break;
    case "unknown_key":
      copy[extras.unknownKey] = extras.sentinel;
      break;
    case "wrong_type":
      copy["ts"] = extras.sentinel;
      break;
  }
  return JSON.stringify(copy);
}

/**
 * Inbound messages that must each give exactly one `message_rejected` entry, from every step of
 * Requirement 4.1, with sentinel values in every string field. `deviceId` is the Registered_Device.
 */
export function rejectionCaseArb(deviceId: string): fc.Arbitrary<RejectionCase> {
  const valid = validInboundArb(deviceId);

  const invalidTopic = fc
    .tuple(sentinelArb, fc.constantFrom(...TOPIC_SUFFIXES), fc.nat({ max: 5 }))
    .map(([s, suffix, shape]): RejectionCase => {
      const topics = [
        `${TOPIC_PREFIX}/${s}`,
        `${s}/${deviceId}/${suffix}`,
        `${TOPIC_PREFIX}/${s}/${suffix}/${s}`,
        `${TOPIC_PREFIX}//${suffix}`,
        `${TOPIC_PREFIX}/${s}/ota`,
        `${TOPIC_PREFIX}/${s}+/${suffix}`,
      ];
      return {
        topic: topics[shape] ?? `${TOPIC_PREFIX}/${s}`,
        payload: encoder.encode(JSON.stringify({ s })),
        expectedKind: "invalid_topic",
        expectedDeviceId: null,
      };
    });

  const unknownDevice = fc
    .tuple(
      deviceIdArb.filter((id) => id !== deviceId),
      valid,
    )
    .map(([other, c]): RejectionCase => ({
      topic: buildTopic(other, c.suffix),
      payload: encoder.encode(c.payload),
      expectedKind: "unknown_device",
      expectedDeviceId: null,
    }));

  const oversize = fc
    .tuple(valid, sentinelArb, fc.nat({ max: 512 }))
    .map(([c, s, extra]): RejectionCase => {
      const padding = s.repeat(Math.ceil((MAX_PAYLOAD_BYTES + 1 + extra) / s.length));
      return {
        topic: c.topic,
        payload: encoder.encode(c.payload.slice(0, -1) + `,"pad":${JSON.stringify(padding)}}`),
        expectedKind: "payload_too_large",
        expectedDeviceId: deviceId,
      };
    });

  const notJson = fc.tuple(valid, sentinelArb).map(([c, s]): RejectionCase => ({
    topic: c.topic,
    payload: encoder.encode(`{${s}`),
    expectedKind: "invalid_json",
    expectedDeviceId: deviceId,
  }));

  const notObject = fc.tuple(valid, sentinelArb).map(([c, s]): RejectionCase => ({
    topic: c.topic,
    payload: encoder.encode(JSON.stringify([s])),
    expectedKind: "not_object",
    expectedDeviceId: deviceId,
  }));

  const schemaFailure = fc
    .tuple(
      valid,
      fc.constantFrom(
        "drop_proto_ver" as const,
        "wrong_proto_ver" as const,
        "unknown_key" as const,
        "wrong_type" as const,
      ),
      unknownKeyArb,
      sentinelArb,
      fc.constantFrom<unknown>(1, 3, "2", null),
    )
    .map(([c, how, unknownKey, sentinel, protoVer]): RejectionCase => ({
      topic: c.topic,
      payload: encoder.encode(
        mutate(JSON.parse(c.payload) as Record<string, unknown>, how, {
          unknownKey,
          sentinel,
          protoVer,
        }),
      ),
      expectedKind: null,
      expectedDeviceId: deviceId,
    }));

  const helloMismatch = helloArb({ deviceId: sentinelArb }).map((m): RejectionCase => ({
    topic: buildTopic(deviceId, "status"),
    payload: encoder.encode(serialiseHelloMessage(m)),
    expectedKind: "device_id_mismatch",
    expectedDeviceId: deviceId,
  }));

  return fc.oneof(
    invalidTopic,
    unknownDevice,
    oversize,
    notJson,
    notObject,
    schemaFailure,
    helloMismatch,
  );
}

// ---------------------------------------------------------------------------------------------
// Generated Log_Entry fields of every kind (without log_ver, seq and at).

/** A sample of contract issue kinds; the full list is a type, not a runtime constant. */
const CONTRACT_ISSUE_KIND_SAMPLE: readonly ContractIssueKind[] = [
  "invalid_type",
  "too_big",
  "too_small",
  "unrecognized_keys",
  "invalid_value",
  "invalid_json",
  "not_object",
  "reason_required",
];

const safeSegmentArb: fc.Arbitrary<string | number> = fc.oneof(
  fc.nat(),
  fc.string({ unit: printableChar, maxLength: 32 }),
);

export const safeIssueArb: fc.Arbitrary<SafeIssue> = fc.record({
  path: fc.array(safeSegmentArb, { maxLength: 4 }),
  kind: fc.constantFrom<SafeIssueKind>(...CONTRACT_ISSUE_KIND_SAMPLE, ...GATEWAY_ISSUE_KINDS),
});

const transportArb = fc.constantFrom("mqtt" as const, "ws" as const);
const optId = fc.option(idArb, { nil: null });
const logIdArb = fc.string({ maxLength: 40 });
const countArb = fc.nat({ max: 1_000_000 });

const VARIANT_NAMES: readonly MessageVariantName[] = [
  "hello",
  "status",
  ...EVENT_KINDS,
  "audio_start",
  "audio_end",
  "ack",
  ...CMD_ACTIONS,
];

export const loggedEventArb: fc.Arbitrary<LoggedEvent> = fc.oneof(
  fc.record({
    event: fc.constant("touch" as const),
    data: fc.record({
      zone: fc.constantFrom(...TOUCH_ZONES),
      gesture: fc.constantFrom(...TOUCH_GESTURES),
    }),
  }),
  fc.record({
    event: fc.constant("wake" as const),
    data: fc.record({ source: fc.constantFrom(...WAKE_SOURCES) }),
  }),
  fc.record({
    event: fc.constant("motion" as const),
    data: fc.record({ event: fc.constantFrom(...MOTION_KINDS) }),
  }),
  fc.record({
    event: fc.constant("button" as const),
    data: fc.record({
      button: fc.constantFrom(...BUTTONS),
      action: fc.constantFrom(...BUTTON_ACTIONS),
    }),
  }),
  fc.record({
    event: fc.constantFrom("cry" as const, "nfc" as const, "interrupt" as const, "error" as const),
    data: fc.constant({}),
  }),
);

const isoArb = fc
  .integer({ min: 0, max: 253_402_300_799_999 })
  .map((ms) => new Date(ms).toISOString());

function eventFieldsArb(
  kind: "event_accepted" | "event_duplicate",
): fc.Arbitrary<LogEntryFields<"event_accepted" | "event_duplicate">> {
  return fc
    .tuple(
      fc.record({
        device_id: logIdArb,
        event_id: logIdArb,
        time_uncertain: fc.boolean(),
        back_dated: kind === "event_duplicate" ? fc.constant(false) : fc.boolean(),
        device_ts: fc.maxSafeNat(),
        received_at: isoArb,
      }),
      loggedEventArb,
    )
    .map(([f, ev]) => ({
      kind,
      ...f,
      ordering: f.time_uncertain ? ("approximate" as const) : ("device_ts" as const),
      ...ev,
    })) as fc.Arbitrary<LogEntryFields<"event_accepted" | "event_duplicate">>;
}

/** Log_Entry fields of every kind, with every field present (null when empty). */
export const logEntryFieldsArb: fc.Arbitrary<LogEntryFields> = fc.oneof(
  fc.record({ kind: fc.constant("gateway" as const), state: fc.constantFrom(...GATEWAY_STATES) }),
  transportArb.chain((transport) =>
    fc.record({
      kind: fc.constant("message_in" as const),
      transport: fc.constant(transport),
      device_id: logIdArb,
      topic_suffix:
        transport === "ws"
          ? fc.constant(null)
          : fc.constantFrom("status" as const, "event" as const, "ack" as const),
      variant: fc.constantFrom(...VARIANT_NAMES),
      event_id: optId,
      cmd_id: optId,
      turn_id: optId,
      battery_pct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
      charging: fc.option(fc.boolean(), { nil: null }),
      mode: fc.option(fc.constantFrom(...MODES), { nil: null }),
    }),
  ),
  fc.record({
    kind: fc.constant("message_out" as const),
    transport: transportArb,
    device_id: logIdArb,
    variant: fc.constantFrom(...CMD_ACTIONS, "audio_end" as const),
    cmd_id: optId,
    turn_id: optId,
  }),
  fc.record({
    kind: fc.constant("message_rejected" as const),
    transport: transportArb,
    device_id: fc.option(logIdArb, { nil: null }),
    topic_suffix: fc.option(fc.constantFrom(...TOPIC_SUFFIXES), { nil: null }),
    issues: fc.array(safeIssueArb, { minLength: 1, maxLength: 20 }),
  }),
  fc.record({
    kind: fc.constant("auth" as const),
    transport: transportArb,
    device_id: fc.option(logIdArb, { nil: null }),
    outcome: fc.constantFrom("ok" as const, "failed" as const),
  }),
  fc.record({
    kind: fc.constant("presence" as const),
    device_id: logIdArb,
    state: fc.constantFrom("online" as const, "offline" as const),
    cause: fc.constantFrom(...PRESENCE_CAUSES),
  }),
  eventFieldsArb("event_accepted"),
  eventFieldsArb("event_duplicate"),
  fc.record({
    kind: fc.constant("ack_result" as const),
    device_id: logIdArb,
    cmd_id: logIdArb,
    action: fc.option(fc.constantFrom(...CMD_ACTIONS), { nil: null }),
    outcome: fc.constantFrom(...ACK_RESULT_OUTCOMES),
    reason: fc.option(fc.constantFrom("" as const, ...ACK_REASONS), { nil: null }),
    timeout_cause: fc.option(fc.constantFrom(...TIMEOUT_CAUSES), { nil: null }),
  }),
  fc.record({
    kind: fc.constant("audio_turn" as const),
    device_id: logIdArb,
    turn_id: fc.option(logIdArb, { nil: null }),
    phase: fc.constantFrom(...AUDIO_TURN_PHASES),
    frames_in: countArb,
    bytes_in: countArb,
    frames_out: countArb,
    cause: fc.option(fc.constantFrom(...ABORT_CAUSES), { nil: null }),
    issues: fc.array(safeIssueArb, { maxLength: 20 }),
  }),
);
