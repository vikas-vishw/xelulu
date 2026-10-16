// Unit examples for the simulator's device cores: the G26 start state, the status builder and its
// 15 s schedule (Req 15.3, 15.4, 15.6), the Ack_Policy table (Req 17.2–17.6) and the Outbox
// basics (Req 19.2–19.5, 19.7) that the device link (task 24) will drive.
import { describe, expect, it } from "vitest";

import {
  ACK_REASONS,
  buildTopic,
  parseEventMessage,
  parseStatusMessage,
  type EventKind,
} from "@xelulu/shared";

import {
  ackPlan,
  EMPTY_ACK_POLICY,
  resolveOverride,
  setOverride,
} from "../src/device/ack-policy.js";
import { createDeviceState, SIM_FW_VER } from "../src/device/device-state.js";
import { buildStatus, createHeartbeat, serialiseStatus } from "../src/device/heartbeat.js";
import { createOutbox, OFFLINE_QUEUE_LIMIT, type QueuedEvent } from "../src/device/outbox.js";
import { createDeadlines } from "../src/deadlines.js";
import { createSimLog, type SimLogEntry } from "../src/log/logger.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker } from "./support/memory-broker.js";
import { createTestClock } from "./support/test-clock.js";

const DEVICE_ID = "sim-device-1";
const EVENT_TOPIC = buildTopic(DEVICE_ID, "event");
const START_MS = 1_760_000_000_500;

async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe("device state and status", () => {
  it("starts with the G26 values", () => {
    expect(createDeviceState()).toEqual({
      battery_pct: 100,
      charging: false,
      mode: "idle",
      wifi_rssi: -50,
      fault: [],
      active_child_id: null,
      temp_c: 30,
      volume: 50,
      settings: { quiet_hours: null, movement_on: null, language: null },
    });
    expect(SIM_FW_VER).toBe("sim-0.1.0");
  });

  it("a status has exactly the contract status fields and whole-second ts", () => {
    const state = createDeviceState();
    expect(Object.keys(buildStatus(state, 1)).sort()).toEqual([
      "active_child_id",
      "battery_pct",
      "charging",
      "fault",
      "mode",
      "proto_ver",
      "temp_c",
      "ts",
      "type",
      "wifi_rssi",
    ]);
    const parsed = parseStatusMessage(serialiseStatus(state, START_MS));
    expect(parsed.ok && parsed.value).toEqual({
      proto_ver: 2,
      ts: Math.floor(START_MS / 1000),
      type: "status",
      battery_pct: 100,
      charging: false,
      mode: "idle",
      wifi_rssi: -50,
      fault: [],
      active_child_id: null,
      temp_c: 30,
    });
  });

  it("sends a status at once, then every 15,000 ms, and restarts from a new start", () => {
    const clock = createTestClock(START_MS);
    const deadlines = createDeadlines(clock);
    const sent: number[] = [];
    const hb = createHeartbeat({ clock, deadlines, send: () => sent.push(clock.now()) });
    const at = (t: number) => {
      clock.set(t);
      deadlines.fireDue(t);
    };
    hb.start();
    at(START_MS + 14_999);
    at(START_MS + 15_000);
    at(START_MS + 30_000);
    at(START_MS + 37_000);
    hb.start(); // a new hello re-anchors the schedule
    at(START_MS + 45_000);
    at(START_MS + 52_000);
    expect(sent).toEqual([
      START_MS,
      START_MS + 15_000,
      START_MS + 30_000,
      START_MS + 37_000,
      START_MS + 52_000,
    ]);
    hb.stop();
    expect(hb.running()).toBe(false);
    at(START_MS + 200_000);
    expect(sent).toHaveLength(5);
  });
});

describe("Ack_Policy table", () => {
  it("maps every override to its apply flag and acks", () => {
    expect(ackPlan(null)).toEqual({
      apply: true,
      acks: [
        { status: "accepted", reason: "" },
        { status: "done", reason: "" },
      ],
    });
    for (const reason of ACK_REASONS) {
      expect(ackPlan({ mode: "reject", reason })).toEqual({
        apply: false,
        acks: [{ status: "rejected", reason }],
      });
    }
    expect(ackPlan({ mode: "fail", reason: "" })).toEqual({
      apply: true,
      acks: [
        { status: "accepted", reason: "" },
        { status: "failed", reason: "" },
      ],
    });
    expect(ackPlan({ mode: "accept_only" })).toEqual({
      apply: true,
      acks: [{ status: "accepted", reason: "" }],
    });
    expect(ackPlan({ mode: "silent" })).toEqual({ apply: true, acks: [] });
  });

  it("resolves per-action over all-actions", () => {
    const p = setOverride(setOverride(EMPTY_ACK_POLICY, "all", { mode: "silent" }), "move", {
      mode: "reject",
      reason: "picked_up",
    });
    expect(resolveOverride(p, "move")).toEqual({ mode: "reject", reason: "picked_up" });
    expect(resolveOverride(p, "say")).toEqual({ mode: "silent" });
    expect(resolveOverride(EMPTY_ACK_POLICY, "say")).toBeNull();
  });
});

function ev(n: number, event: EventKind = "touch"): QueuedEvent {
  return {
    event_id: "ev_" + String(n),
    event,
    data: event === "touch" ? { zone: "belly", gesture: "tap" } : {},
    ts: 1_760_000_000 + n,
  };
}

async function outboxSetup() {
  const broker = createMemoryBroker();
  const sink = createCaptureSink();
  const outbox = createOutbox({ log: createSimLog(createTestClock(START_MS), sink) });
  const replayed: number[] = [];
  /** Connects a peer as the device and hands it to the outbox, as the device link will. */
  async function connect(cause: "dropped" | "toggled_offline" = "dropped") {
    const conn = await broker.peer(DEVICE_ID);
    conn.onClose(() => outbox.linkDown(cause));
    outbox.linkUp({ publishEvent: (p) => conn.publish(EVENT_TOPIC, p, 1) }, () =>
      replayed.push(broker.published.length),
    );
    return conn;
  }
  const events = () =>
    broker.published.map((p) => {
      const r = parseEventMessage(p.payload);
      if (!r.ok) throw new Error("event did not parse");
      return r.value;
    });
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  return { broker, outbox, connect, events, entries, replayed };
}

describe("Outbox", () => {
  it("publishes ready events at once with no time_uncertain", async () => {
    const o = await outboxSetup();
    await o.connect();
    expect(o.replayed).toEqual([0]);
    expect(o.outbox.fire(ev(1))).toEqual({ queued: false });
    expect(o.outbox.fire(ev(2))).toEqual({ queued: false });
    await flush();
    expect(o.events().map((e) => [e.event_id, Object.hasOwn(e, "time_uncertain")])).toEqual([
      ["ev_1", false],
      ["ev_2", false],
    ]);
    expect(o.broker.published.every((p) => p.qos === 1 && p.topic === EVENT_TOPIC)).toBe(true);
    expect(o.outbox.recentPublished().map((e) => e.event_id)).toEqual(["ev_1", "ev_2"]);
  });

  it("queues while offline, drops the oldest at 500, and replays in order after the hello", async () => {
    const o = await outboxSetup();
    for (let i = 1; i <= OFFLINE_QUEUE_LIMIT + 2; i++) {
      expect(o.outbox.fire(ev(i)).queued).toBe(true);
    }
    expect(o.outbox.queueLength()).toBe(OFFLINE_QUEUE_LIMIT);
    expect(o.entries()).toEqual([
      expect.objectContaining({ kind: "queue_dropped", event_id: "ev_1" }),
      expect.objectContaining({ kind: "queue_dropped", event_id: "ev_2" }),
    ]);
    expect(o.broker.published).toEqual([]);
    await o.connect();
    await flush(OFFLINE_QUEUE_LIMIT * 2);
    const out = o.events();
    expect(out.map((e) => e.event_id)).toEqual(
      Array.from({ length: OFFLINE_QUEUE_LIMIT }, (_, i) => "ev_" + String(i + 3)),
    );
    expect(out.every((e) => e.time_uncertain === true)).toBe(true);
    expect(out[0]).toEqual({ ...ev(3), proto_ver: 2, type: "event", time_uncertain: true });
    expect(o.outbox.queueLength()).toBe(0);
    expect(o.replayed).toEqual([OFFLINE_QUEUE_LIMIT]);
    expect(o.outbox.ready()).toBe(true);
  });

  it("keeps the unacknowledged head on a drop and resumes from it", async () => {
    const o = await outboxSetup();
    for (let i = 1; i <= 3; i++) o.outbox.fire(ev(i));
    o.broker.holdPubacks(DEVICE_ID, true);
    await o.connect();
    await flush();
    expect(o.events().map((e) => e.event_id)).toEqual(["ev_1"]);
    o.broker.drop(DEVICE_ID);
    await flush();
    expect(o.outbox.queued().map((e) => e.event_id)).toEqual(["ev_1", "ev_2", "ev_3"]);
    o.broker.holdPubacks(DEVICE_ID, false);
    await o.connect();
    await flush(10);
    expect(o.events().map((e) => e.event_id)).toEqual(["ev_1", "ev_1", "ev_2", "ev_3"]);
    expect(o.outbox.queueLength()).toBe(0);
  });

  it("moves unacknowledged ready events to the queue on a drop", async () => {
    const o = await outboxSetup();
    await o.connect();
    o.broker.holdPubacks(DEVICE_ID, true);
    o.outbox.fire(ev(1));
    o.outbox.fire(ev(2));
    await flush();
    o.broker.drop(DEVICE_ID);
    await flush();
    expect(o.outbox.ready()).toBe(false);
    expect(o.outbox.queued().map((e) => e.event_id)).toEqual(["ev_1", "ev_2"]);
    expect(o.outbox.fire(ev(3)).queued).toBe(true);
  });

  it("with duplicate_replay, re-publishes the last 5 pre-offline events after the queue", async () => {
    const o = await outboxSetup();
    o.outbox.setDuplicateReplay(true);
    const first = await o.connect("toggled_offline");
    for (let i = 1; i <= 7; i++) o.outbox.fire(ev(i));
    await flush(20);
    await first.end();
    await flush();
    o.outbox.fire(ev(8));
    const base = o.broker.published.length;
    await o.connect();
    await flush(20);
    const out = o.events().slice(base);
    expect(out.map((e) => e.event_id)).toEqual(["ev_8", "ev_3", "ev_4", "ev_5", "ev_6", "ev_7"]);
    expect(out.every((e) => e.time_uncertain === true)).toBe(true);
    // The first status (onReplayed) comes only after the last re-publication.
    expect(o.replayed.at(-1)).toBe(base + 6);
  });
});
