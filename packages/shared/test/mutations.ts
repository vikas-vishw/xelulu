// Test helper (not a test): field tables and mutation helpers for the rejection properties.
// Design "test/mutations.ts", Requirements 12.1–12.8.
//
// FIELD_TABLE is written by hand from Document B v2 and requirements.md, independent of the src
// schemas and constants, so the property tests cross-check them. All helpers are pure: they work
// on structuredClone copies and never touch their input.
import fc from "fast-check";

// ---------------------------------------------------------------------------------------------
// Variant names (the codec's variant labels) and the hand-written value lists.

export const VARIANT_NAMES = Object.freeze([
  "hello",
  "status",
  "touch event",
  "wake event",
  "cry event",
  "motion event",
  "button event",
  "nfc event",
  "interrupt event",
  "error event",
  "audio_start",
  "audio_end",
  "ack",
  "say cmd",
  "animate cmd",
  "gesture cmd",
  "move cmd",
  "play cmd",
  "set_mode cmd",
  "led cmd",
  "volume cmd",
  "config cmd",
  "stop_audio cmd",
  "ota cmd",
] as const);
export type VariantName = (typeof VARIANT_NAMES)[number];

/** Every `type` value a device sends (Document B v2 §3, §5). */
export const DEVICE_TYPE_VALUES = Object.freeze([
  "hello",
  "status",
  "event",
  "ack",
  "audio_start",
  "audio_end",
] as const);
export const EVENT_KIND_VALUES = Object.freeze([
  "touch",
  "wake",
  "cry",
  "motion",
  "button",
  "nfc",
  "interrupt",
  "error",
] as const);
export const CMD_ACTION_VALUES = Object.freeze([
  "say",
  "animate",
  "gesture",
  "move",
  "play",
  "set_mode",
  "led",
  "volume",
  "config",
  "stop_audio",
  "ota",
] as const);

const TOUCH_ZONE_VALUES = [
  "head",
  "left_ear",
  "right_ear",
  "belly",
  "back",
  "left_hand",
  "right_hand",
] as const;
const TOUCH_GESTURE_VALUES = ["tap", "double_tap", "hold", "pat"] as const;
const WAKE_SOURCE_VALUES = ["hey_lulu", "touch"] as const;
const MOTION_KIND_VALUES = ["pickup", "shake", "upside_down", "drop", "tilt"] as const;
const BUTTON_VALUES = ["belly_talk"] as const;
const BUTTON_ACTION_VALUES = ["press", "release"] as const;
const MODE_VALUES = ["idle", "play", "story", "quiet", "sleep"] as const;
const MOVE_COMMAND_VALUES = ["come", "stop", "turn"] as const;
const PLAY_SOURCE_VALUES = ["stream", "cache"] as const;
const LED_TARGET_VALUES = ["ears", "cheeks", "belly"] as const;
const LED_EFFECT_VALUES = ["solid", "pulse", "rainbow"] as const;
const SAY_VOICE_VALUES = ["xelulu", "grandma"] as const;
const ACK_STATUS_VALUES = ["accepted", "done", "rejected", "failed"] as const;
const ACK_REASON_VALUES = [
  "picked_up",
  "at_edge",
  "charging",
  "quiet_hours",
  "low_battery",
  "unsafe",
  "busy",
  "unknown_action",
] as const;

// ---------------------------------------------------------------------------------------------
// Field table.

export type FieldKind =
  | { t: "literal2" }
  | { t: "unixSeconds" }
  | { t: "nonEmpty" }
  | { t: "string" }
  | { t: "finite" }
  | { t: "nonNegFinite" }
  | { t: "nonNegInt" }
  | { t: "int" }
  | { t: "pct" }
  | { t: "unit" }
  | { t: "deg" }
  | { t: "boolean" }
  | { t: "nullableString" }
  | { t: "stringArray" }
  /** `alsoAccepts` lists extra accepted strings outside the enum (ack `reason` accepts `""`). */
  | { t: "closedEnum"; values: readonly string[]; alsoAccepts?: readonly string[] }
  | { t: "openVocab" }
  | { t: "lang" }
  | { t: "hhmm" }
  | { t: "color" }
  | { t: "httpsUrl" }
  | { t: "object" }
  | { t: "emptyObject" }
  /** `value` is this variant's value; `defined` every value defined for that position. */
  | { t: "discriminator"; value: string; defined: readonly string[] };

export type FieldKindName = FieldKind["t"];

/** Requiredness may depend on a sibling value: move speeds are required only on come and turn. */
export type Required = boolean | { when: { path: readonly string[]; in: readonly string[] } };

export type FieldSpec = { path: readonly string[]; kind: FieldKind; required: Required };

const LITERAL2: FieldKind = { t: "literal2" };
const UNIX: FieldKind = { t: "unixSeconds" };
const NON_EMPTY: FieldKind = { t: "nonEmpty" };
const ANY_STRING: FieldKind = { t: "string" };
const FINITE: FieldKind = { t: "finite" };
const NON_NEG: FieldKind = { t: "nonNegFinite" };
const NON_NEG_INT: FieldKind = { t: "nonNegInt" };
const INT: FieldKind = { t: "int" };
const PCT: FieldKind = { t: "pct" };
const UNIT: FieldKind = { t: "unit" };
const DEG: FieldKind = { t: "deg" };
const BOOL: FieldKind = { t: "boolean" };
const NULLABLE_STRING: FieldKind = { t: "nullableString" };
const STRING_ARRAY: FieldKind = { t: "stringArray" };
const OPEN_VOCAB: FieldKind = { t: "openVocab" };
const LANG: FieldKind = { t: "lang" };
const HHMM: FieldKind = { t: "hhmm" };
const COLOR: FieldKind = { t: "color" };
const HTTPS_URL: FieldKind = { t: "httpsUrl" };
const OBJECT: FieldKind = { t: "object" };
const EMPTY_OBJECT: FieldKind = { t: "emptyObject" };
const closedEnum = (values: readonly string[], alsoAccepts?: readonly string[]): FieldKind =>
  alsoAccepts ? { t: "closedEnum", values, alsoAccepts } : { t: "closedEnum", values };
const disc = (value: string, defined: readonly string[]): FieldKind => ({
  t: "discriminator",
  value,
  defined,
});

/** `path` is dot-separated for brevity; no wire key contains a dot. */
function field(path: string, kind: FieldKind, required: Required = true): FieldSpec {
  return Object.freeze({ path: Object.freeze(path.split(".")), kind, required });
}

function deviceEnvelope(type: string): FieldSpec[] {
  return [
    field("proto_ver", LITERAL2),
    field("ts", UNIX),
    field("type", disc(type, DEVICE_TYPE_VALUES)),
  ];
}

function eventFields(
  kind: string,
  data: readonly FieldSpec[],
  dataKind: FieldKind = OBJECT,
): FieldSpec[] {
  return [
    ...deviceEnvelope("event"),
    field("event_id", NON_EMPTY),
    field("event", disc(kind, EVENT_KIND_VALUES)),
    field("time_uncertain", BOOL, false),
    field("data", dataKind),
    ...data,
  ];
}

function cmdFields(
  action: string,
  data: readonly FieldSpec[],
  dataKind: FieldKind = OBJECT,
): FieldSpec[] {
  return [
    field("proto_ver", LITERAL2),
    field("cmd_id", NON_EMPTY),
    field("action", disc(action, CMD_ACTION_VALUES)),
    field("data", dataKind),
    ...data,
  ];
}

const SPEED_REQUIRED: Required = { when: { path: ["data", "cmd"], in: ["come", "turn"] } };

/** Every field of every variant: path, kind and requiredness (Document B v2 + rulings). */
export const FIELD_TABLE: Readonly<Record<VariantName, readonly FieldSpec[]>> = Object.freeze({
  hello: [
    ...deviceEnvelope("hello"),
    field("device_id", NON_EMPTY),
    field("fw_ver", NON_EMPTY),
    field("auth", NON_EMPTY),
    field("proto", LITERAL2),
  ],
  status: [
    ...deviceEnvelope("status"),
    field("battery_pct", PCT),
    field("charging", BOOL),
    field("mode", closedEnum(MODE_VALUES)),
    field("wifi_rssi", INT),
    field("fault", STRING_ARRAY),
    field("active_child_id", NULLABLE_STRING),
    field("temp_c", FINITE),
  ],
  "touch event": eventFields("touch", [
    field("data.zone", closedEnum(TOUCH_ZONE_VALUES)),
    field("data.gesture", closedEnum(TOUCH_GESTURE_VALUES)),
  ]),
  "wake event": eventFields("wake", [
    field("data.source", closedEnum(WAKE_SOURCE_VALUES)),
    field("data.dir_deg", DEG, false),
  ]),
  "cry event": eventFields("cry", [
    field("data.confidence", UNIT),
    field("data.duration_s", NON_NEG),
  ]),
  "motion event": eventFields("motion", [
    field("data.event", closedEnum(MOTION_KIND_VALUES)),
    field("data.value", FINITE),
  ]),
  "button event": eventFields("button", [
    field("data.button", closedEnum(BUTTON_VALUES)),
    field("data.action", closedEnum(BUTTON_ACTION_VALUES)),
  ]),
  "nfc event": eventFields("nfc", [field("data.card_id", NON_EMPTY)]),
  "interrupt event": eventFields("interrupt", [], EMPTY_OBJECT),
  "error event": eventFields("error", [
    field("data.code", ANY_STRING),
    field("data.detail", ANY_STRING),
  ]),
  audio_start: [...deviceEnvelope("audio_start"), field("turn_id", NON_EMPTY)],
  audio_end: [...deviceEnvelope("audio_end"), field("turn_id", NON_EMPTY)],
  ack: [
    ...deviceEnvelope("ack"),
    field("cmd_id", NON_EMPTY),
    field("status", closedEnum(ACK_STATUS_VALUES)),
    field("reason", closedEnum(ACK_REASON_VALUES, [""])),
  ],
  "say cmd": cmdFields("say", [
    field("data.expression", OPEN_VOCAB),
    field("data.lang", LANG),
    field("data.voice", closedEnum(SAY_VOICE_VALUES)),
    field("data.duration_hint_ms", NON_NEG_INT),
  ]),
  "animate cmd": cmdFields("animate", [
    field("data.expression", OPEN_VOCAB),
    field("data.eyes", OPEN_VOCAB),
    field("data.loop", BOOL),
  ]),
  "gesture cmd": cmdFields("gesture", [field("data.name", OPEN_VOCAB)]),
  "move cmd": cmdFields("move", [
    field("data.cmd", closedEnum(MOVE_COMMAND_VALUES)),
    field("data.linear_mms", NON_NEG, SPEED_REQUIRED),
    field("data.angular_mrad_s", NON_NEG, SPEED_REQUIRED),
    field("data.max_dist_mm", NON_NEG),
  ]),
  "play cmd": cmdFields("play", [
    field("data.content_id", NON_EMPTY),
    field("data.source", closedEnum(PLAY_SOURCE_VALUES)),
  ]),
  "set_mode cmd": cmdFields("set_mode", [field("data.mode", closedEnum(MODE_VALUES))]),
  "led cmd": cmdFields("led", [
    field("data.target", closedEnum(LED_TARGET_VALUES)),
    field("data.color", COLOR),
    field("data.effect", closedEnum(LED_EFFECT_VALUES)),
    field("data.brightness", PCT),
  ]),
  "volume cmd": cmdFields("volume", [field("data.level", PCT)]),
  "config cmd": cmdFields("config", [
    field("data.volume", PCT, false),
    field("data.quiet_hours", OBJECT, false),
    field("data.quiet_hours.start", HHMM),
    field("data.quiet_hours.end", HHMM),
    field("data.movement_on", BOOL, false),
    field("data.language", LANG, false),
    field("data.active_child_id", NULLABLE_STRING, false),
  ]),
  "stop_audio cmd": cmdFields("stop_audio", [], EMPTY_OBJECT),
  "ota cmd": cmdFields("ota", [field("data.manifest_url", HTTPS_URL)]),
});

// ---------------------------------------------------------------------------------------------
// Path helpers. Messages are plain JSON objects; paths are lists of object keys.

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The value at `path`, or `undefined` when any step is missing. */
export function getAt(message: unknown, path: readonly string[]): unknown {
  let current: unknown = message;
  for (const key of path) {
    if (!isPlainObject(current) || !hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** True when `path` names an own property (a key present with `null` counts as present). */
export function hasAt(message: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return isPlainObject(message);
  const parent = getAt(message, path.slice(0, -1));
  return isPlainObject(parent) && hasOwn(parent, path[path.length - 1] as string);
}

function cloneObject(message: unknown): JsonObject {
  if (!isPlainObject(message)) throw new Error("mutation helpers need a plain object");
  return structuredClone(message);
}

function objectAt(root: JsonObject, path: readonly string[]): JsonObject {
  const target = path.length === 0 ? root : getAt(root, path);
  if (!isPlainObject(target)) throw new Error(`no object at ${path.join(".") || "<root>"}`);
  return target;
}

/** Defines an own, enumerable data property, so `__proto__` stays a plain key. */
function defineKey(obj: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** A copy of `message` with the value at `path` replaced (or added) as `value`. */
export function setAt(message: unknown, path: readonly string[], value: unknown): JsonObject {
  if (path.length === 0) throw new Error("setAt needs a non-empty path");
  const copy = cloneObject(message);
  defineKey(objectAt(copy, path.slice(0, -1)), path[path.length - 1] as string, value);
  return copy;
}

/** A copy of `message` without the key at `path`. */
export function deleteAt(message: unknown, path: readonly string[]): JsonObject {
  if (path.length === 0) throw new Error("deleteAt needs a non-empty path");
  const copy = cloneObject(message);
  delete objectAt(copy, path.slice(0, -1))[path[path.length - 1] as string];
  return copy;
}

/** A copy of `message` with `key: value` added to the object at `position`. */
export function addKey(
  message: unknown,
  position: readonly string[],
  key: string,
  value: unknown,
): JsonObject {
  const copy = cloneObject(message);
  defineKey(objectAt(copy, position), key, value);
  return copy;
}

/** The object positions of a message: the top level, `data`, and `data.quiet_hours`. */
export function objectPositions(message: unknown): (readonly string[])[] {
  const positions: (readonly string[])[] = [[]];
  if (isPlainObject(getAt(message, ["data"]))) positions.push(["data"]);
  if (isPlainObject(getAt(message, ["data", "quiet_hours"]))) {
    positions.push(["data", "quiet_hours"]);
  }
  return positions;
}

/** The variant of a valid message, read from its Discriminators. */
export function variantNameOf(message: unknown): VariantName {
  const action = getAt(message, ["action"]);
  const type = getAt(message, ["type"]);
  const event = getAt(message, ["event"]);
  const name =
    typeof action === "string"
      ? `${action} cmd`
      : type === "event" && typeof event === "string"
        ? `${event} event`
        : type;
  if (typeof name !== "string" || !(VARIANT_NAMES as readonly string[]).includes(name)) {
    throw new Error("not a message of a known variant");
  }
  return name as VariantName;
}

/** Whether `spec` is required in `message` (conditional entries read the sibling value). */
export function isRequired(spec: FieldSpec, message: unknown): boolean {
  const { required } = spec;
  if (typeof required === "boolean") return required;
  const value = getAt(message, required.when.path);
  return typeof value === "string" && required.when.in.includes(value);
}

/** The keys defined for the object at `position` in a variant. */
export function definedKeysAt(variant: VariantName, position: readonly string[]): string[] {
  return FIELD_TABLE[variant]
    .filter(
      (spec) =>
        spec.path.length === position.length + 1 &&
        position.every((key, i) => spec.path[i] === key),
    )
    .map((spec) => spec.path[position.length] as string);
}

/** The variant's fields whose parent object is present in `message`. */
export function applicableFields(message: unknown): FieldSpec[] {
  return FIELD_TABLE[variantNameOf(message)].filter((spec) =>
    isPlainObject(spec.path.length === 1 ? message : getAt(message, spec.path.slice(0, -1))),
  );
}

/** The variant's fields present in `message`. */
export function presentFields(message: unknown): FieldSpec[] {
  return applicableFields(message).filter((spec) => hasAt(message, spec.path));
}

/** The variant's fields that are required in `message` (their parent is present). */
export function requiredFields(message: unknown): FieldSpec[] {
  return applicableFields(message).filter((spec) => isRequired(spec, message));
}

/**
 * Paths of the optional fields present in `message` whose removal keeps it valid: wake
 * `dir_deg`, `time_uncertain`, the speeds on a `stop` move, and config delta keys while at least
 * one other delta key remains.
 */
export function optionalRemovalCases(message: unknown): (readonly string[])[] {
  const variant = variantNameOf(message);
  return presentFields(message)
    .filter((spec) => !isRequired(spec, message))
    .filter(() => {
      // Every optional config field is a delta key; the delta must keep at least one key.
      if (variant !== "config cmd") return true;
      const data = getAt(message, ["data"]);
      return isPlainObject(data) && Object.keys(data).length > 1;
    })
    .map((spec) => spec.path);
}

/** The bounded numeric kinds (Property 11). */
export const BOUNDED_KINDS: ReadonlySet<FieldKindName> = new Set<FieldKindName>([
  "unixSeconds",
  "nonNegFinite",
  "nonNegInt",
  "int",
  "pct",
  "unit",
  "deg",
]);

// ---------------------------------------------------------------------------------------------
// Mutation arbitraries.

/** Finite doubles, with `-0` mapped to `0` (C22). */
function jsonDouble(constraints: fc.DoubleConstraints = {}): fc.Arbitrary<number> {
  return fc
    .double({ noNaN: true, noDefaultInfinity: true, ...constraints })
    .map((x) => (Object.is(x, -0) ? 0 : x));
}

const nonIntegerArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer().map((i) => i + 0.5),
  jsonDouble().filter((x) => !Number.isInteger(x)),
);
const negativeArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(-1),
  fc.integer({ max: -1 }),
  jsonDouble({ max: -Number.MIN_VALUE }),
);

const jsonNullArb = fc.constant(null);
const jsonBoolArb = fc.boolean();
const jsonNumberArb: fc.Arbitrary<number> = fc.oneof(fc.integer(), jsonDouble());
const jsonStringArb = fc.string();
const jsonArrayArb = fc.array(fc.jsonValue({ maxDepth: 1 }), { maxLength: 3 });
const jsonObjectArb = fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 3 });

/** Any JSON value that is not a string. */
export const nonStringJsonArb: fc.Arbitrary<unknown> = fc.oneof(
  jsonNullArb,
  jsonBoolArb,
  jsonNumberArb,
  jsonArrayArb,
  jsonObjectArb,
);

/** Curated unknown key names (Property 7), before filtering against the defined keys. */
export const CURATED_UNKNOWN_KEYS = Object.freeze([
  "ts",
  "type",
  "audio",
  "audio_url",
  "transcript",
  "url",
  "__proto__",
  "constructor",
] as const);

/**
 * Key names not defined for `position` in `variant`: the curated names, case variants of the
 * position's real keys, and random `zz_`-prefixed names.
 */
export function unknownKeyArb(
  variant: VariantName,
  position: readonly string[],
): fc.Arbitrary<string> {
  const defined = definedKeysAt(variant, position);
  const caseVariants = defined.flatMap((key) => [
    key.toUpperCase(),
    key.charAt(0).toUpperCase() + key.slice(1),
  ]);
  const curated = [...CURATED_UNKNOWN_KEYS, ...caseVariants].filter((k) => !defined.includes(k));
  return fc
    .oneof(
      fc.constantFrom(...curated),
      fc.stringMatching(/^[a-z]{1,8}$/).map((s) => `zz_${s}`),
    )
    .filter((key) => !defined.includes(key));
}

/** Any JSON value other than the number 2, with the edges `"2"`, 1, 3, 2.5 and `null`. */
export const notTwoArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>("2", 1, 3, 2.5, null),
  fc.jsonValue().filter((v) => v !== 2),
);

/**
 * Strings outside `values`: one or more letters upper-cased, a leading or trailing space, or a
 * random string.
 */
export function enumPerturbationArb(values: readonly string[]): fc.Arbitrary<string> {
  if (values.length === 0) throw new Error("enumPerturbationArb needs at least one value");
  const base = fc.constantFrom(...values);
  const withLetters = values.filter((v) => /[a-z]/.test(v));
  const arbs: fc.Arbitrary<string>[] = [
    base.map((v) => ` ${v}`),
    base.map((v) => `${v} `),
    fc.string(),
  ];
  if (withLetters.length > 0) {
    arbs.push(
      fc.constantFrom(...withLetters).chain((v) => {
        const chars = [...v];
        const letterIndexes = chars.flatMap((c, i) => (/[a-z]/.test(c) ? [i] : []));
        return fc
          .subarray(letterIndexes, { minLength: 1 })
          .map((picked) =>
            chars.map((c, i) => (picked.includes(i) ? c.toUpperCase() : c)).join(""),
          );
      }),
    );
  }
  return fc.oneof(...arbs).filter((s) => !values.includes(s));
}

/** Strings outside `defined` (including perturbations of its values) and non-string values. */
export function badDiscriminatorArb(defined: readonly string[]): fc.Arbitrary<unknown> {
  return fc.oneof(
    enumPerturbationArb(defined),
    fc.string().filter((s) => !defined.includes(s)),
    nonStringJsonArb,
  );
}

/** Values outside a bounded kind's range, or non-integers for integer kinds (Property 11). */
export function outOfRangeArb(kind: FieldKind): fc.Arbitrary<number> {
  switch (kind.t) {
    case "pct":
      return fc.oneof(
        fc.constantFrom(-1, 101, 50.5),
        fc.integer({ max: -1 }),
        fc.integer({ min: 101 }),
        nonIntegerArb,
      );
    case "deg":
      return fc.oneof(
        fc.constantFrom(-1, 360, 45.5),
        fc.integer({ max: -1 }),
        fc.integer({ min: 360 }),
        nonIntegerArb,
      );
    case "unit":
      return fc.oneof(
        fc.constantFrom(-0.5, 1.5),
        jsonDouble({ max: -Number.MIN_VALUE }),
        jsonDouble({ min: 1 + Number.EPSILON }),
      );
    case "nonNegFinite":
      return negativeArb;
    case "nonNegInt":
      return fc.oneof(negativeArb, nonIntegerArb);
    case "int":
      return nonIntegerArb;
    case "unixSeconds":
      return fc.oneof(
        negativeArb,
        nonIntegerArb,
        fc.constant(2 ** 53),
        jsonDouble({ min: 2 ** 53 }),
      );
    default:
      throw new Error(`kind ${kind.t} has no numeric range`);
  }
}

/** JSON values of a type the kind does not accept (Property 12). */
export function wrongTypeArb(kind: FieldKind): fc.Arbitrary<unknown> {
  const notNumber = fc.oneof(jsonNullArb, jsonBoolArb, jsonStringArb, jsonArrayArb, jsonObjectArb);
  switch (kind.t) {
    case "literal2":
    case "unixSeconds":
    case "finite":
    case "nonNegFinite":
    case "nonNegInt":
    case "int":
    case "pct":
    case "unit":
    case "deg":
      return notNumber;
    case "string":
      return nonStringJsonArb;
    case "closedEnum":
      return kind.alsoAccepts?.includes("")
        ? nonStringJsonArb
        : fc.oneof(fc.constant(""), nonStringJsonArb);
    case "nonEmpty":
    case "openVocab":
    case "lang":
    case "hhmm":
    case "color":
    case "httpsUrl":
    case "discriminator":
      return fc.oneof(fc.constant(""), nonStringJsonArb);
    case "boolean":
      return fc.oneof(jsonNullArb, jsonNumberArb, jsonStringArb, jsonArrayArb, jsonObjectArb);
    case "nullableString":
      return fc.oneof(jsonBoolArb, jsonNumberArb, jsonArrayArb, jsonObjectArb);
    case "stringArray":
      return fc.oneof(
        jsonNullArb,
        jsonBoolArb,
        jsonNumberArb,
        jsonStringArb,
        jsonObjectArb,
        fc
          .tuple(fc.array(fc.string(), { maxLength: 2 }), nonStringJsonArb)
          .map(([strings, odd]) => [...strings, odd]),
      );
    case "object":
    case "emptyObject":
      return fc.oneof(jsonNullArb, jsonBoolArb, jsonNumberArb, jsonStringArb, jsonArrayArb);
  }
}

/** Bad `ts` values: negatives, non-integers, 2 ** 53 and above, and numeric strings. */
export const badTsArb: fc.Arbitrary<unknown> = fc.oneof(
  outOfRangeArb(UNIX),
  fc.maxSafeNat().map(String),
);

/**
 * Sentinel values of at least 8 characters starting with `§`. Error output is ASCII field names,
 * indices, key names and kind strings, so `§` can only appear there if a value leaked.
 */
export const sentinelArb: fc.Arbitrary<string> = fc
  .string({ minLength: 7, unit: "grapheme-ascii" })
  .map((s) => `§${s}`);
