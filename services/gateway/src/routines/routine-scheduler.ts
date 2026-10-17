// The Routine_Scheduler (Phase 4 Req 10, 11, 12, 13.4): the one thing in the Gateway that fires
// a behaviour nobody asked for in a turn.
//
// EVERY command it sends goes through the UNCHANGED Phase 3 Device_Policy_Gate in
// `brain/tools/device-action.ts` (C16, safety.md §5). This module never calls `sendCommand`, adds
// no second policy path and holds no exemption: quiet hours, the play limit and the movement
// toggle are checked before anything reaches the broker, and an ack `reason` is final because
// nothing here registers an ack callback or retries.
//
// Reading the refusal takes two calls, and that is deliberate. `DeviceActions.request` answers
// the opaque `{ outcome: "denied", reason: "policy" }` and must not change — a model may not
// learn why — so the scheduler reads `policyRefusal(deviceId, action)` first for the enum the
// `routine_fired` entry needs, and then `request` to send (Req 10.12).
//
// A SEND FAILURE IS NOT A POLICY REFUSAL (Req 10.4a). When the gate allowed an action and the
// sender answered `error`, the behaviour stops there, the action is counted in `refused` with
// `refusal: null`, nothing is retried, and play minutes accrue only if an earlier action was
// actually published. A send failure therefore reads in the log as `refused > 0` with `refusal`
// null, which no policy refusal produces.
//
// THE TICK FIRES NO NAP (Req 13.5a). The Nap_Sequence is fired by `accruePlay` on the crossing,
// because a tick could only ever find the limit already reached — where the gate refuses the nap
// `play_limit`, the dead path C18 exists to avoid. The dependency runs one way: this module hands
// `fireNap` to `createPlayTime` and nothing is reported back.
import {
  type ActivityRecord,
  type AgeStage,
  type GrandmaRefusal,
  type PolicyRefusal,
  type RoutineTrigger,
  type SafetyRule,
  type SupportedLang,
  type WordEntry,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { GatewayLog } from "../log/gateway-log.js";
import { checkOutput } from "../brain/safety/output-guard.js";
import type { ChildContextTable } from "../brain/state/child-context.js";
import { localDayKey, localMinutes, wordForDay } from "../brain/story/word-of-the-day.js";
import type { DeviceActions } from "../brain/tools/device-action.js";
import type { GrandmaRecording, GrandmaStore } from "../grandma/grandma-store.js";
import type { ChargeReminders } from "./charge-reminders.js";
import type { PlayTime } from "./play-time.js";
import {
  behaviourActions,
  type BehaviourAction,
  type FireResult,
  type RoutineBehaviourId,
} from "./routine-behaviours.js";
import type { Routine, RoutineStore } from "./routine-store.js";

/** One tick a minute. Recomputed from the Clock each time, so nothing is a stale countdown. */
export const SCHEDULER_TICK_MS = 60_000;

/** The one Deadlines key the scheduler owns. It re-arms itself. */
export const SCHEDULER_TICK_KEY = "routines:tick";

/** The `routine_fired` `ref_id` of a Nap_Sequence, which has no row of its own. */
export const NAP_REF_ID = "nap";

/** The Content_Category the Word_Of_The_Day sits in, on the turn path and on this one (C38). */
const WORD_CATEGORY = "world";

/** Which behaviour each charge threshold fires. `battery_20` nods; `battery_10` does not (C37). */
const BATTERY_BEHAVIOURS: Readonly<Record<number, RoutineBehaviourId>> = Object.freeze({
  20: "battery_20",
  10: "battery_10",
});

export type { FireResult } from "./routine-behaviours.js";

export interface RoutineScheduler {
  start(): void;
  stop(): void;
  /** Fires a named routine now, for `POST /v1/routines/run`: trigger `manual`, no day mark. */
  run(deviceId: string, routineId: string, trigger: RoutineTrigger): FireResult;
  /** Called from the status path, after the Child_Context is updated (Req 11.1). */
  onStatus(deviceId: string, batteryPct: number, charging: boolean): void;
  /**
   * Supplied TO `play-time.ts` and not called back into here. There is deliberately no
   * `onPlayMinutes` member: one that re-read nothing and decided nothing is a member to delete
   * (Req 13.5a).
   */
  fireNap(deviceId: string): FireResult;
}

/** A firing's outcome plus the one thing `FireResult` cannot carry: a refused narration's rule. */
type Fired = FireResult & { readonly gateRule: SafetyRule | null };

const NOTHING: Fired = Object.freeze({
  actions: 0,
  sent: 0,
  refused: 0,
  refusal: null,
  gateRule: null,
});

function result(fired: Fired): FireResult {
  return {
    actions: fired.actions,
    sent: fired.sent,
    refused: fired.refused,
    refusal: fired.refusal,
  };
}

export function createRoutineScheduler(
  deps: Readonly<{
    clock: Clock;
    deadlines: Deadlines;
    log: Pick<GatewayLog, "add">;
    /** The unchanged Phase 3 gate. The scheduler never calls `sendCommand`. */
    actions: DeviceActions;
    context: ChildContextTable;
    routines: RoutineStore;
    grandma: Pick<GrandmaStore, "dueAt" | "markPlayed">;
    reminders: ChargeReminders;
    activity: Readonly<{ add(input: Omit<ActivityRecord, "activity_id">): ActivityRecord }>;
    /**
     * The one play-minute writer (Req 13.1). Bound in the composition root, which breaks the
     * two-way shape of the pair: `createPlayTime` takes `fireNap` from here, and this takes
     * `accruePlay` from there, so neither module imports the other's factory.
     */
    play: Pick<PlayTime, "accruePlay">;
    words: readonly WordEntry[];
    /** Scheduler_Devices, bound in the composition root (Req 10.13). Called on every tick. */
    devices: () => readonly string[];
  }>,
): RoutineScheduler {
  let running = false;

  /** Nothing fires and nothing is logged for a device outside the list (Req 10.13). */
  function scheduled(deviceId: string): boolean {
    return deps.devices().includes(deviceId);
  }

  /**
   * The first `say` whose narration the Output_Guard refuses, or null (Req 8.3, 10.8). Every
   * narration is a template constant, so this is the belt to the templates' braces — but it runs
   * before anything is sent, because a guard that only runs on the paths we expect to fail is
   * not a guard.
   */
  function narrationRefusal(
    actions: readonly BehaviourAction[],
    ctx: Readonly<{ ageStage: AgeStage; lang: SupportedLang }>,
  ): SafetyRule | null {
    for (const action of actions) {
      if (action.narration === null) continue;
      const verdict = checkOutput(action.narration, {
        ageStage: ctx.ageStage,
        lang: ctx.lang,
        allowedCategories: [],
        deferTopics: [],
      });
      if (verdict.decision !== "allow") return verdict.rule;
    }
    return null;
  }

  /**
   * Builds a behaviour for the device's active Child_Context and asks the gate to send each
   * action in order, stopping at the first refusal (Req 10.3, 10.4). Sends nothing at all when a
   * narration is refused.
   */
  function fire(
    deviceId: string,
    id: RoutineBehaviourId,
    over: Readonly<{ refId: string | null; word: WordEntry | null; title: string | null }>,
  ): Fired {
    const ctx = deps.context.forDevice(deviceId);
    const lang: SupportedLang = ctx.langs[0] ?? "en-IN";
    const actions = behaviourActions(id, {
      lang,
      ageStage: ctx.ageStage,
      refId: over.refId,
      word: over.word,
      title: over.title,
    });

    const gateRule = narrationRefusal(actions, { ageStage: ctx.ageStage, lang });
    if (gateRule !== null) {
      return { actions: actions.length, sent: 0, refused: 1, refusal: null, gateRule };
    }

    let sent = 0;
    for (const action of actions) {
      const refusal: PolicyRefusal | null = deps.actions.policyRefusal(deviceId, action.action);
      if (refusal !== null) {
        return { actions: actions.length, sent, refused: 1, refusal, gateRule: null };
      }
      const answer = deps.actions.request(deviceId, { action: action.action, data: action.data });
      if (!answer.ok) {
        // The gate allowed it and the sender failed: counted, not retried, and not a refusal.
        return { actions: actions.length, sent, refused: 1, refusal: null, gateRule: null };
      }
      sent += 1;
    }
    return { actions: actions.length, sent, refused: 0, refusal: null, gateRule: null };
  }

  function logFired(
    deviceId: string,
    trigger: RoutineTrigger,
    fired: Fired,
    over: Readonly<{ refId: string | null; threshold: number | null; batteryPct: number | null }>,
  ): void {
    deps.log.add({
      kind: "routine_fired",
      device_id: deviceId,
      trigger,
      ref_id: over.refId,
      threshold: over.threshold,
      battery_pct: over.batteryPct,
      actions: fired.actions,
      sent: fired.sent,
      refused: fired.refused,
      refusal: fired.refusal,
    });
  }

  function addActivity(
    deviceId: string,
    kind: ActivityRecord["kind"],
    refId: string | null,
    categories: readonly string[],
  ): void {
    deps.activity.add({
      device_id: deviceId,
      kind,
      at: isoAt(deps.clock.now()),
      ref_id: refId,
      minutes: null,
      categories: [...categories],
    });
  }

  /**
   * The day's word for a `morning` firing, INSIDE the parent's category gate exactly as the turn
   * path is (C38, Req 5.3a, 5.4b). A null answer is the single signal for the Requirement 5.4b
   * greeting and covers both of its causes.
   */
  function morningWord(deviceId: string): WordEntry | null {
    const ctx = deps.context.forDevice(deviceId);
    if (!ctx.allowedCategories.includes(WORD_CATEGORY)) return null;
    return wordForDay(deps.words, deps.clock.now(), ctx.langs[0] ?? "en-IN");
  }

  function fireRoutine(deviceId: string, routine: Routine, trigger: RoutineTrigger): FireResult {
    const word = routine.behaviour === "morning" ? morningWord(deviceId) : null;
    const fired = fire(deviceId, routine.behaviour, {
      refId: routine.routine_id,
      word,
      title: null,
    });
    logFired(deviceId, trigger, fired, {
      refId: routine.routine_id,
      threshold: null,
      batteryPct: null,
    });
    if (fired.sent >= 1) {
      addActivity(deviceId, "routine", routine.routine_id, []);
      // The `say` is a behaviour's first action, so `sent >= 1` is exactly "the word was spoken"
      // (Req 5.7). A `morning` firing therefore appends BOTH a `routine` and a `word` record.
      if (word !== null) addActivity(deviceId, "word", word.word_id, [WORD_CATEGORY]);
      deps.play.accruePlay(deviceId, 1, "routine", routine.routine_id);
    }
    return result(fired);
  }

  function firePlayback(deviceId: string, recording: GrandmaRecording): void {
    const fired = fire(deviceId, "grandma_play", {
      refId: recording.asset_id,
      word: null,
      title: recording.title,
    });
    // One `grandma_event` per occurrence, carrying ids and closed enums only — never the title,
    // never the Media_Handle and never a reason text (Req 8.3a, 8.4, 8.6). A refused narration
    // reads `gate_refused`; a gate or sender refusal reads the single `policy` code, because the
    // precise Policy_Refusal is a `routine_fired` field and not one of these.
    let reason: GrandmaRefusal | null = null;
    if (fired.gateRule !== null) reason = "gate_refused";
    else if (fired.sent < fired.actions) reason = "policy";
    deps.log.add({
      kind: "grandma_event",
      device_id: deviceId,
      asset_id: recording.asset_id,
      call_id: null,
      event: "play_started",
      outcome: reason === null ? "ok" : "refused",
      reason,
      call_state: null,
    });
    if (fired.sent >= 1) {
      addActivity(deviceId, "story", recording.asset_id, ["stories"]);
      deps.play.accruePlay(
        deviceId,
        Math.ceil(recording.duration_s / 60),
        "grandma",
        recording.asset_id,
      );
    }
  }

  function tick(): void {
    if (!running) return;
    const now = deps.clock.now();
    const dayKey = localDayKey(now);
    const minuteOfDay = localMinutes(now);
    // Recomputed from the Clock every tick, so a routine added, disabled or re-timed between
    // firings is simply read again (Req 10.9). Called rather than cached, so a device starts
    // being scheduled the moment its `hello` lands (Req 10.13).
    for (const deviceId of deps.devices()) {
      for (const routine of deps.routines.dueAt(minuteOfDay, dayKey)) {
        // Marked BEFORE firing, so a refused or failed occurrence is not retried (Req 10.4, 10.6).
        if (!deps.routines.markFired(routine.routine_id, dayKey)) continue;
        fireRoutine(deviceId, routine, "schedule");
      }
      for (const recording of deps.grandma.dueAt(minuteOfDay, dayKey)) {
        deps.grandma.markPlayed(recording.asset_id, dayKey);
        firePlayback(deviceId, recording);
      }
    }
    arm();
  }

  function arm(): void {
    if (!running) return;
    deps.deadlines.schedule(SCHEDULER_TICK_KEY, deps.clock.now() + SCHEDULER_TICK_MS, tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      arm();
    },

    stop() {
      running = false;
      deps.deadlines.cancel(SCHEDULER_TICK_KEY);
    },

    run(deviceId, routineId, trigger) {
      if (!scheduled(deviceId)) return result(NOTHING);
      const routine = deps.routines.byId(routineId);
      // An unknown id fires nothing and logs nothing; the route answers `unknown_content`'s
      // sibling refusal from its own `byId` read before it gets here (Req 16.7).
      if (routine === null) return result(NOTHING);
      // Deliberately no day mark: a manual run is the operator's, and it must not consume the
      // day's scheduled occurrence.
      return fireRoutine(deviceId, routine, trigger);
    },

    onStatus(deviceId, batteryPct, charging) {
      if (!scheduled(deviceId)) return;
      for (const threshold of deps.reminders.onStatus(deviceId, batteryPct, charging)) {
        const behaviour = BATTERY_BEHAVIOURS[threshold];
        if (behaviour === undefined) continue;
        const fired = fire(deviceId, behaviour, { refId: null, word: null, title: null });
        // `ref_id` is null for a battery trigger; the threshold and the reading carry it instead.
        logFired(deviceId, "battery", fired, {
          refId: null,
          threshold,
          batteryPct,
        });
      }
    },

    fireNap(deviceId) {
      const fired = fire(deviceId, "nap", { refId: NAP_REF_ID, word: null, title: null });
      logFired(deviceId, "play_limit", fired, {
        refId: NAP_REF_ID,
        threshold: null,
        batteryPct: null,
      });
      // No Activity_Record and no accrual: the nap is not one of the three accrual sources, and
      // `accruePlay` is the caller — accruing here would re-enter it (Req 13.1).
      return result(fired);
    },
  };
}
