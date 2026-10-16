// Clock, deadlines, ids and backoff examples (design "Clock, deadlines and ids", Req 3.4, 8.1).
import { afterEach, describe, expect, it, vi } from "vitest";

import { backoffDelayMs } from "../src/backoff.js";
import { createSystemClock, isoAt, unixSeconds } from "../src/clock.js";
import { createDeadlines } from "../src/deadlines.js";
import { randomIds } from "../src/ids.js";
import { createTestClock } from "./support/test-clock.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("clock", () => {
  it("never goes backwards and follows fake timers set after import", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(2_000_000);
    const clock = createSystemClock();
    expect(clock.now()).toBe(2_000_000);
    vi.setSystemTime(1_000_000);
    expect(clock.now()).toBe(2_000_000);
    vi.setSystemTime(3_000_000);
    expect(clock.now()).toBe(3_000_000);

    const fired: number[] = [];
    clock.setTimer(() => fired.push(clock.now()), 500);
    const cancelled = clock.setTimer(() => fired.push(-1), 600);
    clock.clearTimer(cancelled);
    vi.advanceTimersByTime(1_000);
    expect(fired).toEqual([3_000_500]);
  });

  it("formats times as ISO strings and whole unix seconds", () => {
    expect(isoAt(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(unixSeconds(1_700_000_000_999)).toBe(1_700_000_000);
  });
});

describe("deadlines", () => {
  it("fires due deadlines in (dueAt, scheduling order) order and replaces by key", () => {
    const clock = createTestClock(0);
    const d = createDeadlines(clock);
    const fired: string[] = [];
    d.schedule("b", 100, () => fired.push("b"));
    d.schedule("a", 100, () => fired.push("a"));
    d.schedule("c", 50, () => fired.push("c"));
    d.schedule("late", 200, () => fired.push("late"));
    d.schedule("b", 100, () => fired.push("b2"));
    expect(d.nextDue()).toBe(50);

    d.fireDue(99);
    expect(fired).toEqual(["c"]);
    d.fireDue(100);
    expect(fired).toEqual(["c", "a", "b2"]);
    d.cancel("late");
    expect(d.nextDue()).toBeNull();
    d.fireDue(1_000);
    expect(fired).toEqual(["c", "a", "b2"]);
  });

  it("keeps exactly one real timer armed for the earliest deadline", () => {
    const clock = createTestClock(0);
    const d = createDeadlines(clock);
    d.schedule("x", 300, () => {});
    d.schedule("y", 100, () => {});
    expect(clock.timers().map((t) => t.dueAt)).toEqual([100]);
    d.cancel("y");
    expect(clock.timers().map((t) => t.dueAt)).toEqual([300]);
    d.cancel("x");
    expect(clock.timers()).toEqual([]);
  });

  it("is driven by fake timers through the system clock", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(10_000);
    const clock = createSystemClock();
    const d = createDeadlines(clock);
    const fired: number[] = [];
    d.schedule("k", clock.now() + 45_000, () => fired.push(clock.now()));
    vi.advanceTimersByTime(44_999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([55_000]);
  });
});

describe("ids and backoff", () => {
  it("draws distinct URL-safe ids with the requested prefix", () => {
    const seen = new Set<string>();
    for (let k = 0; k < 500; k++) {
      const id = randomIds.next("");
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
    expect(randomIds.next("ev_")).toMatch(/^ev_[A-Za-z0-9_-]{22}$/);
    expect(randomIds.next("t_")).toMatch(/^t_[A-Za-z0-9_-]{22}$/);
  });

  it("waits 1, 2, 4, 8, 16, 30, 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(backoffDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});
