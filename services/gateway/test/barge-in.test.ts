// Barge-in (Req 11.1–11.6). Through the composed gateway under fake timers (memory broker, real
// loopback `ws`): a new `interrupt` during the reply stops the frames, sends `audio_end`, closes
// 1000, then publishes `stop_audio`; duplicates, interrupts while uploading and after the reply
// change nothing; a refused `stop_audio` is not retried. The broker_disconnected refusal cannot
// reach the gateway over MQTT (no message arrives while disconnected), so it is driven on the
// real audio server and command sender cores with a manual clock.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROTO_VER,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  type AudioTurnLogEntry,
  type GatewayLogEntry,
} from "@xelulu/shared";

import { createAudioServer } from "../src/audio/audio-server.js";
import type { AudioInbound, AudioSocket } from "../src/audio/audio-transport.js";
import { createStubResponder } from "./support/stub-responder.js";
import { createDeadlines } from "../src/deadlines.js";
import { createPresence } from "../src/devices/presence.js";
import { createRegistry } from "../src/devices/registry.js";
import { randomIds } from "../src/ids.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import { createAckTracker } from "../src/mqtt/ack-tracker.js";
import { createCommandSender } from "../src/mqtt/command-sender.js";
import { createCaptureSink } from "./support/capture-sink.js";
import type { FakeAudio } from "./support/fake-device.js";
import { flush, startHarness, until, type Harness } from "./support/gateway-harness.js";
import { createTestClock } from "./support/test-clock.js";

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  vi.useRealTimers();
});

async function harness(): Promise<Harness> {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  const h = await startHarness();
  running.push(h);
  return h;
}

function turnEntries(h: Harness): AudioTurnLogEntry[] {
  return h.entries.filter((e): e is AudioTurnLogEntry => e.kind === "audio_turn");
}

function stopAudioPublishes(h: Harness): number {
  return h.trace.filter((t) => t.op === "publish" && t.payload.includes('"stop_audio"')).length;
}

function messageOut(h: Harness, variant: string): GatewayLogEntry[] {
  return h.entries.filter((e) => e.kind === "message_out" && e.variant === variant);
}

/** Uploads a 3-frame turn on a new socket and waits until the reply has started. */
async function replying(h: Harness, turnId: string): Promise<FakeAudio> {
  const result = await h.device.openAudio(h.gateway.audioPort());
  if (result.kind !== "open") throw new Error("audio upgrade refused");
  result.audio.sendStart(turnId);
  for (let i = 0; i < 3; i++) result.audio.sendFrame();
  result.audio.sendEnd(turnId);
  await until(() => turnEntries(h).some((e) => e.turn_id === turnId && e.phase !== "started"));
  return result.audio;
}

describe("barge-in through the gateway", () => {
  it("stops the reply, sends audio_end, closes 1000, then publishes stop_audio", async () => {
    const h = await harness();
    await h.online();
    const audio = await replying(h, "t_barge");
    await vi.advanceTimersByTimeAsync(100);
    const sentBefore = h.framesOn(1).length;
    expect(sentBefore).toBe(6);

    const eventId = await h.device.event("interrupt");
    await flush();
    const accepted = h.entries.find((e) => e.kind === "event_accepted" && e.event_id === eventId);
    const acceptedAt = Date.parse(accepted?.at ?? "");
    expect(await audio.closed).toBe(1000);
    await vi.advanceTimersByTimeAsync(2_000);

    // No frame more than 100 ms after the interrupt was accepted, and none after audio_end.
    const frames = h.framesOn(1);
    expect(frames).toHaveLength(sentBefore);
    for (const f of frames) expect(f.at).toBeLessThanOrEqual(acceptedAt + 100);
    const ops = h.trace.map((t) =>
      t.op === "publish" ? (t.payload.includes('"stop_audio"') ? "stop_audio" : "publish") : t.op,
    );
    const end = ops.indexOf("text");
    expect(ops.lastIndexOf("frame")).toBeLessThan(end);
    expect(ops[end + 1]).toBe("close");
    expect(end).toBeLessThan(ops.indexOf("stop_audio"));
    expect(ops.filter((o) => o === "text")).toHaveLength(1);
    expect(h.trace.find((t) => t.op === "close")).toMatchObject({ code: 1000 });

    // The device sees audio_end for the turn, then the stop_audio command.
    expect(audio.reply.controls).toEqual([
      expect.objectContaining({ type: "audio_end", turn_id: "t_barge" }),
    ]);
    await until(() => h.device.commands.some((c) => c.action === "stop_audio"));
    expect(h.device.commands.map((c) => c.action)).toEqual(["say", "stop_audio"]);
    expect(h.device.commands[1]?.data).toEqual({});

    expect(turnEntries(h).map((e) => [e.phase, e.frames_out, e.cause])).toEqual([
      ["started", 0, null],
      ["ended", 0, null],
      ["reply_started", 0, null],
      ["interrupted", sentBefore, null],
    ]);
    expect(messageOut(h, "audio_end")).toHaveLength(1);
    expect(messageOut(h, "stop_audio")).toHaveLength(1);
  });

  it("ignores a duplicate interrupt during a later reply", async () => {
    const h = await harness();
    await h.online();
    const first = await replying(h, "t_first");
    const eventId = await h.device.event("interrupt");
    await flush();
    await first.closed;

    const second = await replying(h, "t_second");
    const mark = h.entries.length;
    await h.device.event("interrupt", { eventId });
    await flush();
    expect(h.entries.slice(mark).map((e) => e.kind)).toEqual(["message_in", "event_duplicate"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await second.closed).toBe(1000);
    expect(h.framesOn(2)).toHaveLength(50);
    expect(
      turnEntries(h)
        .filter((e) => e.turn_id === "t_second")
        .map((e) => e.phase),
    ).toEqual(["started", "ended", "reply_started", "reply_ended"]);
    expect(stopAudioPublishes(h)).toBe(1);
  });

  it("ignores an interrupt while the turn is still uploading", async () => {
    const h = await harness();
    await h.online();
    const result = await h.device.openAudio(h.gateway.audioPort());
    if (result.kind !== "open") throw new Error("audio upgrade refused");
    const audio = result.audio;
    audio.sendStart("t_upload");
    audio.sendFrame();
    await until(() => turnEntries(h).some((e) => e.phase === "started"));

    await h.device.event("interrupt");
    await flush();
    expect(h.trace).toEqual([]);
    expect(stopAudioPublishes(h)).toBe(0);

    audio.sendFrame();
    audio.sendEnd("t_upload");
    await until(() => turnEntries(h).some((e) => e.phase === "reply_started"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await audio.closed).toBe(1000);
    expect(turnEntries(h).at(-1)).toMatchObject({ phase: "reply_ended", frames_in: 2 });
    expect(stopAudioPublishes(h)).toBe(0);
  });

  it("ignores an interrupt after the reply's audio_end", async () => {
    const h = await harness();
    await h.online();
    const audio = await replying(h, "t_done");
    await vi.advanceTimersByTimeAsync(1_000);
    await audio.closed;
    const traced = h.trace.length;

    await h.device.event("interrupt");
    await flush();
    expect(h.trace).toHaveLength(traced);
    expect(stopAudioPublishes(h)).toBe(0);
    expect(turnEntries(h).some((e) => e.phase === "interrupted")).toBe(false);
  });

  it("does not retry a stop_audio refused as device_offline", async () => {
    const h = await harness();
    await h.online();
    const helloAt = Date.now();
    await vi.advanceTimersByTimeAsync(44_500);
    const audio = await replying(h, "t_offline");
    await vi.advanceTimersByTimeAsync(helloAt + 45_100 - Date.now());
    expect(h.entries).toContainEqual(
      expect.objectContaining({ kind: "presence", state: "offline", cause: "silence" }),
    );
    const sent = h.framesOn(1).length;
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(50);

    await h.device.event("interrupt");
    await flush();
    expect(await audio.closed).toBe(1000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(audio.reply.controls).toEqual([
      expect.objectContaining({ type: "audio_end", turn_id: "t_offline" }),
    ]);
    expect(turnEntries(h).at(-1)).toMatchObject({
      phase: "interrupted",
      frames_out: sent,
      cause: "device_offline",
    });
    expect(stopAudioPublishes(h)).toBe(0);
    expect(messageOut(h, "stop_audio")).toEqual([]);
  });
});

describe("barge-in on the audio server core", () => {
  it("does not retry a stop_audio refused as broker_disconnected", () => {
    const DEVICE = "xlu_000123";
    const clock = createTestClock(1_760_000_000_000);
    const deadlines = createDeadlines(clock);
    const log = createGatewayLog(clock, createCaptureSink());
    const entries: GatewayLogEntry[] = [];
    log.subscribe((e) => entries.push(e));
    const registry = createRegistry({ deviceId: DEVICE, token: "core-token-0123456789" });
    const presence = createPresence({ deadlines, onSilence: (c) => log.add(c) });
    presence.heartbeat(DEVICE, clock.now(), "hello");
    const tracker = createAckTracker({ deadlines, log });
    let connected = true;
    const published: string[] = [];
    const sender = createCommandSender({
      registry,
      presence,
      broker: { connected: () => connected, publishCmd: (_d, payload) => published.push(payload) },
      ids: randomIds,
      tracker,
      clock,
      log,
    });
    const responder = createStubResponder({ clock, deadlines, sendCommand: sender.sendCommand });
    const server = createAudioServer({
      clock,
      deadlines,
      log,
      responder,
      openStt: responder.openStt,
      sendCommand: sender.sendCommand,
    });

    const sent: string[] = [];
    let inbound: ((m: AudioInbound) => void) | null = null;
    const socket: AudioSocket = {
      sendText: (text) => sent.push(`text:${text}`),
      sendBinary: () => sent.push("frame"),
      close: (code) => sent.push(`close:${code}`),
      onInbound: (fn) => {
        inbound = fn;
      },
    };
    server.openTurn(DEVICE, socket);
    const deliver = (text: string): void =>
      inbound?.({ kind: "text", text, byteLength: Buffer.byteLength(text) });
    const marker = { proto_ver: PROTO_VER, ts: 1_760_000_000, turn_id: "t_core" } as const;
    deliver(serialiseAudioStartMessage({ ...marker, type: "audio_start" }));
    deliver(serialiseAudioEndMessage({ ...marker, type: "audio_end" }));
    clock.advance(40);
    deadlines.fireDue(clock.now());
    expect(sent).toEqual(["frame", "frame", "frame"]);
    expect(published).toHaveLength(1);

    connected = false;
    server.bargeIn(DEVICE);
    clock.advance(5_000);
    deadlines.fireDue(clock.now());

    expect(sent.slice(3, 4)[0]).toMatch(/^text:/);
    expect(sent.slice(3)).toEqual([sent[3], "close:1000"]);
    expect(published).toHaveLength(1);
    const last = entries.filter((e): e is AudioTurnLogEntry => e.kind === "audio_turn").at(-1);
    expect(last).toMatchObject({
      phase: "interrupted",
      frames_out: 3,
      cause: "broker_disconnected",
    });
    expect(entries.some((e) => e.kind === "message_out" && e.variant === "stop_audio")).toBe(false);
    expect(server.turnStage(DEVICE)).toBeNull();
  });
});
