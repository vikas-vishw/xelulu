// Play limits and the graceful nap (Phase 4 Req 13, C18).
//
// THE CROSSING IS ASSERTED AS A POSITIVE (Req 21.3a). A test that only said "nothing is published
// at the limit" would pass against a dead feature: the whole of C18 is that the nap IS published,
// through the unchanged gate, on the accrual that crosses — because the gate is reached while
// `playMinutesUsed` still reports the pre-accrual total — and that every ordinary behaviour is
// refused `play_limit` from the moment the ledger closes.
//
// `device-action.ts` is not edited, not exempted and not bypassed anywhere in this file: the gate
// the nap goes through is the same object, with the same rule, that refuses everything after it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localDayKey } from "../src/brain/story/word-of-the-day.js";
import { ANIMATE_EYES, LED_DIM } from "../src/routines/routine-behaviours.js";
import { NAP_REF_ID } from "../src/routines/routine-scheduler.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import {
  atLocal,
  createRoutineStack,
  dataOf,
  DEVICE,
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

const LIMIT = 30;

/** Midday, so an unset quiet-hours window is genuinely open and no routine is due. */
const NOON = atLocal(12, 0);

/** An open midday stack with a 30-minute limit and `used` minutes already on the day's ledger. */
function stackAtLimit(used: number): RoutineStack {
  return createRoutineStack({
    startMs: NOON,
    policy: { quietHours: null, playLimitMinutes: LIMIT, movementOn: true },
    playMinutes: { [DEVICE]: used },
  });
}

function playRecords(stack: RoutineStack) {
  return stack.activity.records(DEVICE).filter((row) => row.kind === "play");
}

describe("the crossing publishes the Nap_Sequence (Req 13.2, 13.3, 21.3a)", () => {
  it("publishes all three nap actions, in order, through the unchanged gate", () => {
    const stack = stackAtLimit(LIMIT - 10);
    const accrual = stack.play.accruePlay(DEVICE, 10, "turn", null);

    expect(accrual.before).toBe(LIMIT - 10);
    expect(accrual.after).toBe(LIMIT);
    expect(accrual.napFired).toEqual({ actions: 3, sent: 3, refused: 0, refusal: null });

    expect(stack.sent.map((command) => command.action)).toEqual(["say", "animate", "led"]);
    expect(dataOf(stack.sent[0])).toMatchObject({ expression: "sleepy", lang: "en-IN" });
    // `say.data` carries no text field: Document B streams reply audio down the WebSocket.
    expect(dataOf(stack.sent[0])).not.toHaveProperty("text");
    expect(dataOf(stack.sent[1])).toEqual({
      expression: "sleepy",
      eyes: ANIMATE_EYES.blink,
      loop: false,
    });
    expect(dataOf(stack.sent[2])).toEqual({ ...LED_DIM });
  });

  it("writes one routine_fired entry with trigger play_limit and the nap's counts", () => {
    const stack = stackAtLimit(LIMIT - 1);
    stack.play.accruePlay(DEVICE, 1, "routine", "morning");
    const fired = stack.entriesOf("routine_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      device_id: DEVICE,
      trigger: "play_limit",
      ref_id: NAP_REF_ID,
      threshold: null,
      battery_pct: null,
      actions: 3,
      sent: 3,
      refused: 0,
      refusal: null,
    });
  });

  it("refuses every ordinary behaviour play_limit the moment the ledger closes", () => {
    const stack = stackAtLimit(LIMIT - 5);
    stack.play.accruePlay(DEVICE, 5, "turn", null);
    const napCommands = stack.sent.length;

    // The gate's own rule, unchanged: `playMinutesUsed` now reports the limit.
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(LIMIT);
    expect(stack.actions.policyRefusal(DEVICE, "say")).toBe("play_limit");

    const run = stack.scheduler.run(DEVICE, "morning", "manual");
    expect(run).toEqual({ actions: 4, sent: 0, refused: 1, refusal: "play_limit" });
    expect(stack.sent).toHaveLength(napCommands);
  });

  it("publishes nothing for a second crossing attempt on the same local day", () => {
    const stack = stackAtLimit(LIMIT - 2);
    stack.play.accruePlay(DEVICE, 2, "turn", null);
    expect(stack.sent).toHaveLength(3);

    // The ledger is past the limit, so this accrual crosses nothing — and the once-a-day mark
    // would stop it even if it did (Req 13.2).
    const second = stack.play.accruePlay(DEVICE, 5, "turn", null);
    expect(second.napFired).toBeNull();
    expect(stack.sent).toHaveLength(3);
    expect(stack.routines.napFired(localDayKey(stack.clock.now()))).toBe(true);
  });

  it("publishes nothing for an accrual landing at or above a limit already reached", () => {
    const stack = stackAtLimit(LIMIT);
    const accrual = stack.play.accruePlay(DEVICE, 5, "turn", null);
    expect(accrual.napFired).toBeNull();
    expect(stack.sent).toEqual([]);
    expect(stack.entriesOf("routine_fired")).toEqual([]);
  });

  it("fires no nap where the parent set no play limit", () => {
    const stack = createRoutineStack({
      startMs: NOON,
      policy: { quietHours: null, playLimitMinutes: null, movementOn: true },
      playMinutes: { [DEVICE]: 500 },
    });
    const accrual = stack.play.accruePlay(DEVICE, 60, "turn", null);
    expect(accrual.napFired).toBeNull();
    expect(stack.sent).toEqual([]);
    // And the gate refuses nothing for a play limit either (Req 13.6).
    expect(stack.actions.policyRefusal(DEVICE, "say")).toBeNull();
  });
});

describe("the nap inside quiet hours is silence (Req 13.4, F3)", () => {
  it("stops the sequence at the first action and records the refusal", () => {
    const stack = createRoutineStack({
      // 23:00 local, inside the window below.
      startMs: atLocal(23, 0),
      policy: {
        quietHours: { start: "22:00", end: "07:00" },
        playLimitMinutes: LIMIT,
        movementOn: true,
      },
      playMinutes: { [DEVICE]: LIMIT - 1 },
    });
    const accrual = stack.play.accruePlay(DEVICE, 1, "turn", null);

    expect(accrual.napFired).toEqual({ actions: 3, sent: 0, refused: 1, refusal: "quiet_hours" });
    expect(stack.sent).toEqual([]);
    expect(stack.entriesOf("routine_fired")[0]).toMatchObject({
      trigger: "play_limit",
      sent: 0,
      refused: 1,
      refusal: "quiet_hours",
    });
    // The minutes are still recorded: the limit was reached whether or not the robot could say so.
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(LIMIT);
  });
});

describe("the tick fires no nap of its own (Req 13.5a)", () => {
  it("refuses the due routine play_limit and asks for no nap at all", () => {
    const stack = createRoutineStack({
      startMs: atLocal(6, 59),
      policy: { quietHours: null, playLimitMinutes: LIMIT, movementOn: true },
      playMinutes: { [DEVICE]: LIMIT },
    });
    stack.scheduler.start();
    stack.tickTo(atLocal(7, 0));

    const fired = stack.entriesOf("routine_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      trigger: "schedule",
      ref_id: "morning",
      refusal: "play_limit",
    });
    // The dead path C18 exists to avoid: a tick can only ever find the limit already reached.
    expect(fired.filter((entry) => entry.trigger === "play_limit")).toEqual([]);
    expect(stack.sent).toEqual([]);
    stack.scheduler.stop();
  });
});

describe("the day rollover (Req 13.5)", () => {
  it("resets the minutes and the nap mark on the next local day", () => {
    const stack = stackAtLimit(LIMIT - 1);
    stack.play.accruePlay(DEVICE, 1, "turn", null);
    expect(stack.sent).toHaveLength(3);
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(LIMIT);

    stack.clock.set(atLocal(12, 0, 1));
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(0);
    expect(stack.routines.napFired(localDayKey(stack.clock.now()))).toBe(false);

    // A fresh crossing on the new day publishes a fresh nap.
    stack.play.accruePlay(DEVICE, LIMIT, "turn", null);
    expect(stack.sent).toHaveLength(6);
  });
});

describe("one accrual function, one ledger, one record (Req 13.1, 13.7)", () => {
  it("moves the ledger and appends a play record together, for all three sources", () => {
    const stack = createRoutineStack({
      startMs: NOON,
      policy: { quietHours: null, playLimitMinutes: null, movementOn: true },
    });
    stack.play.accruePlay(DEVICE, 2, "turn", null);
    stack.play.accruePlay(DEVICE, 1, "routine", "bedtime");
    stack.play.accruePlay(DEVICE, 3, "grandma", "gma_1");

    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(6);
    const records = playRecords(stack);
    expect(records.map((row) => [row.minutes, row.ref_id])).toEqual([
      [2, null],
      [1, "bedtime"],
      [3, "gma_1"],
    ]);
    // Ids, an enum, a time, minutes and categories — and no text field of any kind (Req 14.3).
    for (const row of records) {
      expect(Object.keys(row).sort()).toEqual([
        "activity_id",
        "at",
        "categories",
        "device_id",
        "kind",
        "minutes",
        "ref_id",
      ]);
      expect(row.categories).toEqual([]);
    }
  });

  it("records nothing and crosses nothing for a non-positive or unreadable figure", () => {
    const stack = stackAtLimit(LIMIT - 1);
    for (const minutes of [0, -5, Number.NaN]) {
      const accrual = stack.play.accruePlay(DEVICE, minutes, "turn", null);
      expect(accrual).toEqual({ before: LIMIT - 1, after: LIMIT - 1, napFired: null });
    }
    expect(playRecords(stack)).toEqual([]);
    expect(stack.sent).toEqual([]);
  });

  it("rounds a part minute up, so a short turn still counts", () => {
    const stack = createRoutineStack({ startMs: NOON });
    stack.play.accruePlay(DEVICE, 0.2, "turn", null);
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(1);
  });
});
