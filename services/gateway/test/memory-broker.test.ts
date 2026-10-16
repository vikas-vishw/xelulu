// Sanity checks for the in-memory broker double itself (design "In-memory broker double").
import { describe, expect, it } from "vitest";

import { createMemoryBroker } from "./support/memory-broker.js";

const OPTIONS = { url: "", clientId: "gw", username: null, password: null } as const;
const decoder = new TextDecoder();

describe("memory broker double", () => {
  it("routes by exact topic, asynchronously, and records every publish unretained", async () => {
    const broker = createMemoryBroker(() => 42);
    const gw = await broker.connector(OPTIONS);
    const device = await broker.peer("xlu_000001");
    const received: [string, string][] = [];
    gw.onMessage((topic, payload) => received.push([topic, decoder.decode(payload)]));
    await gw.subscribe(["a/b/status"], 1);

    const publish = device.publish("a/b/status", "hello", 1);
    expect(received).toEqual([]);
    await publish;
    await device.publish("a/b/event", "ignored", 0);
    await Promise.resolve();

    expect(received).toEqual([["a/b/status", "hello"]]);
    expect(broker.published).toEqual([
      { clientId: "xlu_000001", topic: "a/b/status", payload: "hello", qos: 1, retain: false },
      { clientId: "xlu_000001", topic: "a/b/event", payload: "ignored", qos: 0, retain: false },
    ]);
    expect(broker.subscriptions("gw")).toEqual([{ topic: "a/b/status", qos: 1 }]);
    expect(broker.connectAttempts).toEqual([{ at: 42, options: OPTIONS }]);
  });

  it("fails the next connects, holds and releases pubacks, and drops connections", async () => {
    const broker = createMemoryBroker();
    broker.failNextConnects(2);
    await expect(broker.connector(OPTIONS)).rejects.toThrow();
    await expect(broker.connector(OPTIONS)).rejects.toThrow();
    const gw = await broker.connector(OPTIONS);
    expect(broker.connectAttempts).toHaveLength(3);

    broker.holdPubacks("gw", true);
    let acked = false;
    const held = gw.publish("t", "x", 1).then(() => {
      acked = true;
    });
    await Promise.resolve();
    expect(acked).toBe(false);
    broker.releasePubacks("gw");
    await held;
    expect(acked).toBe(true);

    let closed = 0;
    gw.onClose(() => {
      closed += 1;
    });
    const pending = gw.publish("t", "y", 1);
    broker.drop("gw");
    await expect(pending).rejects.toThrow();
    await Promise.resolve();
    expect(closed).toBe(1);
    await expect(gw.publish("t", "z", 0)).rejects.toThrow();
    expect(broker.subscriptions("gw")).toEqual([]);
  });
});
