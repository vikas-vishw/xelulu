// Test helper (not a test): a manual Clock for pure model tests, copied from the gateway's test
// support (services and their tests never import each other). `now` is a variable the test moves
// forward; timers are recorded and never fire on their own, so the test drives every deadline
// with `deadlines.fireDue(t)`, exactly as the simulator does before each input.
import type { Clock, TimerHandle } from "../../src/clock.js";

export type RecordedTimer = {
  readonly id: number;
  readonly dueAt: number;
  readonly fn: () => void;
};

export interface TestClock extends Clock {
  /** Moves the clock to `t`. Throws if `t` is earlier than the current time. */
  set(t: number): void;
  advance(ms: number): void;
  /** Timers set and not cleared, in the order they were set. */
  timers(): readonly RecordedTimer[];
}

export function createTestClock(start = 0): TestClock {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, RecordedTimer>();

  return {
    now: () => now,
    setTimer(fn, delayMs): TimerHandle {
      const id = nextId++;
      timers.set(id, { id, dueAt: now + Math.max(0, delayMs), fn });
      return { id };
    },
    clearTimer(handle) {
      timers.delete(handle.id as number);
    },
    set(t) {
      if (t < now) throw new Error("test clock cannot go backwards");
      now = t;
    },
    advance(ms) {
      if (ms < 0) throw new Error("test clock cannot go backwards");
      now += ms;
    },
    timers: () => [...timers.values()],
  };
}
