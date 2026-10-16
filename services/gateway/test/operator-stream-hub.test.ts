// Operator_Stream hub, in process (Phase 1.3 Req 1.2–1.4, 1.7–1.9, 2.1): a fake sink, the manual
// test clock and a real Gateway_Log with a capture sink. Example-based (C15).
import { describe, expect, it } from "vitest";

import type { ConversationTurnView, DeviceSummary } from "@xelulu/shared";

import { createGatewayLog } from "../src/log/gateway-log.js";
import {
  createOperatorStreams,
  OPERATOR_STREAM_LIMITS,
  SSE_KEEP_ALIVE,
  sseEvent,
  type StreamSink,
} from "../src/operator/operator-stream.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock, type TestClock } from "./support/test-clock.js";

type FakeSink = StreamSink & {
  readonly chunks: string[];
  pendingBytes: number;
  ends: number;
};

function fakeSink(): FakeSink {
  const sink: FakeSink = {
    chunks: [],
    pendingBytes: 0,
    ends: 0,
    write: (chunk) => {
      sink.chunks.push(chunk);
    },
    pending: () => sink.pendingBytes,
    end: () => {
      sink.ends += 1;
    },
  };
  return sink;
}

type ParsedEvent = { readonly name: string; readonly data: string };

/** The SSE events in the sink's text (comment lines skipped). */
function events(sink: FakeSink): ParsedEvent[] {
  return sink.chunks
    .join("")
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const [nameLine = "", dataLine = ""] = block.split("\n");
      return { name: nameLine.slice("event: ".length), data: dataLine.slice("data: ".length) };
    });
}

/** Fires every due timer once, removing it first as a real timer would be. */
function fireDue(clock: TestClock): void {
  for (const t of clock.timers()) {
    if (t.dueAt > clock.now()) continue;
    clock.clearTimer({ id: t.id });
    t.fn();
  }
}

const DEVICE = "xlu_000123";

function summary(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    device_id: DEVICE,
    presence: "unknown",
    last_heartbeat_at: null,
    battery_pct: null,
    charging: null,
    events_accepted: 0,
    events_duplicate: 0,
    ...overrides,
  };
}

/** One Conversation_Turn_View, with its text fields off as the default toggle leaves them. */
const TURN: ConversationTurnView = Object.freeze({
  turn_id: "t_hub",
  device_id: DEVICE,
  at: "2026-10-20T10:00:00.000Z",
  state: "thinking",
  lang: "en-IN",
  age_stage: "little",
  input_decision: "allow",
  input_rule: "none",
  input_topic: null,
  output_decision: null,
  output_rule: null,
  tools: [],
  latency_ms: null,
  filler_spoken: false,
  frames_out: 0,
  transcript_len: 19,
  reply_len: 0,
  transcript_text: null,
  reply_text: null,
});

function setup() {
  const clock = createTestClock(0);
  const lines = createCaptureSink();
  const log = createGatewayLog(clock, lines);
  let current: readonly DeviceSummary[] = [summary()];
  let views: readonly ConversationTurnView[] = [];
  const streams = createOperatorStreams({
    log,
    summaries: () => current,
    views: () => views,
    clock,
  });
  return {
    clock,
    lines,
    log,
    streams,
    setSummaries(next: readonly DeviceSummary[]) {
      current = next;
    },
    setViews(next: readonly ConversationTurnView[]) {
      views = next;
    },
  };
}

describe("operator stream hub", () => {
  it("sends devices first, then the backlog and live entries in seq order as stdout lines", () => {
    const h = setup();
    h.log.add({ kind: "gateway", state: "starting" });
    h.log.add({ kind: "gateway", state: "audio_listening" });

    const sink = fakeSink();
    expect(h.streams.open(sink).ok).toBe(true);
    h.log.add({ kind: "auth", transport: "mqtt", device_id: DEVICE, outcome: "ok" });

    const got = events(sink);
    expect(got[0]).toEqual({ name: "devices", data: JSON.stringify({ devices: [summary()] }) });
    const entries = got.slice(1);
    expect(entries.map((e) => e.name)).toEqual(["entry", "entry", "entry"]);
    expect(entries.map((e) => (JSON.parse(e.data) as { seq: number }).seq)).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.data)).toEqual(h.lines.lines);
  });

  it("sends a devices event after an entry only when a summary changed", () => {
    const h = setup();
    const sink = fakeSink();
    h.streams.open(sink);

    h.log.add({ kind: "auth", transport: "mqtt", device_id: DEVICE, outcome: "ok" });
    expect(events(sink).map((e) => e.name)).toEqual(["devices", "entry"]);

    const changed = [summary({ presence: "online", battery_pct: 100, charging: false })];
    h.setSummaries(changed);
    h.log.add({ kind: "presence", device_id: DEVICE, state: "online", cause: "hello" });
    h.log.add({ kind: "auth", transport: "mqtt", device_id: DEVICE, outcome: "ok" });

    const got = events(sink);
    expect(got.map((e) => e.name)).toEqual(["devices", "entry", "entry", "devices", "entry"]);
    expect(got[3]?.data).toBe(JSON.stringify({ devices: changed }));
  });

  it("refuses a fifth stream with 503 too_many_streams and writes nothing to it", () => {
    const h = setup();
    for (let k = 0; k < OPERATOR_STREAM_LIMITS.maxStreams; k++) {
      expect(h.streams.open(fakeSink()).ok).toBe(true);
    }
    const fifth = fakeSink();
    expect(h.streams.open(fifth)).toEqual({
      ok: false,
      refusal: { status: 503, body: { ok: false, error: { code: "too_many_streams" } } },
    });
    expect(fifth.chunks).toEqual([]);
    expect(fifth.ends).toBe(0);
  });

  it("close is idempotent, unsubscribes, clears the timer and frees a slot", () => {
    const h = setup();
    const sinks = [fakeSink(), fakeSink(), fakeSink(), fakeSink()];
    const opened = sinks.map((s) => h.streams.open(s));
    const first = opened[0];
    if (first === undefined || !first.ok) throw new Error("expected an open stream");

    first.close();
    first.close();
    expect(sinks[0]?.ends).toBe(1);
    expect(h.clock.timers()).toHaveLength(3);

    const written = sinks[0]?.chunks.length;
    h.log.add({ kind: "gateway", state: "starting" });
    expect(sinks[0]?.chunks.length).toBe(written);

    expect(h.streams.open(fakeSink()).ok).toBe(true);
    expect(h.streams.open(fakeSink()).ok).toBe(false);
  });

  it("writes a keep-alive comment every 15 s", () => {
    const h = setup();
    const sink = fakeSink();
    h.streams.open(sink);
    expect(h.clock.timers().map((t) => t.dueAt)).toEqual([15_000]);

    h.clock.advance(14_999);
    fireDue(h.clock);
    expect(sink.chunks).not.toContain(SSE_KEEP_ALIVE);

    h.clock.advance(1);
    fireDue(h.clock);
    expect(sink.chunks.at(-1)).toBe(SSE_KEEP_ALIVE);
    expect(h.clock.timers().map((t) => t.dueAt)).toEqual([30_000]);
  });

  it("closes a stream with more than 1 MiB pending and keeps serving the others", () => {
    const h = setup();
    const slow = fakeSink();
    const other = fakeSink();
    h.streams.open(slow);
    h.streams.open(other);

    slow.pendingBytes = OPERATOR_STREAM_LIMITS.maxPendingBytes + 1;
    h.log.add({ kind: "gateway", state: "starting" });
    expect(slow.ends).toBe(1);

    const written = slow.chunks.length;
    h.log.add({ kind: "gateway", state: "audio_listening" });
    expect(slow.chunks.length).toBe(written);
    expect(events(other).map((e) => e.name)).toEqual(["devices", "entry", "entry"]);
    expect(other.ends).toBe(0);
    expect(h.clock.timers()).toHaveLength(1);
  });

  it("closeAll ends every stream, clears every timer and frees every slot", () => {
    const h = setup();
    const sinks = [fakeSink(), fakeSink(), fakeSink()];
    for (const s of sinks) h.streams.open(s);

    h.streams.closeAll();
    expect(sinks.map((s) => s.ends)).toEqual([1, 1, 1]);
    expect(h.clock.timers()).toEqual([]);
    h.log.add({ kind: "gateway", state: "starting" });
    expect(sinks.every((s) => events(s).length === 1)).toBe(true);

    for (let k = 0; k < OPERATOR_STREAM_LIMITS.maxStreams; k++) {
      expect(h.streams.open(fakeSink()).ok).toBe(true);
    }
  });

  it("opens with devices, the entry backlog, then one turn per retained view (Req 18.2)", () => {
    const h = setup();
    h.log.add({ kind: "gateway", state: "starting" });
    h.setViews([TURN, { ...TURN, turn_id: "t_hub_2" }]);

    const sink = fakeSink();
    expect(h.streams.open(sink).ok).toBe(true);

    const got = events(sink);
    expect(got.map((e) => e.name)).toEqual(["devices", "entry", "turn", "turn"]);
    expect(got[2]?.data).toBe(JSON.stringify(TURN));
    expect(got[3]?.data).toBe(JSON.stringify({ ...TURN, turn_id: "t_hub_2" }));
  });

  it("publishTurn writes to every open stream, through the same 1 MiB cap", () => {
    const h = setup();
    const open = fakeSink();
    const slow = fakeSink();
    h.streams.open(open);
    h.streams.open(slow);

    slow.pendingBytes = OPERATOR_STREAM_LIMITS.maxPendingBytes + 1;
    h.streams.publishTurn(TURN);
    expect(events(open).map((e) => e.name)).toEqual(["devices", "turn"]);
    expect(slow.ends).toBe(1);

    h.streams.publishTurn({ ...TURN, state: "done" });
    expect(events(open).filter((e) => e.name === "turn")).toHaveLength(2);
    expect(events(slow).filter((e) => e.name === "turn")).toHaveLength(1);
  });

  it("formats one SSE event per call", () => {
    expect(sseEvent("entry", '{"a":1}')).toBe('event: entry\ndata: {"a":1}\n\n');
  });
});
