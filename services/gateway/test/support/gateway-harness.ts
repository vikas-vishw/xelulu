// Test helper (not a test): a composed gateway for in-process tests. It wires createGateway to
// the in-memory broker double, the real `ws` audio listener and the real Operator_Surface
// listener on 127.0.0.1 with OS-assigned ports (the `listenPorts` override), a capture sink and
// the fake device. The real transports are wrapped only to record what the gateway sends, in
// order and on the gateway's clock (`trace`): reply frames, socket texts, close codes and MQTT
// publishes. `inject` delivers a raw message on the gateway's live MQTT connection, the way a
// broker would deliver one on a topic the gateway did not ask for (unparsable topics, other
// devices). Env records are built from [key, value] tuples and URLs as scheme + "://" + host.
import type { GatewayLogEntry } from "@xelulu/shared";

import type { AudioListen, AudioSocket } from "../../src/audio/audio-transport.js";
import { listenWsAudio } from "../../src/audio/transport/ws-audio-listener.js";
import { createSystemClock, type Clock } from "../../src/clock.js";
import { parseGatewayConfig, type GatewayConfig } from "../../src/config.js";
import { createGateway, type Gateway } from "../../src/gateway.js";
import type { LlmProvider } from "../../src/brain/providers/llm-provider.js";
import type { SttProvider } from "../../src/brain/providers/stt-provider.js";
import type { TtsProvider } from "../../src/brain/providers/tts-provider.js";
import { stubProviders } from "./stub-providers.js";
import { randomIds } from "../../src/ids.js";
import type { MqttConnection, MqttConnector } from "../../src/mqtt/mqtt-transport.js";
import type { OperatorListen } from "../../src/operator/operator-routes.js";
import { listenOperatorHttp } from "../../src/operator/transport/http-listener.js";
import { createCaptureSink, type CaptureSink } from "./capture-sink.js";
import { createFakeDevice, type AckPolicy, type FakeDevice } from "./fake-device.js";
import { createMemoryBroker, type MemoryBroker } from "./memory-broker.js";

export const HARNESS_DEVICE_ID = "xlu_000123";
export const HARNESS_TOKEN = "harness-device-token-0123456789";

const LOOPBACK_PORT_1 = "127.0.0.1:1";
const encoder = new TextEncoder();

/** Lets queued microtasks and loopback deliveries run; setImmediate is never faked here. */
export async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Waits for loopback I/O until `cond` holds, without moving fake time (vi.waitFor advances fake
 * timers on every check, which would disturb timing assertions). Real-time limit: `limitMs`.
 */
export async function until(cond: () => boolean, limitMs = 5_000): Promise<void> {
  const deadline = performance.now() + limitMs;
  while (!cond()) {
    if (performance.now() > deadline) throw new Error("condition not reached in time");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export type HarnessConfigOptions = Readonly<{
  localMode?: boolean;
  deviceId?: string;
  token?: string;
  username?: string;
  password?: string;
}>;

/** A valid Config: Local_Mode with plain schemes, or mqtts/wss with credentials otherwise. */
export function harnessConfig(opts: HarnessConfigOptions = {}): GatewayConfig {
  const local = opts.localMode ?? false;
  const username = opts.username ?? (local ? undefined : "harness-username");
  const password = opts.password ?? (local ? undefined : "harness-password");
  const entries: [string, string][] = [
    ["APP_ENV", local ? "local" : "staging"],
    ["MQTT_BROKER_URL", (local ? "mqtt" : "mqtts") + "://" + LOOPBACK_PORT_1],
    ["AUDIO_WSS_URL", (local ? "ws" : "wss") + "://" + LOOPBACK_PORT_1],
    ["DEVICE_ID", opts.deviceId ?? HARNESS_DEVICE_ID],
    ["DEVICE_TOKEN", opts.token ?? HARNESS_TOKEN],
    ["GATEWAY_OPERATOR_PORT", "1"],
  ];
  if (username !== undefined) entries.push(["MQTT_USERNAME", username]);
  if (password !== undefined) entries.push(["MQTT_PASSWORD", password]);
  const result = parseGatewayConfig(Object.fromEntries(entries));
  if (!result.ok) throw new Error("harness config refused");
  return result.config;
}

/** What the gateway sent, in order, stamped with the gateway clock. */
export type TraceItem =
  | {
      readonly op: "frame";
      readonly at: number;
      readonly socket: number;
      readonly bytes: Uint8Array;
    }
  | { readonly op: "text"; readonly at: number; readonly socket: number; readonly text: string }
  | { readonly op: "close"; readonly at: number; readonly socket: number; readonly code: number }
  | {
      readonly op: "publish";
      readonly at: number;
      readonly topic: string;
      readonly payload: string;
    };

export type HarnessOptions = HarnessConfigOptions &
  Readonly<{
    policy?: AckPolicy;
    /** The token the fake device uses (defaults to the Config's). */
    deviceToken?: string;
    listenAudio?: AudioListen;
    listenOperator?: OperatorListen;
    /** Passed to `GatewayDeps.listenAllInterfaces` (Req 3.1); omitted by default. */
    listenAllInterfaces?: boolean;
    /**
     * Providers for the composed gateway. Defaults to the deterministic stubs, which pin the
     * reply's wire shape; pass the real mocks to exercise the pipeline end to end (Phase 3).
     */
    providers?: Readonly<{ stt: SttProvider; llm: LlmProvider; tts: TtsProvider }>;
    /**
     * Lets the gateway build its own providers — the mock trio, on its own Clock and Deadlines —
     * instead of receiving any. The only way to drive the real pipeline end to end through the
     * composed gateway, because the Mock_Llm's delay must be scheduled on the deadlines the
     * gateway itself fires. Ignores `providers`.
     */
    realProviders?: boolean;
    /** Passed to `GatewayDeps.operatorTranscripts` (Phase 3 C4); omitted by default. */
    operatorTranscripts?: boolean;
  }>;

export interface Harness {
  readonly config: GatewayConfig;
  readonly gateway: Gateway;
  readonly broker: MemoryBroker;
  readonly sink: CaptureSink;
  readonly clock: Clock;
  /** Every Log_Entry, in seq order, from the gateway's subscription. */
  readonly entries: GatewayLogEntry[];
  readonly device: FakeDevice;
  readonly trace: TraceItem[];
  /** The host and port of each Operator_Surface listen call. */
  readonly operatorListens: { readonly host: string; readonly port: number }[];
  /** Delivers one raw message on the gateway's live MQTT connection, synchronously. */
  inject(topic: string, payload: Uint8Array | string): void;
  /** The gateway's MQTT client id. */
  clientId(): string;
  /** Connects the fake device and sends a hello with the right token. */
  online(): Promise<void>;
  /** Frames the gateway sent on one socket (1-based socket number). */
  framesOn(socket: number): Extract<TraceItem, { op: "frame" }>[];
  stop(): Promise<void>;
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const config = harnessConfig(opts);
  const broker = createMemoryBroker();
  const sink = createCaptureSink();
  const clock = createSystemClock();
  const entries: GatewayLogEntry[] = [];
  const trace: TraceItem[] = [];
  const operatorListens: { host: string; port: number }[] = [];
  let live: { handlers: ((topic: string, payload: Uint8Array) => void)[] } | null = null;
  let sockets = 0;

  const connectMqtt: MqttConnector = async (options) => {
    const c = await broker.connector(options);
    const state = { handlers: [] as ((topic: string, payload: Uint8Array) => void)[] };
    live = state;
    const wrapped: MqttConnection = {
      subscribe: (topics, qos) => c.subscribe(topics, qos),
      publish(topic, payload, qos) {
        trace.push({ op: "publish", at: clock.now(), topic, payload });
        return c.publish(topic, payload, qos);
      },
      onMessage(fn) {
        state.handlers.push(fn);
        c.onMessage(fn);
      },
      onClose: (fn) => c.onClose(fn),
      end: () => c.end(),
    };
    return wrapped;
  };

  function traced(socket: AudioSocket): AudioSocket {
    sockets += 1;
    const n = sockets;
    return {
      sendText(text) {
        trace.push({ op: "text", at: clock.now(), socket: n, text });
        socket.sendText(text);
      },
      sendBinary(frame) {
        trace.push({ op: "frame", at: clock.now(), socket: n, bytes: frame.slice() });
        socket.sendBinary(frame);
      },
      close(code) {
        trace.push({ op: "close", at: clock.now(), socket: n, code });
        socket.close(code);
      },
      onInbound: (fn) => socket.onInbound(fn),
    };
  }

  const baseAudio = opts.listenAudio ?? listenWsAudio;
  const listenAudio: AudioListen = (o) =>
    baseAudio({
      host: o.host,
      port: o.port,
      authenticate: (authorization) => o.authenticate(authorization),
      onAuthFailed: () => o.onAuthFailed(),
      onTurn: (deviceId, socket) => o.onTurn(deviceId, traced(socket)),
    });
  const baseOperator = opts.listenOperator ?? listenOperatorHttp;
  const listenOperator: OperatorListen = (o) => {
    operatorListens.push({ host: o.host, port: o.port });
    return baseOperator(o);
  };

  const gateway = createGateway(config, {
    clock,
    connectMqtt,
    listenAudio,
    listenOperator,
    sink,
    ids: randomIds,
    listenPorts: { audio: 0, operator: 0 },
    // Deterministic providers by default (Phase 3). The harness's callers assert the SHAPE of a
    // reply on the wire — one `say`, a known frame count, `audio_end` — so the reply's length
    // must not depend on a sentence the mock model happens to choose. A test that wants the real
    // mocks passes `realProviders: true`, which omits the key and lets the gateway build them.
    ...(opts.realProviders === true ? {} : { providers: opts.providers ?? stubProviders() }),
    ...(opts.listenAllInterfaces === undefined
      ? {}
      : { listenAllInterfaces: opts.listenAllInterfaces }),
    ...(opts.operatorTranscripts === undefined
      ? {}
      : { operatorTranscripts: opts.operatorTranscripts }),
  });
  gateway.log.subscribe((e) => entries.push(e));
  const device = createFakeDevice({
    broker,
    deviceId: config.device.deviceId,
    token: opts.deviceToken ?? config.device.token,
    ...(opts.policy === undefined ? {} : { policy: opts.policy }),
  });

  await gateway.start();
  await flush();

  return {
    config,
    gateway,
    broker,
    sink,
    clock,
    entries,
    device,
    trace,
    operatorListens,
    inject(topic, payload) {
      const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
      for (const fn of live?.handlers ?? []) fn(topic, bytes);
    },
    clientId() {
      const last = broker.connectAttempts.at(-1);
      if (last === undefined) throw new Error("the gateway never connected");
      return last.options.clientId;
    },
    async online() {
      await device.connect();
      await device.hello();
      await flush();
    },
    framesOn: (socket) =>
      trace.filter(
        (t): t is Extract<TraceItem, { op: "frame" }> => t.op === "frame" && t.socket === socket,
      ),
    async stop() {
      await gateway.stop();
      await device.disconnect();
    },
  };
}

/** Every string (keys and values) inside a JSON-like value, for leak scans. */
export function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...stringsIn(v)]);
  }
  return [];
}

/** True when every string segment of every issue path is printable ASCII of at most 32 chars. */
export function safePaths(issues: readonly { readonly path: readonly (string | number)[] }[]) {
  return issues.every((issue) =>
    issue.path.every(
      (seg) => typeof seg === "number" || (seg.length <= 32 && /^[\x20-\x7e]*$/.test(seg)),
    ),
  );
}
