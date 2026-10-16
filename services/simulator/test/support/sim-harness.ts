// Test helper (not a test): a composed simulator for in-process tests. It wires createSimulator
// to the in-memory broker double, the real `ws` audio client, the real Control_Surface listener on
// 127.0.0.1 with an OS-assigned port (the `listenPorts` override), a capture sink and the fake
// gateway (MQTT peer plus loopback audio server). The real audio client is wrapped only to record
// what the simulator sends, in order and on the simulator's clock (`trace`). Env records are built
// from [key, value] tuples and URLs as scheme + "://" + host.
import type { OpenAudioSocket } from "../../src/audio/audio-transport.js";
import { createWsAudioClient } from "../../src/audio/transport/ws-audio-client.js";
import { createSystemClock, type Clock } from "../../src/clock.js";
import { parseSimulatorConfig, type SimulatorConfig } from "../../src/config.js";
import type { ControlListen, ControlRequestIn } from "../../src/control/control-routes.js";
import { listenControlHttp } from "../../src/control/transport/http-listener.js";
import { randomIds } from "../../src/ids.js";
import type { SimLogEntry } from "../../src/log/logger.js";
import { createSimulator, type Simulator } from "../../src/simulator.js";
import { createCaptureSink, type CaptureSink } from "./capture-sink.js";
import { createFakeGateway, type AudioOptions, type FakeGateway } from "./fake-gateway.js";
import { createMemoryBroker, type MemoryBroker } from "./memory-broker.js";

export const SIM_DEVICE_ID = "xlu_sim_000123";
export const SIM_TOKEN = "sim-harness-device-token-0123456789";

const LOOPBACK_PORT_1 = "127.0.0.1:1";

/** Lets queued microtasks and loopback deliveries run; setImmediate is never faked here. */
export async function flush(rounds = 5): Promise<void> {
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

export type SimConfigOptions = Readonly<{
  localMode?: boolean;
  deviceId?: string;
  token?: string;
  username?: string;
  password?: string;
  /** Defaults to 127.0.0.1 port 1 with the mode's scheme. */
  audioUrl?: string;
  brokerUrl?: string;
  panelPort?: number;
}>;

/** A valid Config: Local_Mode with plain schemes, or mqtts/wss with credentials otherwise. */
export function simConfig(opts: SimConfigOptions = {}): SimulatorConfig {
  const local = opts.localMode ?? true;
  const username = opts.username ?? (local ? undefined : "sim-harness-username");
  const password = opts.password ?? (local ? undefined : "sim-harness-password");
  const entries: [string, string][] = [
    ["APP_ENV", local ? "local" : "staging"],
    ["MQTT_BROKER_URL", opts.brokerUrl ?? (local ? "mqtt" : "mqtts") + "://" + LOOPBACK_PORT_1],
    ["AUDIO_WSS_URL", opts.audioUrl ?? (local ? "ws" : "wss") + "://" + LOOPBACK_PORT_1],
    ["DEVICE_ID", opts.deviceId ?? SIM_DEVICE_ID],
    ["DEVICE_TOKEN", opts.token ?? SIM_TOKEN],
    ["SIMULATOR_PANEL_PORT", String(opts.panelPort ?? 1)],
  ];
  if (username !== undefined) entries.push(["MQTT_USERNAME", username]);
  if (password !== undefined) entries.push(["MQTT_PASSWORD", password]);
  const result = parseSimulatorConfig(Object.fromEntries(entries));
  if (!result.ok) throw new Error("harness config refused");
  return result.config;
}

/** What the simulator sent on its audio sockets, stamped with the simulator clock. */
export type AudioTraceItem =
  | { readonly op: "text"; readonly at: number; readonly text: string }
  | { readonly op: "frame"; readonly at: number; readonly byteLength: number }
  | { readonly op: "close"; readonly at: number };

export type ControlAnswer = Readonly<{ status: number; body: Record<string, unknown> }>;

export type SimHarnessOptions = SimConfigOptions &
  Readonly<{
    /** The token the fake gateway's audio server expects (defaults to the Config's). */
    gatewayToken?: string;
    audio?: AudioOptions;
    /** Use this audio URL instead of the fake gateway's. */
    audioUrlOverride?: string;
    /** Real panel port instead of an OS-assigned one. */
    usePanelPort?: boolean;
    /** Passed to `SimulatorDeps.listenAllInterfaces` (Req 3.2); omitted by default. */
    listenAllInterfaces?: boolean;
  }>;

export interface SimHarness {
  readonly config: SimulatorConfig;
  readonly sim: Simulator;
  readonly broker: MemoryBroker;
  readonly sink: CaptureSink;
  readonly clock: Clock;
  readonly gateway: FakeGateway;
  readonly trace: AudioTraceItem[];
  /** The host and port of each Control_Surface listen call. */
  readonly controlListens: { readonly host: string; readonly port: number }[];
  entries(): SimLogEntry[];
  /** One Control_Surface request in-process, with a correct Host and, for POST, JSON body. */
  control(method: string, path: string, body?: unknown): ControlAnswer;
  /** `POST /api/<operation>` with `body`. */
  post(operation: string, body: unknown): ControlAnswer;
  state(): Record<string, unknown>;
  /** Everything the simulator published on the broker. */
  published(): MemoryBroker["published"];
  stop(): Promise<void>;
}

export async function startSimHarness(opts: SimHarnessOptions = {}): Promise<SimHarness> {
  const broker = createMemoryBroker();
  const token = opts.token ?? SIM_TOKEN;
  const gateway = createFakeGateway({
    broker,
    deviceId: opts.deviceId ?? SIM_DEVICE_ID,
    token: opts.gatewayToken ?? token,
    ...(opts.audio === undefined ? {} : { audio: opts.audio }),
  });
  await gateway.start();
  const config = simConfig({ ...opts, audioUrl: opts.audioUrlOverride ?? gateway.audioUrl() });
  const sink = createCaptureSink();
  const clock = createSystemClock();
  const trace: AudioTraceItem[] = [];
  const controlListens: { host: string; port: number }[] = [];

  const baseOpen = createWsAudioClient();
  const openAudio: OpenAudioSocket = async (url, t) => {
    const socket = await baseOpen(url, t);
    return {
      sendText(text) {
        trace.push({ op: "text", at: clock.now(), text });
        socket.sendText(text);
      },
      sendBinary(frame) {
        trace.push({ op: "frame", at: clock.now(), byteLength: frame.byteLength });
        socket.sendBinary(frame);
      },
      close() {
        trace.push({ op: "close", at: clock.now() });
        socket.close();
      },
      onInbound: (fn) => socket.onInbound(fn),
    };
  };
  const listenControl: ControlListen = (o) => {
    controlListens.push({ host: o.host, port: o.port });
    return listenControlHttp(o);
  };

  const sim = createSimulator(config, {
    clock,
    connectMqtt: broker.connector,
    openAudio,
    listenControl,
    sink,
    ids: randomIds,
    ...(opts.usePanelPort === true ? {} : { listenPorts: { control: 0 } }),
    ...(opts.listenAllInterfaces === undefined
      ? {}
      : { listenAllInterfaces: opts.listenAllInterfaces }),
  });
  await sim.start();
  await flush();

  const deviceId = config.device.deviceId;

  function control(method: string, path: string, body?: unknown): ControlAnswer {
    const request: ControlRequestIn = {
      method,
      path,
      query: {},
      host: "127.0.0.1:" + String(sim.controlPort() ?? 0),
      origin: undefined,
      contentType: method === "POST" ? "application/json" : undefined,
      body: body === undefined ? "" : JSON.stringify(body),
    };
    const out = sim.handleControl(request);
    return { status: out.status, body: JSON.parse(out.body) as Record<string, unknown> };
  }

  return {
    config,
    sim,
    broker,
    sink,
    clock,
    gateway,
    trace,
    controlListens,
    entries: () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry),
    control,
    post: (operation, body) => control("POST", "/api/" + operation, body),
    state: () => control("GET", "/api/state").body,
    published: () => broker.published.filter((p) => p.clientId === deviceId),
    async stop() {
      await sim.stop();
      await gateway.stop();
    },
  };
}
