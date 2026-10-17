// The Routine_Store (Phase 4 Req 10.1, 10.1a, 10.10, 13.1, 13.2, 13.5): the day's shape, the
// once-per-day marks and the play-minute ledger, in memory behind one interface.
//
// It EXTENDS the Phase 3 `Routines` interface rather than replacing it, so one object satisfies
// both `routine_lookup`'s dependency and the Device_Policy_Gate's `playMinutesUsed` read. That is
// why `brain/tools/device-action.ts` needs no edit at all (C16) and why `routine_lookup`'s own
// assertions do not move: neither inherited member changes shape.
//
// ONE SOURCE OF TRUTH FOR THE SIX TIMES (Req 10.1a). The seed defaults to the Starter_Content's
// `createStarterRoutines()`, and `ROUTINE_FIXTURE`, `RoutineFixture` and `createRoutines` are
// DELETED from `brain/tools/routines.ts`, which keeps only the `Routines` interface and the
// `RoutineLookup` type. Keeping the fixture as a test default plus an "agree row for row"
// assertion was the alternative floor and is rejected: an assertion that two lists agree still
// leaves production answering from one and the tests from the other.
//
// In memory only: no file, no socket, no clock of its own beyond the injected Clock. Every mark
// and every minute is lost on restart, which is the honest Phase 4 behaviour — Phase 5's Supabase
// implementation replaces this one behind the same interface.
import type { RoutineTemplate } from "@xelulu/shared";
import { createStarterRoutines } from "@xelulu/shared";

import type { Clock } from "../clock.js";
import { localDayKey } from "../brain/story/word-of-the-day.js";
import type { Routines } from "../brain/tools/routines.js";
import { ROUTINE_BEHAVIOUR_IDS, type RoutineBehaviourId } from "./routine-behaviours.js";
import { hhmmToMinutes, withinCatchUp } from "./schedule-time.js";

/** The cap on a Routine_Behaviour's actions. The longest this phase writes is `morning`'s four. */
export const ROUTINE_MAX_ACTIONS = 4;

/**
 * One routine. `routine_id` is the stable key the route and the log use; `name` is what
 * `routine_lookup` has always matched and what a child hears ("bedtime is at 8:30").
 */
export type Routine = Readonly<{
  routine_id: string;
  name: string;
  /** `HH:MM` in the device's local day, the shape the contract uses for quiet hours. */
  at: string;
  enabled: boolean;
  behaviour: RoutineBehaviourId;
}>;

/**
 * What the console shows per routine: the row, how many actions its behaviour has so `sent` can
 * be read against a total, and whether it has already fired today.
 */
export type RoutineSummary = Readonly<{
  routine_id: string;
  name: string;
  at: string;
  enabled: boolean;
  behaviour: RoutineBehaviourId;
  actions: number;
  fired_today: boolean;
}>;

export interface RoutineStore extends Routines {
  routines(): readonly Routine[];
  /** By `routine_id`, matched exactly. Display names with spaces are not ids (Req 16.7). */
  byId(routineId: string): Routine | null;
  /** Enabled, not yet fired on `dayKey`, and `at` inside the Catch_Up_Window (Req 10.10). */
  dueAt(nowMinutes: number, dayKey: string): readonly Routine[];
  /** False when this routine already fired on `dayKey`, so a caller cannot double-fire. */
  markFired(routineId: string, dayKey: string): boolean;
  /**
   * Records minutes and answers the day's total BEFORE and AFTER, which is what makes the
   * Nap_Sequence crossing detectable without changing the gate (C18, Req 13.2). Called only by
   * `accruePlay` in `play-time.ts`, never directly.
   */
  addPlayMinutes(
    deviceId: string,
    minutes: number,
    dayKey: string,
  ): Readonly<{ before: number; after: number }>;
  napFired(dayKey: string): boolean;
  /** False when the nap already fired on `dayKey`: at most one Nap_Sequence a day (Req 13.2). */
  markNap(dayKey: string): boolean;
  // Inherited from Routines, unchanged: lookup(name), names(), playMinutesUsed(deviceId).
}

/** A template whose `behaviour` is one this Gateway knows. A template it cannot place is dropped. */
function placed(template: RoutineTemplate): Routine | null {
  const behaviour = ROUTINE_BEHAVIOUR_IDS.find((id) => id === template.behaviour);
  if (behaviour === undefined) return null;
  return Object.freeze({
    routine_id: template.routine_id,
    name: template.name,
    at: template.at,
    enabled: template.enabled,
    behaviour,
  });
}

/** `${dayKey}|${deviceId}`: the ledger's key, so a day rollover resets it (Req 13.5). */
function playKey(dayKey: string, deviceId: string): string {
  return `${dayKey}|${deviceId}`;
}

export function createRoutineStore(
  deps: Readonly<{
    clock: Clock;
    /** Defaults to the Starter_Content's six templates — the one source of the six times. */
    seed?: readonly RoutineTemplate[];
    /**
     * Seeds the day's ledger per device. It exists because six of the seven former
     * `createRoutines(` call sites are tests that pass exactly that, and Req 10.1a moves them
     * here rather than leaving a second source of truth for the six times behind.
     */
    playMinutes?: Readonly<Record<string, number>>;
  }>,
): RoutineStore {
  const rows: readonly Routine[] = Object.freeze(
    (deps.seed ?? createStarterRoutines()).flatMap((template) => placed(template) ?? []),
  );
  const byName = new Map(rows.map((routine) => [routine.name.trim().toLowerCase(), routine]));
  const byId = new Map(rows.map((routine) => [routine.routine_id, routine]));

  /** `routine_id` -> the Local_Day_Key it last fired on. */
  const fired = new Map<string, string>();
  /** `${dayKey}|${deviceId}` -> minutes of play recorded that local day. */
  const played = new Map<string, number>();
  /** The Local_Day_Keys whose Nap_Sequence has already been requested. */
  const naps = new Set<string>();

  const seededDay = localDayKey(deps.clock.now());
  for (const [deviceId, minutes] of Object.entries(deps.playMinutes ?? {})) {
    played.set(playKey(seededDay, deviceId), minutes);
  }

  return {
    // ----- the Phase 3 `Routines` members, unchanged in shape

    lookup(name) {
      const routine = byName.get(name.trim().toLowerCase());
      if (routine === undefined) return { ok: false, reason: "unknown_routine" };
      // A disabled routine is reported as disabled rather than silently answered, so a child is
      // never told a time the parent has switched off.
      if (!routine.enabled) return { ok: false, reason: "disabled" };
      return { ok: true, name: routine.name, at: routine.at };
    },

    names: () => rows.map((routine) => routine.name),

    playMinutesUsed: (deviceId) =>
      played.get(playKey(localDayKey(deps.clock.now()), deviceId)) ?? 0,

    // ----- the Phase 4 members

    routines: () => rows,

    byId: (routineId) => byId.get(routineId) ?? null,

    dueAt(nowMinutes, dayKey) {
      return rows.filter((routine) => {
        if (!routine.enabled) return false;
        if (fired.get(routine.routine_id) === dayKey) return false;
        const atMinutes = hhmmToMinutes(routine.at);
        return atMinutes !== null && withinCatchUp(atMinutes, nowMinutes);
      });
    },

    markFired(routineId, dayKey) {
      if (fired.get(routineId) === dayKey) return false;
      fired.set(routineId, dayKey);
      return true;
    },

    addPlayMinutes(deviceId, minutes, dayKey) {
      const key = playKey(dayKey, deviceId);
      const before = played.get(key) ?? 0;
      const after = before + minutes;
      played.set(key, after);
      return { before, after };
    },

    napFired: (dayKey) => naps.has(dayKey),

    markNap(dayKey) {
      if (naps.has(dayKey)) return false;
      naps.add(dayKey);
      return true;
    },
  };
}
