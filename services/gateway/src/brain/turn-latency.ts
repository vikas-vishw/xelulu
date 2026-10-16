// Turn_Latency (Req 12, C16): the time from the device's `audio_end` to the first frame the
// Gateway sends on that turn. That is the interval product.md's latency target names — "from the
// end of the child's speech to the first audio" — and it is measured on the Clock, never on the
// wall clock, so a test drives it with fake timers rather than waiting.
//
// The budgets are asserted against the mock providers only. They say nothing about a real
// vendor's latency, and the gap to ElatoAI's 2–3 s baseline is not closed by this phase.
import type { Clock } from "../clock.js";

/** product.md's typical target: end of speech to first audio. */
export const TYPICAL_BUDGET_MS = 1_000;

/** product.md's worst-case target. */
export const WORST_BUDGET_MS = 1_600;

/**
 * When the Filler is spoken if no reply audio is ready yet. Comfortably inside the typical
 * budget, so a turn that needs the Filler still begins speaking well before the worst case.
 */
export const FILLER_DEADLINE_MS = 600;

export interface TurnLatency {
  /** Milliseconds since `audio_end`. */
  sinceAudioEnd(): number;
  /** Records the first frame's instant. Later calls are ignored: there is one first frame. */
  markFirstFrame(): void;
  /** The measured latency, or null before the first frame. */
  firstFrameMs(): number | null;
  /** The Clock instant the Filler becomes due. */
  fillerDueAt(): number;
}

/** Starts the clock for one turn at its `audio_end`. */
export function startTurnLatency(clock: Clock): TurnLatency {
  const audioEndMs = clock.now();
  let firstFrame: number | null = null;

  return {
    sinceAudioEnd: () => clock.now() - audioEndMs,
    markFirstFrame() {
      if (firstFrame === null) firstFrame = clock.now() - audioEndMs;
    },
    firstFrameMs: () => firstFrame,
    fillerDueAt: () => audioEndMs + FILLER_DEADLINE_MS,
  };
}
