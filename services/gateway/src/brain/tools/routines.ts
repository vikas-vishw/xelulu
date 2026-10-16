// The `routine_lookup` tool's source (Req 9.4). An in-process fixture in this phase (C10) with
// no I/O: the parent-authored routines arrive with the backend. A lookup answers with the
// routine's name and its time, which is all a child needs to hear ("bedtime is at 8:30").
//
// Times are `HH:MM` in the device's local day, the same shape the contract uses for quiet hours,
// so nothing here has to reason about time zones.
export type RoutineFixture = Readonly<{ name: string; at: string; enabled: boolean }>;

export const ROUTINE_FIXTURE: readonly RoutineFixture[] = Object.freeze([
  { name: "morning", at: "07:00", enabled: true },
  { name: "brushing", at: "08:00", enabled: true },
  { name: "meals", at: "12:30", enabled: true },
  { name: "play time", at: "17:00", enabled: true },
  { name: "wind down", at: "20:00", enabled: true },
  { name: "bedtime", at: "20:30", enabled: true },
]);

export type RoutineLookup =
  | { readonly ok: true; readonly name: string; readonly at: string }
  | { readonly ok: false; readonly reason: "unknown_routine" | "disabled" };

export interface Routines {
  lookup(name: string): RoutineLookup;
  names(): readonly string[];
  /** Whether the day's play limit has been reached. Fixture-driven in this phase. */
  playMinutesUsed(deviceId: string): number;
}

export function createRoutines(
  fixture: readonly RoutineFixture[] = ROUTINE_FIXTURE,
  playMinutes: Readonly<Record<string, number>> = {},
): Routines {
  const byName = new Map(fixture.map((routine) => [routine.name.toLowerCase(), routine]));

  return {
    lookup(name) {
      const routine = byName.get(name.trim().toLowerCase());
      if (routine === undefined) return { ok: false, reason: "unknown_routine" };
      // A disabled routine is reported as disabled rather than silently answered, so a child is
      // never told a time the parent has switched off.
      if (!routine.enabled) return { ok: false, reason: "disabled" };
      return { ok: true, name: routine.name, at: routine.at };
    },

    names: () => fixture.map((routine) => routine.name),

    playMinutesUsed: (deviceId) => playMinutes[deviceId] ?? 0,
  };
}
