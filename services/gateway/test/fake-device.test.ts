// The fake device (test/support/fake-device.ts) against the composed gateway: the memory broker
// for MQTT, the real `ws` audio listener and the real Operator_Surface listener on loopback
// (OS-assigned ports), real timers. A smoke test that the test-support pieces and the transports
// fit together; the detailed behaviour is covered by the per-requirement test files.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayLogEntry } from "@xelulu/shared";

import { listenWsAudio } from "../src/audio/transport/ws-audio-listener.js";
import { createSystemClock } from "../src/clock.js";
import { parseGatewayConfig, type GatewayConfig } from "../src/config.js";
import { createGateway, type Gateway } from "../src/gateway.js";
import { randomIds } from "../src/ids.js";
import { stubProviders } from "./support/stub-providers.js";
import { callOperator } from "../src/operator/transport/http-client.js";
import { listenOperatorHttp } from "../src/operator/transport/http-listener.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createFakeDevice } from "./support/fake-device.js";
import { createMemoryBroker } from "./support/memory-broker.js";

const DEVICE_ID = "xlu_000123";
const TOKEN = "fake-device-token-0123456789";

function localConfig(): GatewayConfig {
  const result = parseGatewayConfig(
    Object.fromEntries([
      ["APP_ENV", "local"],
      ["MQTT_BROKER_URL", "mqtt" + "://" + "127.0.0.1:1883"],
      ["AUDIO_WSS_URL", "ws" + "://" + "127.0.0.1:8781"],
      ["DEVICE_ID", DEVICE_ID],
      ["DEVICE_TOKEN", TOKEN],
      ["GATEWAY_OPERATOR_PORT", "8782"],
    ]),
  );
  if (!result.ok) throw new Error("test config refused");
  return result.config;
}

const running: Gateway[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((g) => g.stop()));
});

function has(entries: readonly GatewayLogEntry[], match: (e: GatewayLogEntry) => boolean): boolean {
  return entries.some(match);
}

describe("fake device against the composed gateway", () => {
  it("connects, says hello, sends an event, acks an operator command and runs an audio turn", async () => {
    const broker = createMemoryBroker();
    const sink = createCaptureSink();
    const gateway = createGateway(localConfig(), {
      clock: createSystemClock(),
      connectMqtt: broker.connector,
      listenAudio: listenWsAudio,
      listenOperator: listenOperatorHttp,
      sink,
      ids: randomIds,
      listenPorts: { audio: 0, operator: 0 },
      // The deterministic providers, so the reply's frame count is a fixture rather than a
      // function of whatever sentence the mock model chose (Phase 3).
      providers: stubProviders(),
    });
    running.push(gateway);
    const entries: GatewayLogEntry[] = [];
    gateway.log.subscribe((e) => entries.push(e));

    await gateway.start();
    const operatorPort = gateway.operatorPort();
    expect(gateway.audioPort()).toBeGreaterThan(0);
    expect(operatorPort).not.toBeNull();
    await vi.waitFor(() => {
      expect(has(entries, (e) => e.kind === "gateway" && e.state === "broker_connected")).toBe(
        true,
      );
    });
    // The provider gate runs before any listener opens (Phase 3 Req 1.4).
    expect(entries.slice(0, 5).map((e) => (e.kind === "gateway" ? e.state : e.kind))).toEqual([
      "starting",
      "provider_check",
      "provider_check",
      "provider_check",
      "audio_listening",
    ]);

    const device = createFakeDevice({ broker, deviceId: DEVICE_ID, token: TOKEN });
    await device.connect();
    await device.hello();
    await vi.waitFor(() => {
      expect(has(entries, (e) => e.kind === "presence" && e.state === "online")).toBe(true);
    });
    expect(has(entries, (e) => e.kind === "auth" && e.outcome === "ok")).toBe(true);

    const eventId = await device.event("touch");
    await vi.waitFor(() => {
      expect(has(entries, (e) => e.kind === "event_accepted" && e.event_id === eventId)).toBe(true);
    });

    const response = await callOperator({
      port: operatorPort ?? 0,
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({
        device_id: DEVICE_ID,
        action: "animate",
        data: { expression: "happy", eyes: "open", loop: false },
      }),
    });
    expect(response.status).toBe(200);
    const { cmd_id: cmdId } = JSON.parse(response.body) as { cmd_id: string };
    await vi.waitFor(() => {
      expect(
        has(entries, (e) => e.kind === "ack_result" && e.cmd_id === cmdId && e.outcome === "done"),
      ).toBe(true);
    });
    expect(device.commands.map((c) => c.action)).toEqual(["animate"]);

    const audio = await device.audioTurn(gateway.audioPort());
    expect(await audio.closed).toBe(1000);
    expect(audio.reply.frames).toHaveLength(50);
    expect(audio.reply.frames.every((f) => f.byteLength === 40)).toBe(true);
    expect(audio.reply.controls.map((c) => c?.type)).toEqual(["audio_end"]);
    await vi.waitFor(() => {
      expect(has(entries, (e) => e.kind === "audio_turn" && e.phase === "reply_ended")).toBe(true);
    });
    expect(device.commands.map((c) => c.action)).toEqual(["animate", "say"]);

    const refused = await device.openAudio(gateway.audioPort(), { authorization: "Bearer wrong" });
    expect(refused).toEqual({ kind: "refused", status: 401 });
    await vi.waitFor(() => {
      expect(
        has(entries, (e) => e.kind === "auth" && e.transport === "ws" && e.device_id === null),
      ).toBe(true);
    });

    const devices = await callOperator({
      port: operatorPort ?? 0,
      method: "GET",
      path: "/v1/devices",
    });
    expect(devices.status).toBe(200);
    expect(devices.body).not.toContain(TOKEN);

    await gateway.stop();
    expect(entries.at(-1)).toMatchObject({ kind: "gateway", state: "stopping" });
    expect(sink.text()).not.toContain(TOKEN);
    expect(sink.lines).toHaveLength(entries.length);
  });
});
