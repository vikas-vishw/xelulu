// No raw child audio is stored (Req 14, safety.md §1). This is the behavioural half of that
// promise; `tooling/test/audio-retention.test.ts` is the structural half.
//
// safety.md §1 is unconditional: child audio streams in memory through the Gateway to STT and is
// then discarded, and it is never written to disk, Storage, logs or analytics. So the test looks
// for the two ways it could go wrong — bytes outliving their turn, and text or bytes reaching
// something durable:
//
//  - `bytesHeld()` is zero after EVERY terminal path (finish, barge-in, abort, gateway stop);
//  - a sentinel utterance appears in no Log_Entry and no stdout line, with the transcript
//    toggle off AND on, because the toggle governs the operator channel and never the log.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  advanceTo,
  brainHarness,
  createFakeTarget,
  runTurn,
  sttSaying,
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

/** Distinctive enough that a coincidental match is impossible. */
const SENTINEL = "zzsentinelchildutterance";

describe("a turn's audio buffer", () => {
  it("is released when the turn finishes", async () => {
    const h = brainHarness({ stt: sttSaying("tell me about lions", "en-IN", 4_096) });
    const target = createFakeTarget(h);
    const session = target.stt;
    expect(session.bytesHeld()).toBe(4_096);

    await runTurn(h, target);
    expect(target.finished()).toBe(true);
    expect(session.bytesHeld()).toBe(0);
  });

  it("is released when the child barges in", async () => {
    const h = brainHarness({ stt: sttSaying("x", "en-IN", 2_048), llmDelayMs: 5_000 });
    const target = createFakeTarget(h);
    const session = target.stt;
    h.brain.respond(target);
    target.stop();
    await advanceTo(h, h.clock.now() + 100);
    expect(session.bytesHeld()).toBe(0);
  });

  it("is released when the gateway stops mid-turn", async () => {
    const h = brainHarness({ stt: sttSaying("x", "en-IN", 1_024), llmDelayMs: 5_000 });
    const target = createFakeTarget(h);
    const session = target.stt;
    h.brain.respond(target);
    h.brain.stop();
    expect(session.bytesHeld()).toBe(0);
  });

  it("grows only while frames arrive, and never after release", () => {
    const h = brainHarness();
    const session = h.brain.openStt(DEVICEID, "t_push");
    session.pushFrame(new Uint8Array(320));
    expect(session.bytesHeld()).toBe(320);
    session.release();
    expect(session.bytesHeld()).toBe(0);
    session.pushFrame(new Uint8Array(320));
    // A released session takes nothing further, so a late frame cannot resurrect a buffer.
    expect(session.bytesHeld()).toBe(0);
  });
});

const DEVICEID = "xlu_000123";

describe("a child's words reach no durable surface", () => {
  it("appear in no Log_Entry and no stdout line, with the transcript toggle off", async () => {
    const h = brainHarness({ stt: sttSaying(SENTINEL), includeTranscriptText: false });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    expect(JSON.stringify(h.entries())).not.toContain(SENTINEL);
    // The view carries a length but no text.
    const view = h.views.at(-1);
    expect(view?.transcript_text).toBeNull();
    expect(view?.transcript_len).toBe(SENTINEL.length);
  });

  it("appear in no Log_Entry even with the transcript toggle ON", async () => {
    // The toggle governs the operator channel only. safety.md §7 keeps the log free of
    // transcripts whatever the toggle says (Omar ruling 1).
    const h = brainHarness({ stt: sttSaying(SENTINEL), includeTranscriptText: true });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    expect(JSON.stringify(h.entries())).not.toContain(SENTINEL);
    // With the toggle on, the operator view does carry it — that is the one sanctioned place.
    expect(h.views.at(-1)?.transcript_text).toBe(SENTINEL);
  });

  it("live in the Transcript_Store as text, with an expiry, and nowhere else", async () => {
    const h = brainHarness({ stt: sttSaying(SENTINEL) });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    const held = h.transcripts.textFor(target.turnId);
    expect(held.map((t) => t.speaker)).toEqual(["child", "xelulu"]);
    expect(held[0]?.text).toBe(SENTINEL);
    expect(held[0]?.expires_at_ms).toBeGreaterThan(h.clock.now());
    // Deleting really deletes.
    expect(h.transcripts.deleteAll()).toBe(2);
    expect(h.transcripts.textFor(target.turnId)).toEqual([]);
  });

  it("puts no audio byte into any entry", async () => {
    const h = brainHarness({ stt: sttSaying("tell me about lions", "en-IN", 8_192) });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    const serialised = JSON.stringify(h.entries());
    // No entry carries a byte array, a base64 blob or a byte count of the upload.
    expect(serialised).not.toMatch(/"bytes"/);
    expect(serialised).not.toMatch(/"audio"/);
    expect(serialised).not.toMatch(/[A-Za-z0-9+/]{64,}={0,2}/);
  });
});

describe("a cry alert carries only its two numbers", () => {
  it("logs confidence and duration and nothing else about the sound", () => {
    const h = brainHarness();
    h.alerts.raiseCryAlert({ deviceId: DEVICEID, confidence: 0.82, durationS: 7 });
    const alert = h.entries().find((e) => e.kind === "parent_alert");
    expect(alert).toMatchObject({ alert: "cry", confidence: 0.82, duration_s: 7, topic: null });
    expect(JSON.stringify(alert)).not.toMatch(/"audio"|"bytes"|"text"|"transcript"/);
  });
});
