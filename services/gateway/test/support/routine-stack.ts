// Test helper (not a test): the Phase 4 scheduled stack, wired exactly as `gateway.ts` wires it.
//
// It exists so `routine-scheduler.test.ts` and `play-limit.test.ts` cannot drift from each other
// or from the composition root. It adds no behaviour: the Routine_Store, the Charge_Reminders,
// the Activity_Store, the Play_Accrual and the Routine_Scheduler are constructed here with the
// same dependencies and in the same order as in production, over the real Clock, the real
// Deadlines, the real Child_Context table and the REAL unchanged Device_Policy_Gate.
//
// The gate is the real one on purpose: what the scheduler guarantees is about the composition,
// and a mock of the gate would prove nothing about the one invariant that matters (C16).
import { createStarterWords, type RoutineTemplate, type WordEntry } from "@xelulu/shared";

import { createDeadlines, type Deadlines } from "../../src/deadlines.js";
import { randomIds } from "../../src/ids.js";
import { createGatewayLog, type GatewayLog } from "../../src/log/gateway-log.js";
import { localMinutes } from "../../src/brain/story/word-of-the-day.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
  type DevicePolicy,
} from "../../src/brain/state/child-context.js";
import { createDeviceActions, type DeviceActions } from "../../src/brain/tools/device-action.js";
import { createConsentStore, type ConsentStore } from "../../src/grandma/consent-store.js";
import { createGrandmaStore, type GrandmaStore } from "../../src/grandma/grandma-store.js";
import type { CommandRequest } from "../../src/mqtt/command-sender.js";
import { createActivityStore, type ActivityStore } from "../../src/reports/activity-store.js";
import {
  createChargeReminders,
  type ChargeReminders,
} from "../../src/routines/charge-reminders.js";
import { createPlayTime, type PlayTime } from "../../src/routines/play-time.js";
import {
  createRoutineScheduler,
  type RoutineScheduler,
} from "../../src/routines/routine-scheduler.js";
import { grandmaPlaybackNarration } from "../../src/routines/routine-behaviours.js";
import { createRoutineStore, type RoutineStore } from "../../src/routines/routine-store.js";
import { DEV_HOUSEHOLD_ID, DEV_USER_ID } from "../../src/grandma/household.js";
import { createCaptureSink } from "./capture-sink.js";
import { createTestClock, type TestClock } from "./test-clock.js";

export const DEVICE = "xlu_000123";

/** The one household and the one user every Phase 4 row belongs to (C34, Req 7.9, 7.9a). */
export { DEV_HOUSEHOLD_ID, DEV_USER_ID };

export const OPEN_POLICY: DevicePolicy = Object.freeze({
  quietHours: null,
  playLimitMinutes: null,
  movementOn: true,
});

/**
 * A Clock time whose LOCAL hour and minute are `hh:mm`, on a fixed local day plus `dayOffset`.
 *
 * Built with the local `Date` constructor rather than from a UTC literal, so every assertion
 * about a routine's `HH:MM`, the Local_Day_Key and quiet hours holds in any host time zone.
 */
export function atLocal(hh: number, mm: number, dayOffset = 0): number {
  const d = new Date(2026, 9, 24, hh, mm, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.getTime();
}

export type RoutineStack = Readonly<{
  scheduler: RoutineScheduler;
  routines: RoutineStore;
  reminders: ChargeReminders;
  activity: ActivityStore;
  play: PlayTime;
  consent: ConsentStore;
  grandma: GrandmaStore;
  actions: DeviceActions;
  context: ChildContextTable;
  clock: TestClock;
  deadlines: Deadlines;
  log: GatewayLog;
  /** Every command the gate actually published, in order. */
  sent: CommandRequest[];
  entries: () => readonly Readonly<Record<string, unknown>>[];
  entriesOf: (kind: string) => readonly Readonly<Record<string, unknown>>[];
  /** Moves the clock and fires every due deadline, exactly as the gateway does per input. */
  tickTo: (ms: number) => void;
}>;

export type StackOptions = Readonly<{
  startMs?: number;
  policy?: DevicePolicy;
  over?: Partial<ChildContext>;
  /** Defaults to the Starter_Content's six templates — their only source (Req 10.1a). */
  seed?: readonly RoutineTemplate[];
  playMinutes?: Readonly<Record<string, number>>;
  words?: readonly WordEntry[];
  /**
   * Whether the Nth (1-based) command publishes. `false` fails every one, and a function fails a
   * chosen one: both are the Req 10.4a send-failure case, which is NOT a policy refusal.
   */
  sendOk?: boolean | ((nth: number) => boolean);
  /** Defaults to the one configured device, as the composition root binds it. */
  devices?: () => readonly string[];
}>;

export function createRoutineStack(options: StackOptions = {}): RoutineStack {
  const clock = createTestClock(options.startMs ?? atLocal(12, 0));
  const log = createGatewayLog(clock, createCaptureSink());
  const deadlines = createDeadlines(clock);
  const sent: CommandRequest[] = [];

  const ctx: ChildContext = {
    ...MOST_RESTRICTIVE_CONTEXT,
    ageStage: "little",
    langs: ["en-IN"],
    allowedCategories: ["stories", "songs", "animals", "world", "games"],
    policy: options.policy ?? OPEN_POLICY,
    ...options.over,
  };
  const context: ChildContextTable = {
    setActiveChild: () => undefined,
    forDevice: () => ctx,
    childKeyFor: () => "child:test",
  };

  const routines = createRoutineStore({
    clock,
    seed: options.seed,
    playMinutes: options.playMinutes,
  });
  // The real gate, unchanged, reading the same Child_Context and the same Routine_Store the
  // scheduler reads — so a routine and a turn cannot disagree about who is listening (Req 10.11).
  const actions = createDeviceActions({
    sendCommand: (request) => {
      sent.push(request);
      const rule = options.sendOk ?? true;
      const ok = typeof rule === "function" ? rule(sent.length) : rule;
      return ok
        ? { ok: true, cmd_id: `cmd_${String(sent.length)}` }
        : { ok: false, error: { code: "device_offline" } };
    },
    context,
    routines,
    nowMinutes: () => localMinutes(clock.now()),
  });

  const activity = createActivityStore({ ids: randomIds });
  const consent = createConsentStore({ clock, ids: randomIds });
  const grandma = createGrandmaStore({
    clock,
    ids: randomIds,
    log,
    consent,
    narration: grandmaPlaybackNarration,
  });
  const reminders = createChargeReminders();

  // The one-directional pair, bound exactly as the composition root binds it: `createPlayTime`
  // takes `fireNap` from the scheduler and the scheduler takes `accruePlay` from it.
  const play = createPlayTime({
    clock,
    routines,
    context,
    activity,
    fireNap: (deviceId) => scheduler.fireNap(deviceId),
  });
  const scheduler = createRoutineScheduler({
    clock,
    deadlines,
    log,
    actions,
    context,
    routines,
    grandma,
    reminders,
    activity,
    play,
    words: options.words ?? createStarterWords(),
    devices: options.devices ?? (() => [DEVICE]),
  });

  const entries = (): readonly Readonly<Record<string, unknown>>[] =>
    log.since(0) as readonly Readonly<Record<string, unknown>>[];

  return {
    scheduler,
    routines,
    reminders,
    activity,
    play,
    consent,
    grandma,
    actions,
    context,
    clock,
    deadlines,
    log,
    sent,
    entries,
    entriesOf: (kind) => entries().filter((entry) => entry.kind === kind),
    tickTo: (ms) => {
      clock.set(ms);
      deadlines.fireDue(ms);
    },
  };
}

/** A command's `data` is `unknown` on the wire type, so a test reads it as a plain record. */
export function dataOf(command: CommandRequest | undefined): Readonly<Record<string, unknown>> {
  return (command?.data ?? {}) as Readonly<Record<string, unknown>>;
}

/** A live `grandma_recording` consent and one ready recording scheduled at `at`. */
export function seedRecording(
  stack: RoutineStack,
  at: string,
  over: Readonly<{ title?: string; durationS?: number }> = {},
): string {
  const recorded = stack.consent.record({
    household_id: DEV_HOUSEHOLD_ID,
    user_id: DEV_USER_ID,
    purpose: "grandma_recording",
    version: "v1",
    verification_method: "identity_details",
  });
  if (!recorded.ok) throw new Error(`consent refused on ${recorded.field}`);
  const added = stack.grandma.add({
    household_id: DEV_HOUSEHOLD_ID,
    recorded_by_user_id: DEV_USER_ID,
    consent_record_id: recorded.consent.consent_id,
    kind: "story",
    title: over.title ?? "the kind crow",
    lang: "en-IN",
    duration_s: over.durationS ?? 120,
  });
  if (!added.ok) throw new Error(`recording refused ${added.reason}`);
  const scheduled = stack.grandma.schedule(added.value.asset_id, at, true);
  if (!scheduled.ok) throw new Error(`schedule refused ${scheduled.reason}`);
  return added.value.asset_id;
}
