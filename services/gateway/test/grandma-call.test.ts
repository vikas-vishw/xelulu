// The live Grandma call (Phase 4 Req 9): the state machine, the three behaviours through the
// unchanged Device_Policy_Gate, and the ring timeout.
//
// Three things are asserted that the feature would be unsafe without:
//
//   1. Every legal transition moves the call and every illegal one changes NOTHING and sends
//      nothing (Req 9.2).
//   2. Every command goes through the Phase 3 gate, so a call request during quiet hours puts
//      nothing on the wire and leaves the call `requested` until it expires (Req 9.3, 9.4, C16).
//   3. No socket is opened and no media is carried, which the Phase 3 socket guard enforces for
//      the whole file (Req 9.7, C12).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AGE_STAGES, SUPPORTED_LANGS, type AgeStage, type SupportedLang } from "@xelulu/shared";

import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock, type TestClock } from "./support/test-clock.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import { createGatewayLog, type GatewayLog } from "../src/log/gateway-log.js";
import { createDeadlines, type Deadlines } from "../src/deadlines.js";
import { randomIds } from "../src/ids.js";
import { checkOutput } from "../src/brain/safety/output-guard.js";
import { createRoutineStore } from "../src/routines/routine-store.js";
import { createDeviceActions } from "../src/brain/tools/device-action.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
  type DevicePolicy,
} from "../src/brain/state/child-context.js";
import {
  behaviourActions,
  CALL_ANNOUNCE_NARRATION,
  LED_DIM,
  LED_RING,
} from "../src/routines/routine-behaviours.js";
import { DEV_HOUSEHOLD_ID, DEV_USER_ID } from "../src/grandma/household.js";
import {
  CALL_RING_TIMEOUT_MS,
  CALL_TRANSITIONS,
  createGrandmaCalls,
  type CallOp,
  type GrandmaCalls,
} from "../src/grandma/grandma-call.js";
import type { CommandRequest } from "../src/mqtt/command-sender.js";

let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

const DEVICE = "xlu_000123";
const START_MS = 1_760_000_000_000;

const OPEN_POLICY: DevicePolicy = Object.freeze({
  quietHours: null,
  playLimitMinutes: null,
  movementOn: true,
});

function contextOf(policy: DevicePolicy, over: Partial<ChildContext> = {}): ChildContextTable {
  const ctx: ChildContext = {
    ...MOST_RESTRICTIVE_CONTEXT,
    ageStage: "little",
    langs: ["en-IN"],
    policy,
    ...over,
  };
  return {
    setActiveChild: () => undefined,
    forDevice: () => ctx,
    childKeyFor: () => "child:test",
  };
}

type Harness = Readonly<{
  calls: GrandmaCalls;
  sent: CommandRequest[];
  clock: TestClock;
  deadlines: Deadlines;
  entries: () => readonly Readonly<Record<string, unknown>>[];
}>;

function harness(
  policy: DevicePolicy = OPEN_POLICY,
  over: Partial<ChildContext> = {},
  sendOk = true,
): Harness {
  const clock = createTestClock(START_MS);
  const log: GatewayLog = createGatewayLog(clock, createCaptureSink());
  const deadlines = createDeadlines(clock);
  const sent: CommandRequest[] = [];
  const context = contextOf(policy, over);
  const routines = createRoutineStore({ clock, playMinutes: { [DEVICE]: 0 } });
  const calls = createGrandmaCalls({
    clock,
    deadlines,
    ids: randomIds,
    log,
    actions: createDeviceActions({
      sendCommand: (request) => {
        sent.push(request);
        return sendOk
          ? { ok: true, cmd_id: "cmd_1" }
          : { ok: false, error: { code: "device_offline" } };
      },
      context,
      routines,
      // Midday, so an unset quiet-hours window is genuinely open.
      nowMinutes: () => 12 * 60,
    }),
    context,
    household: () => DEV_HOUSEHOLD_ID,
    behaviours: behaviourActions,
  });
  return {
    calls,
    sent,
    clock,
    deadlines,
    entries: () => log.since(0) as readonly Readonly<Record<string, unknown>>[],
  };
}

function grandmaEvents(h: Harness): readonly Readonly<Record<string, unknown>>[] {
  return h.entries().filter((entry) => entry.kind === "grandma_event");
}

/** A command's `data` is `unknown` on the wire type, so a test reads it as a plain record. */
function dataOf(command: CommandRequest | undefined): Readonly<Record<string, unknown>> {
  return (command?.data ?? {}) as Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------------------------

describe("the transition table (Req 9.1, 9.2)", () => {
  it("is exactly Requirement 9.2's transitions", () => {
    expect(CALL_TRANSITIONS).toEqual({
      idle: { request: "requested" },
      requested: { decline: "declined" },
      ringing: { accept: "active", decline: "declined", end: "ended" },
      active: { end: "ended" },
      ended: { request: "requested" },
      declined: { request: "requested" },
    });
  });

  it("walks request -> ringing -> active -> ended", () => {
    const h = harness();
    const requested = h.calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(requested.ok).toBe(true);
    if (requested.ok) expect(requested.value.state).toBe("ringing");
    expect(h.calls.current(DEVICE)?.state).toBe("ringing");

    const accepted = h.calls.apply(DEVICE, "accept", DEV_USER_ID);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.state).toBe("active");

    const ended = h.calls.apply(DEVICE, "end", DEV_USER_ID);
    expect(ended.ok).toBe(true);
    if (ended.ok) {
      expect(ended.value.state).toBe("ended");
      expect(ended.value.ended_at).not.toBeNull();
    }
  });

  it("declines from ringing and sets the end time", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    const declined = h.calls.apply(DEVICE, "decline", DEV_USER_ID);
    expect(declined.ok).toBe(true);
    if (declined.ok) {
      expect(declined.value.state).toBe("declined");
      expect(declined.value.ended_at).not.toBeNull();
    }
  });

  it("holds one call per device, and a finished call accepts a fresh request", () => {
    const h = harness();
    const first = h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.calls.apply(DEVICE, "decline", DEV_USER_ID);
    const second = h.calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.call_id).not.toBe(first.value.call_id);
    expect(second.value.state).toBe("ringing");
  });

  it.each<readonly [string, readonly CallOp[]]>([
    ["accept from idle", ["accept"]],
    ["decline from idle", ["decline"]],
    ["end from idle", ["end"]],
    ["request while ringing", ["request", "request"]],
    ["accept twice", ["request", "accept", "accept"]],
    ["decline from active", ["request", "accept", "decline"]],
    ["end twice", ["request", "accept", "end", "end"]],
  ])("refuses %s with invalid_transition and changes nothing", (_name, ops) => {
    const h = harness();
    const last = ops[ops.length - 1];
    for (const op of ops.slice(0, -1)) h.calls.apply(DEVICE, op, DEV_USER_ID);
    const before = h.calls.current(DEVICE);
    const sentBefore = h.sent.length;
    const result = h.calls.apply(DEVICE, last as CallOp, DEV_USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_transition");
    expect(h.calls.current(DEVICE)).toEqual(before);
    expect(h.sent).toHaveLength(sentBefore);
  });

  it("refuses `end` while the call is still `requested`", () => {
    // `requested` is only reachable when the gate refused the ring, so this case needs a closed
    // policy: with the gate open a request lands in `ringing`, where `end` is legal.
    const h = harness({ ...OPEN_POLICY, quietHours: { start: "07:00", end: "22:00" } });
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(h.calls.current(DEVICE)?.state).toBe("requested");
    const result = h.calls.apply(DEVICE, "end", DEV_USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_transition");
    expect(h.calls.current(DEVICE)?.state).toBe("requested");
    expect(h.sent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the behaviours through the Device_Policy_Gate (Req 9.3, 9.5, 9.6)", () => {
  it("rings with one animate and one pulsing led, then announces, then dims", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(h.sent.map((c) => c.action)).toEqual(["animate", "led"]);
    expect(dataOf(h.sent[0])).toEqual({ expression: "love", eyes: "hearts", loop: true });
    expect(dataOf(h.sent[1])).toEqual({ ...LED_RING });

    h.calls.apply(DEVICE, "accept", DEV_USER_ID);
    expect(h.sent.map((c) => c.action)).toEqual(["animate", "led", "say"]);
    // `say.data` carries no text field: the narration is guard-checked speech, not a wire value.
    expect(Object.keys(dataOf(h.sent[2])).sort()).toEqual([
      "duration_hint_ms",
      "expression",
      "lang",
      "voice",
    ]);

    h.calls.apply(DEVICE, "end", DEV_USER_ID);
    expect(h.sent.map((c) => c.action)).toEqual(["animate", "led", "say", "led"]);
    expect(dataOf(h.sent[3])).toEqual({ ...LED_DIM });
  });

  it("requests no led effect outside solid and pulse, and no flash rate (Req 9.8)", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.calls.apply(DEVICE, "accept", DEV_USER_ID);
    h.calls.apply(DEVICE, "end", DEV_USER_ID);
    for (const command of h.sent.filter((c) => c.action === "led")) {
      const data = dataOf(command);
      expect(["solid", "pulse"]).toContain(data["effect"]);
      expect(Object.keys(data)).not.toContain("hz");
      expect(Object.keys(data)).not.toContain("rate");
    }
  });

  it("publishes NOTHING during quiet hours and leaves the call requested (Req 9.4, C19)", () => {
    const h = harness({ ...OPEN_POLICY, quietHours: { start: "07:00", end: "22:00" } });
    const result = h.calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(result.ok).toBe(true);
    expect(h.sent).toEqual([]);
    expect(h.calls.current(DEVICE)?.state).toBe("requested");
    const refused = grandmaEvents(h).filter((entry) => entry.outcome === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.event).toBe("call_ringing");
    expect(refused[0]?.reason).toBe("policy");
    expect(refused[0]?.call_state).toBe("requested");
  });

  it("stops the ring at a send failure without retrying (Req 10.4a)", () => {
    const h = harness(OPEN_POLICY, {}, false);
    const result = h.calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(result.ok).toBe(true);
    // One attempt, nothing after it, no retry, and the call stays `requested`.
    expect(h.sent.map((c) => c.action)).toEqual(["animate"]);
    expect(h.calls.current(DEVICE)?.state).toBe("requested");
  });

  it("refuses a request for a device with no household, touching nothing (Req 7.9)", () => {
    const clock = createTestClock(START_MS);
    const log = createGatewayLog(clock, createCaptureSink());
    const context = contextOf(OPEN_POLICY);
    const sent: CommandRequest[] = [];
    const calls = createGrandmaCalls({
      clock,
      deadlines: createDeadlines(clock),
      ids: randomIds,
      log,
      actions: createDeviceActions({
        sendCommand: (request) => {
          sent.push(request);
          return { ok: true, cmd_id: "cmd_1" };
        },
        context,
        routines: createRoutineStore({ clock, playMinutes: { [DEVICE]: 0 } }),
        nowMinutes: () => 12 * 60,
      }),
      context,
      household: () => null,
      behaviours: behaviourActions,
    });
    const result = calls.apply(DEVICE, "request", DEV_USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_field");
      expect(result.field).toBe("device_id");
    }
    expect(calls.current(DEVICE)).toBeNull();
    expect(sent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the ring timeout (Req 9.4)", () => {
  it("ends an unanswered ring after CALL_RING_TIMEOUT_MS and dims the belly", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.clock.advance(CALL_RING_TIMEOUT_MS - 1);
    h.deadlines.fireDue(h.clock.now());
    expect(h.calls.current(DEVICE)?.state).toBe("ringing");

    h.clock.advance(1);
    h.deadlines.fireDue(h.clock.now());
    const call = h.calls.current(DEVICE);
    expect(call?.state).toBe("ended");
    expect(call?.ended_at).not.toBeNull();
    expect(h.sent.map((c) => c.action)).toEqual(["animate", "led", "led"]);
    expect(grandmaEvents(h).at(-1)?.event).toBe("call_ended");
  });

  it("expires a refused request with nothing sent at all", () => {
    const h = harness({ ...OPEN_POLICY, quietHours: { start: "07:00", end: "22:00" } });
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.clock.advance(CALL_RING_TIMEOUT_MS);
    h.deadlines.fireDue(h.clock.now());
    expect(h.calls.current(DEVICE)?.state).toBe("ended");
    expect(h.sent).toEqual([]);
  });

  it("cancels the timeout once the call is accepted", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.calls.apply(DEVICE, "accept", DEV_USER_ID);
    h.clock.advance(CALL_RING_TIMEOUT_MS * 2);
    h.deadlines.fireDue(h.clock.now());
    expect(h.calls.current(DEVICE)?.state).toBe("active");
  });
});

// ---------------------------------------------------------------------------------------------

describe("the narrations and the log (Req 9.6, 9.7)", () => {
  it("passes checkOutput at every Age_Stage and language", () => {
    for (const lang of SUPPORTED_LANGS as readonly SupportedLang[]) {
      for (const stage of AGE_STAGES as readonly AgeStage[]) {
        const verdict = checkOutput(CALL_ANNOUNCE_NARRATION[lang][stage], {
          ageStage: stage,
          lang,
          allowedCategories: [],
          deferTopics: [],
        });
        expect(verdict.decision, `${lang}/${stage}`).toBe("allow");
      }
    }
  });

  it("records nothing of a call but its state, its ids and its times", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.calls.apply(DEVICE, "accept", DEV_USER_ID);
    h.calls.apply(DEVICE, "end", DEV_USER_ID);
    const events = grandmaEvents(h);
    expect(events.map((entry) => entry.event)).toEqual([
      "call_requested",
      "call_ringing",
      "call_accepted",
      "call_ended",
    ]);
    for (const entry of events) {
      expect(Object.keys(entry).sort()).toEqual([
        "asset_id",
        "at",
        "call_id",
        "call_state",
        "device_id",
        "event",
        "kind",
        "log_ver",
        "outcome",
        "reason",
        "seq",
      ]);
      // No narration text, no media handle, no user id.
      const text = JSON.stringify(entry);
      expect(text).not.toContain("Grandma is here");
      expect(text).not.toContain(DEV_USER_ID);
    }
  });

  it("carries the announce narration in no command payload", () => {
    const h = harness();
    h.calls.apply(DEVICE, "request", DEV_USER_ID);
    h.calls.apply(DEVICE, "accept", DEV_USER_ID);
    for (const command of h.sent) {
      expect(JSON.stringify(command)).not.toContain("Grandma is here");
    }
  });
});
