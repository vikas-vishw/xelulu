// Test helper (not a test): a fake gateway for simulator tests. It is an MQTT peer on the
// in-memory broker (subscribed to the device's `status`, `event` and `ack` topics) plus a loopback
// `ws` server for audio turns that checks the `Authorization: Bearer <token>` header. Every message
// it sends is built with the `@xelulu/shared` serialisers and every message it receives is parsed
// with the shared parsers, so it speaks Document B exactly, with no shortcut into simulator
// internals. It sends commands, records hellos, statuses, events and acks, and answers an audio
// turn with reply frames and `audio_end`; options refuse the upgrade, close early, send an invalid
// text, send another `turn_id`, or send no reply. The server binds 127.0.0.1 on an OS-assigned port.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  PROTO_VER,
  buildTopic,
  parseAudioControlMessage,
  parseDeviceMessage,
  serialiseAudioEndMessage,
  serialiseCmdMessage,
  type AckMessage,
  type AudioControlMessage,
  type CmdAction,
  type CmdMessage,
  type EventMessage,
  type HelloMessage,
  type StatusMessage,
} from "@xelulu/shared";

import type { MqttConnection } from "../../src/mqtt/mqtt-transport.js";
import type { MemoryBroker } from "./memory-broker.js";

export const FAKE_GATEWAY_CLIENT_ID = "xelulu-gw-fake";
/** Reply frames per turn by default (the gateway's Fake_Reply sends 50). */
export const REPLY_FRAMES = 50;
/** Contract-valid `say` data, as the gateway's Fake_Reply sends it. */
export const SAY_DATA = Object.freeze({
  expression: "happy",
  lang: "en-IN",
  voice: "xelulu",
  duration_hint_ms: 1000,
});

const decoder = new TextDecoder();
const LOOPBACK = "127.0.0.1";
const BEARER_PREFIX = "Bearer ";

/** A 40-byte reply frame of test bytes (not audio). */
function replyFrame(): Uint8Array {
  return new Uint8Array(40).fill(0x2a);
}

function newId(prefix: string): string {
  return prefix + randomBytes(12).toString("base64url");
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

/** One message the fake gateway received over MQTT, parsed with the shared parsers. */
export type Received =
  | { readonly kind: "hello"; readonly at: number; readonly message: HelloMessage }
  | { readonly kind: "status"; readonly at: number; readonly message: StatusMessage }
  | { readonly kind: "event"; readonly at: number; readonly message: EventMessage }
  | { readonly kind: "ack"; readonly at: number; readonly message: AckMessage }
  | { readonly kind: "invalid"; readonly at: number; readonly topic: string };

/**
 * What the server does once the device's own `audio_end` has arrived:
 * `reply` sends the reply frames, then `audio_end` with the same `turn_id`, then closes 1000;
 * `none` sends nothing; `invalid_text` sends a text that fails `parseAudioControlMessage`;
 * `other_turn_id` sends `audio_end` with another `turn_id`; `manual` leaves it to the test.
 */
export type ReplyMode = "reply" | "none" | "invalid_text" | "other_turn_id" | "manual";

export type AudioOptions = Readonly<{
  /** Every upgrade is answered 401. */
  refuseUpgrade?: boolean;
  /** Close the socket (1000) as soon as the device's `audio_start` arrives. */
  closeEarly?: boolean;
  reply?: ReplyMode;
  replyFrames?: number;
  /** Delay before the reply (on `setTimeout`, so fake timers drive it). */
  replyDelayMs?: number;
  /** Publish a `say` command when the device's `audio_end` arrives, before the reply. */
  sayOnTurn?: boolean;
}>;

/** One accepted audio socket, as the server saw it. */
export interface ServerTurn {
  readonly authorization: string | undefined;
  /** Text messages from the device, each parsed (null when it does not parse). */
  readonly controls: (AudioControlMessage | null)[];
  /** `Date.now()` at the receipt of each binary frame. */
  readonly frameTimes: number[];
  /** The `turn_id` of the device's `audio_start`, once it arrived. */
  turnId: string | null;
  /** True once the device's `audio_end` arrived. */
  ended: boolean;
  /** The `say` published for this turn (`sayOnTurn`), if any. */
  sayCmdId: string | null;
  closeCode: number | null;
  readonly closed: Promise<number>;
  sendFrames(n: number): void;
  sendAudioEnd(turnId?: string): void;
  sendText(text: string): void;
  close(code?: number): void;
}

export type FakeGatewayOptions = Readonly<{
  broker: MemoryBroker;
  deviceId: string;
  /** The token the audio server expects in the Bearer header. */
  token: string;
  audio?: AudioOptions;
}>;

export interface FakeGateway {
  readonly deviceId: string;
  /** Everything received over MQTT, in order. */
  readonly received: readonly Received[];
  /** Upgrade attempts, accepted or not, with the Authorization header seen. */
  readonly upgrades: readonly { readonly authorization: string | undefined; ok: boolean }[];
  readonly turns: readonly ServerTurn[];
  /** Connects the MQTT peer and starts the audio server. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** `ws://127.0.0.1:<port>`, built from parts. */
  audioUrl(): string;
  audioPort(): number;
  setAudio(options: AudioOptions): void;
  /** Publishes one command at QoS 1; returns its `cmd_id`. */
  sendCommand(action: CmdAction, data: unknown, cmdId?: string): Promise<string>;
  /** Any payload on the device's `cmd` topic, for negative tests. */
  sendRaw(payload: string): Promise<void>;
  hellos(): HelloMessage[];
  statuses(): StatusMessage[];
  events(): EventMessage[];
  acks(cmdId?: string): AckMessage[];
  /** `hello`, `status`, `event:<event_id>` or `ack:<cmd_id>:<status>` per message, in order. */
  shapes(): string[];
}

export function createFakeGateway(options: FakeGatewayOptions): FakeGateway {
  const { broker, deviceId, token } = options;
  let audio: AudioOptions = options.audio ?? {};
  let connection: MqttConnection | null = null;
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let port = 0;
  const received: Received[] = [];
  const upgrades: { authorization: string | undefined; ok: boolean }[] = [];
  const turns: ServerTurn[] = [];
  const sockets = new Set<WebSocket>();
  const rawSockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const topics = {
    status: buildTopic(deviceId, "status"),
    event: buildTopic(deviceId, "event"),
    ack: buildTopic(deviceId, "ack"),
    cmd: buildTopic(deviceId, "cmd"),
  };

  function onMqtt(topic: string, payload: Uint8Array): void {
    const text = decoder.decode(payload);
    const at = Date.now();
    if (topic === topics.status) {
      const r = parseDeviceMessage("status", text);
      if (r.ok && r.value.type === "hello") received.push({ kind: "hello", at, message: r.value });
      else if (r.ok && r.value.type === "status")
        received.push({ kind: "status", at, message: r.value });
      else received.push({ kind: "invalid", at, topic });
      return;
    }
    if (topic === topics.event) {
      const r = parseDeviceMessage("event", text);
      received.push(
        r.ok ? { kind: "event", at, message: r.value } : { kind: "invalid", at, topic },
      );
      return;
    }
    if (topic === topics.ack) {
      const r = parseDeviceMessage("ack", text);
      received.push(r.ok ? { kind: "ack", at, message: r.value } : { kind: "invalid", at, topic });
    }
  }

  function conn(): MqttConnection {
    if (connection === null) throw new Error("fake gateway is not connected");
    return connection;
  }

  async function sendCommand(action: CmdAction, data: unknown, cmdId?: string): Promise<string> {
    const id = cmdId ?? newId("c_");
    const message = { proto_ver: PROTO_VER, cmd_id: id, action, data } as CmdMessage;
    await conn().publish(topics.cmd, serialiseCmdMessage(message), 1);
    return id;
  }

  function later(ms: number, fn: () => void): void {
    if (ms <= 0) {
      fn();
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  }

  function accept(ws: WebSocket, authorization: string | undefined): void {
    sockets.add(ws);
    let resolveClosed: (code: number) => void = () => undefined;
    const turn: ServerTurn = {
      authorization,
      controls: [],
      frameTimes: [],
      turnId: null,
      ended: false,
      sayCmdId: null,
      closeCode: null,
      closed: new Promise<number>((resolve) => {
        resolveClosed = resolve;
      }),
      sendFrames(n) {
        for (let i = 0; i < n; i++) {
          if (ws.readyState === ws.OPEN) ws.send(replyFrame(), { binary: true });
        }
      },
      sendAudioEnd(turnId) {
        const id = turnId ?? turn.turnId ?? "";
        if (ws.readyState !== ws.OPEN) return;
        ws.send(
          serialiseAudioEndMessage({
            proto_ver: PROTO_VER,
            ts: Math.floor(Date.now() / 1000),
            type: "audio_end",
            turn_id: id,
          }),
        );
      },
      sendText(text) {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close(code = 1000) {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code);
      },
    };
    turns.push(turn);

    ws.on("close", (code: number) => {
      sockets.delete(ws);
      turn.closeCode = code;
      resolveClosed(code);
    });
    ws.on("error", () => undefined);
    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        turn.frameTimes.push(Date.now());
        return;
      }
      const parsed = parseAudioControlMessage(textOf(data));
      const control = parsed.ok ? parsed.value : null;
      turn.controls.push(control);
      if (control === null) return;
      if (control.type === "audio_start") {
        turn.turnId = control.turn_id;
        if (audio.closeEarly === true) turn.close(1000);
        return;
      }
      turn.ended = true;
      onDeviceEnd(turn, control.turn_id);
    });
  }

  function onDeviceEnd(turn: ServerTurn, turnId: string): void {
    const opts = audio;
    if (opts.sayOnTurn === true) {
      const id = newId("c_say_");
      turn.sayCmdId = id;
      sendCommand("say", SAY_DATA, id).catch(() => undefined);
    }
    const mode = opts.reply ?? "reply";
    later(opts.replyDelayMs ?? 0, () => {
      switch (mode) {
        case "reply":
          turn.sendFrames(opts.replyFrames ?? REPLY_FRAMES);
          turn.sendAudioEnd(turnId);
          turn.close(1000);
          return;
        case "invalid_text":
          turn.sendText("{" + "not-a-control-message");
          return;
        case "other_turn_id":
          turn.sendAudioEnd(newId("t_other_"));
          return;
        case "none":
        case "manual":
          return;
      }
    });
  }

  function onUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    socket.on("error", () => undefined);
    const header = req.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    const ok = audio.refuseUpgrade !== true && authorization === BEARER_PREFIX + token;
    upgrades.push({ authorization, ok });
    if (!ok || wss === null) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, authorization));
  }

  function filter<K extends Received["kind"]>(kind: K): Extract<Received, { kind: K }>[] {
    return received.filter((r): r is Extract<Received, { kind: K }> => r.kind === kind);
  }

  return {
    deviceId,
    received,
    upgrades,
    turns,
    async start() {
      const c = await broker.peer(FAKE_GATEWAY_CLIENT_ID);
      c.onMessage(onMqtt);
      await c.subscribe([topics.status, topics.event, topics.ack], 1);
      connection = c;

      wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
      const s = createServer((_req, res) => {
        res.writeHead(426, { Connection: "close" });
        res.end();
      });
      s.on("connection", (socket: Socket) => {
        rawSockets.add(socket);
        socket.on("close", () => rawSockets.delete(socket));
      });
      s.on("upgrade", onUpgrade);
      server = s;
      await new Promise<void>((resolve) => s.listen(0, LOOPBACK, resolve));
      port = (s.address() as AddressInfo).port;
    },
    async stop() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const ws of sockets) ws.terminate();
      for (const socket of rawSockets) socket.destroy();
      wss?.close();
      const s = server;
      server = null;
      if (s !== null) await new Promise<void>((resolve) => s.close(() => resolve()));
      const c = connection;
      connection = null;
      await c?.end();
    },
    audioUrl: () => "ws" + "://" + LOOPBACK + ":" + String(port),
    audioPort: () => port,
    setAudio(next) {
      audio = next;
    },
    sendCommand,
    async sendRaw(payload) {
      await conn().publish(topics.cmd, payload, 1);
    },
    hellos: () => filter("hello").map((r) => r.message),
    statuses: () => filter("status").map((r) => r.message),
    events: () => filter("event").map((r) => r.message),
    acks: (cmdId) =>
      filter("ack")
        .map((r) => r.message)
        .filter((m) => cmdId === undefined || m.cmd_id === cmdId),
    shapes: () =>
      received.map((r) => {
        switch (r.kind) {
          case "event":
            return "event:" + r.message.event_id;
          case "ack":
            return "ack:" + r.message.cmd_id + ":" + r.message.status;
          case "invalid":
            return "invalid";
          default:
            return r.kind;
        }
      }),
  };
}
