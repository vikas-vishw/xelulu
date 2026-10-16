// Inbound classifier examples (Req 4.2, 4.4, 4.9, 4.10, 5.6, 5.7) drive the pure classifier
// directly. Property 2 runs every rejection through the composed gateway (memory broker, fake
// device, capture sink).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GATEWAY_ISSUE_KINDS,
  buildTopic,
  serialiseAckMessage,
  serialiseEventMessage,
  serialiseHelloMessage,
  serialiseStatusMessage,
  type HelloMessage,
  type StatusMessage,
} from "@xelulu/shared";

import { createRegistry } from "../src/devices/registry.js";
import {
  classifyInbound,
  MAX_INBOUND_PAYLOAD_BYTES,
  type InboundDecision,
} from "../src/mqtt/inbound-pipeline.js";
import { rejectionCaseArb, SENTINEL_PREFIX } from "./support/arbitraries.js";
import {
  flush,
  HARNESS_DEVICE_ID,
  safePaths,
  startHarness,
  stringsIn,
} from "./support/gateway-harness.js";

const DEVICE = "xlu_000123";
const TOKEN = "device-token-0123456789";
const encoder = new TextEncoder();

const STATUS: StatusMessage = {
  proto_ver: 2,
  ts: 1_760_000_000,
  type: "status",
  battery_pct: 80,
  charging: false,
  mode: "idle",
  wifi_rssi: -50,
  fault: [],
  active_child_id: null,
  temp_c: 30,
};

const HELLO: HelloMessage = {
  proto_ver: 2,
  ts: 1_760_000_000,
  type: "hello",
  device_id: DEVICE,
  fw_ver: "sim-0.1.0",
  auth: TOKEN,
  proto: 2,
};

const EVENT = serialiseEventMessage({
  proto_ver: 2,
  ts: 1_760_000_000,
  type: "event",
  event_id: "ev_1",
  event: "touch",
  data: { zone: "head", gesture: "tap" },
});

const ACK = serialiseAckMessage({
  proto_ver: 2,
  ts: 1_760_000_000,
  type: "ack",
  cmd_id: "c1",
  status: "done",
  reason: "",
});

/** A valid status payload of exactly `bytes` bytes (ASCII, padded inside `fault`). */
function statusOfSize(bytes: number): Uint8Array {
  const base = serialiseStatusMessage({ ...STATUS, fault: [""] });
  const text = serialiseStatusMessage({ ...STATUS, fault: ["f".repeat(bytes - base.length)] });
  const out = encoder.encode(text);
  expect(out.byteLength).toBe(bytes);
  return out;
}

function rejected(d: InboundDecision) {
  expect(d.kind).toBe("reject");
  if (d.kind !== "reject") throw new Error("expected a rejection");
  return d.entry;
}

describe("inbound pipeline", () => {
  it("parses a payload of exactly 8,192 bytes and rejects 8,193 as payload_too_large", () => {
    const registry = createRegistry({ deviceId: DEVICE, token: TOKEN });
    const topic = buildTopic(DEVICE, "status");

    expect(classifyInbound(topic, statusOfSize(MAX_INBOUND_PAYLOAD_BYTES), registry).kind).toBe(
      "status",
    );
    expect(rejected(classifyInbound(topic, statusOfSize(8_193), registry))).toEqual({
      kind: "message_rejected",
      transport: "mqtt",
      device_id: DEVICE,
      topic_suffix: "status",
      issues: [{ path: [], kind: "payload_too_large" }],
    });
  });

  it("rejects a hello naming another device with one device_id_mismatch issue and no value", () => {
    const registry = createRegistry({ deviceId: DEVICE, token: TOKEN });
    const other = "§other-device-id";
    const payload = encoder.encode(serialiseHelloMessage({ ...HELLO, device_id: other }));
    const entry = rejected(classifyInbound(buildTopic(DEVICE, "status"), payload, registry));

    expect(entry).toEqual({
      kind: "message_rejected",
      transport: "mqtt",
      device_id: DEVICE,
      topic_suffix: "status",
      issues: [{ path: ["device_id"], kind: "device_id_mismatch" }],
    });
    const json = JSON.stringify(entry);
    expect(json).not.toContain(other);
    expect(json).not.toContain(TOKEN);
    // The auth was never compared.
    expect(registry.helloSeen(DEVICE)).toBe(false);
  });

  it("logs no part of an unparsable topic", () => {
    const registry = createRegistry({ deviceId: DEVICE, token: TOKEN });
    for (const topic of ["xelulu/§secret-part/status/extra", "§secret-part", "xelulu//event"]) {
      const entry = rejected(classifyInbound(topic, encoder.encode("{}"), registry));
      expect(entry).toEqual({
        kind: "message_rejected",
        transport: "mqtt",
        device_id: null,
        topic_suffix: null,
        issues: [{ path: [], kind: "invalid_topic" }],
      });
      expect(JSON.stringify(entry)).not.toContain("secret-part");
    }
  });

  it("gives device_id null and no id value for an unregistered device", () => {
    const registry = createRegistry({ deviceId: DEVICE, token: TOKEN });
    const entry = rejected(
      classifyInbound(buildTopic("xlu_999999", "event"), encoder.encode(EVENT), registry),
    );
    expect(entry).toEqual({
      kind: "message_rejected",
      transport: "mqtt",
      device_id: null,
      topic_suffix: "event",
      issues: [{ path: [], kind: "unknown_device" }],
    });
    expect(JSON.stringify(entry)).not.toContain("xlu_999999");
  });

  it("drops status, event and ack while auth_failed but still classifies a hello", () => {
    const registry = createRegistry({ deviceId: DEVICE, token: TOKEN });
    const cases = [
      ["status", serialiseStatusMessage(STATUS)],
      ["event", EVENT],
      ["ack", ACK],
    ] as const;

    // Before any hello, valid messages are processed normally (Req 5.7).
    for (const [suffix, text] of cases) {
      expect(classifyInbound(buildTopic(DEVICE, suffix), encoder.encode(text), registry).kind).toBe(
        suffix,
      );
    }

    expect(registry.checkHello(DEVICE, "wrong-token-value")).toBe("failed");
    for (const [suffix, text] of cases) {
      expect(
        rejected(classifyInbound(buildTopic(DEVICE, suffix), encoder.encode(text), registry)),
      ).toEqual({
        kind: "message_rejected",
        transport: "mqtt",
        device_id: DEVICE,
        topic_suffix: suffix,
        issues: [{ path: [], kind: "auth_failed" }],
      });
    }
    const hello = classifyInbound(
      buildTopic(DEVICE, "status"),
      encoder.encode(serialiseHelloMessage(HELLO)),
      registry,
    );
    expect(hello.kind).toBe("hello");
  });

  it("reports contract failures as Safe_Issues with no payload value", () => {
    const registry = createRegistry({ deviceId: DEVICE, token: TOKEN });
    const topic = buildTopic(DEVICE, "ack");
    expect(rejected(classifyInbound(topic, encoder.encode("{§not-json"), registry)).issues).toEqual(
      [{ path: [], kind: "invalid_json" }],
    );
    const withUnknown = JSON.stringify({ ...JSON.parse(ACK), ["§" + "k".repeat(40)]: "§value" });
    const entry = rejected(classifyInbound(topic, encoder.encode(withUnknown), registry));
    expect(entry.issues).toEqual([{ path: ["?" + "k".repeat(31)], kind: "unrecognized_keys" }]);
    expect(JSON.stringify(entry)).not.toContain("§");
    // Nothing is ever accepted on the cmd topic.
    const onCmd = rejected(
      classifyInbound(buildTopic(DEVICE, "cmd"), encoder.encode(ACK), registry),
    );
    expect(onCmd.topic_suffix).toBe("cmd");
    expect(onCmd.issues).toEqual([{ path: [], kind: "wrong_topic" }]);
  });
});

describe("rejected inbound messages through the gateway", () => {
  // Feature: phase-1-2-gateway-simulator, Property 2: Rejected inbound messages are inert and leak nothing
  it("adds exactly one message_rejected, changes no state and leaks nothing", async () => {
    await fc.assert(
      fc.asyncProperty(rejectionCaseArb(HARNESS_DEVICE_ID), async (c) => {
        const h = await startHarness({ policy: { mode: "silent" } });
        try {
          // A device with state to protect: online, one accepted event at ts 0, one pending command.
          await h.online();
          await h.device.event("touch", { ts: 0 });
          const sent = h.gateway.sendCommand({
            device_id: HARNESS_DEVICE_ID,
            action: "volume",
            data: { level: 10 },
          });
          expect(sent.ok).toBe(true);
          await flush();

          const before = h.gateway.snapshot();
          const published = h.broker.published.length;
          const mark = h.entries.length;
          const sinkMark = h.sink.lines.length;

          h.inject(c.topic, c.payload);

          const added = h.entries.slice(mark);
          expect(added).toHaveLength(1);
          const entry = added[0];
          if (entry?.kind !== "message_rejected") throw new Error("expected message_rejected");
          expect(entry.transport).toBe("mqtt");
          expect(entry.device_id).toBe(c.expectedDeviceId);
          if (c.expectedKind === "invalid_topic") expect(entry.topic_suffix).toBeNull();
          const first = entry.issues[0]?.kind;
          if (c.expectedKind === null) {
            expect(first).toBeDefined();
            expect(GATEWAY_ISSUE_KINDS as readonly string[]).not.toContain(first);
          } else {
            expect(first).toBe(c.expectedKind);
          }
          expect(entry.issues.length).toBeGreaterThanOrEqual(1);
          expect(entry.issues.length).toBeLessThanOrEqual(20);
          expect(safePaths(entry.issues)).toBe(true);

          // Inert: Presence, auth mark, counts and Retained_Commands unchanged, nothing published.
          expect(h.gateway.snapshot()).toEqual(before);
          expect(h.broker.published.length).toBe(published);

          // Nothing from the payload or an unparsable topic reaches an entry or a stdout line.
          for (const s of stringsIn(added)) expect(s).not.toContain(SENTINEL_PREFIX);
          for (const line of h.sink.lines.slice(sinkMark)) {
            expect(line).not.toContain(SENTINEL_PREFIX);
          }

          // The Dedupe_Store and the highest accepted ts are unchanged: a fresh event at ts 0 is
          // accepted and not back-dated (a leaked ts above 0 would make it back-dated).
          const probeMark = h.entries.length;
          const probeId = await h.device.event("touch", { ts: 0 });
          await flush();
          expect(h.entries.slice(probeMark)).toContainEqual(
            expect.objectContaining({
              kind: "event_accepted",
              event_id: probeId,
              back_dated: false,
            }),
          );
        } finally {
          await h.stop();
        }
      }),
      { numRuns: 100 },
    );
  });
});
