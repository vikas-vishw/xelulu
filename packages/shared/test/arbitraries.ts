// Test helper (not a test): one Message_Generator per Document B v2 variant, and the VARIANTS
// table the property tests iterate with it.each. Design "test/arbitraries.ts", Requirements 11.1
// and 11.6. Runtime code comes only from the built entry (design D5).
//
// Generators produce only valid, JSON-representable messages: finite numbers, no -0 (C22), and
// optional keys absent rather than undefined. Boundary values are weighted in with withEdges so
// they show up in 1,000 samples (Requirement 11.6).
import fc from "fast-check";

import {
  ACK_REASONS,
  ACK_STATUSES,
  BUTTONS,
  BUTTON_ACTIONS,
  KNOWN_EXPRESSIONS,
  KNOWN_EYES,
  KNOWN_GESTURE_NAMES,
  LED_EFFECTS,
  LED_TARGETS,
  MODES,
  MOTION_KINDS,
  PLAY_SOURCES,
  SAY_VOICES,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  parseAckMessage,
  parseAckMessageOrThrow,
  parseAnimateCmdMessage,
  parseAnimateCmdMessageOrThrow,
  parseAudioControlMessage,
  parseAudioEndMessage,
  parseAudioEndMessageOrThrow,
  parseAudioStartMessage,
  parseAudioStartMessageOrThrow,
  parseButtonEventMessage,
  parseButtonEventMessageOrThrow,
  parseCmdMessage,
  parseConfigCmdMessage,
  parseConfigCmdMessageOrThrow,
  parseCryEventMessage,
  parseCryEventMessageOrThrow,
  parseErrorEventMessage,
  parseErrorEventMessageOrThrow,
  parseEventMessage,
  parseGestureCmdMessage,
  parseGestureCmdMessageOrThrow,
  parseHelloMessage,
  parseHelloMessageOrThrow,
  parseInterruptEventMessage,
  parseInterruptEventMessageOrThrow,
  parseLedCmdMessage,
  parseLedCmdMessageOrThrow,
  parseMotionEventMessage,
  parseMotionEventMessageOrThrow,
  parseMoveCmdMessage,
  parseMoveCmdMessageOrThrow,
  parseNfcEventMessage,
  parseNfcEventMessageOrThrow,
  parseOtaCmdMessage,
  parseOtaCmdMessageOrThrow,
  parsePlayCmdMessage,
  parsePlayCmdMessageOrThrow,
  parseSayCmdMessage,
  parseSayCmdMessageOrThrow,
  parseSetModeCmdMessage,
  parseSetModeCmdMessageOrThrow,
  parseStatusMessage,
  parseStatusMessageOrThrow,
  parseStatusTopicMessage,
  parseStopAudioCmdMessage,
  parseStopAudioCmdMessageOrThrow,
  parseTouchEventMessage,
  parseTouchEventMessageOrThrow,
  parseVolumeCmdMessage,
  parseVolumeCmdMessageOrThrow,
  parseWakeEventMessage,
  parseWakeEventMessageOrThrow,
  serialiseAckMessage,
  serialiseAnimateCmdMessage,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  serialiseButtonEventMessage,
  serialiseConfigCmdMessage,
  serialiseCryEventMessage,
  serialiseErrorEventMessage,
  serialiseGestureCmdMessage,
  serialiseHelloMessage,
  serialiseInterruptEventMessage,
  serialiseLedCmdMessage,
  serialiseMotionEventMessage,
  serialiseMoveCmdMessage,
  serialiseNfcEventMessage,
  serialiseOtaCmdMessage,
  serialisePlayCmdMessage,
  serialiseSayCmdMessage,
  serialiseSetModeCmdMessage,
  serialiseStatusMessage,
  serialiseStopAudioCmdMessage,
  serialiseTouchEventMessage,
  serialiseVolumeCmdMessage,
  serialiseWakeEventMessage,
} from "../dist/index.js";
import type {
  AckMessage,
  AnimateCmdMessage,
  AudioEndMessage,
  AudioStartMessage,
  ButtonEventMessage,
  ConfigCmdMessage,
  CryEventMessage,
  ErrorEventMessage,
  GestureCmdMessage,
  HelloMessage,
  InterruptEventMessage,
  LedCmdMessage,
  MotionEventMessage,
  MoveCmdData,
  MoveCmdMessage,
  NfcEventMessage,
  OtaCmdMessage,
  ParseResult,
  PlayCmdMessage,
  SayCmdMessage,
  SetModeCmdMessage,
  StatusMessage,
  StopAudioCmdMessage,
  TopicSuffix,
  TouchEventMessage,
  VolumeCmdMessage,
  WakeEventMessage,
} from "../dist/index.js";

import { FIELD_TABLE, type FieldSpec, type VariantName } from "./mutations.js";

// ---------------------------------------------------------------------------------------------
// Building blocks.

/** Mixes `edges` in at weight 1 against `arb` at weight 4, so boundaries appear often. */
export function withEdges<T>(arb: fc.Arbitrary<T>, edges: readonly T[]): fc.Arbitrary<T> {
  if (edges.length === 0) return arb;
  return fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(...edges) },
    { weight: 4, arbitrary: arb },
  );
}

/** Finite doubles with `-0` mapped to `0` (C22). */
export function jsonDouble(constraints: fc.DoubleConstraints = {}): fc.Arbitrary<number> {
  return fc
    .double({ noNaN: true, noDefaultInfinity: true, ...constraints })
    .map((x) => (Object.is(x, -0) ? 0 : x));
}

// Test-local copies of the format patterns (C5, ruling 2), independent of src.
export const LANG_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;
export const HHMM_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Reference predicate for ota `manifest_url` (Requirement 8.14), independent of src. */
export function isReferenceHttpsUrl(s: string): boolean {
  if (!s.startsWith("https://")) return false;
  const url = URL.parse(s);
  return url !== null && url.protocol === "https:" && url.hostname !== "";
}

export const tsArb: fc.Arbitrary<number> = withEdges(fc.maxSafeNat(), [0, Number.MAX_SAFE_INTEGER]);
export const pctArb: fc.Arbitrary<number> = withEdges(fc.integer({ min: 0, max: 100 }), [0, 100]);
export const dirDegArb: fc.Arbitrary<number> = withEdges(
  fc.integer({ min: 0, max: 359 }),
  [0, 359],
);
export const durationHintArb: fc.Arbitrary<number> = withEdges(fc.maxSafeNat(), [0]);
export const rssiArb: fc.Arbitrary<number> = fc.integer();
export const unitArb: fc.Arbitrary<number> = withEdges(jsonDouble({ min: 0, max: 1 }), [0, 1]);
/** `duration_s`, `max_dist_mm`, `linear_mms`, `angular_mrad_s`: min 0, no maximum (ruling 3). */
export const nonNegArb: fc.Arbitrary<number> = withEdges(jsonDouble({ min: 0 }), [0]);
export const finiteArb: fc.Arbitrary<number> = jsonDouble();

/** Identifiers: arbitrary non-empty strings mixed with Document B-style ids. */
export const idArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, unit: "grapheme" }),
  fc.stringMatching(/^xlu_[0-9a-f]{6}$/),
);
/** Error `code` and `detail`: any string, empty included (ruling 3). */
export const anyStringArb: fc.Arbitrary<string> = withEdges(fc.string({ unit: "grapheme" }), [""]);
/** An Open_Vocabulary field: a known value or any non-empty string. */
export function openVocabArb(known: readonly string[]): fc.Arbitrary<string> {
  return fc.oneof(fc.constantFrom(...known), fc.string({ minLength: 1, unit: "grapheme" }));
}
export const langArb: fc.Arbitrary<string> = withEdges(fc.stringMatching(LANG_PATTERN), [
  "en-IN",
  "hi-IN",
  "en",
]);
export const hhmmArb: fc.Arbitrary<string> = withEdges(fc.stringMatching(HHMM_PATTERN), [
  "00:00",
  "23:59",
]);
export const colorArb: fc.Arbitrary<string> = fc.stringMatching(COLOR_PATTERN);
export const manifestUrlArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(fc.constant("localhost"), fc.domain()),
    fc.array(fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/), { maxLength: 3 }),
  )
  .map(([host, segments]) => `https://${host}${segments.map((s) => `/${s}`).join("")}`)
  .filter(isReferenceHttpsUrl);
export const activeChildIdArb: fc.Arbitrary<string | null> = withEdges(
  fc.option(idArb, { nil: null }),
  [null],
);

// ---------------------------------------------------------------------------------------------
// Message_Generators.

const protoVer = fc.constant(2 as const);

export const helloArb: fc.Arbitrary<HelloMessage> = fc.record({
  proto_ver: protoVer,
  ts: tsArb,
  type: fc.constant("hello" as const),
  device_id: idArb,
  fw_ver: idArb,
  auth: idArb,
  proto: protoVer,
});

export const statusArb: fc.Arbitrary<StatusMessage> = fc.record({
  proto_ver: protoVer,
  ts: tsArb,
  type: fc.constant("status" as const),
  battery_pct: pctArb,
  charging: fc.boolean(),
  mode: fc.constantFrom(...MODES),
  wifi_rssi: rssiArb,
  fault: fc.array(fc.string({ unit: "grapheme" }), { maxLength: 3 }),
  active_child_id: activeChildIdArb,
  temp_c: finiteArb,
});

/** One event variant: the envelope with optional `time_uncertain`, plus `data`. */
function eventArb<K extends string, D>(event: K, data: fc.Arbitrary<D>) {
  return fc.record(
    {
      proto_ver: protoVer,
      ts: tsArb,
      type: fc.constant("event" as const),
      event_id: idArb,
      event: fc.constant(event),
      time_uncertain: fc.boolean(),
      data,
    },
    { requiredKeys: ["proto_ver", "ts", "type", "event_id", "event", "data"] },
  );
}

export const touchEventArb: fc.Arbitrary<TouchEventMessage> = eventArb(
  "touch" as const,
  fc.record({ zone: fc.constantFrom(...TOUCH_ZONES), gesture: fc.constantFrom(...TOUCH_GESTURES) }),
);
export const wakeEventArb: fc.Arbitrary<WakeEventMessage> = eventArb(
  "wake" as const,
  fc.record(
    { source: fc.constantFrom(...WAKE_SOURCES), dir_deg: dirDegArb },
    { requiredKeys: ["source"] },
  ),
);
export const cryEventArb: fc.Arbitrary<CryEventMessage> = eventArb(
  "cry" as const,
  fc.record({ confidence: unitArb, duration_s: nonNegArb }),
);
export const motionEventArb: fc.Arbitrary<MotionEventMessage> = eventArb(
  "motion" as const,
  fc.record({ event: fc.constantFrom(...MOTION_KINDS), value: finiteArb }),
);
export const buttonEventArb: fc.Arbitrary<ButtonEventMessage> = eventArb(
  "button" as const,
  fc.record({ button: fc.constantFrom(...BUTTONS), action: fc.constantFrom(...BUTTON_ACTIONS) }),
);
export const nfcEventArb: fc.Arbitrary<NfcEventMessage> = eventArb(
  "nfc" as const,
  fc.record({ card_id: idArb }),
);
export const interruptEventArb: fc.Arbitrary<InterruptEventMessage> = eventArb(
  "interrupt" as const,
  fc.constant({}),
);
export const errorEventArb: fc.Arbitrary<ErrorEventMessage> = eventArb(
  "error" as const,
  fc.record({ code: anyStringArb, detail: anyStringArb }),
);

function audioArb<T extends "audio_start" | "audio_end">(type: T) {
  return fc.record({ proto_ver: protoVer, ts: tsArb, type: fc.constant(type), turn_id: idArb });
}
export const audioStartArb: fc.Arbitrary<AudioStartMessage> = audioArb("audio_start" as const);
export const audioEndArb: fc.Arbitrary<AudioEndMessage> = audioArb("audio_end" as const);

/** Ack: `reason` is `""` or an enum value, but never `""` on a `rejected` ack (C7). */
export const ackArb: fc.Arbitrary<AckMessage> = fc
  .record({
    proto_ver: protoVer,
    ts: tsArb,
    type: fc.constant("ack" as const),
    cmd_id: idArb,
    status: fc.constantFrom(...ACK_STATUSES),
    reason: fc.oneof(
      { weight: 2, arbitrary: fc.constant("" as const) },
      { weight: 3, arbitrary: fc.constantFrom(...ACK_REASONS) },
    ),
  })
  .filter((m) => !(m.status === "rejected" && m.reason === ""));

/** One command variant: `{proto_ver, cmd_id, action, data}`, no `ts` or `type`. */
function cmdArb<A extends string, D>(action: A, data: fc.Arbitrary<D>) {
  return fc.record({ proto_ver: protoVer, cmd_id: idArb, action: fc.constant(action), data });
}

export const sayCmdArb: fc.Arbitrary<SayCmdMessage> = cmdArb(
  "say" as const,
  fc.record({
    expression: openVocabArb(KNOWN_EXPRESSIONS),
    lang: langArb,
    voice: fc.constantFrom(...SAY_VOICES),
    duration_hint_ms: durationHintArb,
  }),
);
export const animateCmdArb: fc.Arbitrary<AnimateCmdMessage> = cmdArb(
  "animate" as const,
  fc.record({
    expression: openVocabArb(KNOWN_EXPRESSIONS),
    eyes: openVocabArb(KNOWN_EYES),
    loop: fc.boolean(),
  }),
);
export const gestureCmdArb: fc.Arbitrary<GestureCmdMessage> = cmdArb(
  "gesture" as const,
  fc.record({ name: openVocabArb(KNOWN_GESTURE_NAMES) }),
);

/** Ruling 4: come and turn carry every key; stop carries each speed present or absent. */
export const moveDataArb: fc.Arbitrary<MoveCmdData> = fc.oneof(
  fc.record({
    cmd: fc.constant("come" as const),
    linear_mms: nonNegArb,
    angular_mrad_s: nonNegArb,
    max_dist_mm: nonNegArb,
  }),
  fc.record({
    cmd: fc.constant("turn" as const),
    linear_mms: nonNegArb,
    angular_mrad_s: nonNegArb,
    max_dist_mm: nonNegArb,
  }),
  fc.record(
    {
      cmd: fc.constant("stop" as const),
      linear_mms: nonNegArb,
      angular_mrad_s: nonNegArb,
      max_dist_mm: nonNegArb,
    },
    { requiredKeys: ["cmd", "max_dist_mm"] },
  ),
);
export const moveCmdArb: fc.Arbitrary<MoveCmdMessage> = cmdArb("move" as const, moveDataArb);

export const playCmdArb: fc.Arbitrary<PlayCmdMessage> = cmdArb(
  "play" as const,
  fc.record({ content_id: idArb, source: fc.constantFrom(...PLAY_SOURCES) }),
);
export const setModeCmdArb: fc.Arbitrary<SetModeCmdMessage> = cmdArb(
  "set_mode" as const,
  fc.record({ mode: fc.constantFrom(...MODES) }),
);
export const ledCmdArb: fc.Arbitrary<LedCmdMessage> = cmdArb(
  "led" as const,
  fc.record({
    target: fc.constantFrom(...LED_TARGETS),
    color: colorArb,
    effect: fc.constantFrom(...LED_EFFECTS),
    brightness: pctArb,
  }),
);
export const volumeCmdArb: fc.Arbitrary<VolumeCmdMessage> = cmdArb(
  "volume" as const,
  fc.record({ level: pctArb }),
);

/** Config delta: each key optional, at least one present (Requirements 8.11, 8.12). */
export const configDataArb: fc.Arbitrary<ConfigCmdMessage["data"]> = fc
  .record(
    {
      volume: pctArb,
      quiet_hours: fc.record({ start: hhmmArb, end: hhmmArb }),
      movement_on: fc.boolean(),
      language: langArb,
      active_child_id: activeChildIdArb,
    },
    { requiredKeys: [] },
  )
  .filter((data) => Object.keys(data).length > 0);
export const configCmdArb: fc.Arbitrary<ConfigCmdMessage> = cmdArb(
  "config" as const,
  configDataArb,
);

export const stopAudioCmdArb: fc.Arbitrary<StopAudioCmdMessage> = cmdArb(
  "stop_audio" as const,
  fc.constant({}),
);
export const otaCmdArb: fc.Arbitrary<OtaCmdMessage> = cmdArb(
  "ota" as const,
  fc.record({ manifest_url: manifestUrlArb }),
);

// ---------------------------------------------------------------------------------------------
// VARIANTS table.

export type VariantCase = {
  /** The codec's variant label, also the FIELD_TABLE key. */
  readonly name: VariantName;
  readonly arb: fc.Arbitrary<unknown>;
  readonly parse: (text: string) => ParseResult<unknown>;
  readonly parseOrThrow: (text: string) => unknown;
  /** Typed `never` so any variant fits the table; call as `serialise(m as never)`. */
  readonly serialise: (m: never) => string;
  /** The union parser for the variant's topic or direction (Requirement 11.3). */
  readonly union: (text: string) => ParseResult<unknown>;
  /** The MQTT topic it travels on; null for commands and audio control. */
  readonly topic: TopicSuffix | null;
  /** `device` envelopes carry `ts` and `type`; `cmd` envelopes carry neither. */
  readonly envelope: "device" | "cmd";
  /** The hand-written field table for this variant. */
  readonly fields: readonly FieldSpec[];
};

function variant<T>(c: {
  name: VariantName;
  arb: fc.Arbitrary<T>;
  parse: (text: string) => ParseResult<T>;
  parseOrThrow: (text: string) => T;
  serialise: (m: T) => string;
  union: (text: string) => ParseResult<unknown>;
  topic: TopicSuffix | null;
  envelope: "device" | "cmd";
}): VariantCase {
  return Object.freeze({ ...c, fields: FIELD_TABLE[c.name] });
}

/** All 24 variants, in VARIANT_NAMES order. */
export const VARIANTS: readonly VariantCase[] = Object.freeze([
  variant({
    name: "hello",
    arb: helloArb,
    parse: parseHelloMessage,
    parseOrThrow: parseHelloMessageOrThrow,
    serialise: serialiseHelloMessage,
    union: parseStatusTopicMessage,
    topic: "status",
    envelope: "device",
  }),
  variant({
    name: "status",
    arb: statusArb,
    parse: parseStatusMessage,
    parseOrThrow: parseStatusMessageOrThrow,
    serialise: serialiseStatusMessage,
    union: parseStatusTopicMessage,
    topic: "status",
    envelope: "device",
  }),
  variant({
    name: "touch event",
    arb: touchEventArb,
    parse: parseTouchEventMessage,
    parseOrThrow: parseTouchEventMessageOrThrow,
    serialise: serialiseTouchEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "wake event",
    arb: wakeEventArb,
    parse: parseWakeEventMessage,
    parseOrThrow: parseWakeEventMessageOrThrow,
    serialise: serialiseWakeEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "cry event",
    arb: cryEventArb,
    parse: parseCryEventMessage,
    parseOrThrow: parseCryEventMessageOrThrow,
    serialise: serialiseCryEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "motion event",
    arb: motionEventArb,
    parse: parseMotionEventMessage,
    parseOrThrow: parseMotionEventMessageOrThrow,
    serialise: serialiseMotionEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "button event",
    arb: buttonEventArb,
    parse: parseButtonEventMessage,
    parseOrThrow: parseButtonEventMessageOrThrow,
    serialise: serialiseButtonEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "nfc event",
    arb: nfcEventArb,
    parse: parseNfcEventMessage,
    parseOrThrow: parseNfcEventMessageOrThrow,
    serialise: serialiseNfcEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "interrupt event",
    arb: interruptEventArb,
    parse: parseInterruptEventMessage,
    parseOrThrow: parseInterruptEventMessageOrThrow,
    serialise: serialiseInterruptEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "error event",
    arb: errorEventArb,
    parse: parseErrorEventMessage,
    parseOrThrow: parseErrorEventMessageOrThrow,
    serialise: serialiseErrorEventMessage,
    union: parseEventMessage,
    topic: "event",
    envelope: "device",
  }),
  variant({
    name: "audio_start",
    arb: audioStartArb,
    parse: parseAudioStartMessage,
    parseOrThrow: parseAudioStartMessageOrThrow,
    serialise: serialiseAudioStartMessage,
    union: parseAudioControlMessage,
    topic: null,
    envelope: "device",
  }),
  variant({
    name: "audio_end",
    arb: audioEndArb,
    parse: parseAudioEndMessage,
    parseOrThrow: parseAudioEndMessageOrThrow,
    serialise: serialiseAudioEndMessage,
    union: parseAudioControlMessage,
    topic: null,
    envelope: "device",
  }),
  variant({
    name: "ack",
    arb: ackArb,
    parse: parseAckMessage,
    parseOrThrow: parseAckMessageOrThrow,
    serialise: serialiseAckMessage,
    union: parseAckMessage,
    topic: "ack",
    envelope: "device",
  }),
  variant({
    name: "say cmd",
    arb: sayCmdArb,
    parse: parseSayCmdMessage,
    parseOrThrow: parseSayCmdMessageOrThrow,
    serialise: serialiseSayCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "animate cmd",
    arb: animateCmdArb,
    parse: parseAnimateCmdMessage,
    parseOrThrow: parseAnimateCmdMessageOrThrow,
    serialise: serialiseAnimateCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "gesture cmd",
    arb: gestureCmdArb,
    parse: parseGestureCmdMessage,
    parseOrThrow: parseGestureCmdMessageOrThrow,
    serialise: serialiseGestureCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "move cmd",
    arb: moveCmdArb,
    parse: parseMoveCmdMessage,
    parseOrThrow: parseMoveCmdMessageOrThrow,
    serialise: serialiseMoveCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "play cmd",
    arb: playCmdArb,
    parse: parsePlayCmdMessage,
    parseOrThrow: parsePlayCmdMessageOrThrow,
    serialise: serialisePlayCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "set_mode cmd",
    arb: setModeCmdArb,
    parse: parseSetModeCmdMessage,
    parseOrThrow: parseSetModeCmdMessageOrThrow,
    serialise: serialiseSetModeCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "led cmd",
    arb: ledCmdArb,
    parse: parseLedCmdMessage,
    parseOrThrow: parseLedCmdMessageOrThrow,
    serialise: serialiseLedCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "volume cmd",
    arb: volumeCmdArb,
    parse: parseVolumeCmdMessage,
    parseOrThrow: parseVolumeCmdMessageOrThrow,
    serialise: serialiseVolumeCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "config cmd",
    arb: configCmdArb,
    parse: parseConfigCmdMessage,
    parseOrThrow: parseConfigCmdMessageOrThrow,
    serialise: serialiseConfigCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "stop_audio cmd",
    arb: stopAudioCmdArb,
    parse: parseStopAudioCmdMessage,
    parseOrThrow: parseStopAudioCmdMessageOrThrow,
    serialise: serialiseStopAudioCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
  variant({
    name: "ota cmd",
    arb: otaCmdArb,
    parse: parseOtaCmdMessage,
    parseOrThrow: parseOtaCmdMessageOrThrow,
    serialise: serialiseOtaCmdMessage,
    union: parseCmdMessage,
    topic: null,
    envelope: "cmd",
  }),
]);

/** Looks up a variant by name; throws on an unknown name. */
export function variantByName(name: VariantName): VariantCase {
  const found = VARIANTS.find((v) => v.name === name);
  if (!found) throw new Error(`unknown variant ${name}`);
  return found;
}
