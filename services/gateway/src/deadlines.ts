// Keyed deadline scheduler over a Clock (design D3, G49). Every rule with a time in it schedules
// through here. One real timer is kept armed for the earliest deadline; inbound handlers call
// `fireDue(clock.now())` first, so a deadline due at the same instant as an input always fires
// before that input is handled.
import type { Clock, TimerHandle } from "./clock.js";

export interface Deadlines {
  /** Replaces any deadline with the same key. Fires fn when clock.now() >= dueAt. */
  schedule(key: string, dueAt: number, fn: () => void): void;
  cancel(key: string): void;
  /** Runs every deadline with dueAt <= now, in (dueAt, scheduling order) order, synchronously. */
  fireDue(now: number): void;
  nextDue(): number | null;
}

type Entry = {
  readonly key: string;
  readonly dueAt: number;
  readonly order: number;
  readonly fn: () => void;
};

export function createDeadlines(clock: Clock): Deadlines {
  const entries = new Map<string, Entry>();
  let order = 0;
  let armed: { readonly handle: TimerHandle; readonly dueAt: number } | null = null;

  function earliest(): Entry | null {
    let best: Entry | null = null;
    for (const e of entries.values()) {
      if (
        best === null ||
        e.dueAt < best.dueAt ||
        (e.dueAt === best.dueAt && e.order < best.order)
      ) {
        best = e;
      }
    }
    return best;
  }

  function nextDue(): number | null {
    return earliest()?.dueAt ?? null;
  }

  /** Keeps exactly one real timer armed, for the earliest deadline. */
  function rearm(): void {
    const next = nextDue();
    if (armed !== null && armed.dueAt === next) return;
    if (armed !== null) {
      clock.clearTimer(armed.handle);
      armed = null;
    }
    if (next === null) return;
    const handle = clock.setTimer(() => {
      armed = null;
      fireDue(clock.now());
    }, next - clock.now());
    armed = { handle, dueAt: next };
  }

  function fireDue(now: number): void {
    try {
      for (let e = earliest(); e !== null && e.dueAt <= now; e = earliest()) {
        entries.delete(e.key);
        e.fn();
      }
    } finally {
      rearm();
    }
  }

  return {
    schedule(key, dueAt, fn) {
      order += 1;
      entries.set(key, { key, dueAt, order, fn });
      rearm();
    },
    cancel(key) {
      if (entries.delete(key)) rearm();
    },
    fireDue,
    nextDue,
  };
}
