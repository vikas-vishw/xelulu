// Gateway_Log core: Properties 9 and 11, and the throwing-subscriber rule (Req 12.3–12.11).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GATEWAY_LOG_VERSION, type GatewayLogEntry, type GatewayLogKind } from "@xelulu/shared";

import { createGatewayLog, GATEWAY_LOG_BACKLOG } from "../src/log/gateway-log.js";
import type { LineSink } from "../src/log/logger.js";
import { logEntryFieldsArb } from "./support/arbitraries.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";

const nullSink: LineSink = { writeLine() {} };
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The fields Requirement 12.4 lists per kind, written here independently of the types. */
const KIND_FIELDS: Readonly<Record<GatewayLogKind, readonly string[]>> = {
  gateway: ["state"],
  message_in: [
    "transport",
    "device_id",
    "topic_suffix",
    "variant",
    "event_id",
    "cmd_id",
    "turn_id",
    "battery_pct",
    "charging",
    "mode",
  ],
  message_out: ["transport", "device_id", "variant", "cmd_id", "turn_id"],
  message_rejected: ["transport", "device_id", "topic_suffix", "issues"],
  auth: ["transport", "device_id", "outcome"],
  presence: ["device_id", "state", "cause"],
  event_accepted: [
    "device_id",
    "event_id",
    "event",
    "data",
    "time_uncertain",
    "back_dated",
    "ordering",
    "device_ts",
    "received_at",
  ],
  event_duplicate: [
    "device_id",
    "event_id",
    "event",
    "data",
    "time_uncertain",
    "back_dated",
    "ordering",
    "device_ts",
    "received_at",
  ],
  ack_result: ["device_id", "cmd_id", "action", "outcome", "reason", "timeout_cause"],
  audio_turn: [
    "device_id",
    "turn_id",
    "phase",
    "frames_in",
    "bytes_in",
    "frames_out",
    "cause",
    "issues",
  ],
  // Phase 3 additive kinds (Req 17.5). No generator writes them yet; the field lists keep this
  // table exhaustive over GatewayLogKind, so a kind cannot be added without being listed here.
  brain_turn: [
    "device_id",
    "turn_id",
    "phase",
    "lang",
    "age_stage",
    "since_audio_end_ms",
    "frames_out",
    "cause",
  ],
  safety_decision: ["device_id", "turn_id", "stage", "decision", "rule", "topic"],
  tool_call: ["device_id", "turn_id", "tool", "outcome", "denied_reason"],
  provider_check: ["capability", "provider", "retains", "trains", "outcome"],
  parent_alert: ["device_id", "turn_id", "alert_id", "alert", "confidence", "duration_s", "topic"],
  transcript_retention: ["action", "turns_removed", "turns_held"],
  // Phase 4 additive kinds (Req 15.2, 15.5). Written here independently of the types, as above,
  // so the table stays exhaustive over GatewayLogKind and a kind cannot be added without being
  // listed. Ids, closed enums, counts and times only — no text, title or Media_Handle.
  routine_fired: [
    "device_id",
    "trigger",
    "ref_id",
    "threshold",
    "battery_pct",
    "actions",
    "sent",
    "refused",
    "refusal",
  ],
  content_gate: ["content_id", "action", "outcome", "rule", "age_stage", "lang"],
  grandma_event: ["device_id", "asset_id", "call_id", "event", "outcome", "reason", "call_state"],
  story_step: ["device_id", "turn_id", "content_id", "step_id", "choice_id", "outcome"],
  report_built: [
    "device_id",
    "period",
    "window_days",
    "turns",
    "play_minutes",
    "routines_completed",
    "stories_heard",
    "words_learned",
    "cry_moments",
    "categories",
  ],
};

/** String, finite number, boolean, null, array or plain object, all the way down (Req 12.11). */
function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) return value.every(isJsonSafe);
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every(isJsonSafe);
    default:
      return false;
  }
}

type Op = { t: "add"; n: number } | { t: "sub" } | { t: "unsub"; i: number; twice: boolean };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({ t: fc.constant("add" as const), n: fc.integer({ min: 1, max: 700 }) }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("sub" as const) }) },
  {
    weight: 1,
    arbitrary: fc.record({ t: fc.constant("unsub" as const), i: fc.nat(), twice: fc.boolean() }),
  },
);

const MAX_ADDS = 3_000;

describe("Gateway_Log subscribers", () => {
  // Feature: phase-1-2-gateway-simulator, Property 9: Subscribers see a contiguous seq stream
  // **Validates: Requirements 12.6, 12.9**
  it("delivers the backlog then every later entry, contiguous by seq, until unsubscribe", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 24 }), (ops) => {
        const log = createGatewayLog(createTestClock(1_700_000_000_000), nullSink);
        type Sub = {
          seqs: number[];
          addedAtSub: number;
          addedAtUnsub: number | null;
          unsub: () => void;
        };
        const subs: Sub[] = [];
        let added = 0;

        for (const op of ops) {
          if (op.t === "add") {
            const n = Math.min(op.n, MAX_ADDS - added);
            for (let k = 0; k < n; k++) log.add({ kind: "gateway", state: "starting" });
            added += n;
          } else if (op.t === "sub") {
            const sub: Sub = { seqs: [], addedAtSub: added, addedAtUnsub: null, unsub: () => {} };
            sub.unsub = log.subscribe((e) => sub.seqs.push(e.seq));
            subs.push(sub);
          } else if (subs.length > 0) {
            const sub = subs[op.i % subs.length];
            if (sub === undefined) continue;
            if (sub.addedAtUnsub === null) sub.addedAtUnsub = added;
            sub.unsub();
            if (op.twice) sub.unsub();
          }
        }
        // More entries after every op: no unsubscribed subscriber may receive them.
        log.add({ kind: "gateway", state: "stopping" });
        added += 1;

        for (const sub of subs) {
          const backlog = Math.min(sub.addedAtSub, GATEWAY_LOG_BACKLOG);
          const first = sub.addedAtSub - backlog + 1;
          const last = sub.addedAtUnsub ?? added;
          const expected = Array.from({ length: last - first + 1 }, (_, k) => first + k);
          expect(sub.seqs).toEqual(expected);
          if (sub.addedAtSub > 0) expect(sub.seqs[backlog - 1]).toBe(sub.addedAtSub);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("removes a throwing subscriber, still delivers the entry to the others and writes it", () => {
    const sink = createCaptureSink();
    const log = createGatewayLog(createTestClock(0), sink);
    const before: number[] = [];
    const after: number[] = [];
    let throwerCalls = 0;
    log.subscribe((e) => before.push(e.seq));
    log.subscribe(() => {
      throwerCalls += 1;
      throw new Error("subscriber failure");
    });
    log.subscribe((e) => after.push(e.seq));

    log.add({ kind: "gateway", state: "starting" });
    log.add({ kind: "gateway", state: "audio_listening" });

    expect(throwerCalls).toBe(1);
    expect(before).toEqual([1, 2]);
    expect(after).toEqual([1, 2]);
    expect(sink.lines).toHaveLength(2);
    expect(sink.text()).not.toContain("subscriber failure");
  });

  it("since(after) returns the retained entries with a larger seq", () => {
    const log = createGatewayLog(createTestClock(0), nullSink);
    for (let k = 0; k < GATEWAY_LOG_BACKLOG + 5; k++)
      log.add({ kind: "gateway", state: "starting" });
    expect(log.since()).toHaveLength(GATEWAY_LOG_BACKLOG);
    expect(log.since()[0]?.seq).toBe(6);
    expect(log.since(1_000).map((e) => e.seq)).toEqual([1_001, 1_002, 1_003, 1_004, 1_005]);
    expect(log.since(1_005)).toEqual([]);
  });
});

describe("Gateway_Log entries", () => {
  // Feature: phase-1-2-gateway-simulator, Property 11: Log entries are JSON-safe and round-trip through stdout
  // **Validates: Requirements 12.3, 12.4, 12.8, 12.11**
  it("have exactly their kind's fields, are JSON-safe, and the stdout line parses to the entry", () => {
    fc.assert(
      fc.property(
        fc.array(logEntryFieldsArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 253_402_300_799_999 }),
        (fieldsList, start) => {
          const clock = createTestClock(start);
          const sink = createCaptureSink();
          const log = createGatewayLog(clock, sink);
          const delivered: GatewayLogEntry[] = [];
          log.subscribe((e) => delivered.push(e));

          for (const fields of fieldsList) log.add(fields);

          expect(delivered).toHaveLength(fieldsList.length);
          expect(sink.lines).toHaveLength(fieldsList.length);
          delivered.forEach((entry, k) => {
            const expectedKeys = ["log_ver", "seq", "at", "kind", ...KIND_FIELDS[entry.kind]];
            expect(Object.keys(entry).sort()).toEqual([...expectedKeys].sort());
            expect(entry.log_ver).toBe(GATEWAY_LOG_VERSION);
            expect(entry.seq).toBe(k + 1);
            expect(entry.at).toMatch(AT_RE);
            expect(entry.at).toBe(new Date(start).toISOString());
            expect(isJsonSafe(entry)).toBe(true);
            expect(Object.isFrozen(entry)).toBe(true);
            expect(JSON.parse(sink.lines[k] ?? "")).toEqual(entry);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
