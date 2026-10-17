// The Routine_Scheduler (Phase 4 Req 10, 11, 12): the six seeded routines, the two charge
// reminders, the Grandma schedules, and the one gate every one of them goes through.
//
// Three things are asserted that the feature would be unsafe without:
//
//   1. NO COMMAND IS PUBLISHED during quiet hours, and none for a movement-bearing action with
//      the movement toggle off — for a ROUTINE (through `morning`'s `gesture`) and for a CHARGE
//      REMINDER (through `battery_20`'s), so neither half of Req 12.7 is vacuous.
//   2. Property 6: the number of commands published equals the number of leading actions the
//      unchanged Device_Policy_Gate allows, and the entry's counts and `refusal` match exactly.
//   3. Property 9: each enabled routine fires at most once per Local_Day_Key, and a manual run
//      neither consumes nor suppresses the day's firing.
//
// Everything here runs against the REAL gate, the real Clock, the real Deadlines and the real
// Child_Context table. A mock of the gate would prove nothing about the one invariant that
// matters (C16), and the socket guard is installed for the whole file because nothing scheduled
// may open a connection.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  AGE_STAGES,
  CHARGE_THRESHOLDS,
  SUPPORTED_LANGS,
  createStarterRoutines,
  createStarterWords,
  type RoutineTemplate,
} from "@xelulu/shared";

import { checkOutput } from "../src/brain/safety/output-guard.js";
import { localMinutes, wordForDay } from "../src/brain/story/word-of-the-day.js";
import { ROUTINE_MAX_ACTIONS } from "../src/routines/routine-store.js";
import {
  behaviourActions,
  LED_WARM,
  ROUTINE_BEHAVIOUR_IDS,
  type BehaviourAction,
} from "../src/routines/routine-behaviours.js";
import { SCHEDULER_TICK_MS } from "../src/routines/routine-scheduler.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import {
  atLocal,
  createRoutineStack,
  dataOf,
  DEVICE,
  seedRecording,
  type RoutineStack,
} from "./support/routine-stack.js";

let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

/** The six seeded rows, from `createStarterRoutines()` — now their only source (Req 10.1a). */
const SEEDED = createStarterRoutines();

function startAndTick(stack: RoutineStack, hh: number, mm: number, dayOffset = 0): void {
  stack.scheduler.start();
  stack.tickTo(atLocal(hh, mm, dayOffset));
}

// ---------------------------------------------------------------------------------------------
// The seeded six

describe("the seeded routines (Req 10.1, 10.1a)", () => {
  it("holds exactly the six rows the Starter_Content declares, with their times", () => {
    const stack = createRoutineStack();
    expect(stack.routines.routines().map((r) => [r.routine_id, r.name, r.at])).toEqual([
      ["morning", "morning", "07:00"],
      ["brushing", "brushing", "08:00"],
      ["meals", "meals", "12:30"],
      ["play_time", "play time", "17:00"],
      ["wind_down", "wind down", "20:00"],
      ["bedtime", "bedtime", "20:30"],
    ]);
    // `routine_lookup`'s own answers are unchanged by the move off the deleted fixture.
    expect(stack.routines.lookup("bedtime")).toEqual({ ok: true, name: "bedtime", at: "20:30" });
    expect(stack.routines.lookup("nope")).toEqual({ ok: false, reason: "unknown_routine" });
    expect(stack.routines.names()).toEqual(SEEDED.map((row) => row.name));
  });

  it("drops a template whose behaviour this Gateway cannot place", () => {
    const seed: readonly RoutineTemplate[] = [
      ...SEEDED,
      { routine_id: "x", name: "x", at: "09:00", enabled: true, behaviour: "not_a_behaviour" },
    ];
    const stack = createRoutineStack({ seed });
    expect(stack.routines.byId("x")).toBeNull();
    expect(stack.routines.routines()).toHaveLength(SEEDED.length);
  });

  it("keeps every behaviour inside the action cap and the five allowed actions", () => {
    for (const id of ROUTINE_BEHAVIOUR_IDS) {
      const actions = behaviourActions(id, {
        lang: "en-IN",
        ageStage: "little",
        refId: null,
        word: null,
        title: "a story",
      });
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.length).toBeLessThanOrEqual(ROUTINE_MAX_ACTIONS);
      for (const action of actions) {
        // `move` is never asked for, and no behaviour sends `play` this phase (C30, Req 10.2).
        expect(["say", "animate", "gesture", "led"]).toContain(action.action);
        // No `rainbow` and no flash rate, ever (safety.md §6, Req 9.8).
        if (action.action === "led") expect(["solid", "pulse"]).toContain(action.data["effect"]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Property 1's scheduled half: every narration passes the Output_Guard at every stage it meets

describe("Property 1 (scheduled narrations): every say passes the Output_Guard", () => {
  it("passes at every Age_Stage and language a scheduled behaviour can meet", () => {
    const words = createStarterWords();
    for (const id of ROUTINE_BEHAVIOUR_IDS) {
      for (const lang of SUPPORTED_LANGS) {
        for (const stage of AGE_STAGES) {
          // Both `morning` shapes: the Word_Of_The_Day, and the Req 5.4b greeting.
          const wordsForLang = [wordForDay(words, atLocal(12, 0), lang), null];
          for (const word of wordsForLang) {
            const actions = behaviourActions(id, {
              lang,
              ageStage: stage,
              refId: null,
              word,
              title: "the kind crow",
            });
            for (const action of actions) {
              if (action.narration === null) continue;
              const verdict = checkOutput(action.narration, {
                ageStage: stage,
                lang,
                allowedCategories: [],
                deferTopics: [],
              });
              expect(verdict, `${id} / ${lang} / ${stage} / word=${String(word !== null)}`).toEqual(
                { decision: "allow", rule: "none", topic: null },
              );
            }
          }
        }
      }
    }
  });

  it("holds at tiny, the Age_Stage a device with no active child is given", () => {
    // One sentence of eight words, which is what `MOST_RESTRICTIVE_CONTEXT` gives (Req 10.11).
    const stack = createRoutineStack({
      startMs: atLocal(6, 59),
      over: { ageStage: "tiny", langs: ["en-IN"] },
    });
    startAndTick(stack, 7, 0);
    expect(stack.sent.map((c) => c.action)).toEqual(["say", "animate", "gesture", "led"]);
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// Firing, in order, through the gate

describe("a due routine fires its behaviour in order (Req 10.3)", () => {
  it("publishes morning's four actions and writes one routine_fired entry", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59) });
    startAndTick(stack, 7, 0);

    expect(stack.sent.map((c) => c.action)).toEqual(["say", "animate", "gesture", "led"]);
    expect(stack.sent.every((c) => c.device_id === DEVICE)).toBe(true);
    expect(dataOf(stack.sent[2])).toEqual({ name: "wave" });
    expect(dataOf(stack.sent[3])).toEqual({ ...LED_WARM });

    const fired = stack.entriesOf("routine_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      device_id: DEVICE,
      trigger: "schedule",
      ref_id: "morning",
      threshold: null,
      battery_pct: null,
      actions: 4,
      sent: 4,
      refused: 0,
      refusal: null,
    });
    // No narration, no title and no text of any kind on the entry.
    expect(Object.keys(fired[0] ?? {}).sort()).toEqual([
      "actions",
      "at",
      "battery_pct",
      "device_id",
      "kind",
      "log_ver",
      "ref_id",
      "refusal",
      "refused",
      "sent",
      "seq",
      "threshold",
      "trigger",
    ]);
    stack.scheduler.stop();
  });

  it("fires inside the catch-up window and not retroactively (Req 10.10)", () => {
    const late = createRoutineStack({ startMs: atLocal(7, 3) });
    startAndTick(late, 7, 4);
    expect(late.entriesOf("routine_fired")).toHaveLength(1);
    late.scheduler.stop();

    // Ten minutes late is outside the window: the occurrence is missed, not caught up.
    const tooLate = createRoutineStack({ startMs: atLocal(7, 9) });
    startAndTick(tooLate, 7, 10);
    expect(tooLate.entriesOf("routine_fired")).toEqual([]);
    tooLate.scheduler.stop();
  });

  it("fires nothing for a disabled routine", () => {
    const seed = SEEDED.map((row) =>
      row.routine_id === "morning" ? { ...row, enabled: false } : row,
    );
    const stack = createRoutineStack({ startMs: atLocal(6, 59), seed });
    startAndTick(stack, 7, 0);
    expect(stack.sent).toEqual([]);
    expect(stack.entriesOf("routine_fired")).toEqual([]);
    // And `routine_lookup` reports it disabled rather than answering a time (Phase 3).
    expect(stack.routines.lookup("morning")).toEqual({ ok: false, reason: "disabled" });
    stack.scheduler.stop();
  });

  it("re-reads the routines on every tick rather than holding a countdown (Req 10.9)", () => {
    // `meals` is at 12:30 and `brushing` at 08:00; one scheduler, two ticks, two firings, with
    // the times read from the store each time rather than armed once at start().
    const stack = createRoutineStack({ startMs: atLocal(7, 59) });
    stack.scheduler.start();
    stack.tickTo(atLocal(8, 0));
    stack.tickTo(atLocal(12, 30));
    expect(stack.entriesOf("routine_fired").map((e) => e.ref_id)).toEqual(["brushing", "meals"]);
    stack.scheduler.stop();
  });

  it("fires nothing and logs nothing for a device outside the Scheduler_Devices list", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59), devices: () => [] });
    startAndTick(stack, 7, 0);
    expect(stack.sent).toEqual([]);
    expect(stack.entries().filter((e) => e.kind === "routine_fired")).toEqual([]);
    expect(stack.scheduler.run(DEVICE, "morning", "manual")).toEqual({
      actions: 0,
      sent: 0,
      refused: 0,
      refusal: null,
    });
    stack.scheduler.stop();
  });

  it("stops ticking after stop()", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59) });
    stack.scheduler.start();
    stack.scheduler.stop();
    stack.tickTo(atLocal(7, 0));
    expect(stack.entriesOf("routine_fired")).toEqual([]);
    expect(stack.deadlines.nextDue()).toBeNull();
  });

  it("re-arms itself one minute at a time", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    stack.scheduler.start();
    expect(stack.deadlines.nextDue()).toBe(atLocal(12, 0) + SCHEDULER_TICK_MS);
    stack.tickTo(atLocal(12, 1));
    expect(stack.deadlines.nextDue()).toBe(atLocal(12, 1) + SCHEDULER_TICK_MS);
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// Requirement 12.7: nothing published under quiet hours, nothing for movement off

describe("no command is published during quiet hours (Req 12.2, 12.7)", () => {
  it("publishes nothing for a routine and writes the refusal", () => {
    const stack = createRoutineStack({
      startMs: atLocal(20, 29),
      policy: {
        quietHours: { start: "20:00", end: "07:00" },
        playLimitMinutes: null,
        movementOn: true,
      },
    });
    startAndTick(stack, 20, 30);
    expect(stack.sent).toEqual([]);
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      ref_id: "bedtime",
      sent: 0,
      refused: 1,
      refusal: "quiet_hours",
    });
    stack.scheduler.stop();
  });

  it("publishes nothing for a charge reminder and writes the refusal", () => {
    const stack = createRoutineStack({
      startMs: atLocal(23, 0),
      policy: {
        quietHours: { start: "22:00", end: "07:00" },
        playLimitMinutes: null,
        movementOn: true,
      },
    });
    stack.scheduler.onStatus(DEVICE, 90, false);
    stack.scheduler.onStatus(DEVICE, 19, false);
    expect(stack.sent).toEqual([]);
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      trigger: "battery",
      threshold: 20,
      battery_pct: 19,
      sent: 0,
      refused: 1,
      refusal: "quiet_hours",
    });
  });
});

describe("no command is published for a movement-bearing action with movement off (Req 12.7)", () => {
  const MOVEMENT_OFF = {
    quietHours: null,
    playLimitMinutes: null,
    movementOn: false,
  } as const;

  it("stops a routine at morning's gesture, with the two earlier actions published", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59), policy: MOVEMENT_OFF });
    startAndTick(stack, 7, 0);
    // The gate stops the behaviour AT the gesture: `say` and `animate` went, `gesture` and the
    // trailing `led` did not (Req 10.3, 10.4).
    expect(stack.sent.map((c) => c.action)).toEqual(["say", "animate"]);
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      ref_id: "morning",
      actions: 4,
      sent: 2,
      refused: 1,
      refusal: "movement_off",
    });
    stack.scheduler.stop();
  });

  it("stops a charge reminder at battery_20's gesture (C37)", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0), policy: MOVEMENT_OFF });
    stack.scheduler.onStatus(DEVICE, 90, false);
    stack.scheduler.onStatus(DEVICE, 18, false);
    expect(stack.sent.map((c) => c.action)).toEqual(["say"]);
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      trigger: "battery",
      threshold: 20,
      actions: 3,
      sent: 1,
      refused: 1,
      refusal: "movement_off",
    });
  });

  it("publishes battery_10 in full, because it carries no gesture (Req 11.5)", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0), policy: MOVEMENT_OFF });
    stack.scheduler.onStatus(DEVICE, 90, false);
    stack.sent.length = 0;
    stack.scheduler.onStatus(DEVICE, 8, false);
    // 20 % stopped at its gesture; 10 % went through whole.
    const actions = stack.sent.map((c) => c.action);
    expect(actions).toEqual(["say", "say", "led"]);
    const battery10 = stack.entriesOf("routine_fired").find((e) => e.threshold === 10);
    expect(battery10).toMatchObject({ actions: 2, sent: 2, refused: 0, refusal: null });
  });
});

// ---------------------------------------------------------------------------------------------
// Requirement 10.4a: a send failure is not a policy refusal

describe("a send failure is not a policy refusal (Req 10.4a)", () => {
  it("stops at that action with refusal null, retries nothing, and accrues no minutes", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59), sendOk: false });
    startAndTick(stack, 7, 0);

    // One send was attempted and failed; nothing after it was attempted at all.
    expect(stack.sent.map((c) => c.action)).toEqual(["say"]);
    const fired = stack.entriesOf("routine_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      ref_id: "morning",
      actions: 4,
      sent: 0,
      refused: 1,
      // A send failure reads as `refused > 0` with `refusal` null, which no policy refusal
      // produces. No `PolicyRefusal` value is invented for it.
      refusal: null,
    });
    // Nothing was published, so no Activity_Record and no play minutes (Req 13.1).
    expect(stack.activity.count()).toBe(0);
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(0);
    stack.scheduler.stop();
  });

  it("accrues minutes when an earlier action WAS published and a later one failed", () => {
    // The first command publishes; the second fails. The behaviour stops there, and because
    // something WAS published the minute is accrued (Req 10.4a, 13.1).
    const stack = createRoutineStack({ startMs: atLocal(6, 59), sendOk: (nth) => nth < 2 });
    startAndTick(stack, 7, 0);

    expect(stack.sent.map((c) => c.action)).toEqual(["say", "animate"]);
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      actions: 4,
      sent: 1,
      refused: 1,
      refusal: null,
    });
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(1);
    expect(stack.activity.records(DEVICE).map((row) => row.kind)).toEqual([
      "routine",
      "word",
      "play",
    ]);
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// An ack reason is final

describe("an ack reason is final (Req 10.5, 12.6)", () => {
  it("publishes each action exactly once and registers no ack handler", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59) });
    startAndTick(stack, 7, 0);
    expect(stack.sent).toHaveLength(4);
    // A later tick on the same local day fires nothing, so no replacement command can appear.
    stack.tickTo(atLocal(7, 1));
    expect(stack.sent).toHaveLength(4);
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// The morning word, and the Activity_Records

describe("the morning word stays inside the parent's category gate (C38, Req 5.3a, 5.7)", () => {
  it("appends both a routine and a word record when the word was spoken", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59) });
    startAndTick(stack, 7, 0);
    const kinds = stack.activity.records(DEVICE).map((row) => row.kind);
    expect(kinds).toEqual(["routine", "word", "play"]);
    const word = stack.activity.records(DEVICE).find((row) => row.kind === "word");
    expect(word?.categories).toEqual(["world"]);
    expect(word?.ref_id).not.toBeNull();
    stack.scheduler.stop();
  });

  it("appends only a routine record when the parent has not opened world", () => {
    const stack = createRoutineStack({
      startMs: atLocal(6, 59),
      over: { allowedCategories: ["stories", "songs"] },
    });
    startAndTick(stack, 7, 0);
    expect(stack.activity.records(DEVICE).map((row) => row.kind)).toEqual(["routine", "play"]);
    stack.scheduler.stop();
  });

  it("appends only a routine record when no entry carries the turn language", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59), words: [] });
    startAndTick(stack, 7, 0);
    expect(stack.activity.records(DEVICE).map((row) => row.kind)).toEqual(["routine", "play"]);
    stack.scheduler.stop();
  });

  it("appends no record at all for a refused behaviour", () => {
    const stack = createRoutineStack({
      startMs: atLocal(6, 59),
      policy: {
        quietHours: { start: "06:00", end: "08:00" },
        playLimitMinutes: null,
        movementOn: true,
      },
    });
    startAndTick(stack, 7, 0);
    expect(stack.activity.count()).toBe(0);
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// The Grandma schedules

describe("a due Grandma schedule plays through the same gate (Req 8.2, 8.4, 8.6)", () => {
  it("publishes the playback, logs play_started and appends a story record", () => {
    const stack = createRoutineStack({ startMs: atLocal(19, 59) });
    const assetId = seedRecording(stack, "20:00", { durationS: 150 });
    stack.sent.length = 0;
    startAndTick(stack, 20, 0);

    // `wind_down` is also due at 20:00; the playback's two actions follow its three.
    expect(stack.sent.map((c) => c.action)).toEqual(["say", "animate", "led", "say", "led"]);
    const play = stack.entriesOf("grandma_event").filter((e) => e.event === "play_started");
    expect(play).toHaveLength(1);
    expect(play[0]).toMatchObject({
      device_id: DEVICE,
      asset_id: assetId,
      outcome: "ok",
      reason: null,
      call_id: null,
      call_state: null,
    });
    // No title and no Media_Handle on the entry (Req 7.6, C11).
    expect(JSON.stringify(play[0])).not.toContain("kind crow");
    expect(JSON.stringify(play[0])).not.toContain("mh_");

    const story = stack.activity.records(DEVICE).find((row) => row.kind === "story");
    expect(story).toMatchObject({ ref_id: assetId, categories: ["stories"], minutes: null });
    // 150 s rounds up to three minutes of play, plus one for `wind_down` (Req 13.1).
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(4);
    stack.scheduler.stop();
  });

  it("publishes nothing and records the refusal when the gate refuses the playback", () => {
    const stack = createRoutineStack({
      startMs: atLocal(22, 59),
      policy: {
        quietHours: { start: "22:00", end: "07:00" },
        playLimitMinutes: null,
        movementOn: true,
      },
    });
    seedRecording(stack, "23:00");
    stack.sent.length = 0;
    startAndTick(stack, 23, 0);

    expect(stack.sent).toEqual([]);
    expect(
      stack.entriesOf("grandma_event").filter((e) => e.event === "play_started")[0],
    ).toMatchObject({ outcome: "refused", reason: "policy" });
    expect(stack.activity.count()).toBe(0);
    stack.scheduler.stop();
  });

  it("plays each occurrence at most once a local day (Req 8.7)", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 29) });
    seedRecording(stack, "12:30");
    stack.scheduler.start();
    stack.tickTo(atLocal(12, 30));
    stack.tickTo(atLocal(12, 31));
    expect(stack.entriesOf("grandma_event").filter((e) => e.event === "play_started")).toHaveLength(
      1,
    );
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// The manual run

describe("a manual run (Req 16.7)", () => {
  it("fires with trigger manual and sets no day mark", () => {
    const stack = createRoutineStack({ startMs: atLocal(6, 59) });
    const run = stack.scheduler.run(DEVICE, "morning", "manual");
    expect(run).toEqual({ actions: 4, sent: 4, refused: 0, refusal: null });
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      trigger: "manual",
      ref_id: "morning",
    });

    // The day's scheduled firing is neither consumed nor suppressed (Property 9).
    startAndTick(stack, 7, 0);
    expect(stack.entriesOf("routine_fired").map((e) => e.trigger)).toEqual(["manual", "schedule"]);
    stack.scheduler.stop();
  });

  it("fires nothing and logs nothing for an unknown routine id", () => {
    const stack = createRoutineStack();
    expect(stack.scheduler.run(DEVICE, "play time", "manual")).toEqual({
      actions: 0,
      sent: 0,
      refused: 0,
      refusal: null,
    });
    expect(stack.entriesOf("routine_fired")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property 6: the policy gate decides every scheduled command

describe("Property 6: the policy gate decides every scheduled command", () => {
  it("publishes exactly the leading actions the gate allows, and logs what happened", () => {
    fc.assert(
      fc.property(
        fc.record({
          quiet: fc.option(
            fc.record({
              start: fc.constantFrom("00:00", "07:00", "20:00", "22:00"),
              end: fc.constantFrom("00:00", "07:00", "09:00", "22:00"),
            }),
            { nil: null },
          ),
          limit: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
          used: fc.integer({ min: 0, max: 120 }),
          movementOn: fc.boolean(),
          hour: fc.integer({ min: 0, max: 23 }),
          minute: fc.integer({ min: 0, max: 59 }),
          stage: fc.constantFrom(...AGE_STAGES),
          lang: fc.constantFrom(...SUPPORTED_LANGS),
          routineId: fc.constantFrom(...SEEDED.map((row) => row.routine_id)),
          scheduled: fc.boolean(),
        }),
        (c) => {
          // A sender that accepts every action the gate allows: the property's precondition.
          const stack = createRoutineStack({
            startMs: atLocal(c.hour, c.minute),
            policy: {
              quietHours: c.quiet,
              playLimitMinutes: c.limit,
              movementOn: c.movementOn,
            },
            over: { ageStage: c.stage, langs: [c.lang] },
            playMinutes: { [DEVICE]: c.used },
            devices: c.scheduled ? () => [DEVICE] : () => [],
          });
          const routine = stack.routines.byId(c.routineId);
          expect(routine).not.toBeNull();
          if (routine === null) return;

          const actions = behaviourActions(routine.behaviour, {
            lang: c.lang,
            ageStage: c.stage,
            refId: routine.routine_id,
            word: wordForDay(createStarterWords(), stack.clock.now(), c.lang),
            title: null,
          });
          /** How many LEADING actions the unchanged gate allows, read in the pre-fire state. */
          function leading(
            list: readonly BehaviourAction[],
          ): Readonly<{ allowed: number; refusal: string | null }> {
            let allowed = 0;
            for (const action of list) {
              const answer = stack.actions.policyRefusal(DEVICE, action.action);
              if (answer !== null) return { allowed, refusal: answer };
              allowed += 1;
            }
            return { allowed, refusal: null };
          }

          const { allowed, refusal } = leading(actions);
          // The Nap_Sequence is the case that makes this property non-vacuous (C18): a routine
          // that published something accrues one minute, and if that minute CROSSES the limit the
          // nap is asked for while `playMinutesUsed` still reports the pre-accrual total — so the
          // gate allows it on its own unchanged rule, read here in exactly that state.
          const crossing = c.limit !== null && c.used < c.limit && c.used + 1 >= c.limit;
          const napActions = behaviourActions("nap", {
            lang: c.lang,
            ageStage: c.stage,
            refId: null,
            word: null,
            title: null,
          });
          const nap = crossing && allowed >= 1 ? leading(napActions).allowed : 0;

          const fired = stack.scheduler.run(DEVICE, routine.routine_id, "manual");
          if (!c.scheduled) {
            // Nothing is published and nothing is logged for a device outside the list.
            expect(stack.sent).toEqual([]);
            expect(stack.entriesOf("routine_fired")).toEqual([]);
            expect(fired).toEqual({ actions: 0, sent: 0, refused: 0, refusal: null });
            return;
          }

          expect(fired.sent).toBe(allowed);
          expect(fired.actions).toBe(actions.length);
          expect(fired.refusal).toBe(refusal);
          expect(fired.refused).toBe(refusal === null ? 0 : 1);
          // The behaviour's own publishes are exactly its leading allowed actions, in order, and
          // nothing is published after the first refusal.
          expect(stack.sent.slice(0, allowed).map((command) => command.action)).toEqual(
            actions.slice(0, allowed).map((action) => action.action),
          );
          // Everything published after them is the Nap_Sequence, itself gate-decided.
          expect(stack.sent).toHaveLength(allowed + nap);
          expect(stack.sent.slice(allowed).map((command) => command.action)).toEqual(
            napActions.slice(0, nap).map((action) => action.action),
          );
          const entry = stack.entriesOf("routine_fired")[0];
          expect(entry).toMatchObject({
            sent: allowed,
            refused: refusal === null ? 0 : 1,
            refusal,
            actions: actions.length,
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Property 9: a routine fires once per local day

describe("Property 9: a routine fires once per local day", () => {
  it("fires at most once a day and at least once on a day whose ticks cover its window", () => {
    fc.assert(
      fc.property(
        fc.record({
          days: fc.integer({ min: 1, max: 3 }),
          extraTicks: fc.integer({ min: 0, max: 3 }),
        }),
        (c) => {
          const stack = createRoutineStack({ startMs: atLocal(0, 0) });
          stack.scheduler.start();
          for (let day = 0; day < c.days; day += 1) {
            for (const row of SEEDED) {
              const [hh, mm] = row.at.split(":").map(Number);
              const hour = hh ?? 0;
              const minute = mm ?? 0;
              stack.tickTo(atLocal(hour, minute, day));
              for (let extra = 0; extra < c.extraTicks; extra += 1) {
                stack.tickTo(atLocal(hour, minute, day) + (extra + 1) * 60_000);
              }
            }
          }
          stack.scheduler.stop();

          const fired = stack.entriesOf("routine_fired");
          // Exactly one firing per routine per day: six a day, however many ticks fell inside
          // each Catch_Up_Window.
          expect(fired).toHaveLength(SEEDED.length * c.days);
          for (const row of SEEDED) {
            const mine = fired.filter((entry) => entry.ref_id === row.routine_id);
            expect(mine).toHaveLength(c.days);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never fires a routine re-timed to a time outside the window retroactively", () => {
    // `morning` moved to 02:00: a 14:00 tick is far outside its Catch_Up_Window.
    const seed = SEEDED.map((row) =>
      row.routine_id === "morning" ? { ...row, at: "02:00" } : row,
    );
    const stack = createRoutineStack({ startMs: atLocal(13, 59), seed });
    stack.scheduler.start();
    stack.tickTo(atLocal(14, 0));
    expect(stack.entriesOf("routine_fired")).toEqual([]);
    stack.scheduler.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// One notion of "local"

describe("one notion of local (Req 5.2, 10.10)", () => {
  it("reads the same minute of day the Device_Policy_Gate's quiet-hours window is read in", () => {
    for (const [hh, mm] of [
      [0, 0],
      [7, 0],
      [12, 30],
      [23, 59],
    ] as const) {
      expect(localMinutes(atLocal(hh, mm))).toBe(hh * 60 + mm);
    }
  });

  it("covers both charge thresholds with a behaviour", () => {
    for (const threshold of CHARGE_THRESHOLDS) {
      expect(ROUTINE_BEHAVIOUR_IDS).toContain(`battery_${String(threshold)}`);
    }
  });
});
