// The Transcript_Store is safety.md §1's retention promise as code (Req 15, C11), so the test
// drives the policy rather than reading it back out of the module: the sweep fires through the
// real Deadlines on a manual clock, and `deleteAll` has to leave the store empty.
//
// Property 10: retention removes exactly the expired turns — for any set of ages, a sweep at a
// given instant removes every turn whose expiry has passed and no turn whose expiry has not.
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_TRANSCRIPT_RETENTION_DAYS } from "@xelulu/shared";

import { createDeadlines } from "../src/deadlines.js";
import { isoAt } from "../src/clock.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import {
  TRANSCRIPT_MAX_TURNS_PER_DEVICE,
  TRANSCRIPT_MAX_TURNS_TOTAL,
  TRANSCRIPT_SWEEP_INTERVAL_MS,
  TRANSCRIPT_SWEEP_KEY,
  createTranscriptStore,
} from "../src/brain/state/transcript-store.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";
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

const DAY_MS = 86_400_000;
const DEVICE = "xlu_000123";

function harness(startMs = 0) {
  const clock = createTestClock(startMs);
  const deadlines = createDeadlines(clock);
  const log = createGatewayLog(clock, createCaptureSink());
  const store = createTranscriptStore({ clock, deadlines, log });
  const add = (turnId: string, text: string, atMs: number, deviceId = DEVICE): void => {
    store.add({
      device_id: deviceId,
      turn_id: turnId,
      speaker: "child",
      text,
      at: isoAt(atMs),
    });
  };
  return {
    clock,
    deadlines,
    store,
    add,
    entries: () => log.since(0) as readonly Readonly<Record<string, unknown>>[],
  };
}

describe("the transcript store", () => {
  it("holds text turns and reports its counts", () => {
    const h = harness();
    h.add("t_1", "hello xelulu", 0);
    h.add("t_1", "hello there", 0);
    h.add("t_2", "a story please", 0, "xlu_other");
    expect(h.store.counts()).toEqual({
      total: 3,
      byDevice: { [DEVICE]: 2, xlu_other: 1 },
    });
    expect(h.store.textFor("t_1").map((turn) => turn.text)).toEqual([
      "hello xelulu",
      "hello there",
    ]);
  });

  it("expires a turn at its retention day and not before", () => {
    const h = harness();
    h.add("t_1", "hello", 0);
    const ttl = DEFAULT_TRANSCRIPT_RETENTION_DAYS * DAY_MS;
    expect(h.store.sweep(ttl - 1)).toBe(0);
    expect(h.store.counts().total).toBe(1);
    expect(h.store.sweep(ttl)).toBe(1);
    expect(h.store.counts().total).toBe(0);
  });

  it("runs the sweep on its own schedule, re-arming each time (Req 15.7)", () => {
    const h = harness();
    h.add("t_1", "hello", 0);
    expect(h.deadlines.nextDue()).toBe(TRANSCRIPT_SWEEP_INTERVAL_MS);

    // Nothing has expired an hour in, but the sweep must still re-arm.
    h.clock.set(TRANSCRIPT_SWEEP_INTERVAL_MS);
    h.deadlines.fireDue(h.clock.now());
    expect(h.store.counts().total).toBe(1);
    expect(h.deadlines.nextDue()).toBe(TRANSCRIPT_SWEEP_INTERVAL_MS * 2);

    // Past the TTL, the next scheduled sweep removes it without anyone calling sweep().
    const past = DEFAULT_TRANSCRIPT_RETENTION_DAYS * DAY_MS + TRANSCRIPT_SWEEP_INTERVAL_MS;
    h.clock.set(past);
    h.deadlines.fireDue(h.clock.now());
    expect(h.store.counts().total).toBe(0);
    const retention = h.entries().filter((entry) => entry["kind"] === "transcript_retention");
    expect(retention.at(-1)).toMatchObject({ action: "expired", turns_removed: 1, turns_held: 0 });
  });

  it("stops sweeping when the gateway stops", () => {
    const h = harness();
    h.add("t_1", "hello", 0);
    h.store.stop();
    expect(h.deadlines.nextDue()).toBeNull();
    // A stopped store takes nothing further, so a late turn cannot outlive the process' policy.
    h.add("t_2", "late", 0);
    expect(h.store.counts().total).toBe(1);
  });

  it("really deletes everything on deleteAll, and logs it", () => {
    const h = harness();
    h.add("t_1", "hello", 0);
    h.add("t_2", "again", 0);
    expect(h.store.deleteAll()).toBe(2);
    expect(h.store.counts()).toEqual({ total: 0, byDevice: {} });
    expect(h.store.textFor("t_1")).toEqual([]);
    const retention = h.entries().filter((entry) => entry["kind"] === "transcript_retention");
    expect(retention.at(-1)).toMatchObject({
      action: "deleted_all",
      turns_removed: 2,
      turns_held: 0,
    });
  });

  it("writes no transcript text into any log entry (Omar ruling 1)", () => {
    const h = harness();
    const secret = "zzsentineltranscripttext";
    h.add("t_1", secret, 0);
    h.store.sweep(DEFAULT_TRANSCRIPT_RETENTION_DAYS * DAY_MS);
    h.store.deleteAll();
    expect(JSON.stringify(h.entries())).not.toContain(secret);
  });

  it("drops the oldest first at the per-device cap", () => {
    const h = harness();
    for (let i = 0; i < TRANSCRIPT_MAX_TURNS_PER_DEVICE + 5; i += 1)
      h.add(`t_${i}`, `text ${i}`, 0);
    expect(h.store.counts().total).toBe(TRANSCRIPT_MAX_TURNS_PER_DEVICE);
    expect(h.store.textFor("t_0")).toEqual([]);
    expect(h.store.textFor(`t_${TRANSCRIPT_MAX_TURNS_PER_DEVICE + 4}`)).toHaveLength(1);
  });

  it("drops the oldest first at the total cap, across devices", () => {
    const h = harness();
    const perDevice = TRANSCRIPT_MAX_TURNS_PER_DEVICE;
    const devices = Math.ceil((TRANSCRIPT_MAX_TURNS_TOTAL + perDevice) / perDevice);
    let n = 0;
    for (let d = 0; d < devices; d += 1) {
      for (let i = 0; i < perDevice; i += 1) {
        h.add(`t_${n}`, "x", 0, `xlu_${d}`);
        n += 1;
      }
    }
    expect(h.store.counts().total).toBe(TRANSCRIPT_MAX_TURNS_TOTAL);
  });

  /** Property 10. */
  it("removes exactly the expired turns, for any set of ages", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 60 }),
        (ageDays, sweepDay) => {
          const h = harness();
          const ttl = DEFAULT_TRANSCRIPT_RETENTION_DAYS;
          ageDays.forEach((day, i) => h.add(`t_${i}`, "x", day * DAY_MS));
          const nowMs = sweepDay * DAY_MS;
          const expected = ageDays.filter((day) => (day + ttl) * DAY_MS <= nowMs).length;
          expect(h.store.sweep(nowMs)).toBe(expected);
          expect(h.store.counts().total).toBe(ageDays.length - expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("schedules under one key, so a second store cannot orphan the first's sweep", () => {
    expect(TRANSCRIPT_SWEEP_KEY).toBe("transcripts:sweep");
  });
});
