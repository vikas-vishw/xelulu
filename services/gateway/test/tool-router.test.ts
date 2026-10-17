// The Tool_Router is the allow-list that stands between a model and the house (Req 9, C18,
// safety.md §3), so it is tested as a gate, not as a dispatcher. Four invariants carry the
// safety argument and each has its own block below:
//
//   1. the allow-list is an exact match, consulted before any handler runs;
//   2. an unknown name reaches no handler and is never written anywhere;
//   3. a device action is gated on quiet hours, the play limit and the movement toggle BEFORE
//      anything is sent;
//   4. an ack `reason` is final: one send, no retry, and no reason in anything speakable.
//
// Property 7: only allow-listed tools run. Property 8: device policy gates before sending. Both
// are fast-check runs, because the claim is about every name and every policy state rather than
// about the handful an example list would reach.
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOW_LISTED_TOOLS, type AllowListedTool, type ToolDeniedReason } from "@xelulu/shared";

import { createTestClock } from "./support/test-clock.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createContentStack } from "./support/content-stack.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import { createRoutines } from "../src/brain/tools/routines.js";
import {
  DEVICE_ACTION_ALLOWED,
  createDeviceActions,
  inQuietHours,
} from "../src/brain/tools/device-action.js";
import {
  MAX_TOOL_CALLS_PER_TURN,
  createToolRouter,
  type ToolResult,
  type ToolRouter,
} from "../src/brain/tools/tool-router.js";
import { createMemoryStore } from "../src/brain/state/memory-store.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
  type DevicePolicy,
} from "../src/brain/state/child-context.js";
import type { CommandRequest, CommandResult } from "../src/mqtt/command-sender.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";

/** Every brain test installs the socket guard: no tool reaches a network (Req 22.8). */
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
/** `lang` is the turn's resolved language, carried on the turn since Phase 4 (Req 3.2d). */
const TURN = { deviceId: DEVICE, turnId: "t_router", lang: "en-IN" } as const;

/**
 * A distinctive name no list carries and no log field spells, so the "never logged" assertion
 * cannot pass by coincidence. Built from a fixed alphabet rather than a string generator, so the
 * shape is the same on every fast-check version.
 */
const HEX = "0123456789abcdef".split("");
const unknownName = fc
  .array(fc.constantFrom(...HEX), { minLength: 12, maxLength: 24 })
  .map((chars) => `zz${chars.join("")}`);

/** The denial reason of a result, or null when it succeeded. Keeps the union narrowed. */
function reasonOf(result: ToolResult): ToolDeniedReason | null {
  return result.ok ? null : result.reason;
}

const OPEN_POLICY: DevicePolicy = Object.freeze({
  quietHours: null,
  playLimitMinutes: null,
  movementOn: true,
});

function contextOf(policy: DevicePolicy, over: Partial<ChildContext> = {}): ChildContextTable {
  const ctx: ChildContext = {
    ...MOST_RESTRICTIVE_CONTEXT,
    langs: ["en-IN"],
    allowedCategories: ["stories", "animals"],
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
  router: ToolRouter;
  sent: CommandRequest[];
  entries: () => readonly Readonly<Record<string, unknown>>[];
  nowMinutes: { value: number };
}>;

function harness(
  policy: DevicePolicy = OPEN_POLICY,
  over: Partial<ChildContext> = {},
  sendResult: CommandResult = { ok: true, cmd_id: "cmd_1" },
): Harness {
  const clock = createTestClock(0);
  const log = createGatewayLog(clock, createCaptureSink());
  const sent: CommandRequest[] = [];
  const nowMinutes = { value: 12 * 60 };
  const context = contextOf(policy, over);
  const routines = createRoutines(undefined, { [DEVICE]: 0 });
  const stack = createContentStack({ clock, log });
  const router = createToolRouter({
    log,
    content: stack.library,
    stories: stack.stories,
    routines,
    memory: createMemoryStore(),
    context,
    device: createDeviceActions({
      sendCommand: (request) => {
        sent.push(request);
        return sendResult;
      },
      context,
      routines,
      nowMinutes: () => nowMinutes.value,
    }),
  });
  return {
    router,
    sent,
    entries: () => log.since(0) as readonly Readonly<Record<string, unknown>>[],
    nowMinutes,
  };
}

// ---------------------------------------------------------------------------------------------
// 1 and 2: the allow-list

describe("the allow-list is exact-match and runs before any handler", () => {
  /** Handlers that fail the test if they are ever reached. */
  function spyRouter(): Readonly<{ router: ToolRouter; touched: () => number }> {
    let touched = 0;
    const clock = createTestClock(0);
    const log = createGatewayLog(clock, createCaptureSink());
    const context = contextOf(OPEN_POLICY);
    const count = (): void => {
      touched += 1;
    };
    const router = createToolRouter({
      log,
      content: {
        lookup: () => {
          count();
          return { ok: true, titles: ["x"] };
        },
        categories: () => {
          count();
          return [];
        },
      },
      stories: {
        start: () => {
          count();
          return null;
        },
        inProgress: () => false,
        advance: () => null,
        putPending: () => {
          count();
        },
        takePending: () => null,
        end: () => undefined,
        sweep: () => undefined,
      },
      routines: {
        lookup: () => {
          count();
          return { ok: true, name: "bedtime", at: "20:30" };
        },
        names: () => [],
        playMinutesUsed: () => 0,
      },
      memory: {
        read: () => {
          count();
          return [];
        },
        write: () => {
          count();
          return "stored";
        },
        forget: () => 0,
        count: () => 0,
      },
      context,
      device: {
        request: () => {
          count();
          return { ok: true, tool: "device_action", text: "asked Xelulu to say" };
        },
        policyRefusal: () => null,
      },
    });
    return { router, touched: () => touched };
  }

  it("denies every name outside the list and touches no handler (Property 7)", () => {
    fc.assert(
      fc.property(unknownName, (name) => {
        const spy = spyRouter();
        const result = spy.router.run(TURN, { name, args: {} });
        expect(result).toEqual({
          ok: false,
          tool: null,
          outcome: "denied",
          reason: "not_allow_listed",
        });
        expect(spy.touched()).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it("matches exactly: no trimming, no case folding, no prefix", () => {
    const spy = spyRouter();
    for (const name of [
      " content_lookup",
      "content_lookup ",
      "Content_Lookup",
      "CONTENT_LOOKUP",
      "content_lookup2",
      "content",
      "content_lookup\n",
      "memory_writes",
      "",
    ]) {
      expect(reasonOf(spy.router.run(TURN, { name, args: {} }))).toBe("not_allow_listed");
    }
    expect(spy.touched()).toBe(0);
  });

  it("reaches a handler for each of the five allow-listed names", () => {
    for (const tool of ALLOW_LISTED_TOOLS) {
      const spy = spyRouter();
      const result = spy.router.run(
        { deviceId: DEVICE, turnId: `t_${tool}`, lang: "en-IN" },
        {
          name: tool,
          args: { category: "stories", name: "bedtime", fact: "likes lions", action: "say" },
        },
      );
      expect(result.tool).toBe(tool);
      expect(spy.touched()).toBe(1);
    }
  });

  it("never writes the requested name, and logs a null tool for it", () => {
    fc.assert(
      fc.property(unknownName, (name) => {
        const h = harness();
        h.router.run(TURN, { name, args: { category: name, fact: name } });
        const serialised = JSON.stringify(h.entries());
        expect(serialised).not.toContain(name);
        const call = h.entries().find((entry) => entry["kind"] === "tool_call");
        expect(call).toMatchObject({
          tool: null,
          outcome: "denied",
          denied_reason: "not_allow_listed",
        });
      }),
      { numRuns: 200 },
    );
  });

  it("logs no argument value for an allow-listed call either", () => {
    const h = harness();
    const secret = "zzsentinelfactvalue";
    h.router.run(TURN, { name: "memory_write", args: { fact: secret } });
    expect(JSON.stringify(h.entries())).not.toContain(secret);
  });

  it("spends the per-turn budget only on allow-listed names", () => {
    const h = harness();
    for (let i = 0; i < 5; i += 1) h.router.run(TURN, { name: "zzunknownname", args: {} });
    expect(h.router.callCount(TURN.turnId)).toBe(0);

    for (let i = 0; i < MAX_TOOL_CALLS_PER_TURN; i += 1) {
      expect(h.router.run(TURN, { name: "memory_read", args: {} }).ok).toBe(true);
    }
    expect(h.router.run(TURN, { name: "memory_read", args: {} })).toEqual({
      ok: false,
      tool: "memory_read",
      outcome: "denied",
      reason: "too_many",
    });
    h.router.endTurn(TURN.turnId);
    expect(h.router.callCount(TURN.turnId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 3: the device policy gate

describe("device actions are gated before anything is sent", () => {
  const ACTION_ARGS = { action: "say", data: { expression: "happy" } } as const;

  it("sends nothing under quiet hours", () => {
    const h = harness({
      quietHours: { start: "22:00", end: "07:00" },
      playLimitMinutes: null,
      movementOn: true,
    });
    h.nowMinutes.value = 23 * 60;
    expect(h.router.run(TURN, { name: "device_action", args: ACTION_ARGS })).toEqual({
      ok: false,
      tool: "device_action",
      outcome: "denied",
      reason: "policy",
    });
    expect(h.sent).toEqual([]);
  });

  it("sends when the quiet window has passed", () => {
    const h = harness({
      quietHours: { start: "22:00", end: "07:00" },
      playLimitMinutes: null,
      movementOn: true,
    });
    h.nowMinutes.value = 9 * 60;
    expect(h.router.run(TURN, { name: "device_action", args: ACTION_ARGS }).ok).toBe(true);
    expect(h.sent).toHaveLength(1);
  });

  it("sends nothing once the play limit is reached", () => {
    const clock = createTestClock(0);
    const log = createGatewayLog(clock, createCaptureSink());
    const sent: CommandRequest[] = [];
    const context = contextOf({ quietHours: null, playLimitMinutes: 30, movementOn: true });
    const routines = createRoutines(undefined, { [DEVICE]: 30 });
    const stack = createContentStack({ clock, log });
    const router = createToolRouter({
      log,
      content: stack.library,
      stories: stack.stories,
      routines,
      memory: createMemoryStore(),
      context,
      device: createDeviceActions({
        sendCommand: (request) => {
          sent.push(request);
          return { ok: true, cmd_id: "cmd_1" };
        },
        context,
        routines,
        nowMinutes: () => 12 * 60,
      }),
    });
    expect(reasonOf(router.run(TURN, { name: "device_action", args: ACTION_ARGS }))).toBe("policy");
    expect(sent).toEqual([]);
  });

  it("sends nothing for a gesture while movement is off, but still speaks", () => {
    const h = harness({ quietHours: null, playLimitMinutes: null, movementOn: false });
    expect(
      reasonOf(
        h.router.run(TURN, { name: "device_action", args: { action: "gesture", data: {} } }),
      ),
    ).toBe("policy");
    expect(h.sent).toEqual([]);
    expect(h.router.run(TURN, { name: "device_action", args: ACTION_ARGS }).ok).toBe(true);
    expect(h.sent).toHaveLength(1);
  });

  it("refuses an action outside the five, without sending (Req 9.5)", () => {
    for (const action of ["move", "ota", "config", "set_mode", "volume", "stop_audio"]) {
      const h = harness();
      expect(h.router.run(TURN, { name: "device_action", args: { action, data: {} } }).ok).toBe(
        false,
      );
      expect(h.sent).toEqual([]);
    }
    // The set, not the order: the order is the contract's, because the list is derived from
    // CMD_ACTIONS rather than re-spelled here.
    expect([...DEVICE_ACTION_ALLOWED].sort().join(",")).toBe("animate,gesture,led,play,say");
  });

  /** Property 8: for any policy and any clock minute, a refusal means nothing was sent. */
  it("never sends when the gate refuses, for any policy state (Property 8)", () => {
    fc.assert(
      fc.property(
        fc.record({
          quiet: fc.option(
            fc.record({
              start: fc.constantFrom("00:00", "07:00", "22:00", "23:30"),
              end: fc.constantFrom("00:00", "07:00", "09:00", "22:00"),
            }),
            { nil: null },
          ),
          limit: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
          used: fc.integer({ min: 0, max: 120 }),
          movementOn: fc.boolean(),
          minute: fc.integer({ min: 0, max: 1439 }),
          action: fc.constantFrom(...DEVICE_ACTION_ALLOWED),
        }),
        (c) => {
          const clock = createTestClock(0);
          const log = createGatewayLog(clock, createCaptureSink());
          const sent: CommandRequest[] = [];
          const policy: DevicePolicy = {
            quietHours: c.quiet,
            playLimitMinutes: c.limit,
            movementOn: c.movementOn,
          };
          const context = contextOf(policy);
          const routines = createRoutines(undefined, { [DEVICE]: c.used });
          const device = createDeviceActions({
            sendCommand: (request) => {
              sent.push(request);
              return { ok: true, cmd_id: "cmd_1" };
            },
            context,
            routines,
            nowMinutes: () => c.minute,
          });
          const stack = createContentStack({ clock, log });
          const router = createToolRouter({
            log,
            content: stack.library,
            stories: stack.stories,
            routines,
            memory: createMemoryStore(),
            context,
            device,
          });
          const refusal = device.policyRefusal(DEVICE, c.action);
          const result = router.run(TURN, {
            name: "device_action",
            args: { action: c.action, data: {} },
          });
          if (refusal !== null) {
            expect(result.ok).toBe(false);
            expect(sent).toEqual([]);
          } else {
            expect(result.ok).toBe(true);
            expect(sent).toHaveLength(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("treats a malformed quiet window as quiet, not as absent", () => {
    // A misconfigured setting should silence the robot rather than be ignored (safety.md §8).
    expect(
      inQuietHours(
        { quietHours: { start: "25:00", end: "07:00" }, playLimitMinutes: null, movementOn: true },
        600,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 4: an ack reason is final

describe("an ack reason is final", () => {
  it("sends exactly once per request and never retries", () => {
    const h = harness();
    h.router.run(TURN, { name: "device_action", args: { action: "say", data: {} } });
    expect(h.sent).toHaveLength(1);
    // Nothing in the module can react to an ack: there is no callback to call. A second send
    // could only come from a retry, and a second run is a second request, not a retry.
    expect(h.router.callCount(TURN.turnId)).toBe(1);
  });

  it("reports a send refusal without a replacement command", () => {
    const h = harness(OPEN_POLICY, {}, {
      ok: false,
      error: { code: "device_offline" },
    } as CommandResult);
    const result = h.router.run(TURN, { name: "device_action", args: { action: "say", data: {} } });
    expect(result).toEqual({
      ok: false,
      tool: "device_action",
      outcome: "error",
      reason: null,
    });
    expect(h.sent).toHaveLength(1);
  });

  it("puts no ack reason into any text a child could hear", () => {
    const h = harness();
    const result = h.router.run(TURN, { name: "device_action", args: { action: "say", data: {} } });
    const text = result.ok ? result.text : "";
    for (const reason of [
      "picked_up",
      "at_edge",
      "charging",
      "quiet_hours",
      "low_battery",
      "unsafe",
      "busy",
      "unknown_action",
    ]) {
      expect(text).not.toContain(reason);
    }
    expect(text).toBe("asked Xelulu to say");
  });

  it("registers no ack handler at all", () => {
    // Structural: the module takes a sender and nothing else, so no ack path exists to retry on.
    const spy = vi.fn(() => ({ ok: true, cmd_id: "cmd_1" }) as CommandResult);
    const context = contextOf(OPEN_POLICY);
    const routines = createRoutines(undefined, { [DEVICE]: 0 });
    const device = createDeviceActions({
      sendCommand: spy,
      context,
      routines,
      nowMinutes: () => 12 * 60,
    });
    expect(Object.keys(device).sort()).toEqual(["policyRefusal", "request"]);
    device.request(DEVICE, { action: "say", data: {} });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The five handlers, and the stores' caps

describe("the five tools", () => {
  it("looks up curated content only inside an allowed category", () => {
    const h = harness();
    const ok = h.router.run(TURN, { name: "content_lookup", args: { category: "stories" } });
    expect(ok.ok).toBe(true);
    // `maths` is not in the test context's allowed categories, so the tool refuses on policy.
    const denied = h.router.run(TURN, { name: "content_lookup", args: { category: "maths" } });
    expect(denied).toMatchObject({ outcome: "denied", reason: "policy" });
  });

  it("answers a routine with its name and time", () => {
    const h = harness();
    const result = h.router.run(TURN, { name: "routine_lookup", args: { name: "bedtime" } });
    expect(result).toEqual({ ok: true, tool: "routine_lookup", text: "bedtime at 20:30" });
  });

  it("reads back what it wrote, within the per-child caps", () => {
    const h = harness();
    expect(h.router.run(TURN, { name: "memory_write", args: { fact: "likes lions" } }).ok).toBe(
      true,
    );
    const read = h.router.run(
      { deviceId: DEVICE, turnId: "t_read", lang: "en-IN" },
      { name: "memory_read", args: {} },
    );
    expect(read.ok && read.text).toContain("likes lions");
  });

  it("refuses an over-long fact rather than truncating it", () => {
    const h = harness();
    const long = "a".repeat(121);
    expect(h.router.run(TURN, { name: "memory_write", args: { fact: long } })).toMatchObject({
      outcome: "denied",
      reason: "policy",
    });
  });

  it("errors rather than coerces a wrong argument shape", () => {
    const h = harness();
    for (const args of [{}, { category: 7 }, { category: "" }, { category: null }]) {
      const result = h.router.run(TURN, {
        name: "content_lookup",
        args: args as Readonly<Record<string, unknown>>,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("names exactly five tools, and the router runs no other", () => {
    expect([...ALLOW_LISTED_TOOLS].sort()).toEqual([
      "content_lookup",
      "device_action",
      "memory_read",
      "memory_write",
      "routine_lookup",
    ] satisfies AllowListedTool[]);
  });
});
