// Play_Accrual (Phase 4 Req 13.1, 13.2, C18): one owner, one call.
//
// The ledger, the `play` Activity_Record and the Nap_Sequence crossing are three consequences of
// ONE event, so they live behind one function rather than three callers agreeing to be
// consistent. `accruePlay` is the only writer of the play ledger and of the `play` record, which
// is why `playMinutesUsed` and `play_minutes` cannot drift.
//
// THE ORDER IS THE WHOLE OF C18 AND IS NOT NEGOTIABLE:
//
//   1. read the day's total and the active Child_Context's `playLimitMinutes`
//   2. if `before < limit && before + minutes >= limit`, fire the Nap_Sequence through the
//      UNCHANGED Device_Policy_Gate — which allows it, because `playMinutesUsed` still reports
//      `before`
//   3. `addPlayMinutes(...)` — the ledger closes, and every later behaviour is refused
//      `play_limit` on the gate's own unchanged rule
//   4. append the `play` Activity_Record
//
// There is NO gate exemption, no lead margin and no second policy path: `device-action.ts` is not
// edited, and the nap is sent before the ledger closes precisely so it does not need to be.
//
// The dependency runs ONE WAY. The Routine_Scheduler hands `fireNap(deviceId)` in, and
// `accruePlay` calls it on the crossing; nothing is reported back, and the scheduler has no
// play-minutes notification member at all (Req 13.5a).
//
// No `log` dependency, deliberately: the nap's `routine_fired` entry is written by the scheduler
// that fires it, and an accrual is not itself a log event — the `play` Activity_Record is the
// record of it.
import type { ActivityRecord } from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import { localDayKey } from "../brain/story/word-of-the-day.js";
import type { ChildContextTable } from "../brain/state/child-context.js";
import type { FireResult } from "./routine-behaviours.js";
import type { RoutineStore } from "./routine-store.js";

/**
 * Named `PlayAccrualSource` and NOT `PlaySource`, because `PlaySource` is a `gateway-contract`
 * export (the `play.data.source` union) and `tooling/checks/contract-use.ts`'s
 * `contract_type_name` rule flags any declaration under a service `src` tree named like one. The
 * check is not relaxed to fit a name (Req 20.4). These three values are this module's own accrual
 * sources and belong to no contract list.
 */
export type PlayAccrualSource = "turn" | "routine" | "grandma";

export type PlayAccrual = Readonly<{
  before: number;
  after: number;
  /** What the Nap_Sequence did, or null when this accrual crossed nothing. */
  napFired: FireResult | null;
}>;

export interface PlayTime {
  /**
   * The only writer of the play ledger and of the `play` Activity_Record, and the only place the
   * Nap_Sequence crossing is noticed. Answers what happened, so a test can tell a nap from
   * silence.
   */
  accruePlay(
    deviceId: string,
    minutes: number,
    source: PlayAccrualSource,
    sourceRefId: string | null,
  ): PlayAccrual;
}

export function createPlayTime(
  deps: Readonly<{
    clock: Clock;
    routines: RoutineStore;
    context: ChildContextTable;
    activity: Readonly<{ add(input: Omit<ActivityRecord, "activity_id">): ActivityRecord }>;
    /** Fires the `nap` behaviour through the Device_Policy_Gate. Supplied by the scheduler. */
    fireNap: (deviceId: string) => FireResult;
  }>,
): PlayTime {
  return {
    accruePlay(deviceId, minutes, source, sourceRefId) {
      const now = deps.clock.now();
      const dayKey = localDayKey(now);
      const before = deps.routines.playMinutesUsed(deviceId);
      // Total rather than trusting a caller's arithmetic: a non-positive or unreadable figure
      // records nothing and crosses nothing, so a bad call can never charge a child play time.
      const whole = Number.isFinite(minutes) && minutes > 0 ? Math.ceil(minutes) : 0;
      if (whole === 0) return { before, after: before, napFired: null };

      const limit = deps.context.forDevice(deviceId).policy.playLimitMinutes;
      let napFired: FireResult | null = null;
      // (2) The crossing, BEFORE the ledger closes. An accrual landing at or above a limit that
      // was already reached crosses nothing and fires nothing (Req 13.2).
      if (
        limit !== null &&
        before < limit &&
        before + whole >= limit &&
        deps.routines.markNap(dayKey)
      ) {
        napFired = deps.fireNap(deviceId);
      }
      // (3) The ledger closes; from here the gate refuses every ordinary behaviour `play_limit`.
      const { after } = deps.routines.addPlayMinutes(deviceId, whole, dayKey);
      // (4) The record: the source's ref id, the minutes, and no text of any kind (Req 13.7).
      // `source` names which of the three accrual paths this was and is deliberately NOT stored:
      // an Activity_Record carries the six fields Req 14.1 lists and no seventh (C20).
      deps.activity.add({
        device_id: deviceId,
        kind: "play",
        at: isoAt(now),
        ref_id: sourceRefId,
        minutes: whole,
        categories: [],
      });
      return { before, after, napFired };
    },
  };
}
