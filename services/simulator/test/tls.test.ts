// TLS verification for the simulator's two outbound connections (Req 1.6, 1.9). No simulator
// source names an option that weakens verification, the MQTT.js options carry none, and against a
// loopback TLS server with an untrusted, expired or wrong-host certificate both the `mqtts`
// connector and the `wss` audio client fail the attempt before any application data: the server
// receives nothing, so no credential, DEVICE_TOKEN or Document B message is sent. A trusted
// certificate is the control. The only trust hook is extra trust anchors passed through deps.
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server, type TLSSocket } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";

import { createWsAudioClient } from "../src/audio/transport/ws-audio-client.js";
import { createSystemClock } from "../src/clock.js";
import { listenControlHttp } from "../src/control/transport/http-listener.js";
import { randomIds } from "../src/ids.js";
import type { SimLogEntry } from "../src/log/logger.js";
import type { MqttConnectOptions } from "../src/mqtt/mqtt-transport.js";
import { createMqttJsConnector, mqttJsOptions } from "../src/mqtt/transport/mqtt-js-connector.js";
import { createSimulator } from "../src/simulator.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { selfSignedCert, type CertVariant } from "./support/self-signed.js";
import { simConfig } from "./support/sim-harness.js";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const WEAKENING = /rejectUnauthorized|checkServerIdentity|NODE_TLS_REJECT_UNAUTHORIZED/;
const PASSWORD = "\u00a7tls-test-password";
const TOKEN = "\u00a7tls-test-device-token";
const BAD_VARIANTS = ["untrusted", "expired", "wrong_host"] as const;

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
  readonly ca: string;
  /** TCP connections accepted. */
  tcp: number;
  /** Handshakes completed. */
  secure: number;
  /** Application bytes received after a handshake. */
  received: number;
  /** The first application bytes, as latin1 text. */
  head: string;
};

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function tlsServer(variant: CertVariant, onData?: (s: TLSSocket) => void): Promise<TlsProbe> {
  const { cert, key, ca } = selfSignedCert(variant);
  const probe = { tcp: 0, secure: 0, received: 0, head: "" };
  const server = createServer({ cert, key }, (socket) => {
    probe.secure += 1;
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      if (probe.head.length < 64) probe.head += chunk.toString("latin1").slice(0, 64);
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
    clientId: "xlu_tls_000123",
    username: "tls-test-user",
    password: PASSWORD,
  };
}

const wssUrl = (port: number): string => "wss" + "://" + "127.0.0.1:" + String(port);
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("TLS settings", () => {
  it("no simulator source names an option that weakens certificate verification", () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(WEAKENING);
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

describe("mqtts certificate failures", () => {
  it.each(BAD_VARIANTS)(
    "fails a %s certificate before any MQTT packet is sent",
    async (variant) => {
      const probe = await tlsServer(variant);
      const connect = createMqttJsConnector({ ca: probe.ca });
      const error = await connect(connectOptions(probe.port)).then(
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
    expect(probe.head.charCodeAt(0)).toBe(0x10);
  });
});

describe("wss certificate failures", () => {
  it.each(BAD_VARIANTS)(
    "fails a %s certificate before the upgrade request carries the token",
    async (variant) => {
      const probe = await tlsServer(variant);
      const open = createWsAudioClient({ ca: probe.ca });
      const reason = await open(wssUrl(probe.port), TOKEN).then(
        () => null,
        (r: unknown) => r,
      );
      expect(reason).toBe("connect_failed");
      await settle(50);
      expect(probe.tcp).toBe(1);
      expect(probe.secure).toBe(0);
      expect(probe.received).toBe(0);
    },
  );

  it("control: with a trusted certificate the server does receive the upgrade request", async () => {
    const probe = await tlsServer("valid", (socket) => socket.destroy());
    const open = createWsAudioClient({ ca: probe.ca });
    const reason = await open(wssUrl(probe.port), TOKEN).then(
      () => null,
      (r: unknown) => r,
    );
    expect(reason).toBe("connect_failed");
    expect(probe.secure).toBe(1);
    expect(probe.received).toBeGreaterThan(0);
    expect(probe.head.startsWith("GET ")).toBe(true);
  });
});

describe("the composed simulator", () => {
  it("treats a failed broker handshake as a failed attempt: no entry, backoff, no data", async () => {
    const probe = await tlsServer("untrusted");
    const config = simConfig({
      localMode: false,
      brokerUrl: "mqtts" + "://" + "127.0.0.1:" + String(probe.port),
      password: PASSWORD,
      token: TOKEN,
    });
    const sink = createCaptureSink();
    const sim = createSimulator(config, {
      clock: createSystemClock(),
      // The trust hook goes through deps; the Config has no TLS field.
      connectMqtt: createMqttJsConnector({ ca: probe.ca }),
      openAudio: createWsAudioClient({ ca: probe.ca }),
      listenControl: listenControlHttp,
      sink,
      ids: randomIds,
      listenPorts: { control: 0 },
    });
    try {
      await sim.start();
      // The first attempt fails at once; the next follows the 1 s backoff.
      await settle(1_500);
    } finally {
      await sim.stop();
    }
    expect(probe.tcp).toBeGreaterThanOrEqual(2);
    expect(probe.secure).toBe(0);
    expect(probe.received).toBe(0);
    const entries = sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
    expect(entries.map((e) => (e.kind === "simulator" ? e.state : e.kind))).toEqual([
      "starting",
      "control_listening",
      "stopping",
    ]);
    expect(sink.text()).not.toContain(PASSWORD);
    expect(sink.text()).not.toContain(TOKEN);
  });
});
