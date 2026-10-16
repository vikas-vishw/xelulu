// The Audio_Server over real loopback `ws` (Req 9.1–9.12, D7, D8): listening, upgrade auth, every
// Abort_Cause with its close code and close time, `replaced`, and reply-stage traffic. Timeouts
// and the reply stage run under Vitest fake timers; socket waits use `until` (real I/O, no fake
// time moved) or vi.waitFor where time drift does not matter.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AudioTurnLogEntry, GatewayLogEntry } from "@xelulu/shared";

import { uploadFrame, type FakeAudio } from "./support/fake-device.js";
import {
  HARNESS_DEVICE_ID,
  HARNESS_TOKEN,
  startHarness,
  until,
  type Harness,
} from "./support/gateway-harness.js";

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  vi.useRealTimers();
});

function useFakeTimers(): void {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

async function harness(): Promise<Harness> {
  const h = await startHarness();
  running.push(h);
  return h;
}

function turnEntries(h: Harness): AudioTurnLogEntry[] {
  return h.entries.filter((e): e is AudioTurnLogEntry => e.kind === "audio_turn");
}

function aborted(h: Harness): AudioTurnLogEntry[] {
  return turnEntries(h).filter((e) => e.phase === "aborted");
}

async function open(h: Harness): Promise<FakeAudio> {
  const result = await h.device.openAudio(h.gateway.audioPort());
  if (result.kind !== "open") throw new Error("audio upgrade refused");
  return result.audio;
}

function has(h: Harness, match: (e: GatewayLogEntry) => boolean): boolean {
  return h.entries.some(match);
}

describe("audio server: listening and upgrade auth", () => {
  it("listens on an OS-assigned loopback port and logs audio_listening", async () => {
    const h = await harness();
    expect(h.config.audio.listenHost).toBe("127.0.0.1");
    expect(h.gateway.audioPort()).toBeGreaterThan(0);
    // The provider gate runs before any listener opens (Phase 3 Req 1.4), so its three
    // `provider_check` entries sit between `starting` and `audio_listening`.
    expect(h.entries.slice(0, 5).map((e) => (e.kind === "gateway" ? e.state : e.kind))).toEqual([
      "starting",
      "provider_check",
      "provider_check",
      "provider_check",
      "audio_listening",
    ]);
  });

  it.each([
    ["no Authorization header", null],
    ["another scheme", "Basic " + HARNESS_TOKEN],
    ["a lower-case scheme", "bearer " + HARNESS_TOKEN],
    ["an empty token", "Bearer "],
    ["an unknown token", "Bearer not-the-device-token-0000"],
  ] as const)("answers 401 with %s and opens no turn", async (_name, authorization) => {
    const h = await harness();
    const mark = h.entries.length;
    const result = await h.device.openAudio(h.gateway.audioPort(), { authorization });
    expect(result).toEqual({ kind: "refused", status: 401 });
    expect(h.entries.slice(mark)).toEqual([
      expect.objectContaining({
        kind: "auth",
        transport: "ws",
        device_id: null,
        outcome: "failed",
      }),
    ]);
    expect(turnEntries(h)).toEqual([]);
  });

  it("accepts the device token on any path and opens a turn in awaiting_start", async () => {
    const h = await harness();
    const result = await h.device.openAudio(h.gateway.audioPort(), { path: "/any/path?x=1" });
    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    result.audio.sendStart("t_any_path");
    await vi.waitFor(() => {
      expect(turnEntries(h)).toEqual([
        expect.objectContaining({
          device_id: HARNESS_DEVICE_ID,
          turn_id: "t_any_path",
          phase: "started",
          frames_in: 0,
          bytes_in: 0,
          frames_out: 0,
        }),
      ]);
    });
    result.audio.close();
  });
});

type AbortCase = Readonly<{
  name: string;
  cause: AudioTurnLogEntry["cause"];
  code: number;
  turnId: string | null;
  framesIn?: number;
  bytesIn?: number;
  drive(audio: FakeAudio): void;
}>;

const ABORT_CASES: readonly AbortCase[] = [
  {
    name: "an invalid text first",
    cause: "invalid_message",
    code: 1008,
    turnId: null,
    drive: (a) => a.sendText("{not-json"),
  },
  {
    name: "an invalid text of exactly 4,096 bytes (parsed, not too large)",
    cause: "invalid_message",
    code: 1008,
    turnId: null,
    drive: (a) => a.sendText("x".repeat(4_096)),
  },
  {
    name: "a text of 4,097 bytes",
    cause: "text_too_large",
    code: 1009,
    turnId: null,
    drive: (a) => a.sendText("x".repeat(4_097)),
  },
  {
    name: "a text over 65,536 bytes (D7)",
    cause: "frame_too_large",
    code: 1009,
    turnId: null,
    drive: (a) => a.sendText("x".repeat(65_537)),
  },
  {
    name: "a binary frame before audio_start",
    cause: "frame_before_start",
    code: 1008,
    turnId: null,
    drive: (a) => a.sendFrame(),
  },
  {
    name: "audio_end before audio_start",
    cause: "end_before_start",
    code: 1008,
    turnId: null,
    drive: (a) => a.sendEnd("t_early"),
  },
  {
    name: "a second audio_start",
    cause: "duplicate_start",
    code: 1008,
    turnId: "t_dup",
    drive: (a) => {
      a.sendStart("t_dup");
      a.sendStart("t_dup_2");
    },
  },
  {
    name: "audio_end with another turn_id",
    cause: "turn_id_mismatch",
    code: 1008,
    turnId: "t_one",
    framesIn: 2,
    bytesIn: 80,
    drive: (a) => {
      a.sendStart("t_one");
      a.sendFrame();
      a.sendFrame();
      a.sendEnd("t_two");
    },
  },
  {
    name: "a binary frame of 1,501 bytes",
    cause: "frame_too_large",
    code: 1009,
    turnId: "t_big",
    framesIn: 1,
    bytesIn: 1_500,
    drive: (a) => {
      a.sendStart("t_big");
      a.sendFrame(uploadFrame(1_500));
      a.sendFrame(uploadFrame(1_501));
    },
  },
  {
    name: "a binary frame over 65,536 bytes (D7)",
    cause: "frame_too_large",
    code: 1009,
    turnId: "t_huge",
    drive: (a) => {
      a.sendStart("t_huge");
      a.sendFrame(uploadFrame(65_537));
    },
  },
  {
    name: "a frame after 3,000 counted frames",
    cause: "too_many_frames",
    code: 1008,
    turnId: "t_many",
    framesIn: 3_000,
    bytesIn: 120_000,
    drive: (a) => {
      a.sendStart("t_many");
      for (let i = 0; i < 3_001; i++) a.sendFrame();
    },
  },
];

describe("audio server: aborts", () => {
  it.each(ABORT_CASES)(
    "aborts on $name, closes within 1,000 ms and sends no audio_end",
    async (c) => {
      const h = await harness();
      const audio = await open(h);
      const started = performance.now();
      c.drive(audio);
      const code = await audio.closed;
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(code).toBe(c.code);
      await vi.waitFor(() => {
        expect(aborted(h)).toHaveLength(1);
      });
      const entry = aborted(h)[0];
      expect(entry).toMatchObject({
        device_id: HARNESS_DEVICE_ID,
        turn_id: c.turnId,
        cause: c.cause,
        frames_in: c.framesIn ?? 0,
        bytes_in: c.bytesIn ?? 0,
        frames_out: 0,
      });
      if (c.cause === "invalid_message") expect(entry?.issues.length).toBeGreaterThan(0);
      else expect(entry?.issues).toEqual([]);
      // No audio_end, no reply, no TurnResponder call: nothing was sent at all but the close.
      expect(audio.reply.texts).toEqual([]);
      expect(audio.reply.frames).toEqual([]);
      expect(h.trace.filter((t) => t.op !== "close")).toEqual([]);
      expect(turnEntries(h).filter((e) => e.phase === "aborted")).toHaveLength(1);
      expect(has(h, (e) => e.kind === "message_out")).toBe(false);
    },
  );

  it("aborts as client_closed when the device closes the socket", async () => {
    const h = await harness();
    const audio = await open(h);
    audio.sendStart("t_closed");
    audio.sendFrame();
    audio.close(1000);
    await audio.closed;
    await vi.waitFor(() => {
      expect(aborted(h)).toEqual([
        expect.objectContaining({
          turn_id: "t_closed",
          cause: "client_closed",
          frames_in: 1,
          bytes_in: 40,
          issues: [],
        }),
      ]);
    });
    expect(audio.reply.texts).toEqual([]);
  });

  it("forgets an aborted turn so the device can open a new one", async () => {
    const h = await harness();
    const first = await open(h);
    first.sendFrame();
    await first.closed;
    const second = await open(h);
    second.sendStart("t_next");
    await vi.waitFor(() => {
      expect(turnEntries(h).map((e) => [e.turn_id, e.phase])).toEqual([
        [null, "aborted"],
        ["t_next", "started"],
      ]);
    });
    second.close();
  });

  it("aborts as start_timeout 5,000 ms after the upgrade with no audio_start", async () => {
    useFakeTimers();
    const h = await harness();
    const audio = await open(h);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(aborted(h)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted(h)).toEqual([
      expect.objectContaining({ turn_id: null, cause: "start_timeout" }),
    ]);
    expect(await audio.closed).toBe(1008);
  });

  it("aborts as idle_timeout after 10,000 ms with no message while uploading", async () => {
    useFakeTimers();
    const h = await harness();
    const audio = await open(h);
    audio.sendStart("t_idle");
    await until(() => turnEntries(h).some((e) => e.phase === "started"));
    const startedAt = Date.parse(turnEntries(h)[0]?.at ?? "");

    // A frame at +5,000 ms re-arms the idle deadline to +15,000 ms.
    await vi.advanceTimersByTimeAsync(startedAt + 5_000 - Date.now());
    audio.sendFrame();
    const sentAt = performance.now();
    await until(() => performance.now() - sentAt > 300);
    await vi.advanceTimersByTimeAsync(startedAt + 10_000 - Date.now());
    expect(aborted(h)).toEqual([]);
    await vi.advanceTimersByTimeAsync(startedAt + 14_999 - Date.now());
    expect(aborted(h)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted(h)).toEqual([
      expect.objectContaining({ turn_id: "t_idle", cause: "idle_timeout", frames_in: 1 }),
    ]);
    expect(await audio.closed).toBe(1008);
  });
});

describe("audio server: replaced", () => {
  it("aborts the older turn as replaced (1001) before handling the new socket", async () => {
    const h = await harness();
    const older = await open(h);
    older.sendStart("t_old");
    await vi.waitFor(() => {
      expect(turnEntries(h).some((e) => e.phase === "started")).toBe(true);
    });
    const newer = await open(h);
    newer.sendStart("t_new");
    expect(await older.closed).toBe(1001);
    await vi.waitFor(() => {
      expect(turnEntries(h).map((e) => [e.turn_id, e.phase, e.cause])).toEqual([
        ["t_old", "started", null],
        ["t_old", "aborted", "replaced"],
        ["t_new", "started", null],
      ]);
    });
    expect(older.reply.texts).toEqual([]);
    newer.close();
  });

  it("gives a replaced turn with no audio_start a null turn_id", async () => {
    const h = await harness();
    const older = await open(h);
    const newer = await open(h);
    expect(await older.closed).toBe(1001);
    await vi.waitFor(() => {
      expect(aborted(h)).toEqual([
        expect.objectContaining({ turn_id: null, cause: "replaced", issues: [] }),
      ]);
    });
    newer.close();
  });
});

describe("audio server: reply stage", () => {
  async function replying(h: Harness, turnId: string): Promise<FakeAudio> {
    await h.online();
    const audio = await open(h);
    audio.sendStart(turnId);
    for (let i = 0; i < 3; i++) audio.sendFrame();
    audio.sendEnd(turnId);
    await until(() => turnEntries(h).some((e) => e.phase === "reply_started"));
    return audio;
  }

  it("ignores frames and markers during the reply and logs an invalid text as ws", async () => {
    useFakeTimers();
    const h = await harness();
    const audio = await replying(h, "t_reply");
    const messageIns = h.entries.filter((e) => e.kind === "message_in").length;

    audio.sendFrame();
    audio.sendStart("t_reply");
    audio.sendEnd("t_reply");
    audio.sendText("{not-json");
    await until(() => has(h, (e) => e.kind === "message_rejected"));
    expect(h.entries.filter((e) => e.kind === "message_rejected")).toEqual([
      expect.objectContaining({
        transport: "ws",
        device_id: HARNESS_DEVICE_ID,
        topic_suffix: null,
        issues: [{ path: [], kind: "invalid_json" }],
      }),
    ]);
    expect(h.entries.filter((e) => e.kind === "message_in")).toHaveLength(messageIns);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await audio.closed).toBe(1000);
    expect(audio.reply.frames).toHaveLength(50);
    expect(turnEntries(h).map((e) => e.phase)).toEqual([
      "started",
      "ended",
      "reply_started",
      "reply_ended",
    ]);
    expect(turnEntries(h).at(-1)).toMatchObject({ frames_in: 3, bytes_in: 120, frames_out: 50 });
  });

  it.each([
    ["a text of 4,097 bytes", "text_too_large", (a: FakeAudio) => a.sendText("y".repeat(4_097))],
    [
      "a binary frame of 1,501 bytes",
      "frame_too_large",
      (a: FakeAudio) => a.sendFrame(uploadFrame(1_501)),
    ],
    [
      "a message over 65,536 bytes",
      "frame_too_large",
      (a: FakeAudio) => a.sendFrame(uploadFrame(65_537)),
    ],
  ] as const)("aborts the reply on %s with no audio_end", async (_name, cause, drive) => {
    useFakeTimers();
    const h = await harness();
    const audio = await replying(h, "t_oversize");
    const sent = h.framesOn(1).length;
    drive(audio);
    expect(await audio.closed).toBe(1009);
    expect(aborted(h)).toEqual([
      expect.objectContaining({ turn_id: "t_oversize", cause, frames_in: 3, frames_out: sent }),
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.framesOn(1)).toHaveLength(sent);
    expect(audio.reply.texts).toEqual([]);
    expect(h.trace.some((t) => t.op === "text")).toBe(false);
  });
});
