// Turn_Latency (Req 12, C16): the time from the device's `audio_end` to the first frame the
// Gateway sends. That is the interval product.md's target names, and it is measured on the Clock,
// so this test advances time rather than waiting.
//
// The budgets hold against the MOCK providers only. They say nothing about a real vendor's
// latency, and the gap to ElatoAI's 2–3 s baseline is not closed by this phase — the spec says so
// rather than letting a green test imply otherwise.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FILLER_DEADLINE_MS,
  TYPICAL_BUDGET_MS,
  WORST_BUDGET_MS,
  startTurnLatency,
} from "../src/brain/turn-latency.js";
import { createTestClock } from "./support/test-clock.js";
import {
  advanceTo,
  brainHarness,
  createFakeTarget,
  fillerOf,
  runTurn,
} from "./support/brain-harness.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";

let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

describe("the measurement itself", () => {
  it("counts from audio_end to the first frame, and only the first", () => {
    const clock = createTestClock(1_000);
    const latency = startTurnLatency(clock);
    expect(latency.firstFrameMs()).toBeNull();

    clock.set(1_420);
    latency.markFirstFrame();
    expect(latency.firstFrameMs()).toBe(420);

    // A later frame does not move the measurement: there is one first frame.
    clock.set(2_000);
    latency.markFirstFrame();
    expect(latency.firstFrameMs()).toBe(420);
    expect(latency.sinceAudioEnd()).toBe(1_000);
  });

  it("puts the filler deadline inside the typical budget", () => {
    expect(FILLER_DEADLINE_MS).toBeLessThan(TYPICAL_BUDGET_MS);
    expect(TYPICAL_BUDGET_MS).toBeLessThan(WORST_BUDGET_MS);
    expect(TYPICAL_BUDGET_MS).toBe(1_000);
    expect(WORST_BUDGET_MS).toBe(1_600);
  });
});

describe("the budgets with the mock providers", () => {
  it("speaks within the typical budget when the model answers at once", async () => {
    const h = brainHarness({ llmDelayMs: 0 });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    const view = h.views.at(-1);
    expect(view?.latency_ms).not.toBeNull();
    expect(view?.latency_ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(TYPICAL_BUDGET_MS);
    expect(target.frames.length).toBeGreaterThan(0);
  });

  it.each([100, 300, 599])(
    "stays inside the typical budget for a %i ms model delay",
    async (delay) => {
      const h = brainHarness({ llmDelayMs: delay });
      const target = createFakeTarget(h);
      await runTurn(h, target, 200);
      const latency = h.views.at(-1)?.latency_ms ?? Number.POSITIVE_INFINITY;
      expect(latency).toBeLessThanOrEqual(TYPICAL_BUDGET_MS);
    },
  );

  it("still begins speaking inside the worst case on the slow path, via the filler", async () => {
    // The model takes 1.2 s: past the typical budget, so the Filler is what keeps the first
    // audio inside the worst case. That is exactly what it exists for.
    const h = brainHarness({ llmDelayMs: 1_200, filler: fillerOf(100) });
    const target = createFakeTarget(h);
    await runTurn(h, target, 300);

    const latency = h.views.at(-1)?.latency_ms ?? Number.POSITIVE_INFINITY;
    expect(latency).toBeLessThanOrEqual(WORST_BUDGET_MS);
    // And it was the filler that got there first.
    expect(h.views.at(-1)?.filler_spoken).toBe(true);
    expect(latency).toBeLessThanOrEqual(FILLER_DEADLINE_MS + 20);
  });

  it("records the measurement on the turn's done entry", async () => {
    const h = brainHarness({ llmDelayMs: 0 });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    const done = h
      .entries()
      .filter((e) => e.kind === "brain_turn")
      .find((e) => e.phase === "done");
    expect(done).toBeDefined();
    expect(done?.since_audio_end_ms).not.toBeNull();
    expect(done?.frames_out).toBeGreaterThan(0);
  });

  it("measures nothing when the turn stops before a frame", async () => {
    const h = brainHarness({ llmDelayMs: 5_000 });
    const target = createFakeTarget(h);
    const t0 = h.clock.now();
    h.brain.respond(target);
    target.stop();
    await advanceTo(h, t0 + 1_000);

    expect(target.frames).toHaveLength(0);
    expect(h.views.at(-1)?.latency_ms).toBeNull();
  });
});
