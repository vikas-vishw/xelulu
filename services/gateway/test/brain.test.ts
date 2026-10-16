// Brain seams (Req 1.7, 14.2, 14.3): the Audio_Server hands each opened turn its own Stt_Session,
// every upload frame is pushed into that session inside the inbound handler, the session is
// released exactly once on all six terminal paths (client close, abort, replaced, finish,
// barge-in, dispose), and the Fake_Reply is the Audio_Server's only TurnResponder, called exactly
// once per ended upload. The Fake_Reply's temporary session is asserted to hold nothing. The
// provider declarations and the Provider_Gate are covered by provider-gate.test.ts; the
// provider-module boundary by the gateway-boundaries Repo_Check.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  PROTO_VER,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  type GatewayLogEntry,
} from "@xelulu/shared";

import { createAudioServer } from "../src/audio/audio-server.js";
import type { AudioInbound, AudioSocket } from "../src/audio/audio-transport.js";
import { MAX_FRAME_BYTES } from "../src/audio/audio-turn.js";
import { createStubResponder } from "./support/stub-responder.js";
import type { SttSession } from "../src/brain/providers/stt-provider.js";
import type { ReplyTarget, TurnResponder } from "../src/brain/turn-responder.js";
import { createDeadlines } from "../src/deadlines.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { startHarness, until, type Harness } from "./support/gateway-harness.js";
import { createTestClock } from "./support/test-clock.js";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}

function rel(file: string): string {
  return relative(SRC_DIR, file).split("\\").join("/");
}

/** A session that records what the turn did with it, and holds nothing of its own. */
function recordingStt(turnId: string): SttSession & {
  readonly pushed: number[];
  releases(): number;
} {
  const pushed: number[] = [];
  let releases = 0;
  return {
    turnId,
    pushed,
    releases: () => releases,
    pushFrame: (frame) => pushed.push(frame.byteLength),
    release: () => {
      releases += 1;
    },
    bytesHeld: () => 0,
    finish: () => Promise.resolve({ ok: false, reason: "no_speech" }),
  };
}

describe("TurnResponder wiring", () => {
  it("gateway.ts is the only composition root, and wires the Fake_Reply and its Stt_Session", () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    const constructors = files.filter((f) => /\bcreateAudioServer\(/.test(readFileSync(f, "utf8")));
    expect(constructors.map(rel).filter((f) => f !== "audio/audio-server.ts")).toEqual([
      "gateway.ts",
    ]);
    const gateway = readFileSync(join(SRC_DIR, "gateway.ts"), "utf8");
    // The Voice_Brain replaced the Fake_Reply at the same seam (Phase 3 C1).
    expect(gateway).toMatch(/const responder = createVoiceBrain\(/);
    expect(gateway).toMatch(/createAudioServer\(\{[^}]*\bresponder,/s);
    expect(gateway).toMatch(/createAudioServer\(\{[^}]*\bopenStt: responder\.openStt,/s);
  });

  it("the Audio_Server calls the TurnResponder exactly once per ended upload", () => {
    const clock = createTestClock(1_760_000_000_000);
    const deadlines = createDeadlines(clock);
    const log = createGatewayLog(clock, createCaptureSink());
    const entries: GatewayLogEntry[] = [];
    log.subscribe((e) => entries.push(e));
    const calls: ReplyTarget[] = [];
    const responder: TurnResponder = { respond: (t) => calls.push(t) };
    const sessions: ReturnType<typeof recordingStt>[] = [];
    const server = createAudioServer({
      clock,
      deadlines,
      log,
      responder,
      openStt: (_deviceId, turnId) => {
        const session = recordingStt(turnId);
        sessions.push(session);
        return session;
      },
      sendCommand: () => ({ ok: true, cmd_id: "c_unused" }),
    });

    function socket(): { s: AudioSocket; send(m: AudioInbound): void } {
      let inbound: ((m: AudioInbound) => void) | null = null;
      return {
        s: {
          sendText: () => undefined,
          sendBinary: () => undefined,
          close: () => undefined,
          onInbound: (fn) => {
            inbound = fn;
          },
        },
        send: (m) => inbound?.(m),
      };
    }
    const text = (t: string): AudioInbound => ({ kind: "text", text: t, byteLength: t.length });
    const start = (id: string): AudioInbound =>
      text(
        serialiseAudioStartMessage({
          proto_ver: PROTO_VER,
          ts: 1,
          type: "audio_start",
          turn_id: id,
        }),
      );
    const end = (id: string): AudioInbound =>
      text(
        serialiseAudioEndMessage({ proto_ver: PROTO_VER, ts: 1, type: "audio_end", turn_id: id }),
      );

    // An ended upload: one call, even with more markers during the reply.
    const a = socket();
    server.openTurn("dev_a", a.s);
    a.send(start("t_a"));
    a.send({ kind: "binary", bytes: new Uint8Array(40), byteLength: 40 });
    // A reply-stage frame is released without being counted or pushed (Req 14.2).
    a.send(end("t_a"));
    a.send({ kind: "binary", bytes: new Uint8Array(40), byteLength: 40 });
    a.send(end("t_a"));
    a.send(start("t_a"));
    expect(calls.map((c) => [c.deviceId, c.turnId])).toEqual([["dev_a", "t_a"]]);

    // Aborted uploads: no call.
    const b = socket();
    server.openTurn("dev_b", b.s);
    b.send(start("t_b"));
    b.send({ kind: "closed" });
    const c = socket();
    server.openTurn("dev_c", c.s);
    c.send(end("t_c"));
    const d = socket();
    server.openTurn("dev_d", d.s);
    d.send(start("t_d"));
    d.send(end("t_other"));
    expect(calls).toHaveLength(1);

    // A second ended upload on a new socket: one more call.
    const e = socket();
    server.openTurn("dev_a", e.s);
    e.send(start("t_a2"));
    e.send(end("t_a2"));
    expect(calls.map((x) => x.turnId)).toEqual(["t_a", "t_a2"]);

    // One session per opened turn; only upload frames are pushed (Req 14.2).
    expect(sessions).toHaveLength(5);
    expect(sessions.map((s) => s.pushed)).toEqual([[40], [], [], [], []]);
  });

  it("releases each turn's Stt_Session exactly once, on every terminal path (Req 14.3)", () => {
    const clock = createTestClock(1_760_000_000_000);
    const deadlines = createDeadlines(clock);
    const log = createGatewayLog(clock, createCaptureSink());
    const sessions: ReturnType<typeof recordingStt>[] = [];
    const targets: ReplyTarget[] = [];
    const server = createAudioServer({
      clock,
      deadlines,
      log,
      // Captures the turn's ReplyTarget so the `finish` path can be driven from the test.
      responder: { respond: (t) => targets.push(t) },
      openStt: (_deviceId, turnId) => {
        const session = recordingStt(turnId);
        sessions.push(session);
        return session;
      },
      sendCommand: () => ({ ok: true, cmd_id: "c_unused" }),
    });

    function socket(): { s: AudioSocket; send(m: AudioInbound): void } {
      let inbound: ((m: AudioInbound) => void) | null = null;
      return {
        s: {
          sendText: () => undefined,
          sendBinary: () => undefined,
          close: () => undefined,
          onInbound: (fn) => {
            inbound = fn;
          },
        },
        send: (m) => inbound?.(m),
      };
    }
    const control = (kind: "audio_start" | "audio_end", id: string): AudioInbound => {
      const text =
        kind === "audio_start"
          ? serialiseAudioStartMessage({
              proto_ver: PROTO_VER,
              ts: 1,
              type: "audio_start",
              turn_id: id,
            })
          : serialiseAudioEndMessage({
              proto_ver: PROTO_VER,
              ts: 1,
              type: "audio_end",
              turn_id: id,
            });
      return { kind: "text", text, byteLength: text.length };
    };
    const start = (id: string): AudioInbound => control("audio_start", id);
    const end = (id: string): AudioInbound => control("audio_end", id);

    // All six paths the design names: client close, an aborting protocol error, replaced,
    // finish (reply_ended), barge-in, and the gateway stop (dispose).
    const closed = socket();
    server.openTurn("dev_a", closed.s);
    closed.send({ kind: "closed" });

    const aborted = socket();
    server.openTurn("dev_b", aborted.s);
    aborted.send({ kind: "binary", bytes: new Uint8Array(8), byteLength: 8 });

    const replaced = socket();
    server.openTurn("dev_c", replaced.s);
    replaced.send(start("t_c"));
    const replacing = socket();
    server.openTurn("dev_c", replacing.s);
    replacing.send(start("t_c2"));

    // finish: a full upload, then the responder's target ends the reply.
    const finished = socket();
    server.openTurn("dev_d", finished.s);
    finished.send(start("t_d"));
    finished.send({ kind: "binary", bytes: new Uint8Array(40), byteLength: 40 });
    finished.send(end("t_d"));
    expect(server.turnStage("dev_d")).toBe("replying");
    targets.at(-1)?.finish();
    expect(server.turnStage("dev_d")).toBe(null);

    // barge-in: a turn taken to `replying`, then interrupted.
    const interrupted = socket();
    server.openTurn("dev_e", interrupted.s);
    interrupted.send(start("t_e"));
    interrupted.send(end("t_e"));
    expect(server.turnStage("dev_e")).toBe("replying");
    server.bargeIn("dev_e");
    expect(server.turnStage("dev_e")).toBe(null);

    // dispose: the one turn still open when the gateway stops.
    server.stop();

    expect(sessions).toHaveLength(6);
    expect(sessions.map((s) => s.releases())).toEqual([1, 1, 1, 1, 1, 1]);
    expect(sessions.map((s) => s.bytesHeld())).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("the audio-plane stub's Stt_Session holds nothing and transcribes nothing", async () => {
    const clock = createTestClock(1_760_000_000_000);
    const responder = createStubResponder({
      clock,
      deadlines: createDeadlines(clock),
      sendCommand: () => ({ ok: true, cmd_id: "c_unused" }),
    });
    const session = responder.openStt("dev_a", "audio:1");
    session.pushFrame(new Uint8Array(MAX_FRAME_BYTES));
    session.pushFrame(new Uint8Array(MAX_FRAME_BYTES));
    expect(session.bytesHeld()).toBe(0);
    await expect(session.finish()).resolves.toEqual({ ok: false, reason: "no_speech" });
    session.release();
    expect(session.bytesHeld()).toBe(0);
  });
});

describe("Fake_Reply as the only reply path", () => {
  const running: Harness[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((h) => h.stop()));
  });

  it("each ended upload gets exactly one say and one reply", async () => {
    const h = await startHarness();
    running.push(h);
    await h.online();
    for (const turnId of ["t_one", "t_two"]) {
      const audio = await h.device.audioTurn(h.gateway.audioPort(), { frames: 2, turnId });
      expect(await audio.closed).toBe(1000);
    }
    await until(
      () =>
        h.entries.filter((e) => e.kind === "audio_turn" && e.phase === "reply_ended").length === 2,
    );
    expect(h.entries.filter((e) => e.kind === "message_out" && e.variant === "say")).toHaveLength(
      2,
    );
    expect(h.device.commands.map((c) => c.action)).toEqual(["say", "say"]);
    expect(
      h.entries.flatMap((e) =>
        e.kind === "audio_turn" && e.phase === "reply_started" ? [e.turn_id] : [],
      ),
    ).toEqual(["t_one", "t_two"]);
  });
});
