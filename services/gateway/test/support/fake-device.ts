// Test helper (not a test): a fake robot for gateway tests. It is an MQTT peer on the in-memory
// broker (client id = device_id, subscribed to its own `cmd` topic) plus a `ws` client for audio
// turns that sends `Authorization: Bearer <token>`. Every message it sends is built with the
// `@xelulu/shared` serialisers and every command it receives is parsed with `parseCmdMessage`,
// so it speaks Document B exactly, with no shortcut into gateway internals. Commands are answered
// by an auto-ack policy; audio replies (binary frames, texts, close code) are captured.
import { randomBytes } from "node:crypto";

import { WebSocket } from "ws";

import {
  BUTTON_ACTIONS,
  BUTTONS,
  MODES,
  MOTION_KINDS,
  PROTO_VER,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  buildTopic,
  parseAudioControlMessage,
  parseCmdMessage,
  serialiseAckMessage,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  serialiseEventMessage,
  serialiseHelloMessage,
  serialiseStatusMessage,
  type AckReason,
  type AckStatus,
  type AudioControlMessage,
  type CmdAction,
  type CmdMessage,
  type EventDataFor,
  type EventKind,
  type EventMessage,
  type StatusMessage,
} from "@xelulu/shared";

import type { MqttConnection } from "../../src/mqtt/mqtt-transport.js";
import type { MemoryBroker } from "./memory-broker.js";

const decoder = new TextDecoder();

/** Whole unix seconds now (fake timers fake Date too). */
export function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

/** A valid `data` for each Event_Kind, from the contract constants. */
export function defaultEventData<K extends EventKind>(kind: K): EventDataFor<K> {
  const data: { [Kind in EventKind]: EventDataFor<Kind> } = {
    touch: { zone: TOUCH_ZONES[0], gesture: TOUCH_GESTURES[0] },
    wake: { source: WAKE_SOURCES[0] },
    cry: { confidence: 0.9, duration_s: 6 },
    motion: { event: MOTION_KINDS[0], value: 1 },
    button: { button: BUTTONS[0], action: BUTTON_ACTIONS[0] },
    nfc: { card_id: "card-0001" },
    interrupt: {},
    error: { code: "", detail: "" },
  };
  // TypeScript cannot relate a mapped type indexed by K to the Extract-based EventDataFor<K>.
  return data[kind] as EventDataFor<K>;
}

/** How the fake device answers each valid command it receives. */
export type AckPolicy = Readonly<{
  /** `accept_done`: accepted then done ""; `accept_only`: accepted; `silent`: nothing. */
  mode: "accept_done" | "accept_only" | "silent";
  /** Actions answered `rejected` with this reason instead (the hardware's truth). */
  reject?: Readonly<Partial<Record<CmdAction, AckReason>>>;
}>;

export const DEFAULT_ACK_POLICY: AckPolicy = Object.freeze({ mode: "accept_done" });

/** A 40-byte upload frame of test bytes (not audio). */
export function uploadFrame(byteLength = 40): Uint8Array {
  return new Uint8Array(byteLength).fill(0x55);
}

export type ReplyCapture = {
  /** Binary frames received from the gateway, in order. */
  readonly frames: Uint8Array[];
  /** Text messages received from the gateway, raw. */
  readonly texts: string[];
  /** Each text parsed with parseAudioControlMessage (null when it does not parse). */
  readonly controls: (AudioControlMessage | null)[];
  closeCode: number | null;
};

export interface FakeAudio {
  readonly reply: ReplyCapture;
  /** Resolves with the close code once the socket closes. */
  readonly closed: Promise<number>;
  sendStart(turnId: string): void;
  sendEnd(turnId: string): void;
  sendFrame(frame?: Uint8Array): void;
  /** Any text, for negative tests. */
  sendText(text: string): void;
  close(code?: number): void;
  terminate(): void;
}

export type AudioOpenResult =
  | { readonly kind: "open"; readonly audio: FakeAudio }
  | { readonly kind: "refused"; readonly status: number };

export type FakeDeviceOptions = Readonly<{
  broker: MemoryBroker;
  deviceId: string;
  token: string;
  policy?: AckPolicy;
}>;

export interface FakeDevice {
  readonly deviceId: string;
  /** Valid commands received, in order. */
  readonly commands: readonly CmdMessage[];
  /** Command payloads that failed parseCmdMessage. */
  readonly invalidCommands: number;
  /** Connects as an MQTT peer with client id = device_id and subscribes to its `cmd` topic. */
  connect(): Promise<void>;
  /** Ends the MQTT connection. */
  disconnect(): Promise<void>;
  setPolicy(policy: AckPolicy): void;
  hello(opts?: { auth?: string; deviceId?: string; ts?: number }): Promise<void>;
  status(overrides?: Partial<Omit<StatusMessage, "proto_ver" | "type">>): Promise<void>;
  /** Publishes one event; returns its event_id. */
  event<K extends EventKind>(
    kind: K,
    opts?: { data?: EventDataFor<K>; eventId?: string; ts?: number; timeUncertain?: boolean },
  ): Promise<string>;
  ack(cmdId: string, status: AckStatus, reason?: "" | AckReason): Promise<void>;
  /** Any payload on any topic, for negative tests. */
  publishRaw(topic: string, payload: string, qos?: 0 | 1): Promise<void>;
  /** Opens an audio socket at 127.0.0.1:port. `authorization` null sends no header. */
  openAudio(
    port: number,
    opts?: { authorization?: string | null; path?: string },
  ): Promise<AudioOpenResult>;
  /** Opens a socket, sends audio_start, `frames` upload frames and audio_end. Throws if refused. */
  audioTurn(port: number, opts?: { frames?: number; turnId?: string }): Promise<FakeAudio>;
}

function newId(prefix: string): string {
  return prefix + randomBytes(12).toString("base64url");
}

export function createFakeDevice(options: FakeDeviceOptions): FakeDevice {
  const { broker, deviceId, token } = options;
  let policy: AckPolicy = options.policy ?? DEFAULT_ACK_POLICY;
  let connection: MqttConnection | null = null;
  const commands: CmdMessage[] = [];
  let invalidCommands = 0;

  function conn(): MqttConnection {
    if (connection === null) throw new Error("fake device is not connected");
    return connection;
  }

  async function ack(cmdId: string, status: AckStatus, reason: "" | AckReason = ""): Promise<void> {
    await conn().publish(
      buildTopic(deviceId, "ack"),
      serialiseAckMessage({
        proto_ver: PROTO_VER,
        ts: nowTs(),
        type: "ack",
        cmd_id: cmdId,
        status,
        reason,
      }),
      1,
    );
  }

  async function answer(cmd: CmdMessage): Promise<void> {
    const reason = policy.reject?.[cmd.action];
    if (reason !== undefined) {
      await ack(cmd.cmd_id, "rejected", reason);
      return;
    }
    if (policy.mode === "silent") return;
    await ack(cmd.cmd_id, "accepted");
    if (policy.mode === "accept_done") await ack(cmd.cmd_id, "done");
  }

  function onMessage(topic: string, payload: Uint8Array): void {
    if (topic !== buildTopic(deviceId, "cmd")) return;
    const parsed = parseCmdMessage(decoder.decode(payload));
    if (!parsed.ok) {
      invalidCommands += 1;
      return;
    }
    commands.push(parsed.value);
    answer(parsed.value).catch(() => undefined);
  }

  function openAudio(
    port: number,
    opts: { authorization?: string | null; path?: string } = {},
  ): Promise<AudioOpenResult> {
    const authorization = opts.authorization === undefined ? `Bearer ${token}` : opts.authorization;
    const url = "ws" + "://" + "127.0.0.1:" + String(port) + (opts.path ?? "/");
    const ws = new WebSocket(url, {
      perMessageDeflate: false,
      headers: authorization === null ? {} : { Authorization: authorization },
    });
    const reply: ReplyCapture = { frames: [], texts: [], controls: [], closeCode: null };
    const closed = new Promise<number>((resolve) => {
      ws.on("close", (code: number) => {
        reply.closeCode = code;
        resolve(code);
      });
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        reply.frames.push(new Uint8Array(data));
        return;
      }
      const text = data.toString("utf8");
      reply.texts.push(text);
      const parsed = parseAudioControlMessage(text);
      reply.controls.push(parsed.ok ? parsed.value : null);
    });

    const audio: FakeAudio = {
      reply,
      closed,
      sendStart(turnId) {
        ws.send(
          serialiseAudioStartMessage({
            proto_ver: PROTO_VER,
            ts: nowTs(),
            type: "audio_start",
            turn_id: turnId,
          }),
        );
      },
      sendEnd(turnId) {
        ws.send(
          serialiseAudioEndMessage({
            proto_ver: PROTO_VER,
            ts: nowTs(),
            type: "audio_end",
            turn_id: turnId,
          }),
        );
      },
      sendFrame(frame = uploadFrame()) {
        ws.send(frame, { binary: true });
      },
      sendText(text) {
        ws.send(text);
      },
      close(code = 1000) {
        ws.close(code);
      },
      terminate() {
        ws.terminate();
      },
    };

    return new Promise((resolve) => {
      ws.once("open", () => resolve({ kind: "open", audio }));
      ws.once("unexpected-response", (_req, res) => {
        resolve({ kind: "refused", status: res.statusCode ?? 0 });
        ws.terminate();
      });
      ws.on("error", () => resolve({ kind: "refused", status: 0 }));
    });
  }

  return {
    deviceId,
    commands,
    get invalidCommands() {
      return invalidCommands;
    },
    async connect() {
      const c = await broker.peer(deviceId);
      c.onMessage(onMessage);
      await c.subscribe([buildTopic(deviceId, "cmd")], 1);
      connection = c;
    },
    async disconnect() {
      const c = connection;
      connection = null;
      await c?.end();
    },
    setPolicy(next) {
      policy = next;
    },
    async hello(opts = {}) {
      await conn().publish(
        buildTopic(deviceId, "status"),
        serialiseHelloMessage({
          proto_ver: PROTO_VER,
          ts: opts.ts ?? nowTs(),
          type: "hello",
          device_id: opts.deviceId ?? deviceId,
          fw_ver: "fake-1.0.0",
          auth: opts.auth ?? token,
          proto: PROTO_VER,
        }),
        1,
      );
    },
    async status(overrides = {}) {
      await conn().publish(
        buildTopic(deviceId, "status"),
        serialiseStatusMessage({
          proto_ver: PROTO_VER,
          ts: nowTs(),
          type: "status",
          battery_pct: 80,
          charging: false,
          mode: MODES[0],
          wifi_rssi: -50,
          fault: [],
          active_child_id: null,
          temp_c: 30,
          ...overrides,
        }),
        0,
      );
    },
    async event(kind, opts = {}) {
      const eventId = opts.eventId ?? newId("ev_");
      const message = {
        proto_ver: PROTO_VER,
        ts: opts.ts ?? nowTs(),
        type: "event",
        event_id: eventId,
        event: kind,
        ...(opts.timeUncertain === undefined ? {} : { time_uncertain: opts.timeUncertain }),
        data: opts.data ?? defaultEventData(kind),
      } as EventMessage;
      await conn().publish(buildTopic(deviceId, "event"), serialiseEventMessage(message), 1);
      return eventId;
    },
    ack,
    async publishRaw(topic, payload, qos = 1) {
      await conn().publish(topic, payload, qos);
    },
    openAudio,
    async audioTurn(port, opts = {}) {
      const result = await openAudio(port);
      if (result.kind !== "open") throw new Error("audio upgrade refused");
      const turnId = opts.turnId ?? newId("t_");
      result.audio.sendStart(turnId);
      for (let i = 0; i < (opts.frames ?? 50); i++) result.audio.sendFrame();
      result.audio.sendEnd(turnId);
      return result.audio;
    },
  };
}
