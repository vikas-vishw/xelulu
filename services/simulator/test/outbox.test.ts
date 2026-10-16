// Offline replay through the device link and the Outbox: Property 15 and the `duplicate_replay`
// example (Req 19.2–19.7). The in-memory broker double holds PUBACKs and drops the connection at
// generated points; a manual test clock drives the reconnect backoff, so nothing waits.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TOUCH_GESTURES,
  TOUCH_ZONES,
  buildTopic,
  parseEventMessage,
  parseHelloMessage,
  parseStatusMessage,
  type EventMessage,
} from "@xelulu/shared";

import { createDeadlines } from "../src/deadlines.js";
import { createDeviceState } from "../src/device/device-state.js";
import { createOutbox, OFFLINE_QUEUE_LIMIT, type QueuedEvent } from "../src/device/outbox.js";
import { createSimLog, type SimLogEntry } from "../src/log/logger.js";
import { createDeviceLink } from "../src/mqtt/device-link.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker } from "./support/memory-broker.js";
import { createTestClock } from "./support/test-clock.js";

const DEVICE_ID = "sim-device-1";
const EVENT_TOPIC = buildTopic(DEVICE_ID, "event");
const STATUS_TOPIC = buildTopic(DEVICE_ID, "status");
const START_MS = 1_760_000_000_000;
const START_S = Math.floor(START_MS / 1000);

async function flush(rounds = 1): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

function setup() {
  const clock = createTestClock(START_MS);
  const deadlines = createDeadlines(clock);
  const broker = createMemoryBroker(() => clock.now());
  const sink = createCaptureSink();
  const log = createSimLog(clock, sink);
  const outbox = createOutbox({ log });
  const link = createDeviceLink({
    broker: { url: "mqtt" + "://" + "127.0.0.1:1883", username: null, password: null },
    device: { deviceId: DEVICE_ID, token: "sim-token-0123456789abcdef" },
    connect: broker.connector,
    clock,
    deadlines,
    log,
    state: createDeviceState(),
    outbox,
    onCommand: () => undefined,
  });
  /** Moves the clock and fires every due deadline, as the simulator does before each input. */
  const advance = (ms: number) => {
    clock.advance(ms);
    deadlines.fireDue(clock.now());
  };
  const fromDevice = () => broker.published.filter((p) => p.clientId === DEVICE_ID);
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  return { clock, broker, outbox, link, advance, fromDevice, entries };
}

/** A touch or interrupt event with contract-valid data, a unique id and its own ts. */
function event(prefix: string, n: number): QueuedEvent {
  const touch = n % 2 === 0;
  return {
    event_id: "ev_" + prefix + "_" + String(n),
    event: touch ? "touch" : "interrupt",
    data: touch
      ? {
          zone: TOUCH_ZONES[n % TOUCH_ZONES.length],
          gesture: TOUCH_GESTURES[n % TOUCH_GESTURES.length],
        }
      : {},
    ts: START_S + n,
  };
}

function parseEvent(payload: string): EventMessage {
  const r = parseEventMessage(payload);
  if (!r.ok) throw new Error("published event did not parse");
  return r.value;
}

function asQueued(e: EventMessage): QueuedEvent {
  return { event_id: e.event_id, event: e.event, data: e.data as QueuedEvent["data"], ts: e.ts };
}

describe("Outbox replay through the device link", () => {
  it("replays offline events once, in order, with original ids", async () => {
    // Feature: phase-1-2-gateway-simulator, Property 15: Offline events replay once, in order, with original ids
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 0, max: 7 }),
        fc.boolean(),
        fc.uniqueArray(fc.integer({ min: 0, max: OFFLINE_QUEUE_LIMIT - 1 }), { maxLength: 4 }),
        async (n, onlineCount, duplicateReplay, dropPoints) => {
          const s = setup();
          s.outbox.setDuplicateReplay(duplicateReplay);
          s.link.start();
          await flush(3);

          // Events published (and PUBACKed) before going offline.
          const before = Array.from({ length: onlineCount }, (_, i) => event("on", i));
          for (const e of before) s.outbox.fire(e);
          await flush(3);

          s.link.setOnline(false);
          await flush(2);
          const fired = Array.from({ length: n }, (_, i) => event("off", i));
          for (const e of fired) {
            if (!s.outbox.fire(e).queued) return false;
          }
          const kept = fired.slice(Math.max(0, n - OFFLINE_QUEUE_LIMIT));
          const dropped = fired.slice(0, Math.max(0, n - OFFLINE_QUEUE_LIMIT));
          const base = s.fromDevice().length;

          // Replay with every PUBACK held, released one at a time, and a drop before the PUBACK
          // of the event at each generated point.
          s.broker.holdPubacks(DEVICE_ID, true);
          s.link.setOnline(true);
          const pending = new Set(dropPoints.filter((p) => p < kept.length));
          let done = false;
          for (let step = 0; step < 4 * OFFLINE_QUEUE_LIMIT && !done; step++) {
            await flush();
            if (s.outbox.ready() && s.outbox.queueLength() === 0) {
              done = true;
              break;
            }
            if (!s.link.connected()) {
              s.advance(30_000);
              continue;
            }
            const acked = kept.length - s.outbox.queueLength();
            const last = s.fromDevice().at(-1);
            if (last?.topic === EVENT_TOPIC && pending.has(acked)) {
              pending.delete(acked);
              s.broker.drop(DEVICE_ID);
              continue;
            }
            s.broker.releasePubacks(DEVICE_ID);
          }
          s.broker.holdPubacks(DEVICE_ID, false);
          s.broker.releasePubacks(DEVICE_ID);
          await flush(2);
          expect(done).toBe(true);

          const published = s
            .fromDevice()
            .slice(base)
            .filter((p) => p.topic === EVENT_TOPIC)
            .map((p) => parseEvent(p.payload));
          const source = new Map(kept.map((e) => [e.event_id, e]));
          const duplicates = duplicateReplay ? before.slice(-5) : [];
          for (const e of duplicates) source.set(e.event_id, e);

          // Every publication equals its queued event, with time_uncertain true.
          for (const p of published) {
            expect(p.time_uncertain).toBe(true);
            const original = source.get(p.event_id);
            expect(original).toBeDefined();
            expect(asQueued(p)).toEqual(original);
          }
          // Each kept event at least once, first publications in firing order.
          const firstSeen: string[] = [];
          for (const p of published) {
            if (
              !firstSeen.includes(p.event_id) &&
              !duplicates.some((d) => d.event_id === p.event_id)
            )
              firstSeen.push(p.event_id);
          }
          expect(firstSeen).toEqual(kept.map((e) => e.event_id));
          // One queue_dropped entry per event dropped from the full queue.
          const droppedIds = s
            .entries()
            .flatMap((e) => (e.kind === "queue_dropped" ? [e.event_id] : []));
          expect(droppedIds).toEqual(dropped.map((e) => e.event_id));
          expect(s.outbox.queueLength()).toBe(0);
          await s.link.stop();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);

  it("with duplicate_replay on: hello, the queued event, the last 5 pre-offline events, then status", async () => {
    const s = setup();
    s.link.start();
    await flush(10);
    const before = Array.from({ length: 6 }, (_, i) => event("on", i));
    for (const e of before) s.outbox.fire(e);
    await flush(10);
    s.outbox.setDuplicateReplay(true);
    s.link.setOnline(false);
    await flush(5);
    const offline = event("off", 0);
    expect(s.outbox.fire(offline)).toEqual({ queued: true });
    const base = s.fromDevice().length;
    s.link.setOnline(true);
    await flush(20);

    const after = s.fromDevice().slice(base);
    expect(after).toHaveLength(8);
    expect(after[0]?.topic).toBe(STATUS_TOPIC);
    expect(parseHelloMessage(after[0]?.payload ?? "").ok).toBe(true);
    const events = after.slice(1, 7);
    expect(events.every((p) => p.topic === EVENT_TOPIC && p.qos === 1)).toBe(true);
    const parsed = events.map((p) => parseEvent(p.payload));
    expect(parsed.map(asQueued)).toEqual([offline, ...before.slice(-5)]);
    expect(parsed.every((e) => e.time_uncertain === true)).toBe(true);
    expect(after[7]?.topic).toBe(STATUS_TOPIC);
    expect(parseStatusMessage(after[7]?.payload ?? "").ok).toBe(true);

    const replayLog = s
      .entries()
      .filter((e) => e.kind === "message_out" && e.replay)
      .map((e) => (e.kind === "message_out" ? e.event_id : null));
    expect(replayLog).toEqual([offline, ...before.slice(-5)].map((e) => e.event_id));
  });
});
