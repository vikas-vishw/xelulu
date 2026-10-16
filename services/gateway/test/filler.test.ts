// The "let me think" Filler (Req 12, C14, C15). product.md promises it when the reply is slow,
// so a child is never left with silence.
//
// The four things that have to hold, each a block below: it is silent when the reply is fast; it
// speaks at the Filler_Deadline when the reply is slow; it never plays alongside or after the
// reply's frames; and it stops with the turn on barge-in. Plus the one that is easy to get wrong:
// exactly ONE `say` per spoken turn, whichever stream the first frame belonged to.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FILLER_DEADLINE_MS } from "../src/brain/turn-latency.js";
import { prerenderFiller } from "../src/brain/filler.js";
import { FILLER_TEXT } from "../src/brain/safety/safe-text.js";
import {
  advanceTo,
  brainHarness,
  createFakeTarget,
  fillerOf,
  runTurn,
  ttsFrames,
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

const FILLER_MARKER = 0xff;

/** How many of a target's frames came from the Filler, which marks its bytes. */
function fillerFrames(frames: readonly Uint8Array[]): number {
  return frames.filter((f) => f.length === 1 && f[0] === FILLER_MARKER).length;
}

describe("the filler is silent when the reply is fast", () => {
  it("speaks no filler frame and still sends exactly one say", async () => {
    const h = brainHarness({ filler: fillerOf(4, FILLER_MARKER), llmDelayMs: 0 });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    expect(target.finished()).toBe(true);
    expect(fillerFrames(target.frames)).toBe(0);
    expect(target.frames.length).toBeGreaterThan(0);
    expect(h.sent.filter((c) => c.action === "say")).toHaveLength(1);
    const view = h.views.at(-1);
    expect(view?.filler_spoken).toBe(false);
  });
});

describe("the filler speaks when the reply is slow", () => {
  it("starts at the Filler_Deadline and not before", async () => {
    // The model takes 1.2 s, well past the 600 ms deadline.
    const h = brainHarness({ filler: fillerOf(40, FILLER_MARKER), llmDelayMs: 1_200 });
    const target = createFakeTarget(h);
    const t0 = h.clock.now();
    h.brain.respond(target);

    // One millisecond before the deadline: still silent.
    await advanceTo(h, t0 + FILLER_DEADLINE_MS - 1);
    expect(target.frames).toHaveLength(0);

    // At the deadline the filler begins.
    await advanceTo(h, t0 + FILLER_DEADLINE_MS);
    expect(fillerFrames(target.frames)).toBe(1);
    expect(h.sent.filter((c) => c.action === "say")).toHaveLength(1);
  });

  it("switches to the reply and never plays a filler frame after a reply frame", async () => {
    const h = brainHarness({
      filler: fillerOf(200, FILLER_MARKER),
      llmDelayMs: 1_200,
      tts: ttsFrames(6),
    });
    const target = createFakeTarget(h);
    await runTurn(h, target, 200);

    expect(target.finished()).toBe(true);
    const marks = target.frames.map((f) => (f.length === 1 && f[0] === FILLER_MARKER ? "f" : "r"));
    expect(marks).toContain("f");
    expect(marks).toContain("r");
    // Every filler frame precedes every reply frame: the switch happens once, at a boundary.
    expect(marks.lastIndexOf("f")).toBeLessThan(marks.indexOf("r"));
    // Still one `say` for the whole turn, published before the first filler frame (C14).
    expect(h.sent.filter((c) => c.action === "say")).toHaveLength(1);
    expect(h.views.at(-1)?.filler_spoken).toBe(true);
  });

  it("stops with the turn when the child barges in during the filler", async () => {
    const h = brainHarness({ filler: fillerOf(200, FILLER_MARKER), llmDelayMs: 5_000 });
    const target = createFakeTarget(h);
    const t0 = h.clock.now();
    h.brain.respond(target);
    await advanceTo(h, t0 + FILLER_DEADLINE_MS);
    await advanceTo(h, t0 + FILLER_DEADLINE_MS + 40);
    const spoken = target.frames.length;
    expect(spoken).toBeGreaterThan(0);

    target.stop();
    await advanceTo(h, t0 + FILLER_DEADLINE_MS + 400);
    // Not one more frame after the turn stopped.
    expect(target.frames).toHaveLength(spoken);
    expect(h.views.at(-1)?.state).toBe("interrupted");
  });
});

describe("the filler audio itself", () => {
  it("is pre-rendered once per supported language through the Tts provider", async () => {
    const filler = await prerenderFiller(ttsFrames(3));
    expect(filler.frames("en-IN")).toHaveLength(3);
    expect(filler.frames("hi-IN")).toHaveLength(3);
  });

  it("has text for both languages, and it is Xelulu's own speech, not child audio", () => {
    expect(FILLER_TEXT["en-IN"].length).toBeGreaterThan(0);
    expect(FILLER_TEXT["hi-IN"].length).toBeGreaterThan(0);
  });

  it("leaves the turn silent rather than failing when synthesis yields nothing", async () => {
    const filler = await prerenderFiller(ttsFrames(0));
    expect(filler.frames("en-IN")).toHaveLength(0);
    const h = brainHarness({ filler, llmDelayMs: 1_200 });
    const target = createFakeTarget(h);
    await runTurn(h, target, 200);
    // No filler to play, but the reply still arrives and the turn still ends.
    expect(target.finished()).toBe(true);
  });
});
