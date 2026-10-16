// The simulator side of Done-when 2–6 in-process (Req 23.2–23.8, 23.10): the fake gateway on the
// memory broker and its loopback `ws` audio server, the Control_Surface routes in-process, under
// Vitest fake timers. No Docker and no network beyond loopback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENT_KINDS, TOUCH_ZONES, parseEventMessage } from "@xelulu/shared";

import { flush, startSimHarness, until, type SimHarness } from "./support/sim-harness.js";

const START_MS = 1_760_000_000_000;
const ANIMATE_DATA = Object.freeze({ expression: "happy", eyes: "open", loop: false });
const SAY = Object.freeze({
  expression: "happy",
  lang: "en-IN",
  voice: "xelulu",
  duration_hint_ms: 800,
});

let h: SimHarness;

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(START_MS);
  h = await startSimHarness({ audio: { sayOnTurn: true, replyDelayMs: 40 } });
});

afterEach(async () => {
  await h.stop();
  vi.useRealTimers();
});

function fire(event: string, data?: unknown): string {
  const answer = h.post("events", data === undefined ? { event } : { event, data });
  expect(answer.status).toBe(200);
  return answer.body["event_id"] as string;
}

function ackPairs(cmdId: string): [string, string][] {
  return h.gateway.acks(cmdId).map((a) => [a.status, a.reason]);
}

describe("Done-when on the simulator side", () => {
  it("2: 14 Control_Surface requests publish 14 valid events with distinct ids", async () => {
    const ids: string[] = [];
    for (const zone of TOUCH_ZONES) ids.push(fire("touch", { zone }));
    for (const kind of EVENT_KINDS.filter((k) => k !== "touch")) ids.push(fire(kind));
    await until(() => h.gateway.events().length === 14);

    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    expect(h.gateway.received.filter((r) => r.kind === "invalid")).toEqual([]);
    const events = h.gateway.events();
    expect(events.map((e) => e.event_id)).toEqual(ids);
    expect(events.map((e) => e.event)).toEqual([
      ...TOUCH_ZONES.map(() => "touch"),
      ...EVENT_KINDS.filter((k) => k !== "touch"),
    ]);
    expect(events.slice(0, 7).map((e) => (e.event === "touch" ? e.data.zone : null))).toEqual([
      ...TOUCH_ZONES,
    ]);
    for (const e of events) expect(Object.hasOwn(e, "time_uncertain")).toBe(false);
    // Every publication is a contract event at QoS 1, not retained.
    const published = h.published().filter((p) => parseEventMessage(p.payload).ok);
    expect(published).toHaveLength(14);
    expect(published.every((p) => p.qos === 1 && p.retain === false)).toBe(true);
  });

  it("3: the default plan acks accepted then done; reject picked_up for animate only gives one rejected", async () => {
    const say = await h.gateway.sendCommand("say", SAY);
    const animate = await h.gateway.sendCommand("animate", ANIMATE_DATA);
    await until(() => h.gateway.acks(say).length === 2 && h.gateway.acks(animate).length === 2);
    for (const cmdId of [say, animate]) {
      expect(ackPairs(cmdId)).toEqual([
        ["accepted", ""],
        ["done", ""],
      ]);
    }

    const set = h.post("ack-policy", {
      scope: "animate",
      override: { mode: "reject", reason: "picked_up" },
    });
    expect(set.status).toBe(200);
    const refused = await h.gateway.sendCommand("animate", ANIMATE_DATA);
    const other = await h.gateway.sendCommand("say", SAY);
    await until(() => h.gateway.acks(refused).length === 1 && h.gateway.acks(other).length === 2);
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(ackPairs(refused)).toEqual([["rejected", "picked_up"]]);
    expect(ackPairs(other)).toEqual([
      ["accepted", ""],
      ["done", ""],
    ]);

    const listed = (h.state()["received_commands"] as { cmd_id: string }[]).map((c) => c.cmd_id);
    expect(listed).toEqual([say, animate, refused, other]);
  });

  it("4: an audio turn against the fake gateway completes with 50 frames and a latency", async () => {
    const answer = h.post("audio-turn", {});
    expect(answer.status).toBe(200);
    const turnId = answer.body["turn_id"] as string;
    await until(() => h.trace.length > 0);
    await vi.advanceTimersByTimeAsync(980);
    await until(() => h.gateway.turns[0]?.ended === true);
    await vi.advanceTimersByTimeAsync(40);
    await until(() => {
      const last = h.sim.state().last_turn;
      return last !== null && last.outcome !== "in_progress";
    });

    expect(h.gateway.turns[0]?.frameTimes).toHaveLength(50);
    expect(h.state()["last_turn"]).toEqual({
      turn_id: turnId,
      outcome: "complete",
      cause: null,
      frames_received: 50,
      latency_ms: 40,
    });
    // The say sent for the turn is done once the reply audio_end has arrived.
    const sayId = h.gateway.turns[0]?.sayCmdId ?? "";
    await until(() => h.gateway.acks(sayId).length === 2);
    expect(ackPairs(sayId)).toEqual([
      ["accepted", ""],
      ["done", ""],
    ]);
  });

  it("5: offline, one queued event, online: hello, replay, 5 re-publications, then status", async () => {
    const before: string[] = [];
    for (let i = 0; i < 5; i++) before.push(fire("touch"));
    await until(() => h.gateway.events().length === 5);
    await flush();
    const originals = h.gateway.events();

    expect(h.post("duplicate-replay", { enabled: true }).status).toBe(200);
    expect(h.post("connection", { online: false }).body).toEqual({ ok: true, online: false });
    await vi.advanceTimersByTimeAsync(5_000);
    const queuedAnswer = h.post("events", { event: "wake" });
    expect(queuedAnswer.body).toMatchObject({ ok: true, queued: true });
    const queued = queuedAnswer.body["event_id"] as string;
    const queuedTs = queuedAnswer.body["ts"] as number;
    await vi.advanceTimersByTimeAsync(5_000);

    const mark = h.gateway.received.length;
    expect(h.post("connection", { online: true }).body).toEqual({ ok: true, online: true });
    await until(() => h.gateway.received.slice(mark).some((r) => r.kind === "status"));

    expect(h.gateway.shapes().slice(mark)).toEqual([
      "hello",
      "event:" + queued,
      ...before.map((id) => "event:" + id),
      "status",
    ]);
    const after = h.gateway.events().slice(5);
    expect(after[0]).toMatchObject({
      event_id: queued,
      event: "wake",
      ts: queuedTs,
      time_uncertain: true,
    });
    expect(after.slice(1)).toEqual(originals.map((e) => ({ ...e, time_uncertain: true })));
    expect(h.state()["queue_length"]).toBe(0);
  });

  it("6: the offline toggle stops all publishing and the online toggle sends hello", async () => {
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    const statuses = h.gateway.statuses().length;
    expect(statuses).toBeGreaterThanOrEqual(2);

    expect(h.post("connection", { online: false }).body).toEqual({ ok: true, online: false });
    const published = h.published().length;
    const received = h.gateway.received.length;
    expect(fire("touch")).toMatch(/^ev_/);
    const ack = await h.gateway.sendCommand("animate", ANIMATE_DATA).catch(() => null);
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(h.published()).toHaveLength(published);
    expect(h.gateway.received).toHaveLength(received);
    expect(ack === null ? [] : h.gateway.acks(ack)).toEqual([]);
    expect(h.sim.connected()).toBe(false);

    expect(h.post("connection", { online: true }).body).toEqual({ ok: true, online: true });
    await until(() => h.gateway.received.length > received);
    expect(h.gateway.shapes()[received]).toBe("hello");
    await until(() => h.gateway.received.slice(received).some((r) => r.kind === "status"));
  });
});
