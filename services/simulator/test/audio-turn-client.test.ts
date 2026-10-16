// Simulator audio turn (Req 18.1–18.9) against the loopback fake gateway, under Vitest fake
// timers: the real `ws` client and a real `ws` server on 127.0.0.1, the memory broker for the
// `say` and `stop_audio` commands, and the Control_Surface routes in-process.
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeUtteranceFrames, parseAudioControlMessage } from "@xelulu/shared";

import { TURN_FRAME_INTERVAL_MS, TURN_UPLOAD_FRAMES } from "../src/audio/audio-turn-client.js";
import { SYNTHETIC_FRAME_BYTES } from "../src/audio/synthetic-frame.js";
import { findTestUtterance } from "../src/audio/test-utterances.js";
import type { SimLogEntry } from "../src/log/logger.js";
import type { AudioOptions, ServerTurn } from "./support/fake-gateway.js";
import {
  flush,
  SIM_TOKEN,
  startSimHarness,
  until,
  type SimHarness,
  type SimHarnessOptions,
} from "./support/sim-harness.js";

const START_MS = 1_760_000_000_000;

let h: SimHarness | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(START_MS);
});

afterEach(async () => {
  await h?.stop();
  h = null;
  vi.useRealTimers();
});

async function harness(opts: SimHarnessOptions = {}): Promise<SimHarness> {
  h = await startSimHarness(opts);
  return h;
}

type LastTurn = {
  turn_id: string | null;
  outcome: string;
  cause: string | null;
  frames_received: number;
  latency_ms: number | null;
};

function lastTurn(s: SimHarness): LastTurn | null {
  return s.state()["last_turn"] as LastTurn | null;
}

function finished(s: SimHarness): boolean {
  const t = lastTurn(s);
  return t !== null && t.outcome !== "in_progress";
}

function turnEntries(s: SimHarness): Extract<SimLogEntry, { kind: "audio_turn" }>[] {
  return s
    .entries()
    .filter((e): e is Extract<SimLogEntry, { kind: "audio_turn" }> => e.kind === "audio_turn");
}

function serverTurn(s: SimHarness): ServerTurn {
  const t = s.gateway.turns[0];
  if (t === undefined) throw new Error("no audio socket reached the fake gateway");
  return t;
}

/** Starts a turn and runs the upload to the own `audio_end` (50 frames over 980 ms). */
async function uploadTurn(s: SimHarness): Promise<string> {
  const answer = s.post("audio-turn", {});
  expect(answer.status).toBe(200);
  const turnId = answer.body["turn_id"] as string;
  await until(() => s.trace.length > 0);
  await vi.advanceTimersByTimeAsync(980);
  await until(() => s.gateway.turns[0]?.ended === true);
  return turnId;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The byte length of every frame the simulator uploaded, in order (never the bytes). */
function uploadedLengths(s: SimHarness): number[] {
  return s.trace.flatMap((x) => (x.op === "frame" ? [x.byteLength] : []));
}

describe("a complete turn", () => {
  it("sends Bearer, audio_start, 50 frames at 20 ms and audio_end, then reports complete", async () => {
    const s = await harness({ audio: { replyDelayMs: 120 } });
    const t0 = Date.now();
    const turnId = await uploadTurn(s);
    expect(lastTurn(s)).toMatchObject({ turn_id: turnId, outcome: "in_progress" });
    await vi.advanceTimersByTimeAsync(120);
    await until(() => finished(s));

    // The upgrade carried the device token as a Bearer header.
    expect(s.gateway.upgrades).toEqual([{ authorization: "Bearer " + SIM_TOKEN, ok: true }]);

    // What the simulator sent, in order, on its own clock.
    const texts = s.trace.filter((x) => x.op === "text");
    const frames = s.trace.filter((x) => x.op === "frame");
    expect(s.trace[0]).toMatchObject({ op: "text", at: t0 });
    expect(frames.map((f) => f.at)).toEqual(Array.from({ length: 50 }, (_, i) => t0 + 20 * i));
    expect(frames.every((f) => f.op === "frame" && f.byteLength === SYNTHETIC_FRAME_BYTES)).toBe(
      true,
    );
    expect(texts.map((x) => (x.op === "text" ? parseAudioControlMessage(x.text) : null))).toEqual([
      {
        ok: true,
        value: { proto_ver: 2, ts: Math.floor(t0 / 1000), type: "audio_start", turn_id: turnId },
      },
      {
        ok: true,
        value: {
          proto_ver: 2,
          ts: Math.floor((t0 + 980) / 1000),
          type: "audio_end",
          turn_id: turnId,
        },
      },
    ]);
    expect(texts[1]?.at).toBe(t0 + 980);
    const order = s.trace.map((x) => x.op);
    expect(order.indexOf("close")).toBeGreaterThan(order.lastIndexOf("frame"));

    // What the fake gateway received.
    const st = serverTurn(s);
    expect(st.frameTimes).toHaveLength(50);
    expect(st.controls.map((c) => c?.type)).toEqual(["audio_start", "audio_end"]);

    expect(lastTurn(s)).toEqual({
      turn_id: turnId,
      outcome: "complete",
      cause: null,
      frames_received: 50,
      latency_ms: 120,
    });
    expect(turnEntries(s).map((e) => [e.phase, e.cause, e.frames_out, e.frames_in])).toEqual([
      ["started", null, 0, 0],
      ["complete", null, 50, 50],
    ]);
    expect(turnEntries(s)[1]?.latency_ms).toBe(120);
  });

  it("uploads a named Test_Utterance's frames in place of the synthetic ones (Req 19.2)", async () => {
    const s = await harness({ audio: { replyDelayMs: 120 } });
    const t0 = Date.now();
    const utterance = findTestUtterance("story");
    if (utterance === null) throw new Error("the story Test_Utterance is missing");
    const expected = encodeUtteranceFrames(utterance.text, utterance.lang).frames;
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(TURN_UPLOAD_FRAMES);

    const answer = s.post("audio-turn", { utterance: "story" });
    expect(answer.status).toBe(200);
    const turnId = answer.body["turn_id"] as string;
    await until(() => s.trace.length > 0);
    await vi.advanceTimersByTimeAsync(TURN_FRAME_INTERVAL_MS * (expected.length - 1));
    await until(() => s.gateway.turns[0]?.ended === true);

    // Exactly this utterance's frames, on the same 20 ms cadence, and no Synthetic_Frame.
    expect(uploadedLengths(s)).toEqual(expected.map((f) => f.byteLength));
    expect(uploadedLengths(s)).not.toContain(SYNTHETIC_FRAME_BYTES);
    const frames = s.trace.filter((x) => x.op === "frame");
    expect(frames.map((f) => f.at)).toEqual(
      Array.from({ length: expected.length }, (_, i) => t0 + TURN_FRAME_INTERVAL_MS * i),
    );
    const st = serverTurn(s);
    expect(st.frameTimes).toHaveLength(expected.length);
    expect(st.controls.map((c) => c?.type)).toEqual(["audio_start", "audio_end"]);

    // The outcome, the reply frame count and the first-frame latency are unchanged (Req 19.7).
    await vi.advanceTimersByTimeAsync(120);
    await until(() => finished(s));
    expect(lastTurn(s)).toEqual({
      turn_id: turnId,
      outcome: "complete",
      cause: null,
      frames_received: 50,
      latency_ms: 120,
    });
    expect(turnEntries(s).map((e) => [e.phase, e.frames_out, e.frames_in])).toEqual([
      ["started", 0, 0],
      ["complete", expected.length, 50],
    ]);
    // No utterance text and no frame byte reaches a log entry (Req 19.8).
    expect(s.sink.text()).not.toContain(utterance.text);
  });

  it("uploads the 50 Synthetic_Frames when no utterance is named (Req 19.3)", async () => {
    const s = await harness({ audio: { replyDelayMs: 20 } });
    await uploadTurn(s);
    expect(uploadedLengths(s)).toEqual(
      Array.from({ length: TURN_UPLOAD_FRAMES }, () => SYNTHETIC_FRAME_BYTES),
    );
    await vi.advanceTimersByTimeAsync(20);
    await until(() => finished(s));
    expect(lastTurn(s)).toMatchObject({ outcome: "complete", frames_received: 50 });
  });

  it("answers a say received during the turn with accepted now and done on the reply audio_end", async () => {
    const s = await harness({ audio: { sayOnTurn: true, replyDelayMs: 50 } });
    await uploadTurn(s);
    const sayId = serverTurn(s).sayCmdId ?? "";
    await until(() => s.gateway.acks(sayId).length === 1);
    expect(s.gateway.acks(sayId).map((a) => a.status)).toEqual(["accepted"]);
    await vi.advanceTimersByTimeAsync(50);
    await until(() => finished(s) && s.gateway.acks(sayId).length === 2);
    expect(lastTurn(s)?.outcome).toBe("complete");
    expect(s.gateway.acks(sayId).map((a) => [a.status, a.reason])).toEqual([
      ["accepted", ""],
      ["done", ""],
    ]);
  });

  it("counts no reply frame after a stop_audio, then answers the stop_audio", async () => {
    const s = await harness({ audio: { reply: "manual" } });
    await uploadTurn(s);
    const st = serverTurn(s);
    st.sendFrames(10);
    await until(() => lastTurn(s)?.frames_received === 10);
    const stopId = await s.gateway.sendCommand("stop_audio", {});
    await until(() => s.gateway.acks(stopId).length === 2);
    expect(s.gateway.acks(stopId).map((a) => a.status)).toEqual(["accepted", "done"]);
    st.sendFrames(40);
    st.sendAudioEnd();
    await until(() => finished(s));
    expect(lastTurn(s)).toMatchObject({ outcome: "complete", frames_received: 10 });
  });

  it("reports interrupted when an interrupt is fired while reply frames arrive", async () => {
    const s = await harness({ audio: { reply: "manual" } });
    const turnId = await uploadTurn(s);
    const st = serverTurn(s);
    st.sendFrames(10);
    await until(() => lastTurn(s)?.frames_received === 10);
    const fired = s.post("events", { event: "interrupt" });
    expect(fired.status).toBe(200);
    await until(() => s.gateway.events().some((e) => e.event === "interrupt"));
    expect(st.closeCode).toBeNull();
    st.sendFrames(40);
    st.sendAudioEnd();
    await until(() => finished(s));
    expect(lastTurn(s)).toEqual({
      turn_id: turnId,
      outcome: "interrupted",
      cause: null,
      frames_received: 50,
      latency_ms: 0,
    });
  });
});

describe("failed turns", () => {
  const cases: [string, AudioOptions, string][] = [
    ["a refused upgrade", { refuseUpgrade: true }, "upgrade_refused"],
    ["a socket closed early", { closeEarly: true }, "socket_closed"],
    ["an invalid text", { reply: "invalid_text" }, "invalid_message"],
    ["another turn_id", { reply: "other_turn_id" }, "turn_id_mismatch"],
  ];

  it.each(cases)("%s fails the turn with its cause", async (_name, audio, cause) => {
    const s = await harness({ audio });
    const answer = s.post("audio-turn", {});
    expect(answer.status).toBe(200);
    await until(() => s.gateway.upgrades.length === 1);
    await vi.advanceTimersByTimeAsync(980);
    await until(() => finished(s));
    expect(lastTurn(s)).toMatchObject({ outcome: "failed", cause });
    expect(turnEntries(s).at(-1)).toMatchObject({ phase: "failed", cause });

    // Frames stop and the socket is closed if it was open.
    const sent = s.trace.length;
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(s.trace.length).toBe(sent);
    expect(s.trace.filter((x) => x.op === "frame").length).toBeLessThanOrEqual(50);
    const st = s.gateway.turns[0];
    if (st !== undefined) await st.closed;
    if (cause === "invalid_message") {
      expect(s.entries().some((e) => e.kind === "message_rejected" && e.transport === "ws")).toBe(
        true,
      );
    }
    if (cause === "upgrade_refused") expect(s.trace).toEqual([]);
    if (cause === "socket_closed") {
      expect(s.trace.some((x) => x.op === "text" && x.text.includes("audio_end"))).toBe(false);
    }
  });

  it("a socket that cannot be opened fails with connect_failed", async () => {
    const port = await freePort();
    const s = await harness({ audioUrlOverride: "ws" + "://" + "127.0.0.1:" + String(port) });
    expect(s.post("audio-turn", {}).status).toBe(200);
    await until(() => finished(s));
    expect(lastTurn(s)).toMatchObject({ outcome: "failed", cause: "connect_failed" });
    expect(s.trace).toEqual([]);
  });

  it("no reply audio_end 10,000 ms after the own audio_end fails with reply_timeout and a waiting say fails", async () => {
    const s = await harness({ audio: { reply: "none", sayOnTurn: true } });
    await uploadTurn(s);
    const sayId = serverTurn(s).sayCmdId ?? "";
    await until(() => s.gateway.acks(sayId).length === 1);
    await vi.advanceTimersByTimeAsync(9_999);
    await flush();
    expect(lastTurn(s)?.outcome).toBe("in_progress");
    await vi.advanceTimersByTimeAsync(1);
    await until(() => finished(s));
    expect(lastTurn(s)).toMatchObject({ outcome: "failed", cause: "reply_timeout" });
    await serverTurn(s).closed;
    await until(() => s.gateway.acks(sayId).length === 2);
    expect(s.gateway.acks(sayId).map((a) => [a.status, a.reason])).toEqual([
      ["accepted", ""],
      ["failed", ""],
    ]);
  });

  it("an offline toggle during the upload fails with toggled_offline and stops the frames", async () => {
    const s = await harness();
    expect(s.post("audio-turn", {}).status).toBe(200);
    await until(() => s.trace.length > 0);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.post("connection", { online: false }).body).toEqual({ ok: true, online: false });
    expect(lastTurn(s)).toMatchObject({ outcome: "failed", cause: "toggled_offline" });
    const frames = s.trace.filter((x) => x.op === "frame").length;
    expect(frames).toBe(11);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.trace.filter((x) => x.op === "frame").length).toBe(frames);
    expect(await serverTurn(s).closed).toBe(1000);
  });
});

describe("refused requests", () => {
  it("refuses a turn while offline and opens nothing", async () => {
    const s = await harness();
    s.post("connection", { online: false });
    const answer = s.post("audio-turn", {});
    expect(answer).toEqual({ status: 409, body: { ok: false, error: { code: "offline" } } });
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(s.gateway.upgrades).toEqual([]);
    expect(lastTurn(s)).toBeNull();
  });

  it("refuses a second turn while one is in progress and leaves it unchanged", async () => {
    const s = await harness({ audio: { replyDelayMs: 100 } });
    const first = s.post("audio-turn", {});
    await until(() => s.trace.length > 0);
    const before = lastTurn(s);
    const second = s.post("audio-turn", {});
    expect(second).toEqual({
      status: 409,
      body: { ok: false, error: { code: "turn_in_progress" } },
    });
    expect(lastTurn(s)).toEqual(before);
    await vi.advanceTimersByTimeAsync(980);
    await until(() => s.gateway.turns[0]?.ended === true);
    await vi.advanceTimersByTimeAsync(100);
    await until(() => finished(s));
    expect(lastTurn(s)).toMatchObject({ turn_id: first.body["turn_id"], outcome: "complete" });
    expect(s.gateway.upgrades).toHaveLength(1);
  });
});
