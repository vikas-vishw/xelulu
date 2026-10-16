// One Clock per service (design D3, G49). A copy of the gateway's module. `now()` never goes backwards; timers and the time source
// are looked up on `globalThis` at call time, never at import, so Vitest fake timers drive them no
// matter when this module was loaded.

export type TimerHandle = { readonly id: unknown };

export interface Clock {
  /** Milliseconds since the epoch, never smaller than the previous call. */
  now(): number;
  setTimer(fn: () => void, delayMs: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

/** Largest delay `setTimeout` accepts without wrapping round to 1 ms. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** A fresh system clock with its own monotonic floor. */
export function createSystemClock(): Clock {
  let last = Number.NEGATIVE_INFINITY;
  return {
    now: () => {
      const t = Date.now();
      if (t > last) last = t;
      return last;
    },
    setTimer: (fn, delayMs) => ({
      id: globalThis.setTimeout(fn, Math.min(MAX_TIMER_DELAY_MS, Math.max(0, delayMs))),
    }),
    clearTimer: (handle) => {
      globalThis.clearTimeout(handle.id as ReturnType<typeof setTimeout>);
    },
  };
}

/** The process clock. */
export const systemClock: Clock = createSystemClock();

/** `YYYY-MM-DDTHH:mm:ss.sssZ` for a Clock time. */
export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** Whole unix seconds for a Clock time. */
export function unixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}
