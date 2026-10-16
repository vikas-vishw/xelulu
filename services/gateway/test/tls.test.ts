// TLS verification for the broker connection (Req 1.6, 1.9). No gateway source names an option
// that weakens verification, the MQTT.js options carry none, and against a loopback TLS server
// with an untrusted, expired or wrong-host certificate the MQTT.js connector fails the attempt
// before any MQTT packet: the server receives no application data, so no credential or Document B
// message is sent. The only trust hook is extra trust anchors passed through deps, never Config.
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server, type TLSSocket } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";

import type { GatewayLogEntry } from "@xelulu/shared";

import { listenWsAudio } from "../src/audio/transport/ws-audio-listener.js";
import { createSystemClock } from "../src/clock.js";
import { parseGatewayConfig } from "../src/config.js";
import { createGateway } from "../src/gateway.js";
import { randomIds } from "../src/ids.js";
import { createMqttJsConnector, mqttJsOptions } from "../src/mqtt/transport/mqtt-js-connector.js";
import type { MqttConnectOptions } from "../src/mqtt/mqtt-transport.js";
import { listenOperatorHttp } from "../src/operator/transport/http-listener.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { selfSignedCert, type CertVariant } from "./support/self-signed.js";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const WEAKENING = /rejectUnauthorized|checkServerIdentity|NODE_TLS_REJECT_UNAUTHORIZED/;
const PASSWORD = "\u00a7tls-test-password";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}

type TlsProbe = {
  readonly server: Server;
  readonly port: number;
  /** TCP connections accepted. */
  tcp: number;
  /** Handshakes completed. */
  secure: number;
  /** Application bytes received after a handshake. */
  received: number;
  firstByte: number | null;
};

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function tlsServer(
  variant: CertVariant,
  onData?: (s: TLSSocket) => void,
): Promise<TlsProbe & { ca: string }> {
  const { cert, key, ca } = selfSignedCert(variant);
  const probe = { tcp: 0, secure: 0, received: 0, firstByte: null as number | null };
  const server = createServer({ cert, key }, (socket) => {
    probe.secure += 1;
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      if (probe.firstByte === null) probe.firstByte = chunk[0] ?? null;
      probe.received += chunk.byteLength;
      onData?.(socket);
    });
  });
  server.on("connection", (socket: Socket) => {
    probe.tcp += 1;
    sockets.push(socket);
  });
  server.on("tlsClientError", () => undefined);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return Object.assign(probe, { server, port, ca });
}

function connectOptions(port: number): MqttConnectOptions {
  return {
    url: "mqtts" + "://" + "127.0.0.1:" + String(port),
    clientId: "xelulu-gw-tls-test",
    username: "tls-test-user",
    password: PASSWORD,
  };
}

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("TLS settings", () => {
  it("no gateway source names an option that weakens certificate verification", () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(WEAKENING);
  });

  it("the MQTT.js options add only trust anchors and never weaken verification", () => {
    const plain = mqttJsOptions(connectOptions(8883));
    const withCa = mqttJsOptions(connectOptions(8883), { ca: "PEM" });
    for (const opts of [plain, withCa]) {
      expect(opts).not.toHaveProperty("rejectUnauthorized");
      expect(opts).not.toHaveProperty("checkServerIdentity");
      expect(opts).not.toHaveProperty("servername");
    }
    expect(Object.keys(withCa).filter((k) => !(k in plain))).toEqual(["ca"]);
    expect(withCa.ca).toBe("PEM");
  });
});

describe("certificate failures", () => {
  it.each(["untrusted", "expired", "wrong_host"] as const)(
    "fails a %s certificate before any MQTT packet is sent",
    async (variant) => {
      const probe = await tlsServer(variant);
      const connect = createMqttJsConnector({ ca: probe.ca });
      const attempt = connect(connectOptions(probe.port));
      const error = await attempt.then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("");
      await settle(50);
      expect(probe.tcp).toBe(1);
      expect(probe.secure).toBe(0);
      expect(probe.received).toBe(0);
    },
  );

  it("control: with a trusted certificate the server does receive the MQTT CONNECT", async () => {
    const probe = await tlsServer("valid", (socket) => socket.destroy());
    const connect = createMqttJsConnector({ ca: probe.ca });
    const error = await connect(connectOptions(probe.port)).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect(probe.secure).toBe(1);
    expect(probe.received).toBeGreaterThan(0);
    // 0x10: the MQTT CONNECT packet type.
    expect(probe.firstByte).toBe(0x10);
  });

  it("a gateway treats a failed handshake as a failed attempt: no entry, backoff, no data", async () => {
    const probe = await tlsServer("untrusted");
    const config = parseGatewayConfig(
      Object.fromEntries([
        ["APP_ENV", "staging"],
        ["MQTT_BROKER_URL", "mqtts" + "://" + "127.0.0.1:" + String(probe.port)],
        ["MQTT_USERNAME", "tls-test-user"],
        ["MQTT_PASSWORD", PASSWORD],
        ["AUDIO_WSS_URL", "wss" + "://" + "127.0.0.1:1"],
        ["DEVICE_ID", "xlu_000123"],
        ["DEVICE_TOKEN", "tls-test-device-token"],
        ["GATEWAY_OPERATOR_PORT", "1"],
      ]),
    );
    if (!config.ok) throw new Error("test config refused");
    const sink = createCaptureSink();
    const gateway = createGateway(config.config, {
      clock: createSystemClock(),
      // The trust hook goes through deps; the Config has no TLS field.
      connectMqtt: createMqttJsConnector({ ca: probe.ca }),
      listenAudio: listenWsAudio,
      listenOperator: listenOperatorHttp,
      sink,
      ids: randomIds,
      listenPorts: { audio: 0 },
    });
    const entries: GatewayLogEntry[] = [];
    gateway.log.subscribe((e) => entries.push(e));
    try {
      await gateway.start();
      // The first attempt fails at once; the next follows the 1 s backoff.
      await settle(1_500);
    } finally {
      await gateway.stop();
    }
    expect(probe.tcp).toBeGreaterThanOrEqual(2);
    expect(probe.secure).toBe(0);
    expect(probe.received).toBe(0);
    // The provider gate runs before any listener opens (Phase 3 Req 1.4).
    expect(entries.map((e) => (e.kind === "gateway" ? e.state : e.kind))).toEqual([
      "starting",
      "provider_check",
      "provider_check",
      "provider_check",
      "audio_listening",
      "stopping",
    ]);
    expect(sink.text()).not.toContain(PASSWORD);
  });
});
