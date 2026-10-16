// Device link (Req 15.1–15.5, 15.7, 19.1, 19.8) over the in-memory broker double with Vitest fake
// timers, so the 15 s heartbeat and the reconnect backoff run with no real waiting. A peer on the
// same broker plays the gateway and records what reaches it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTopic,
  parseEventMessage,
  parseHelloMessage,
  parseStatusMessage,
  serialiseCmdMessage,
} from "@xelulu/shared";

import { createSystemClock } from "../src/clock.js";
import { createDeadlines } from "../src/deadlines.js";
import { createDeviceState } from "../src/device/device-state.js";
import { createOutbox, type QueuedEvent } from "../src/device/outbox.js";
import { createSimLog, type SimLogEntry } from "../src/log/logger.js";
import { createDeviceLink } from "../src/mqtt/device-link.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker } from "./support/memory-broker.js";

const DEVICE_ID = "sim-device-1";
const TOKEN = "sim-token-0123456789abcdef";
const BROKER_URL = "mqtt" + "://" + "127.0.0.1:1883";
const USERNAME = "sim-user";
const PASSWORD = "sim-pass-0123456789";
const CMD_TOPIC = buildTopic(DEVICE_ID, "cmd");
const STATUS_TOPIC = buildTopic(DEVICE_ID, "status");
const EVENT_TOPIC = buildTopic(DEVICE_ID, "event");
const ACK_TOPIC = buildTopic(DEVICE_ID, "ack");
const START_MS = 1_760_000_000_000;
const GATEWAY_PEER = "fake-gateway";

/** Real setImmediate (not faked) drains every pending microtask of the broker double. */
async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

type Received = { readonly topic: string; readonly text: string; readonly at: number };

async function setup() {
  const clock = createSystemClock();
  const deadlines = createDeadlines(clock);
  const broker = createMemoryBroker(() => clock.now());
  const sink = createCaptureSink();
  const log = createSimLog(clock, sink);
  const state = createDeviceState();
  const outbox = createOutbox({ log });
  const commands: string[] = [];
  let toggledOffline = 0;
  const link = createDeviceLink({
    broker: { url: BROKER_URL, username: USERNAME, password: PASSWORD },
    device: { deviceId: DEVICE_ID, token: TOKEN },
    connect: broker.connector,
    clock,
    deadlines,
    log,
    state,
    outbox,
    onCommand: (text) => commands.push(text),
    onToggledOffline: () => {
      toggledOffline += 1;
    },
  });

  const gateway = await broker.peer(GATEWAY_PEER);
  await gateway.subscribe([STATUS_TOPIC, EVENT_TOPIC, ACK_TOPIC], 1);
  const received: Received[] = [];
  /** The device's subscriptions at the moment each hello reached the gateway. */
  const subsAtHello: { topic: string; qos: 0 | 1 }[][] = [];
  const decoder = new TextDecoder();
  gateway.onMessage((topic, payload) => {
    const text = decoder.decode(payload);
    received.push({ topic, text, at: clock.now() });
    if (topic === STATUS_TOPIC && parseHelloMessage(text).ok) {
      subsAtHello.push([...broker.subscriptions(DEVICE_ID)]);
    }
  });

  const fromDevice = () => broker.published.filter((p) => p.clientId === DEVICE_ID);
  /** "hello", "status" or "event:<event_id>" for each message the device published. */
  const shapes = () =>
    fromDevice().map((p) => {
      if (p.topic === EVENT_TOPIC) {
        const r = parseEventMessage(p.payload);
        return r.ok ? "event:" + r.value.event_id : "event:?";
      }
      if (parseHelloMessage(p.payload).ok) return "hello";
      return parseStatusMessage(p.payload).ok ? "status" : "other";
    });
  const statusTimes = () =>
    received
      .filter((r) => r.topic === STATUS_TOPIC && parseStatusMessage(r.text).ok)
      .map((r) => r.at);
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  const simStates = () => entries().flatMap((e) => (e.kind === "simulator" ? [e.state] : []));
  return {
    clock,
    broker,
    sink,
    outbox,
    link,
    gateway,
    commands,
    received,
    subsAtHello,
    fromDevice,
    shapes,
    statusTimes,
    entries,
    simStates,
    toggledOffline: () => toggledOffline,
  };
}

function queued(n: number): QueuedEvent {
  return {
    event_id: "ev_link_" + String(n),
    event: "interrupt",
    data: {},
    ts: Math.floor(START_MS / 1000) + n,
  };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(START_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("device link", () => {
  it("connects with DEVICE_ID and the Config credentials and subscribes to its cmd topic only", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    expect(s.broker.connectAttempts.map((a) => a.options)).toEqual([
      { url: BROKER_URL, clientId: DEVICE_ID, username: USERNAME, password: PASSWORD },
    ]);
    expect(s.broker.subscriptions(DEVICE_ID)).toEqual([{ topic: CMD_TOPIC, qos: 1 }]);
    expect(s.link.clientId).toBe(DEVICE_ID);
    expect(s.link.connected()).toBe(true);
    expect(s.simStates()).toEqual(["broker_connected"]);
  });

  it("publishes the hello after the SUBACK with exactly the contract keys at QoS 1", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    const first = s.fromDevice()[0];
    expect(first).toMatchObject({ topic: STATUS_TOPIC, qos: 1, retain: false });
    const raw = JSON.parse(first?.payload ?? "null") as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual([
      "auth",
      "device_id",
      "fw_ver",
      "proto",
      "proto_ver",
      "ts",
      "type",
    ]);
    const hello = parseHelloMessage(first?.payload ?? "");
    expect(hello.ok && hello.value).toEqual({
      proto_ver: 2,
      ts: Math.floor(START_MS / 1000),
      type: "hello",
      device_id: DEVICE_ID,
      fw_ver: "sim-0.1.0",
      auth: TOKEN,
      proto: 2,
    });
    // The subscription was in place when the hello arrived.
    expect(s.subsAtHello).toEqual([[{ topic: CMD_TOPIC, qos: 1 }]]);
    // The token never reaches a log line.
    expect(s.sink.text()).not.toContain(TOKEN);
  });

  it("sends a status at once after the hello, then every 15,000 ms, at QoS 0", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    await vi.advanceTimersByTimeAsync(45_000);
    await flush();
    const times = s.statusTimes();
    expect(times).toEqual([START_MS, START_MS + 15_000, START_MS + 30_000, START_MS + 45_000]);
    const statuses = s.fromDevice().filter((p) => parseStatusMessage(p.payload).ok);
    expect(statuses.every((p) => p.qos === 0 && p.topic === STATUS_TOPIC)).toBe(true);
    expect(s.shapes().slice(0, 2)).toEqual(["hello", "status"]);
  });

  it("on a drop stops status, reconnects with backoff, then sends hello, the replay and a status", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    await flush();
    const dropAt = s.clock.now();
    const before = s.fromDevice().length;
    s.broker.failNextConnects(2);
    s.broker.drop(DEVICE_ID);
    await flush();
    expect(s.link.connected()).toBe(false);
    expect(s.outbox.fire(queued(1))).toEqual({ queued: true });

    // Attempts at +1 s (fails), +2 s later (fails), +4 s later (succeeds).
    await vi.advanceTimersByTimeAsync(6_999);
    await flush();
    expect(s.fromDevice()).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(s.broker.connectAttempts.slice(1).map((a) => a.at - dropAt)).toEqual([
      1_000, 3_000, 7_000,
    ]);
    expect(s.shapes().slice(before)).toEqual(["hello", "event:ev_link_1", "status"]);
    const replayed = parseEventMessage(s.fromDevice()[before + 1]?.payload ?? "");
    expect(replayed.ok && replayed.value).toEqual({
      ...queued(1),
      proto_ver: 2,
      type: "event",
      time_uncertain: true,
    });

    // The 15 s timer restarted from the new hello.
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    const times = s.statusTimes();
    expect(times.slice(-2)).toEqual([dropAt + 7_000, dropAt + 22_000]);
    expect(times.filter((t) => t > dropAt && t < dropAt + 7_000)).toEqual([]);
    expect(s.simStates()).toEqual(["broker_connected", "broker_disconnected", "broker_connected"]);
  });

  it("the offline toggle aborts the turn, ends the connection and publishes nothing until online", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    const before = s.fromDevice().length;
    expect(s.link.setOnline(false)).toEqual({ online: false, changed: true });
    expect(s.toggledOffline()).toBe(1);
    expect(s.link.online()).toBe(false);
    expect(s.link.connected()).toBe(false);
    await flush();
    expect(s.broker.subscriptions(DEVICE_ID)).toEqual([]);
    expect(s.link.publish(ACK_TOPIC, "{}", 1)).toBe(false);
    expect(s.outbox.fire(queued(2))).toEqual({ queued: true });
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(s.fromDevice()).toHaveLength(before);
    expect(s.broker.connectAttempts).toHaveLength(1);

    expect(s.link.setOnline(true)).toEqual({ online: true, changed: true });
    await flush();
    expect(s.shapes().slice(before)).toEqual(["hello", "event:ev_link_2", "status"]);
    expect(s.simStates()).toEqual([
      "broker_connected",
      "toggled_offline",
      "toggled_online",
      "broker_connected",
    ]);
  });

  it("toggles to the current state change nothing and report the state", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    const snapshot = () => ({
      published: s.broker.published.length,
      attempts: s.broker.connectAttempts.length,
      lines: s.sink.lines.length,
      queue: s.outbox.queueLength(),
    });
    const online = snapshot();
    expect(s.link.setOnline(true)).toEqual({ online: true, changed: false });
    await flush();
    expect(snapshot()).toEqual(online);
    expect(s.link.connected()).toBe(true);

    s.link.setOnline(false);
    await flush();
    const offline = snapshot();
    expect(s.link.setOnline(false)).toEqual({ online: false, changed: false });
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(snapshot()).toEqual(offline);
    expect(s.toggledOffline()).toBe(1);
  });

  it("passes each inbound cmd payload to the command handler", async () => {
    const s = await setup();
    s.link.start();
    await flush();
    const payload = serialiseCmdMessage({
      proto_ver: 2,
      cmd_id: "c-1",
      action: "stop_audio",
      data: {},
    });
    await s.gateway.publish(CMD_TOPIC, payload, 1);
    await flush();
    expect(s.commands).toEqual([payload]);
    expect(s.link.publish(ACK_TOPIC, "{}", 1)).toBe(true);
  });
});
