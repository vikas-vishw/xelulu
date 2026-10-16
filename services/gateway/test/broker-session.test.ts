// Broker session (Req 3.1–3.6) against the in-memory broker double, with Vitest fake timers so
// the 1, 2, 4, 8, 16, 30 s backoff runs with no real waiting.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTopic, type GatewayLogEntry } from "@xelulu/shared";

import { createSystemClock } from "../src/clock.js";
import { createDeadlines } from "../src/deadlines.js";
import { randomIds } from "../src/ids.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import {
  createBrokerSession,
  GATEWAY_CLIENT_ID_PREFIX,
  type BrokerSession,
} from "../src/mqtt/broker-session.js";
import type { MqttConnector } from "../src/mqtt/mqtt-transport.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker, type MemoryBroker } from "./support/memory-broker.js";

const DEVICE = "xlu_000123";
const BROKER_URL = "mqtt" + "://" + "127.0.0.1:1883";
const decoder = new TextDecoder();

/** Lets queued microtasks and socket-like deliveries run (setImmediate stays real). */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type Harness = {
  broker: MemoryBroker;
  session: BrokerSession;
  entries: GatewayLogEntry[];
  messages: [string, string][];
};

function harness(
  opts: {
    username?: string | null;
    password?: string | null;
    connect?: (broker: MemoryBroker) => MqttConnector;
  } = {},
): Harness {
  const clock = createSystemClock();
  const broker = createMemoryBroker(() => Date.now());
  const log = createGatewayLog(clock, createCaptureSink());
  const entries: GatewayLogEntry[] = [];
  log.subscribe((e) => entries.push(e));
  const messages: [string, string][] = [];
  const session = createBrokerSession({
    broker: {
      url: BROKER_URL,
      username: opts.username === undefined ? "gw-user" : opts.username,
      password: opts.password === undefined ? "gw-secret" : opts.password,
    },
    deviceIds: [DEVICE],
    connect: opts.connect?.(broker) ?? broker.connector,
    clock,
    deadlines: createDeadlines(clock),
    ids: randomIds,
    log,
    onMessage: (topic, payload) => messages.push([topic, decoder.decode(payload)]),
  });
  return { broker, session, entries, messages };
}

function states(entries: readonly GatewayLogEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === "gateway" ? [e.state] : []));
}

function gaps(times: readonly number[]): number[] {
  return times.slice(1).map((t, i) => t - (times[i] ?? 0));
}

const EXPECTED_TOPICS = [
  buildTopic(DEVICE, "status"),
  buildTopic(DEVICE, "event"),
  buildTopic(DEVICE, "ack"),
];

describe("broker session", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects with a unique xelulu-gw- client id and the Config credentials", async () => {
    const a = harness();
    const b = harness({ username: null, password: null });
    a.session.start();
    b.session.start();
    await flush();

    const [attemptA] = a.broker.connectAttempts;
    const [attemptB] = b.broker.connectAttempts;
    expect(attemptA?.options).toEqual({
      url: BROKER_URL,
      clientId: a.session.clientId,
      username: "gw-user",
      password: "gw-secret",
    });
    expect(attemptB?.options.username).toBeNull();
    expect(attemptB?.options.password).toBeNull();
    expect(a.session.clientId.startsWith(GATEWAY_CLIENT_ID_PREFIX)).toBe(true);
    expect(a.session.clientId.length).toBeGreaterThanOrEqual(GATEWAY_CLIENT_ID_PREFIX.length + 16);
    expect(a.session.clientId).not.toBe(b.session.clientId);
  });

  it("subscribes to exactly the three device topics at QoS 1, then logs broker_connected", async () => {
    const h = harness();
    expect(h.session.connected()).toBe(false);
    h.session.start();
    await flush();

    const subs = h.broker.subscriptions(h.session.clientId);
    expect(subs).toEqual(EXPECTED_TOPICS.map((topic) => ({ topic, qos: 1 })));
    for (const { topic } of subs) expect(topic).not.toMatch(/[+#]/);
    expect(h.session.connected()).toBe(true);
    expect(states(h.entries)).toEqual(["broker_connected"]);

    const device = await h.broker.peer(DEVICE);
    await device.publish(buildTopic(DEVICE, "status"), "x", 0);
    await flush();
    expect(h.messages).toEqual([[buildTopic(DEVICE, "status"), "x"]]);
  });

  it("retries failed attempts after 1, 2, 4, 8, 16, 30, 30 s with no entry for them", async () => {
    const h = harness();
    h.broker.failNextConnects(7);
    h.session.start();
    await flush();
    await vi.advanceTimersByTimeAsync(91_000);
    await flush();

    const times = h.broker.connectAttempts.map((c) => c.at);
    expect(times).toHaveLength(8);
    expect(gaps(times)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(states(h.entries)).toEqual(["broker_connected"]);
    expect(h.session.connected()).toBe(true);
  });

  it("logs a drop, resets the backoff after a success and resubscribes on reconnect", async () => {
    const h = harness();
    h.session.start();
    await flush();
    expect(states(h.entries)).toEqual(["broker_connected"]);

    h.broker.failNextConnects(2);
    h.broker.drop(h.session.clientId);
    await flush();
    expect(h.session.connected()).toBe(false);
    expect(h.broker.subscriptions(h.session.clientId)).toEqual([]);
    expect(states(h.entries)).toEqual(["broker_connected", "broker_disconnected"]);

    await vi.advanceTimersByTimeAsync(7_000);
    await flush();
    const times = h.broker.connectAttempts.map((c) => c.at);
    expect(gaps(times.slice(1))).toEqual([2_000, 4_000]);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(1_000);
    expect(h.broker.subscriptions(h.session.clientId)).toEqual(
      EXPECTED_TOPICS.map((topic) => ({ topic, qos: 1 })),
    );
    expect(states(h.entries)).toEqual([
      "broker_connected",
      "broker_disconnected",
      "broker_connected",
    ]);

    // After this success the wait is 1 s again.
    h.broker.drop(h.session.clientId);
    await flush();
    const before = h.broker.connectAttempts.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(h.broker.connectAttempts).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(h.broker.connectAttempts).toHaveLength(before + 1);
    expect(h.session.connected()).toBe(true);
  });

  it("treats a failed subscribe as a failed attempt with no entry", async () => {
    let failSubscribe = true;
    const h = harness({
      connect: (broker) => async (options) => {
        const conn = await broker.connector(options);
        if (!failSubscribe) return conn;
        failSubscribe = false;
        return { ...conn, subscribe: () => Promise.reject(new Error()) };
      },
    });
    h.session.start();
    await flush();
    expect(h.session.connected()).toBe(false);
    expect(states(h.entries)).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(h.broker.connectAttempts).toHaveLength(2);
    expect(h.session.connected()).toBe(true);
    expect(states(h.entries)).toEqual(["broker_connected"]);
  });

  it("publishes only on the cmd topic at QoS 1, unretained, and nothing while disconnected", async () => {
    const h = harness();
    h.session.publishCmd(DEVICE, "early");
    h.session.start();
    await flush();
    h.session.publishCmd(DEVICE, "one");
    h.session.publishCmd(DEVICE, "two");
    await flush();
    h.broker.drop(h.session.clientId);
    await flush();
    h.session.publishCmd(DEVICE, "while-down");
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    const mine = h.broker.published.filter((p) => p.clientId === h.session.clientId);
    expect(mine).toEqual([
      {
        clientId: h.session.clientId,
        topic: buildTopic(DEVICE, "cmd"),
        payload: "one",
        qos: 1,
        retain: false,
      },
      {
        clientId: h.session.clientId,
        topic: buildTopic(DEVICE, "cmd"),
        payload: "two",
        qos: 1,
        retain: false,
      },
    ]);
    for (const p of mine) {
      expect(p.topic).not.toMatch(/\/(?:status|event|ack|ota)$/);
    }
    for (const { topic } of h.broker.subscriptions(h.session.clientId)) {
      expect(topic).not.toMatch(/\/(?:cmd|ota)$/);
    }
  });

  it("stop ends the connection, cancels reconnects and logs nothing", async () => {
    const h = harness();
    h.session.start();
    await flush();
    await h.session.stop();
    await flush();
    expect(h.session.connected()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.broker.connectAttempts).toHaveLength(1);
    expect(states(h.entries)).toEqual(["broker_connected"]);
  });
});
