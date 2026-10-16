// The gateway side of Done-when 2–6 in-process (Req 23.2–23.8, 23.10): the fake device on the
// memory broker, loopback `ws` audio and the loopback Operator_Surface, under Vitest fake timers.
// No Docker and no network beyond loopback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENT_KINDS,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  encodeUtteranceFrames,
  type AckResultLogEntry,
  type GatewayLogEntry,
} from "@xelulu/shared";

import { MOCK_LLM_RULES } from "../src/brain/providers/mock-llm.js";
import { mockTtsFrameCount } from "../src/brain/providers/mock-tts.js";
import {
  AGE_SENTENCE_LIMITS,
  AGE_WORD_LIMITS,
  sentenceCount,
  wordCount,
} from "../src/brain/safety/age-shape.js";
import { callOperator } from "../src/operator/transport/http-client.js";
import {
  flush,
  HARNESS_DEVICE_ID,
  startHarness,
  until,
  type Harness,
} from "./support/gateway-harness.js";

let h: Harness;

/** The plain-question utterance of Done-when 1, and the Mock_Llm rule that answers it. */
const E2E_UTTERANCE = "why is the sky blue";
const E2E_RULE = MOCK_LLM_RULES.find(
  (rule) => rule.lang === "en-IN" && rule.match.every((needle) => E2E_UTTERANCE.includes(needle)),
);
const E2E_REPLY = E2E_RULE?.reply ?? "";

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  h = await startHarness({ localMode: true });
  await h.online();
});

afterEach(async () => {
  await h.stop();
  vi.useRealTimers();
});

function ackResults(cmdId: string): AckResultLogEntry[] {
  return h.entries.filter(
    (e): e is AckResultLogEntry => e.kind === "ack_result" && e.cmd_id === cmdId,
  );
}

function count(match: (e: GatewayLogEntry) => boolean): number {
  return h.entries.filter(match).length;
}

async function operatorSend(action: string, data: unknown): Promise<string> {
  const response = await callOperator({
    port: h.gateway.operatorPort() ?? 0,
    method: "POST",
    path: "/v1/commands",
    body: JSON.stringify({ device_id: HARNESS_DEVICE_ID, action, data }),
  });
  expect(response.status).toBe(200);
  const body = JSON.parse(response.body) as { ok: boolean; cmd_id: string };
  expect(body.ok).toBe(true);
  return body.cmd_id;
}

describe("Done-when on the gateway side", () => {
  it("1: a full turn runs end to end through the real mock pipeline", async () => {
    // Its own gateway, because this is the one test that must run the gateway's OWN providers:
    // the Mock_Llm's delay is scheduled on the gateway's Deadlines, so only the gateway can
    // build it. Everything else in this file asserts the stub reply's fixed wire shape.
    const e2e = await startHarness({ localMode: true, realProviders: true });
    try {
      await e2e.online();
      const turnId = "t_full_turn";
      const upload = encodeUtteranceFrames(E2E_UTTERANCE, "en-IN");

      // The utterance travels as Utterance_Frames inside the turn's binary frames: Document B's
      // audio turn has no text field, so there is no shortcut and the device stays a wire peer.
      const opened = await e2e.device.openAudio(e2e.gateway.audioPort());
      expect(opened.kind).toBe("open");
      if (opened.kind !== "open") return;
      const audio = opened.audio;
      audio.sendStart(turnId);
      for (const frame of upload.frames) audio.sendFrame(frame);
      audio.sendEnd(turnId);

      // The upload lands first; then time moves, which is what releases the model's 120 ms delay
      // and then the 20 ms frame chain.
      await until(() => e2e.entries.some((e) => e.kind === "audio_turn" && e.phase === "ended"));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await audio.closed).toBe(1000);

      // Transcribed, with one `brain_turn` entry per phase and no text in any of them.
      const phases = e2e.entries.flatMap((e) =>
        e.kind === "brain_turn" && e.turn_id === turnId ? [e.phase] : [],
      );
      expect(phases).toContain("transcribed");
      expect(phases.at(-1)).toBe("done");

      // The Safety_Layer ran on both sides of the model, and allowed both.
      const decisions = e2e.entries.flatMap((e) =>
        e.kind === "safety_decision" && e.turn_id === turnId ? [[e.stage, e.decision, e.rule]] : [],
      );
      expect(decisions).toEqual([
        ["input", "allow", "none"],
        ["output", "allow", "none"],
      ]);

      // Exactly one `say`, carrying `lang` `en-IN`, acked `accepted` then `done`.
      const saysOut = e2e.entries.filter((e) => e.kind === "message_out" && e.variant === "say");
      expect(saysOut).toHaveLength(1);
      const sayCmdId = saysOut[0]?.kind === "message_out" ? (saysOut[0].cmd_id ?? "") : "";
      const sayCmd = e2e.device.commands.filter((c) => c.action === "say");
      expect(sayCmd).toHaveLength(1);
      expect(sayCmd[0]?.cmd_id).toBe(sayCmdId);
      expect(sayCmd[0]?.data).toMatchObject({ lang: "en-IN", voice: "xelulu" });
      await until(() =>
        e2e.entries.some(
          (e) => e.kind === "ack_result" && e.cmd_id === sayCmdId && e.outcome === "done",
        ),
      );
      expect(
        e2e.entries.flatMap((e) =>
          e.kind === "ack_result" && e.cmd_id === sayCmdId ? [e.outcome] : [],
        ),
      ).toEqual(["accepted", "done"]);

      // The reply's own frames, then its `audio_end`: the Mock_Tts count for that exact text, so
      // the frames the device received are the reply and nothing else (no filler on this path).
      expect(audio.reply.frames).toHaveLength(mockTtsFrameCount(E2E_REPLY));
      expect(audio.reply.controls).toEqual([
        expect.objectContaining({ type: "audio_end", turn_id: turnId }),
      ]);

      // The spoken reply fits the active child's Age_Stage. No child is named in the device's
      // `status`, so the most restrictive context applies: `tiny`, one sentence, eight words.
      const held = e2e.gateway.brain.transcripts.textFor(turnId);
      expect(held.map((t) => [t.speaker, t.text])).toEqual([
        ["child", E2E_UTTERANCE],
        ["xelulu", E2E_REPLY],
      ]);
      expect(sentenceCount(E2E_REPLY)).toBeLessThanOrEqual(AGE_SENTENCE_LIMITS.tiny);
      expect(wordCount(E2E_REPLY)).toBeLessThanOrEqual(AGE_WORD_LIMITS.tiny);
    } finally {
      await e2e.stop();
    }
  });

  it("2: every event type is validated and logged once", async () => {
    const ids: string[] = [];
    for (const zone of TOUCH_ZONES) {
      ids.push(await h.device.event("touch", { data: { zone, gesture: TOUCH_GESTURES[0] } }));
    }
    for (const kind of EVENT_KINDS.filter((k) => k !== "touch"))
      ids.push(await h.device.event(kind));
    await flush();

    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    for (const id of ids) {
      expect(count((e) => e.kind === "message_in" && e.event_id === id)).toBe(1);
      expect(count((e) => e.kind === "event_accepted" && e.event_id === id)).toBe(1);
    }
    expect(h.entries.filter((e) => e.kind === "event_accepted").map((e) => e.event)).toEqual([
      ...TOUCH_ZONES.map(() => "touch"),
      ...EVENT_KINDS.filter((k) => k !== "touch"),
    ]);
    expect(count((e) => e.kind === "message_rejected")).toBe(0);
    expect(count((e) => e.kind === "event_duplicate")).toBe(0);
    expect(count((e) => e.kind === "message_out" && e.variant === "stop_audio")).toBe(0);
    expect(h.gateway.snapshot().devices[0]?.events_accepted).toBe(14);
  });

  it("3: say and animate are acked and matched; a picked_up rejection is final", async () => {
    const say = await operatorSend("say", {
      expression: "happy",
      lang: "en-IN",
      voice: "xelulu",
      duration_hint_ms: 800,
    });
    const animate = await operatorSend("animate", {
      expression: "happy",
      eyes: "open",
      loop: false,
    });
    await until(() => ackResults(say).length === 2 && ackResults(animate).length === 2);
    await vi.advanceTimersByTimeAsync(61_000);

    for (const cmdId of [say, animate]) {
      expect(count((e) => e.kind === "message_out" && e.cmd_id === cmdId)).toBe(1);
      expect(ackResults(cmdId).map((e) => [e.outcome, e.reason])).toEqual([
        ["accepted", ""],
        ["done", ""],
      ]);
    }
    expect(h.device.commands.map((c) => c.cmd_id)).toEqual([say, animate]);

    // Refusal: reject animate only, with picked_up.
    await h.device.hello();
    await flush();
    h.device.setPolicy({ mode: "accept_done", reject: { animate: "picked_up" } });
    const refused = await operatorSend("animate", {
      expression: "sad",
      eyes: "closed",
      loop: true,
    });
    await until(() => ackResults(refused).length === 1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ackResults(refused).map((e) => [e.outcome, e.reason, e.action])).toEqual([
      ["rejected", "picked_up", "animate"],
    ]);
    expect(count((e) => e.kind === "message_out" && e.cmd_id === refused)).toBe(1);
    expect(h.device.commands.filter((c) => c.cmd_id === refused)).toHaveLength(1);
    const state = h.gateway.snapshot().devices[0]?.commands.find((c) => c.cmd_id === refused);
    expect(state).toMatchObject({ state: "rejected", reason: "picked_up", timeout_cause: null });
  });

  it("4: a fake audio turn completes with a say, 50 frames back and audio_end", async () => {
    const audio = await h.device.audioTurn(h.gateway.audioPort(), { turnId: "t_done_when" });
    await until(() =>
      h.entries.some((e) => e.kind === "audio_turn" && e.phase === "reply_started"),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await audio.closed).toBe(1000);
    expect(audio.reply.frames).toHaveLength(50);
    expect(audio.reply.controls).toEqual([
      expect.objectContaining({ type: "audio_end", turn_id: "t_done_when" }),
    ]);

    const turn = h.entries.filter((e) => e.kind === "audio_turn" && e.turn_id === "t_done_when");
    expect(turn.map((e) => (e.kind === "audio_turn" ? e.phase : ""))).toEqual([
      "started",
      "ended",
      "reply_started",
      "reply_ended",
    ]);
    expect(turn[1]).toMatchObject({ frames_in: 50, bytes_in: 2_000 });
    expect(turn[3]).toMatchObject({ frames_out: 50 });

    const sayIndex = h.entries.findIndex((e) => e.kind === "message_out" && e.variant === "say");
    const replyStarted = h.entries.findIndex(
      (e) => e.kind === "audio_turn" && e.phase === "reply_started",
    );
    expect(sayIndex).toBeGreaterThan(-1);
    expect(sayIndex).toBeLessThan(replyStarted);
    const sayOut = h.entries[sayIndex];
    const sayCmd = sayOut?.kind === "message_out" ? (sayOut.cmd_id ?? "") : "";
    await until(() => ackResults(sayCmd).some((e) => e.outcome === "done"));
    expect(ackResults(sayCmd).map((e) => e.outcome)).toEqual(["accepted", "done"]);
  });

  it("5: an event queued offline replays flagged time_uncertain and is not double-counted", async () => {
    const before: string[] = [];
    for (let i = 0; i < 5; i++) before.push(await h.device.event("touch"));
    await flush();
    const counts = h.gateway.snapshot().devices[0];

    // Offline: the robot queues one event with its own (earlier) clock.
    await h.device.disconnect();
    const queuedTs = Math.floor(Date.now() / 1000);
    await vi.advanceTimersByTimeAsync(5_000);

    // Online: hello, replay the queue, then the 5 at-least-once re-publications.
    await h.device.connect();
    await h.device.hello();
    const queued = await h.device.event("wake", { ts: queuedTs, timeUncertain: true });
    for (const id of before) await h.device.event("touch", { eventId: id, timeUncertain: true });
    await flush();

    expect(h.entries.filter((e) => e.kind === "event_accepted" && e.event_id === queued)).toEqual([
      expect.objectContaining({
        time_uncertain: true,
        ordering: "approximate",
        device_ts: queuedTs,
      }),
    ]);
    for (const id of before) {
      expect(count((e) => e.kind === "event_duplicate" && e.event_id === id)).toBe(1);
    }
    const after = h.gateway.snapshot().devices[0];
    expect(after?.events_accepted).toBe((counts?.events_accepted ?? 0) + 1);
    expect(after?.events_duplicate).toBe((counts?.events_duplicate ?? 0) + 5);
  });

  it("6: presence goes offline exactly 45 s after the last Heartbeat and back on hello", async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    await h.device.status();
    await flush();
    const heartbeats = h.entries.filter(
      (e) => e.kind === "message_in" && (e.variant === "status" || e.variant === "hello"),
    );
    const lastAt = Date.parse(heartbeats.at(-1)?.at ?? "");

    // Offline toggle: the robot goes silent.
    await h.device.disconnect();
    await vi.advanceTimersByTimeAsync(lastAt + 44_999 - Date.now());
    expect(count((e) => e.kind === "presence" && e.state === "offline")).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const offline = h.entries.filter((e) => e.kind === "presence" && e.state === "offline");
    expect(offline).toEqual([
      expect.objectContaining({ device_id: HARNESS_DEVICE_ID, cause: "silence" }),
    ]);
    expect(Date.parse(offline[0]?.at ?? "") - lastAt).toBe(45_000);
    expect(h.gateway.snapshot().devices[0]?.presence).toBe("offline");

    // Online toggle: hello, then online with cause hello.
    await vi.advanceTimersByTimeAsync(5_000);
    const mark = h.entries.length;
    await h.device.connect();
    await h.device.hello();
    await flush();
    expect(h.entries.slice(mark).map((e) => e.kind)).toEqual(["message_in", "auth", "presence"]);
    expect(h.entries.at(-1)).toMatchObject({ kind: "presence", state: "online", cause: "hello" });
  });
});
