// Example tests for the Stream_Client: reconnect schedule (Property 7, example-based per C15),
// connection states, shape guards and stop() (Req 10.4, 7.2, 7.4). Node environment: Node 24
// provides the global Event and MessageEvent, and the client only sees an injected fake source.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationTurnView, GatewayLogEntry, OperatorStreamDevices } from "@xelulu/shared";

import type { StreamState } from "../src/stream/console-state";
import { STREAM_URL, createStreamClient, reconnectDelayMs } from "../src/stream/stream-client";

import { turnView } from "./support/entries";
import { FakeEventSource } from "./support/fake-event-source";

function setup() {
  const sources: FakeEventSource[] = [];
  const states: StreamState[] = [];
  const devices: OperatorStreamDevices[] = [];
  const entries: GatewayLogEntry[] = [];
  const turns: ConversationTurnView[] = [];
  const onOpen = vi.fn();
  const client = createStreamClient({
    createSource: (url) => {
      const s = new FakeEventSource(url);
      sources.push(s);
      return s;
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
    onState: (state) => states.push(state),
    onOpen,
    onDevices: (payload) => devices.push(payload),
    onEntry: (entry) => entries.push(entry),
    onTurn: (view) => turns.push(view),
  });
  const latest = (): FakeEventSource => {
    const s = sources.at(-1);
    if (s === undefined) throw new Error("no source created");
    return s;
  };
  return { client, sources, states, devices, entries, turns, onOpen, latest };
}

/** Fails the latest source and returns how long the client waited before opening the next one. */
function measureRetry(ctx: ReturnType<typeof setup>): number {
  const before = ctx.sources.length;
  ctx.latest().fail();
  let waited = 0;
  while (ctx.sources.length === before) {
    if (waited > 60_000) throw new Error("no retry scheduled");
    vi.advanceTimersByTime(500);
    waited += 500;
  }
  return waited;
}

describe("reconnectDelayMs (Property 7: Reconnect schedule)", () => {
  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [5, 10_000],
    [6, 10_000],
    [100, 10_000],
  ])("failure %i waits %i ms", (failures, ms) => {
    expect(reconnectDelayMs(failures)).toBe(ms);
  });
});

describe("createStreamClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens one source at the relative stream URL and reports connecting", () => {
    const ctx = setup();
    expect(STREAM_URL).toBe("/v1/stream");
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.latest().url).toBe("/v1/stream");
    expect(ctx.states).toEqual(["connecting"]);
    ctx.client.stop();
  });

  it("goes live on open, calling onOpen before the live state", () => {
    const ctx = setup();
    ctx.onOpen.mockImplementation(() => ctx.states.push("connecting"));
    ctx.latest().open();
    expect(ctx.onOpen).toHaveBeenCalledTimes(1);
    // The marker pushed by onOpen sits before "live", so the reset ran first.
    expect(ctx.states).toEqual(["connecting", "connecting", "live"]);
    ctx.client.stop();
  });

  it("on error closes the source, reports reconnecting and opens a new source after 1 s", () => {
    const ctx = setup();
    const first = ctx.latest();
    first.open();
    first.fail();
    expect(first.closed).toBe(true);
    expect(ctx.states.at(-1)).toBe("reconnecting");
    vi.advanceTimersByTime(999);
    expect(ctx.sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.latest().url).toBe(STREAM_URL);
    ctx.latest().open();
    expect(ctx.states.at(-1)).toBe("live");
    expect(ctx.onOpen).toHaveBeenCalledTimes(2);
    ctx.client.stop();
  });

  it("backs off 1, 2, 4, 8, 10, 10 s and returns to 1 s after a successful open", () => {
    const ctx = setup();
    const waits = Array.from({ length: 6 }, () => measureRetry(ctx));
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
    ctx.latest().open();
    expect(ctx.states.at(-1)).toBe("live");
    expect(measureRetry(ctx)).toBe(1_000);
    ctx.client.stop();
  });

  it("passes well-formed data and ignores malformed data", () => {
    const ctx = setup();
    const s = ctx.latest();
    s.open();
    const entry: GatewayLogEntry = {
      log_ver: 3,
      seq: 7,
      at: "2026-10-20T10:00:01.250Z",
      kind: "gateway",
      state: "starting",
    };
    const payload: OperatorStreamDevices = {
      devices: [
        {
          device_id: "xlu_000123",
          presence: "online",
          last_heartbeat_at: "2026-10-20T10:00:01.250Z",
          battery_pct: 100,
          charging: false,
          events_accepted: 0,
          events_duplicate: 0,
        },
      ],
    };

    for (const bad of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ ...entry, kind: "nope" }),
      JSON.stringify({ ...entry, seq: 0 }),
      JSON.stringify({ ...entry, seq: 1.5 }),
      JSON.stringify({ log_ver: 3, seq: 8, kind: "gateway" }),
    ]) {
      s.emit("entry", bad);
    }
    for (const bad of [
      "{",
      "[]",
      JSON.stringify({ devices: "xlu_000123" }),
      JSON.stringify({ devices: [{ device_id: "xlu_000123", presence: "away" }] }),
    ]) {
      s.emit("devices", bad);
    }
    expect(ctx.entries).toEqual([]);
    expect(ctx.devices).toEqual([]);

    s.emit("entry", JSON.stringify(entry));
    s.emit("devices", JSON.stringify(payload));
    expect(ctx.entries).toEqual([entry]);
    expect(ctx.devices).toEqual([payload]);
    expect(ctx.states.at(-1)).toBe("live");
    ctx.client.stop();
  });

  it("ignores a malformed turn payload and passes a well-formed view through once", () => {
    const ctx = setup();
    const s = ctx.latest();
    s.open();
    const view = turnView();

    for (const bad of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ ...view, state: "pondering" }),
      JSON.stringify({ ...view, lang: "fr-FR" }),
      JSON.stringify({ ...view, age_stage: "teen" }),
      JSON.stringify({ ...view, input_decision: "maybe" }),
      JSON.stringify({ ...view, output_rule: "vibes" }),
      JSON.stringify({ ...view, input_topic: "homework" }),
      JSON.stringify({ ...view, tools: [{ tool: "web_search", outcome: "ok" }] }),
      JSON.stringify({ ...view, tools: [{ tool: "content_lookup", outcome: "fine" }] }),
      JSON.stringify({ ...view, tools: {} }),
      JSON.stringify({ ...view, filler_spoken: "no" }),
      JSON.stringify({ ...view, frames_out: 1.5 }),
      JSON.stringify({ ...view, transcript_len: -1 }),
      JSON.stringify({ ...view, latency_ms: "820" }),
      JSON.stringify({ ...view, reply_text: 31 }),
      JSON.stringify({ ...view, turn_id: undefined }),
    ]) {
      s.emit("turn", bad);
    }
    expect(ctx.turns).toEqual([]);

    s.emit("turn", JSON.stringify(view));
    expect(ctx.turns).toEqual([view]);
    ctx.client.stop();
  });

  it("stop() cancels the pending retry", () => {
    const ctx = setup();
    ctx.latest().fail();
    ctx.client.stop();
    vi.advanceTimersByTime(60_000);
    expect(ctx.sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() closes the open source and ignores its later events", () => {
    const ctx = setup();
    const s = ctx.latest();
    s.open();
    ctx.client.stop();
    expect(s.closed).toBe(true);
    const statesAtStop = [...ctx.states];
    s.emit("entry", JSON.stringify({ log_ver: 3, seq: 1, at: "x", kind: "gateway" }));
    s.fail();
    vi.advanceTimersByTime(60_000);
    expect(ctx.entries).toEqual([]);
    expect(ctx.states).toEqual(statesAtStop);
    expect(ctx.sources).toHaveLength(1);
  });
});
