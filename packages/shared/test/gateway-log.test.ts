// Gateway_Log shared module (Phase 1.2): field names, entry shapes, Safe_Issue rules and
// constants. Requirements 4.5, 4.8, 12.1, 12.2, 12.4 and 12.5; design D5.
// Runtime code comes from the built entry, like every other shared test.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ABORT_CAUSES,
  ACK_RESULT_OUTCOMES,
  ALLOW_LISTED_TOOLS,
  AUDIO_TURN_PHASES,
  BRAIN_TURN_CAUSES,
  BRAIN_TURN_PHASES,
  CONTRACT_FIELD_NAMES,
  DEFERRAL_TOPICS,
  GATEWAY_ISSUE_KINDS,
  GATEWAY_LOG_KINDS,
  GATEWAY_LOG_VERSION,
  GATEWAY_STATES,
  INTERRUPT_CAUSES,
  PARENT_ALERT_KINDS,
  PRESENCE_CAUSES,
  PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
  SAFE_ISSUE_LIMITS,
  SAFETY_DECISIONS,
  SAFETY_RULES,
  SAFETY_STAGES,
  TIMEOUT_CAUSES,
  TOOL_DENIED_REASONS,
  TOOL_OUTCOMES,
  TRANSCRIPT_RETENTION_ACTIONS,
  toSafeIssues,
} from "../dist/index.js";
import type {
  AckResultLogEntry,
  AudioTurnLogEntry,
  AuthLogEntry,
  BrainTurnLogEntry,
  ButtonAction,
  ButtonName,
  ContractIssue,
  ContractIssueKind,
  EventAcceptedLogEntry,
  EventDuplicateLogEntry,
  GatewayLogEntry,
  GatewayLogEntryOf,
  GatewayLogKind,
  GatewayStateLogEntry,
  LoggedEvent,
  MessageInLogEntry,
  MessageOutLogEntry,
  MessageRejectedLogEntry,
  MotionKind,
  ParentAlertLogEntry,
  PresenceLogEntry,
  ProviderCheckLogEntry,
  SafeIssue,
  SafetyDecisionLogEntry,
  ToolCallLogEntry,
  TouchGesture,
  TouchZone,
  TranscriptRetentionLogEntry,
  WakeSource,
} from "../dist/index.js";

// ---------------------------------------------------------------------------------------------
// CONTRACT_FIELD_NAMES oracle, written by hand from the Document B v2 field tables (not from src).

const DOC_B_FIELDS_BY_SECTION: Readonly<Record<string, readonly string[]>> = {
  "envelope (device to cloud)": ["proto_ver", "ts", "type"],
  "§3.1 hello": ["device_id", "fw_ver", "auth", "proto"],
  "§3.2 status": [
    "battery_pct",
    "charging",
    "mode",
    "wifi_rssi",
    "fault",
    "active_child_id",
    "temp_c",
  ],
  "§3.3 event envelope": ["event_id", "event", "time_uncertain", "data"],
  "§3.3 touch": ["zone", "gesture"],
  "§3.3 wake": ["source", "dir_deg"],
  "§3.3 cry": ["confidence", "duration_s"],
  "§3.3 motion": ["event", "value"],
  "§3.3 button": ["button", "action"],
  "§3.3 nfc": ["card_id"],
  "§3.3 error": ["code", "detail"],
  "§3.4 audio markers": ["turn_id"],
  "§4 command envelope": ["proto_ver", "cmd_id", "action", "data"],
  "§4 say": ["expression", "lang", "voice", "duration_hint_ms"],
  "§4 animate": ["expression", "eyes", "loop"],
  "§4 gesture": ["name"],
  "§4 move": ["cmd", "linear_mms", "angular_mrad_s", "max_dist_mm"],
  "§4 play": ["content_id", "source"],
  "§4 set_mode": ["mode"],
  "§4 led": ["target", "color", "effect", "brightness"],
  "§4 volume": ["level"],
  "§4 config": [
    "volume",
    "quiet_hours",
    "start",
    "end",
    "movement_on",
    "language",
    "active_child_id",
  ],
  "§4.2 ota": ["manifest_url"],
  "§5 ack": ["cmd_id", "status", "reason"],
};

const ORACLE_FIELD_NAMES: readonly string[] = [
  ...new Set(Object.values(DOC_B_FIELDS_BY_SECTION).flat()),
].sort();

const FIXTURE_DIR = fileURLToPath(new URL("../src/gateway-contract/fixtures/", import.meta.url));
const FIXTURE_FILES = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".json") && name !== "manifest.json")
  .sort();

/** Every object key at every depth of a JSON value. */
function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

describe("CONTRACT_FIELD_NAMES (Req 4.5, D5)", () => {
  it("equals the 58-name oracle from the Document B field tables", () => {
    expect(ORACLE_FIELD_NAMES).toHaveLength(58);
    expect([...CONTRACT_FIELD_NAMES]).toEqual(ORACLE_FIELD_NAMES);
  });

  it("is sorted, has no duplicates and is frozen", () => {
    expect([...CONTRACT_FIELD_NAMES]).toEqual([...CONTRACT_FIELD_NAMES].sort());
    expect(new Set(CONTRACT_FIELD_NAMES).size).toBe(CONTRACT_FIELD_NAMES.length);
    expect(Object.isFrozen(CONTRACT_FIELD_NAMES)).toBe(true);
  });

  it("contains every key, at every depth, of every golden fixture", () => {
    expect(FIXTURE_FILES.length).toBeGreaterThan(0);
    for (const file of FIXTURE_FILES) {
      const keys = collectKeys(
        JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")),
        new Set(),
      );
      for (const key of keys) {
        expect(CONTRACT_FIELD_NAMES, `${file}: ${key}`).toContain(key);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Version, kinds and entry shapes.

/** All keys of every member of a union (keyof a union gives only the shared keys). */
type KeysOf<T> = T extends unknown ? keyof T : never;
type BaseKeys = "log_ver" | "seq" | "at" | "kind";
type EventKeys =
  | "device_id"
  | "event_id"
  | "event"
  | "data"
  | "time_uncertain"
  | "back_dated"
  | "ordering"
  | "device_ts"
  | "received_at";

/** Fields no Log_Entry may carry (Req 12.5, G21). */
type ForbiddenKeys =
  | "auth"
  | "token"
  | "device_token"
  | "password"
  | "mqtt_password"
  | "fw_ver"
  | "expression"
  | "eyes"
  | "name"
  | "lang"
  | "language"
  | "content_id"
  | "code"
  | "detail"
  | "card_id"
  | "active_child_id"
  | "manifest_url"
  | "quiet_hours"
  | "audio"
  | "bytes"
  | "frame"
  | "payload"
  | "transcript"
  | "text"
  | "value"
  | "message";

/** The Phase 1.2 ten, in order: the Phase 3 bump may not disturb them (Req 17.1, 17.2). */
const PHASE_1_2_KINDS = [
  "gateway",
  "message_in",
  "message_out",
  "message_rejected",
  "auth",
  "presence",
  "event_accepted",
  "event_duplicate",
  "ack_result",
  "audio_turn",
] as const;

/** The six Phase 3 kinds, appended (C3, Req 17.1). */
const PHASE_3_KINDS = [
  "brain_turn",
  "safety_decision",
  "tool_call",
  "provider_check",
  "parent_alert",
  "transcript_retention",
] as const;

describe("Gateway_Log version and kinds (Req 12.1, 12.2; Req 17.1)", () => {
  it("GATEWAY_LOG_VERSION is 2", () => {
    expect(GATEWAY_LOG_VERSION).toBe(2);
    expectTypeOf(GATEWAY_LOG_VERSION).toEqualTypeOf<2>();
  });

  it("GATEWAY_LOG_KINDS is the Phase 1.2 ten in order, then the six new ones, each once", () => {
    expect([...GATEWAY_LOG_KINDS]).toEqual([...PHASE_1_2_KINDS, ...PHASE_3_KINDS]);
    expect(GATEWAY_LOG_KINDS.slice(0, 10)).toEqual([...PHASE_1_2_KINDS]);
    expect(new Set(GATEWAY_LOG_KINDS).size).toBe(16);
    expectTypeOf<GatewayLogEntry["kind"]>().toEqualTypeOf<GatewayLogKind>();
  });
});

describe("Log_Entry shapes (Req 12.3, 12.4, 12.5)", () => {
  it("each entry type has exactly the listed fields for its kind", () => {
    // Compile-time only: tsc -p tsconfig.test.json fails if a type gains, loses or renames a field.
    expectTypeOf<KeysOf<GatewayStateLogEntry>>().toEqualTypeOf<BaseKeys | "state">();
    expectTypeOf<KeysOf<MessageInLogEntry>>().toEqualTypeOf<
      | BaseKeys
      | "transport"
      | "device_id"
      | "topic_suffix"
      | "variant"
      | "event_id"
      | "cmd_id"
      | "turn_id"
      | "battery_pct"
      | "charging"
      | "mode"
    >();
    expectTypeOf<KeysOf<MessageOutLogEntry>>().toEqualTypeOf<
      BaseKeys | "transport" | "device_id" | "variant" | "cmd_id" | "turn_id"
    >();
    expectTypeOf<KeysOf<MessageRejectedLogEntry>>().toEqualTypeOf<
      BaseKeys | "transport" | "device_id" | "topic_suffix" | "issues"
    >();
    expectTypeOf<KeysOf<AuthLogEntry>>().toEqualTypeOf<
      BaseKeys | "transport" | "device_id" | "outcome"
    >();
    expectTypeOf<KeysOf<PresenceLogEntry>>().toEqualTypeOf<
      BaseKeys | "device_id" | "state" | "cause"
    >();
    expectTypeOf<KeysOf<EventAcceptedLogEntry>>().toEqualTypeOf<BaseKeys | EventKeys>();
    expectTypeOf<KeysOf<EventDuplicateLogEntry>>().toEqualTypeOf<BaseKeys | EventKeys>();
    expectTypeOf<KeysOf<AckResultLogEntry>>().toEqualTypeOf<
      BaseKeys | "device_id" | "cmd_id" | "action" | "outcome" | "reason" | "timeout_cause"
    >();
    expectTypeOf<KeysOf<AudioTurnLogEntry>>().toEqualTypeOf<
      | BaseKeys
      | "device_id"
      | "turn_id"
      | "phase"
      | "frames_in"
      | "bytes_in"
      | "frames_out"
      | "cause"
      | "issues"
    >();
    expectTypeOf<GatewayLogEntryOf<"presence">>().toEqualTypeOf<PresenceLogEntry>();
    expectTypeOf<EventDuplicateLogEntry["back_dated"]>().toEqualTypeOf<false>();
  });

  it("logged event data holds only the Closed_Enum keys of each Event_Kind", () => {
    expectTypeOf<Extract<LoggedEvent, { event: "touch" }>["data"]>().toEqualTypeOf<{
      readonly zone: TouchZone;
      readonly gesture: TouchGesture;
    }>();
    expectTypeOf<Extract<LoggedEvent, { event: "wake" }>["data"]>().toEqualTypeOf<{
      readonly source: WakeSource;
    }>();
    expectTypeOf<Extract<LoggedEvent, { event: "motion" }>["data"]>().toEqualTypeOf<{
      readonly event: MotionKind;
    }>();
    expectTypeOf<Extract<LoggedEvent, { event: "button" }>["data"]>().toEqualTypeOf<{
      readonly button: ButtonName;
      readonly action: ButtonAction;
    }>();
    // cry, nfc, interrupt and error share one member whose `event` is a union of the four kinds.
    type EmptyDataMember = Extract<LoggedEvent, { event: "cry" | "nfc" | "interrupt" | "error" }>;
    expectTypeOf<EmptyDataMember["event"]>().toEqualTypeOf<"cry" | "nfc" | "interrupt" | "error">();
    expectTypeOf<EmptyDataMember["data"]>().toEqualTypeOf<{ readonly [k: string]: never }>();
  });

  it("no Phase 1.2 entry type has a forbidden field", () => {
    expectTypeOf<Extract<KeysOf<Phase12LogEntry>, ForbiddenKeys>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<KeysOf<LoggedEvent["data"]>, ForbiddenKeys>>().toEqualTypeOf<never>();
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 3: the six additive kinds (Req 17.1–17.5). The Phase 1.2 ten above are unchanged, so an
// entry built for GATEWAY_LOG_VERSION 1 differs only in `log_ver`.

type Phase12LogEntry =
  | GatewayStateLogEntry
  | MessageInLogEntry
  | MessageOutLogEntry
  | MessageRejectedLogEntry
  | AuthLogEntry
  | PresenceLogEntry
  | EventAcceptedLogEntry
  | EventDuplicateLogEntry
  | AckResultLogEntry
  | AudioTurnLogEntry;

type Phase3LogEntry =
  | BrainTurnLogEntry
  | SafetyDecisionLogEntry
  | ToolCallLogEntry
  | ProviderCheckLogEntry
  | ParentAlertLogEntry
  | TranscriptRetentionLogEntry;

/**
 * Fields no entry of any kind may carry (Req 17.3, safety.md §7). This is the Phase 1.2 list
 * without `lang`: the new `lang` field is one of the two Supported_Langs, a closed list, never a
 * free-form tag. `age_stage` is likewise one of four buckets and names nobody.
 */
type ForbiddenKeysEverywhere =
  | Exclude<ForbiddenKeys, "lang">
  | "reply"
  | "reply_text"
  | "transcript_text"
  | "utterance"
  | "args"
  | "arguments"
  | "tool_args"
  | "child_name"
  | "child_id";

/** One entry per new kind, with every field present and null where it has no value (Req 17.5). */
const PHASE_3_EXAMPLES: readonly Phase3LogEntry[] = [
  {
    log_ver: GATEWAY_LOG_VERSION,
    seq: 51,
    at: "2026-10-20T10:00:04.100Z",
    kind: "brain_turn",
    device_id: "xlu_000123",
    turn_id: "t_9f",
    phase: "transcribed",
    lang: "en-IN",
    age_stage: "little",
    since_audio_end_ms: 40,
    frames_out: 0,
    cause: null,
  },
  {
    log_ver: GATEWAY_LOG_VERSION,
    seq: 52,
    at: "2026-10-20T10:00:04.110Z",
    kind: "safety_decision",
    device_id: "xlu_000123",
    turn_id: "t_9f",
    stage: "input",
    decision: "defer",
    rule: "defer_topic",
    topic: "death",
  },
  {
    log_ver: GATEWAY_LOG_VERSION,
    seq: 53,
    at: "2026-10-20T10:00:04.120Z",
    kind: "tool_call",
    device_id: "xlu_000123",
    turn_id: "t_9f",
    tool: null,
    outcome: "denied",
    denied_reason: "not_allow_listed",
  },
  {
    log_ver: GATEWAY_LOG_VERSION,
    seq: 54,
    at: "2026-10-20T10:00:04.130Z",
    kind: "provider_check",
    capability: "stt",
    provider: "mock",
    retains: false,
    trains: false,
    outcome: "accepted",
  },
  {
    log_ver: GATEWAY_LOG_VERSION,
    seq: 55,
    at: "2026-10-20T10:00:04.140Z",
    kind: "parent_alert",
    device_id: "xlu_000123",
    turn_id: null,
    alert_id: "al_7",
    alert: "cry",
    confidence: 0.82,
    duration_s: 6,
    topic: null,
  },
  {
    log_ver: GATEWAY_LOG_VERSION,
    seq: 56,
    at: "2026-10-20T10:00:04.150Z",
    kind: "transcript_retention",
    action: "expired",
    turns_removed: 3,
    turns_held: 12,
  },
];

describe("Phase 3 Log_Entry shapes (Req 17.2, 17.3, 17.5)", () => {
  it("the Phase 1.2 union and the new union together cover every kind", () => {
    expectTypeOf<Phase12LogEntry | Phase3LogEntry>().toEqualTypeOf<GatewayLogEntry>();
    expectTypeOf<Phase12LogEntry["kind"]>().toEqualTypeOf<(typeof PHASE_1_2_KINDS)[number]>();
    expectTypeOf<Phase3LogEntry["kind"]>().toEqualTypeOf<(typeof PHASE_3_KINDS)[number]>();
  });

  it("each new entry type has exactly the listed fields for its kind", () => {
    // Compile-time only, like the Phase 1.2 block above.
    expectTypeOf<KeysOf<BrainTurnLogEntry>>().toEqualTypeOf<
      | BaseKeys
      | "device_id"
      | "turn_id"
      | "phase"
      | "lang"
      | "age_stage"
      | "since_audio_end_ms"
      | "frames_out"
      | "cause"
    >();
    expectTypeOf<KeysOf<SafetyDecisionLogEntry>>().toEqualTypeOf<
      BaseKeys | "device_id" | "turn_id" | "stage" | "decision" | "rule" | "topic"
    >();
    expectTypeOf<KeysOf<ToolCallLogEntry>>().toEqualTypeOf<
      BaseKeys | "device_id" | "turn_id" | "tool" | "outcome" | "denied_reason"
    >();
    expectTypeOf<KeysOf<ProviderCheckLogEntry>>().toEqualTypeOf<
      BaseKeys | "capability" | "provider" | "retains" | "trains" | "outcome"
    >();
    expectTypeOf<KeysOf<ParentAlertLogEntry>>().toEqualTypeOf<
      | BaseKeys
      | "device_id"
      | "turn_id"
      | "alert_id"
      | "alert"
      | "confidence"
      | "duration_s"
      | "topic"
    >();
    expectTypeOf<KeysOf<TranscriptRetentionLogEntry>>().toEqualTypeOf<
      BaseKeys | "action" | "turns_removed" | "turns_held"
    >();
    expectTypeOf<GatewayLogEntryOf<"brain_turn">>().toEqualTypeOf<BrainTurnLogEntry>();
    expectTypeOf<ProviderCheckLogEntry["outcome"]>().toEqualTypeOf<"accepted" | "refused">();
  });

  it("no entry type, old or new, has a forbidden field", () => {
    expectTypeOf<
      Extract<KeysOf<GatewayLogEntry>, ForbiddenKeysEverywhere>
    >().toEqualTypeOf<never>();
  });

  it("every new kind round-trips through JSON unchanged (Req 17.6)", () => {
    for (const entry of PHASE_3_EXAMPLES) {
      expect(entry.log_ver).toBe(GATEWAY_LOG_VERSION);
      const line = JSON.stringify(entry);
      expect(JSON.parse(line)).toEqual(entry);
      // Every value is a closed-enum string, an id, a boolean, a count or a time.
      for (const value of Object.values(entry)) {
        expect(["string", "number", "boolean", "object"]).toContain(typeof value);
        if (typeof value === "object") expect(value).toBeNull();
      }
    }
    expect(PHASE_3_EXAMPLES.map((entry) => entry.kind)).toEqual([...PHASE_3_KINDS]);
  });
});

// ---------------------------------------------------------------------------------------------
// Safe_Issue rules.

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const DECLARED = new Set(CONTRACT_FIELD_NAMES);

/** Independent statement of Req 4.5 for one unknown-key segment. */
function expectedUnknownSegment(segment: string): string {
  return Array.from(segment)
    .slice(0, 32)
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp >= 0x20 && cp <= 0x7e ? ch : "?";
    })
    .join("");
}

describe("toSafeIssues examples (Req 4.5)", () => {
  it("keeps declared field names and numeric segments unchanged", () => {
    expect(
      toSafeIssues([{ path: ["data", "fault", 3, "battery_pct"], kind: "invalid_type" }]),
    ).toEqual([{ path: ["data", "fault", 3, "battery_pct"], kind: "invalid_type" }]);
  });

  it("cuts an unknown key to 32 code points and replaces non-printable code points", () => {
    const longKey = "k".repeat(40);
    expect(toSafeIssues([{ path: [longKey], kind: "unrecognized_keys" }])).toEqual([
      { path: ["k".repeat(32)], kind: "unrecognized_keys" },
    ]);
    // An astral emoji is one code point and becomes one `?`; a lone surrogate also becomes one.
    expect(
      toSafeIssues([{ path: ["a\u0000b\n\u{1F600}\uD800\u00e9"], kind: "unrecognized_keys" }]),
    ).toEqual([{ path: ["a?b????"], kind: "unrecognized_keys" }]);
  });

  it("keeps only path and kind, and only the first 20 issues in order", () => {
    const issues = Array.from({ length: 25 }, (_, i) => ({
      path: [i],
      kind: "invalid_type" as const,
      value: "sentinel-value-1234",
    }));
    const out = toSafeIssues(issues);
    expect(out).toHaveLength(20);
    expect(out.map((issue) => issue.path[0])).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (const issue of out) expect(Object.keys(issue).sort()).toEqual(["kind", "path"]);
    expect(JSON.stringify(out)).not.toContain("sentinel");
  });

  it("accepts Gateway_Issue_Kinds and an empty list", () => {
    expect(toSafeIssues([{ path: ["device_id"], kind: "device_id_mismatch" }])).toEqual([
      { path: ["device_id"], kind: "device_id_mismatch" },
    ]);
    expect(toSafeIssues([])).toEqual([]);
  });
});

const ISSUE_KINDS: readonly (ContractIssueKind | (typeof GATEWAY_ISSUE_KINDS)[number])[] = [
  "invalid_type",
  "unrecognized_keys",
  "too_big",
  "invalid_value",
  "custom",
  "invalid_json",
  "reason_required",
  ...GATEWAY_ISSUE_KINDS,
];

/** One code point drawn from all of Unicode, biased towards the awkward ranges. */
const codePointArb = fc.oneof(
  fc.string({ unit: "binary", minLength: 1, maxLength: 1 }),
  fc.integer({ min: 0xd800, max: 0xdfff }).map((u) => String.fromCharCode(u)), // lone surrogate
  fc.integer({ min: 0x00, max: 0x1f }).map((u) => String.fromCharCode(u)), // C0 control
  fc.integer({ min: 0x7f, max: 0x9f }).map((u) => String.fromCharCode(u)), // DEL and C1
  fc.integer({ min: 0x20, max: 0x7e }).map((u) => String.fromCharCode(u)), // printable ASCII
);

/** Strings of 0 to 200 code points (adjacent surrogates may pair, giving fewer). */
const unicodeSegmentArb = fc
  .array(codePointArb, { minLength: 0, maxLength: 200 })
  .map((parts) => parts.join(""));

const segmentArb: fc.Arbitrary<string | number> = fc.oneof(
  fc.nat(),
  unicodeSegmentArb,
  fc.constantFrom(...CONTRACT_FIELD_NAMES),
);

const issueArb = fc.record({
  path: fc.array(segmentArb, { maxLength: 6 }),
  kind: fc.constantFrom(...ISSUE_KINDS),
});

describe("Safe_Issue rules (Req 4.5, 4.8)", () => {
  // Feature: phase-1-2-gateway-simulator, Property 3: Safe_Issue segment rules are bounded and idempotent
  // **Validates: Requirements 4.5, 4.8**
  it("bounds unknown keys, keeps numbers and declared names, and is idempotent", () => {
    fc.assert(
      fc.property(fc.array(issueArb, { maxLength: 30 }), (issues) => {
        const out = toSafeIssues(issues as readonly (ContractIssue | SafeIssue)[]);
        expect(out).toHaveLength(Math.min(issues.length, SAFE_ISSUE_LIMITS.max_issues));
        out.forEach((safe, i) => {
          const original = issues[i]!;
          expect(Object.keys(safe).sort()).toEqual(["kind", "path"]);
          expect(safe.kind).toBe(original.kind);
          expect(safe.path).toHaveLength(original.path.length);
          safe.path.forEach((segment, j) => {
            const before = original.path[j]!;
            if (typeof before === "number" || DECLARED.has(before)) {
              expect(segment).toBe(before);
            } else {
              expect(typeof segment).toBe("string");
              const text = segment as string;
              expect(Array.from(text).length).toBeLessThanOrEqual(32);
              expect(text).toMatch(PRINTABLE_ASCII);
              expect(text).toBe(expectedUnknownSegment(before));
            }
          });
        });
        expect(toSafeIssues(out)).toEqual(out);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Constant lists and freezing (Req 12.1).

const EXPECTED_LISTS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  [
    "GATEWAY_LOG_KINDS",
    GATEWAY_LOG_KINDS,
    [
      "gateway",
      "message_in",
      "message_out",
      "message_rejected",
      "auth",
      "presence",
      "event_accepted",
      "event_duplicate",
      "ack_result",
      "audio_turn",
      "brain_turn",
      "safety_decision",
      "tool_call",
      "provider_check",
      "parent_alert",
      "transcript_retention",
    ],
  ],
  [
    "GATEWAY_STATES",
    GATEWAY_STATES,
    ["starting", "broker_connected", "broker_disconnected", "audio_listening", "stopping"],
  ],
  [
    "GATEWAY_ISSUE_KINDS",
    GATEWAY_ISSUE_KINDS,
    ["invalid_topic", "unknown_device", "payload_too_large", "device_id_mismatch", "auth_failed"],
  ],
  [
    "ABORT_CAUSES",
    ABORT_CAUSES,
    [
      "invalid_message",
      "text_too_large",
      "frame_before_start",
      "end_before_start",
      "duplicate_start",
      "turn_id_mismatch",
      "frame_too_large",
      "too_many_frames",
      "start_timeout",
      "idle_timeout",
      "client_closed",
      "replaced",
      "device_offline",
      "broker_disconnected",
    ],
  ],
  ["INTERRUPT_CAUSES", INTERRUPT_CAUSES, ["device_offline", "broker_disconnected"]],
  [
    "AUDIO_TURN_PHASES",
    AUDIO_TURN_PHASES,
    ["started", "ended", "reply_started", "reply_ended", "interrupted", "aborted"],
  ],
  [
    "ACK_RESULT_OUTCOMES",
    ACK_RESULT_OUTCOMES,
    ["accepted", "done", "rejected", "failed", "timed_out", "duplicate", "late", "unmatched"],
  ],
  ["TIMEOUT_CAUSES", TIMEOUT_CAUSES, ["no_ack", "no_completion"]],
  ["PRESENCE_CAUSES", PRESENCE_CAUSES, ["hello", "status", "silence"]],
];

describe("Gateway_Log constants (Req 12.1)", () => {
  it.each(EXPECTED_LISTS)(
    "%s holds exactly the stated values in order",
    (_name, list, expected) => {
      expect([...list]).toEqual([...expected]);
    },
  );

  it("SAFE_ISSUE_LIMITS holds the R2 limits", () => {
    expect({ ...SAFE_ISSUE_LIMITS }).toEqual({ max_issues: 20, max_unknown_key_code_points: 32 });
  });

  it("every list is typed as a read-only tuple of its exact values", () => {
    // Compile-time only.
    expectTypeOf(INTERRUPT_CAUSES).toEqualTypeOf<
      readonly ["device_offline", "broker_disconnected"]
    >();
    expectTypeOf(ACK_RESULT_OUTCOMES).toEqualTypeOf<
      readonly [
        "accepted",
        "done",
        "rejected",
        "failed",
        "timed_out",
        "duplicate",
        "late",
        "unmatched",
      ]
    >();
    expectTypeOf(TIMEOUT_CAUSES).toEqualTypeOf<readonly ["no_ack", "no_completion"]>();
    expectTypeOf(PRESENCE_CAUSES).toEqualTypeOf<readonly ["hello", "status", "silence"]>();
    expectTypeOf(SAFE_ISSUE_LIMITS).toEqualTypeOf<{
      readonly max_issues: 20;
      readonly max_unknown_key_code_points: 32;
    }>();
    expectTypeOf(CONTRACT_FIELD_NAMES).toEqualTypeOf<readonly string[]>();
  });

  const FROZEN: readonly (readonly [string, object])[] = [
    ...EXPECTED_LISTS.map(([name, list]): readonly [string, object] => [name, list]),
    ["SAFE_ISSUE_LIMITS", SAFE_ISSUE_LIMITS],
    ["CONTRACT_FIELD_NAMES", CONTRACT_FIELD_NAMES],
  ];

  it.each(FROZEN)("%s is frozen at runtime", (_name, value) => {
    expect(Object.isFrozen(value)).toBe(true);
  });

  // Each write is a compile error (checked by @ts-expect-error under tsconfig.test.json) and, in
  // strict-mode ESM, throws a TypeError at runtime without changing the contents.
  const WRITES: readonly (readonly [string, () => unknown, () => void])[] = [
    [
      "GATEWAY_LOG_KINDS",
      () => [...GATEWAY_LOG_KINDS],
      () => {
        // @ts-expect-error read-only tuple
        GATEWAY_LOG_KINDS[0] = "audio_turn";
      },
    ],
    [
      "GATEWAY_STATES",
      () => [...GATEWAY_STATES],
      () => {
        // @ts-expect-error read-only tuple
        GATEWAY_STATES[0] = "stopping";
      },
    ],
    [
      "GATEWAY_ISSUE_KINDS",
      () => [...GATEWAY_ISSUE_KINDS],
      () => {
        // @ts-expect-error read-only tuple
        GATEWAY_ISSUE_KINDS[0] = "auth_failed";
      },
    ],
    [
      "ABORT_CAUSES",
      () => [...ABORT_CAUSES],
      () => {
        // @ts-expect-error read-only tuple
        ABORT_CAUSES[0] = "replaced";
      },
    ],
    [
      "INTERRUPT_CAUSES",
      () => [...INTERRUPT_CAUSES],
      () => {
        // @ts-expect-error read-only tuple
        INTERRUPT_CAUSES[0] = "broker_disconnected";
      },
    ],
    [
      "AUDIO_TURN_PHASES",
      () => [...AUDIO_TURN_PHASES],
      () => {
        // @ts-expect-error read-only tuple
        AUDIO_TURN_PHASES[0] = "aborted";
      },
    ],
    [
      "ACK_RESULT_OUTCOMES",
      () => [...ACK_RESULT_OUTCOMES],
      () => {
        // @ts-expect-error read-only tuple
        ACK_RESULT_OUTCOMES[0] = "unmatched";
      },
    ],
    [
      "TIMEOUT_CAUSES",
      () => [...TIMEOUT_CAUSES],
      () => {
        // @ts-expect-error read-only tuple
        TIMEOUT_CAUSES[0] = "no_completion";
      },
    ],
    [
      "PRESENCE_CAUSES",
      () => [...PRESENCE_CAUSES],
      () => {
        // @ts-expect-error read-only tuple
        PRESENCE_CAUSES[0] = "silence";
      },
    ],
    [
      "SAFE_ISSUE_LIMITS",
      () => ({ ...SAFE_ISSUE_LIMITS }),
      () => {
        // @ts-expect-error read-only property
        SAFE_ISSUE_LIMITS.max_issues = 21;
      },
    ],
    [
      "CONTRACT_FIELD_NAMES",
      () => [...CONTRACT_FIELD_NAMES],
      () => {
        // @ts-expect-error read-only array
        CONTRACT_FIELD_NAMES[0] = "zz_field";
      },
    ],
  ];

  it("WRITES covers every new constant except the version number", () => {
    expect(WRITES.map(([name]) => name)).toEqual([
      ...EXPECTED_LISTS.map(([name]) => name),
      "SAFE_ISSUE_LIMITS",
      "CONTRACT_FIELD_NAMES",
    ]);
  });

  it.each(WRITES)("writing to %s throws and leaves it unchanged", (_name, snapshot, write) => {
    const before = snapshot();
    expect(write).toThrow(TypeError);
    expect(snapshot()).toEqual(before);
  });

  it("pushing onto CONTRACT_FIELD_NAMES throws and leaves it unchanged", () => {
    const before = [...CONTRACT_FIELD_NAMES];
    expect(() => {
      // @ts-expect-error read-only array has no push
      CONTRACT_FIELD_NAMES.push("zz_field");
    }).toThrow(TypeError);
    expect([...CONTRACT_FIELD_NAMES]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 3 constants (Req 17.1, 17.4): one frozen list per new closed list, values restated here.

const PHASE_3_LISTS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  [
    "BRAIN_TURN_PHASES",
    BRAIN_TURN_PHASES,
    ["started", "transcribed", "replied", "speaking", "filler", "done", "failed", "aborted"],
  ],
  [
    "BRAIN_TURN_CAUSES",
    BRAIN_TURN_CAUSES,
    [
      "stt_failed",
      "llm_failed",
      "tts_failed",
      "provider_refused",
      "tool_failed",
      "interrupted",
      "client_closed",
      "replaced",
      "device_offline",
      "broker_disconnected",
      "gateway_stopping",
    ],
  ],
  ["SAFETY_STAGES", SAFETY_STAGES, ["input", "output"]],
  ["SAFETY_DECISIONS", SAFETY_DECISIONS, ["allow", "defer", "comfort", "refuse"]],
  [
    "SAFETY_RULES",
    SAFETY_RULES,
    [
      "blocked_category",
      "defer_topic",
      "distress",
      "harm_disclosure",
      "unsupported_language",
      "too_long",
      "url",
      "contact_detail",
      "price",
      "brand",
      "romantic",
      "frightening",
      "medical",
      "legal",
      "financial",
      "length",
      "uncertain",
      "none",
    ],
  ],
  [
    "DEFERRAL_TOPICS",
    DEFERRAL_TOPICS,
    ["death", "body", "violence", "religion", "family_conflict", "parent_added"],
  ],
  [
    "ALLOW_LISTED_TOOLS",
    ALLOW_LISTED_TOOLS,
    ["content_lookup", "routine_lookup", "memory_read", "memory_write", "device_action"],
  ],
  ["TOOL_OUTCOMES", TOOL_OUTCOMES, ["ok", "denied", "error"]],
  ["TOOL_DENIED_REASONS", TOOL_DENIED_REASONS, ["not_allow_listed", "policy", "too_many"]],
  ["PROVIDER_CAPABILITIES", PROVIDER_CAPABILITIES, ["stt", "llm", "tts"]],
  [
    "PROVIDER_IDS",
    PROVIDER_IDS,
    ["mock", "sarvam", "elevenlabs", "faster_whisper", "indic_parler", "indic_f5", "hosted_llm"],
  ],
  [
    "PARENT_ALERT_KINDS",
    PARENT_ALERT_KINDS,
    ["cry", "distress", "harm_disclosure", "deferred_question"],
  ],
  ["TRANSCRIPT_RETENTION_ACTIONS", TRANSCRIPT_RETENTION_ACTIONS, ["expired", "deleted_all"]],
];

describe("Phase 3 Gateway_Log constants (Req 17.1, 17.4)", () => {
  it.each(PHASE_3_LISTS)("%s holds exactly the stated values in order", (_name, list, expected) => {
    expect([...list]).toEqual([...expected]);
    expect(new Set(list).size).toBe(list.length);
  });

  it.each(PHASE_3_LISTS)("%s is frozen at runtime", (_name, list) => {
    expect(Object.isFrozen(list)).toBe(true);
  });

  it("every new list is typed as a read-only tuple of its exact values", () => {
    // Compile-time only, spot-checked across the shapes used by the entry types.
    expectTypeOf(SAFETY_STAGES).toEqualTypeOf<readonly ["input", "output"]>();
    expectTypeOf(SAFETY_DECISIONS).toEqualTypeOf<
      readonly ["allow", "defer", "comfort", "refuse"]
    >();
    expectTypeOf(TOOL_OUTCOMES).toEqualTypeOf<readonly ["ok", "denied", "error"]>();
    expectTypeOf(PROVIDER_CAPABILITIES).toEqualTypeOf<readonly ["stt", "llm", "tts"]>();
    expectTypeOf(TRANSCRIPT_RETENTION_ACTIONS).toEqualTypeOf<readonly ["expired", "deleted_all"]>();
  });

  const PHASE_3_WRITES: readonly (readonly [string, () => unknown, () => void])[] = [
    [
      "BRAIN_TURN_PHASES",
      () => [...BRAIN_TURN_PHASES],
      () => {
        // @ts-expect-error read-only tuple
        BRAIN_TURN_PHASES[0] = "done";
      },
    ],
    [
      "BRAIN_TURN_CAUSES",
      () => [...BRAIN_TURN_CAUSES],
      () => {
        // @ts-expect-error read-only tuple
        BRAIN_TURN_CAUSES[0] = "interrupted";
      },
    ],
    [
      "SAFETY_STAGES",
      () => [...SAFETY_STAGES],
      () => {
        // @ts-expect-error read-only tuple
        SAFETY_STAGES[0] = "output";
      },
    ],
    [
      "SAFETY_DECISIONS",
      () => [...SAFETY_DECISIONS],
      () => {
        // @ts-expect-error read-only tuple
        SAFETY_DECISIONS[0] = "refuse";
      },
    ],
    [
      "SAFETY_RULES",
      () => [...SAFETY_RULES],
      () => {
        // @ts-expect-error read-only tuple
        SAFETY_RULES[0] = "none";
      },
    ],
    [
      "DEFERRAL_TOPICS",
      () => [...DEFERRAL_TOPICS],
      () => {
        // @ts-expect-error read-only tuple
        DEFERRAL_TOPICS[0] = "parent_added";
      },
    ],
    [
      "ALLOW_LISTED_TOOLS",
      () => [...ALLOW_LISTED_TOOLS],
      () => {
        // @ts-expect-error read-only tuple
        ALLOW_LISTED_TOOLS[0] = "device_action";
      },
    ],
    [
      "TOOL_OUTCOMES",
      () => [...TOOL_OUTCOMES],
      () => {
        // @ts-expect-error read-only tuple
        TOOL_OUTCOMES[0] = "error";
      },
    ],
    [
      "TOOL_DENIED_REASONS",
      () => [...TOOL_DENIED_REASONS],
      () => {
        // @ts-expect-error read-only tuple
        TOOL_DENIED_REASONS[0] = "too_many";
      },
    ],
    [
      "PROVIDER_CAPABILITIES",
      () => [...PROVIDER_CAPABILITIES],
      () => {
        // @ts-expect-error read-only tuple
        PROVIDER_CAPABILITIES[0] = "tts";
      },
    ],
    [
      "PROVIDER_IDS",
      () => [...PROVIDER_IDS],
      () => {
        // @ts-expect-error read-only tuple
        PROVIDER_IDS[0] = "sarvam";
      },
    ],
    [
      "PARENT_ALERT_KINDS",
      () => [...PARENT_ALERT_KINDS],
      () => {
        // @ts-expect-error read-only tuple
        PARENT_ALERT_KINDS[0] = "distress";
      },
    ],
    [
      "TRANSCRIPT_RETENTION_ACTIONS",
      () => [...TRANSCRIPT_RETENTION_ACTIONS],
      () => {
        // @ts-expect-error read-only tuple
        TRANSCRIPT_RETENTION_ACTIONS[0] = "deleted_all";
      },
    ],
  ];

  it("PHASE_3_WRITES covers every new list", () => {
    expect(PHASE_3_WRITES.map(([name]) => name)).toEqual(PHASE_3_LISTS.map(([name]) => name));
  });

  it.each(PHASE_3_WRITES)("writing to %s throws and leaves it unchanged", (_n, snapshot, write) => {
    const before = snapshot();
    expect(write).toThrow(TypeError);
    expect(snapshot()).toEqual(before);
  });
});
