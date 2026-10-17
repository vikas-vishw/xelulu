// The scheduling primitives every scheduled thing shares (Phase 4 Req 8.1, 10.10): one shape for
// a local `HH:MM`, and one catch-up window.
//
// It is its own module because it has two consumers — the Grandma schedules and the Routine_Store
// — and the whole point of the window is that a Grandma story and a routine agree on what "due"
// means. A second copy of either constant would be a second answer.
//
// Pure. No clock, no state: the caller supplies the local minutes past midnight it already reads
// from the Clock.

/**
 * How far back a tick looks. Five minutes absorbs a late or coalesced tick, and keeps a schedule
 * set or re-timed at 14:00 from firing its 07:00 occurrence retroactively (Req 10.10). The cost
 * is the honest one: a process down across the window misses that occurrence and does not catch
 * up, which is right for a bedtime story.
 */
export const ROUTINE_CATCH_UP_MINUTES = 5;

/** A local `HH:MM` as minutes past midnight, or null when it is not exactly that shape. */
export function hhmmToMinutes(at: string): number | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(at);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * True when `atMinutes` falls inside `[nowMinutes - ROUTINE_CATCH_UP_MINUTES, nowMinutes]`.
 * Deliberately does NOT wrap midnight: a 00:02 schedule is not due at 23:59.
 */
export function withinCatchUp(atMinutes: number, nowMinutes: number): boolean {
  return atMinutes <= nowMinutes && atMinutes >= nowMinutes - ROUTINE_CATCH_UP_MINUTES;
}
