// The Device_Control_Route (Phase 6 Req 5, 8.2, 8.3; C10, C11, C12).
//
// Two halves, because the claim has two halves.
//
//  1. THE GATE. Property 3 — `send` puts a command on the wire if and only if `policyRefusal` is
//     null — plus the two examples Requirement 8.2 names by hand: `move` refused as
//     `action_not_allowed` with nothing sent, and `say` inside quiet hours refused as
//     `quiet_hours` with nothing sent. These run against `createDeviceActions` directly with an
//     injected `nowMinutes`, because a quiet-hours claim must not depend on what time the test
//     machine happens to think it is.
//  2. THE ROUTE. The flag refusal before any body byte, the body rules, the gate's refusal on the
//     wire as a closed enum, and `POST /v1/commands` behaving exactly as it did before — which is
//     the point of C10: the Compose_Acceptance_Check sends `config` through that route and
//     `config` is not allow-listed, so gating it would have broken a green criterion.
//
// The route half runs the composed gateway in this process on the memory broker, with the real
// HTTP listener on 127.0.0.1 and an OS-assigned port.
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import {
  CMD_ACTIONS,
  KNOWN_EXPRESSIONS,
  KNOWN_GESTURE_NAMES,
  SAY_VOICES,
  SUPPORTED_LANGS,
  type CmdAction,
} from "@xelulu/shared";

import {
  DEVICE_ACTION_ALLOWED,
  createDeviceActions,
  type DeviceActionSend,
} from "../src/brain/tools/device-action.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
  type DevicePolicy,
} from "../src/brain/state/child-context.js";
import type { CommandRequest } from "../src/mqtt/command-sender.js";
import { OPERATOR_DEVICE_CONTROL_PATH } from "../src/operator/operator-routes.js";
import { createRoutineStore } from "../src/routines/routine-store.js";

import { HARNESS_DEVICE_ID, startHarness, type Harness } from "./support/gateway-harness.js";
import { rawRequest, type RawResponse } from "./support/operator-http.js";
import { createTestClock } from "./support/test-clock.js";

const DEVICE = HARNESS_DEVICE_ID;

/** A valid minimal `data` per action, so a refusal is the gate's and never the schema's. */
const SAY_DATA: Readonly<Record<string, unknown>> = Object.freeze({
  expression: KNOWN_EXPRESSIONS[0],
  lang: SUPPORTED_LANGS[0],
  voice: SAY_VOICES[0],
  duration_hint_ms: 1_000,
});

const GESTURE_DATA: Readonly<Record<string, unknown>> = Object.freeze({
  name: KNOWN_GESTURE_NAMES[0],
});

// ---------------------------------------------------------------------------------------------
// 1: the gate.

const OPEN_POLICY: DevicePolicy = Object.freeze({
  quietHours: null,
  playLimitMinutes: null,
  movementOn: true,
});

function contextOf(policy: DevicePolicy): ChildContextTable {
  const ctx: ChildContext = { ...MOST_RESTRICTIVE_CONTEXT, policy };
  return {
    setActiveChild: () => undefined,
    forDevice: () => ctx,
    childKeyFor: () => "child:test",
  };
}

type GateHarness = Readonly<{
  sent: CommandRequest[];
  send: (action: string, data?: Readonly<Record<string, unknown>>) => DeviceActionSend;
  refusalFor: (action: CmdAction) => string | null;
}>;

function gate(policy: DevicePolicy = OPEN_POLICY, nowMinutes = 12 * 60, playUsed = 0): GateHarness {
  const clock = createTestClock(0);
  const sent: CommandRequest[] = [];
  const context = contextOf(policy);
  const routines = createRoutineStore({ clock, playMinutes: { [DEVICE]: playUsed } });
  const actions = createDeviceActions({
    sendCommand: (request) => {
      sent.push(request);
      return { ok: true, cmd_id: `cmd_${String(sent.length)}` };
    },
    context,
    routines,
    nowMinutes: () => nowMinutes,
  });
  return {
    sent,
    send: (action, data = {}) => actions.send(DEVICE, { action: action as CmdAction, data }),
    refusalFor: (action) => actions.policyRefusal(DEVICE, action),
  };
}

describe("Property 3: the gate decides every send", () => {
  // Feature: phase-6-integration-cockpit, Property 3: The gate decides every send
  it("sends iff policyRefusal is null, and returns a cmd_id exactly then", () => {
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
          // Every Document B action, not only the allow-listed five: the allow-list itself is
          // part of what the gate decides.
          action: fc.constantFrom(...CMD_ACTIONS),
        }),
        (c) => {
          const policy: DevicePolicy = {
            quietHours: c.quiet,
            playLimitMinutes: c.limit,
            movementOn: c.movementOn,
          };
          const h = gate(policy, c.minute, c.used);
          const refusal = h.refusalFor(c.action);
          const result = h.send(c.action);
          if (refusal !== null) {
            expect(result).toEqual({ ok: false, refusal });
            expect(h.sent).toEqual([]);
          } else {
            expect(result.ok).toBe(true);
            expect(result.ok ? result.cmd_id : "").not.toBe("");
            expect(h.sent).toHaveLength(1);
            expect(h.sent[0]?.action).toBe(c.action);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("refuses move as action_not_allowed with nothing on the wire (Req 8.2)", () => {
    // Every policy state: movement is refused on the ACTION, before any policy is read, so an
    // open policy and a wide-open movement toggle change nothing.
    const h = gate(OPEN_POLICY);
    expect(h.send("move", { cmd: "stop", max_dist_mm: 0 })).toEqual({
      ok: false,
      refusal: "action_not_allowed",
    });
    expect(h.sent).toEqual([]);
    expect(DEVICE_ACTION_ALLOWED).not.toContain("move");
  });

  it("refuses every action outside the allow-list, nothing sent", () => {
    for (const action of CMD_ACTIONS.filter((a) => !DEVICE_ACTION_ALLOWED.includes(a))) {
      const h = gate(OPEN_POLICY);
      expect(h.send(action)).toEqual({ ok: false, refusal: "action_not_allowed" });
      expect(h.sent).toEqual([]);
    }
    // And a string Document B has never heard of is refused the same way.
    const unknown = gate(OPEN_POLICY);
    expect(unknown.send("teleport")).toEqual({ ok: false, refusal: "action_not_allowed" });
    expect(unknown.sent).toEqual([]);
  });

  it("refuses say inside quiet hours as quiet_hours with nothing on the wire (Req 8.2)", () => {
    const quiet: DevicePolicy = {
      quietHours: { start: "22:00", end: "07:00" },
      playLimitMinutes: null,
      movementOn: true,
    };
    // 02:00 is inside the window, which wraps midnight.
    const night = gate(quiet, 2 * 60);
    expect(night.send("say", SAY_DATA)).toEqual({ ok: false, refusal: "quiet_hours" });
    expect(night.sent).toEqual([]);
    // 12:00 is outside it, and the same request goes.
    const day = gate(quiet, 12 * 60);
    expect(day.send("say", SAY_DATA).ok).toBe(true);
    expect(day.sent).toHaveLength(1);
  });

  it("refuses on a reached play limit and on movement off, nothing sent", () => {
    const limited = gate({ ...OPEN_POLICY, playLimitMinutes: 30 }, 12 * 60, 30);
    expect(limited.send("say", SAY_DATA)).toEqual({ ok: false, refusal: "play_limit" });
    expect(limited.sent).toEqual([]);

    const still = gate({ ...OPEN_POLICY, movementOn: false });
    expect(still.send("gesture", GESTURE_DATA)).toEqual({ ok: false, refusal: "movement_off" });
    expect(still.sent).toEqual([]);
    // A non-movement action is unaffected by the toggle.
    expect(still.send("say", SAY_DATA).ok).toBe(true);
  });

  it("passes the sender's own Command_Error through as an error, not as a refusal", () => {
    const clock = createTestClock(0);
    const context = contextOf(OPEN_POLICY);
    const routines = createRoutineStore({ clock, playMinutes: { [DEVICE]: 0 } });
    let calls = 0;
    const actions = createDeviceActions({
      sendCommand: () => {
        calls += 1;
        return { ok: false, error: { code: "device_offline" } };
      },
      context,
      routines,
      nowMinutes: () => 12 * 60,
    });
    expect(actions.send(DEVICE, { action: "say", data: SAY_DATA })).toEqual({
      ok: false,
      error: { code: "device_offline" },
    });
    // Sent exactly once: there is no retry anywhere in the module.
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 2: the route.

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
});

async function harness(deviceControl: boolean): Promise<Harness> {
  const h = await startHarness({ localMode: true, deviceControl });
  running.push(h);
  return h;
}

function port(h: Harness): number {
  const p = h.gateway.operatorPort();
  if (p === null) throw new Error("no Operator_Surface");
  return p;
}

function json(res: RawResponse): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

function control(body: unknown): Parameters<typeof rawRequest>[1] {
  return {
    method: "POST",
    path: OPERATOR_DEVICE_CONTROL_PATH,
    body: JSON.stringify(body),
  };
}

function publishes(h: Harness): number {
  return h.trace.filter((t) => t.op === "publish").length;
}

describe("the Device_Control_Route is off by default (Req 5.2, 8.3)", () => {
  it("answers 403 device_control_disabled and publishes nothing, whatever the body", async () => {
    const h = await harness(false);
    await h.online();
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant({}),
          fc.constant({ device_id: DEVICE, action: "say", data: SAY_DATA }),
          fc.constant({ device_id: DEVICE, action: "move", data: { cmd: "stop", max_dist_mm: 0 } }),
          fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string({ maxLength: 8 }), {
            maxKeys: 3,
          }),
        ),
        async (body) => {
          const before = publishes(h);
          const res = await rawRequest(port(h), control(body));
          expect(res.status).toBe(403);
          expect(json(res)).toEqual({ ok: false, error: { code: "device_control_disabled" } });
          expect(publishes(h)).toBe(before);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("refuses before any body parse: a body that is not even JSON still answers the flag", async () => {
    const h = await harness(false);
    const res = await rawRequest(port(h), {
      method: "POST",
      path: OPERATOR_DEVICE_CONTROL_PATH,
      body: "{not json",
    });
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({ ok: false, error: { code: "device_control_disabled" } });
  });

  it("does not exist at all outside Local_Mode: no Operator_Surface is opened", async () => {
    const h = await startHarness({ localMode: false, deviceControl: true });
    running.push(h);
    // The flag is ignored entirely outside Local_Mode, so there is no surface to refuse on.
    expect(h.gateway.operatorPort()).toBeNull();
  });
});

describe("the Device_Control_Route body rules (Req 5.1)", () => {
  it("takes exactly device_id, action and data, and echoes no value", async () => {
    const h = await harness(true);
    await h.online();
    const res = await rawRequest(
      port(h),
      control({ device_id: DEVICE, action: "say", data: SAY_DATA, extra: "nope" }),
    );
    expect(res.status).toBe(400);
    const body = json(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("invalid_fields");
    expect(res.body).not.toContain("nope");
  });

  const BAD_BODIES: readonly [Record<string, unknown>, string][] = [
    [{ action: "say", data: {} }, "device_id"],
    [{ device_id: DEVICE, data: {} }, "action"],
    [{ device_id: DEVICE, action: "say" }, "data"],
    [{ device_id: 7, action: "say", data: {} }, "device_id"],
    [{ device_id: DEVICE, action: 7, data: {} }, "action"],
    [{ device_id: DEVICE, action: "say", data: [] }, "data"],
  ];

  it.each(BAD_BODIES)("refuses %j naming %s and publishing nothing", async (body, field) => {
    const h = await harness(true);
    await h.online();
    const before = publishes(h);
    const res = await rawRequest(port(h), control(body));
    expect(res.status).toBe(400);
    const issues = (json(res)["error"] as Record<string, unknown>)["issues"];
    expect(Array.isArray(issues)).toBe(true);
    const paths = (issues as Record<string, unknown>[]).map((issue) =>
      (issue["path"] as unknown[]).join("."),
    );
    expect(paths).toContain(field);
    expect(publishes(h)).toBe(before);
  });

  it("refuses a body that is not JSON and one that is not an object", async () => {
    const h = await harness(true);
    const bad = await rawRequest(port(h), {
      method: "POST",
      path: OPERATOR_DEVICE_CONTROL_PATH,
      body: "{nope",
    });
    expect(bad.status).toBe(400);
    expect(json(bad)).toEqual({ ok: false, error: { code: "invalid_json" } });

    const notObject = await rawRequest(port(h), control([1, 2, 3]));
    expect(notObject.status).toBe(400);
    expect(json(notObject)).toEqual({ ok: false, error: { code: "not_object" } });
  });

  it("goes through the unchanged request guard", async () => {
    const h = await harness(true);
    const foreignHost = await rawRequest(port(h), {
      ...control({}),
      headers: { Host: "evil.example" },
    });
    expect(foreignHost.status).toBe(403);
    expect(json(foreignHost)).toEqual({ ok: false, error: { code: "forbidden_host" } });

    const withOrigin = await rawRequest(port(h), {
      ...control({}),
      headers: { Origin: "null" },
    });
    expect(withOrigin.status).toBe(403);
    expect(json(withOrigin)).toEqual({ ok: false, error: { code: "forbidden_origin" } });

    const wrongMethod = await rawRequest(port(h), { path: OPERATOR_DEVICE_CONTROL_PATH });
    expect(wrongMethod.status).toBe(405);
    expect(json(wrongMethod)).toEqual({ ok: false, error: { code: "method_not_allowed" } });
  });
});

describe("the Device_Control_Route sends only through the gate (Req 5.3-5.6)", () => {
  it("answers { ok: true, cmd_id } for an allow-listed action and publishes once", async () => {
    const h = await harness(true);
    await h.online();
    const before = publishes(h);
    const res = await rawRequest(
      port(h),
      control({ device_id: DEVICE, action: "say", data: SAY_DATA }),
    );
    expect(res.status).toBe(200);
    const body = json(res);
    expect(body["ok"]).toBe(true);
    expect(typeof body["cmd_id"]).toBe("string");
    expect(body["cmd_id"]).not.toBe("");
    // Exactly one publish, and nothing else on the body.
    expect(publishes(h)).toBe(before + 1);
    expect(Object.keys(body).sort()).toEqual(["cmd_id", "ok"]);
  });

  it("refuses move with the Policy_Refusal as a closed enum and publishes nothing", async () => {
    const h = await harness(true);
    await h.online();
    const before = publishes(h);
    const res = await rawRequest(
      port(h),
      control({ device_id: DEVICE, action: "move", data: { cmd: "stop", max_dist_mm: 0 } }),
    );
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({
      ok: false,
      error: { code: "action_refused" },
      refusal: "action_not_allowed",
    });
    expect(publishes(h)).toBe(before);
  });

  it("refuses a movement action when the toggle is off, publishing nothing", async () => {
    const h = await harness(true);
    await h.online();
    // No active child, so MOST_RESTRICTIVE_CONTEXT applies and movement is off (safety.md §8).
    const before = publishes(h);
    const res = await rawRequest(
      port(h),
      control({ device_id: DEVICE, action: "gesture", data: GESTURE_DATA }),
    );
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({
      ok: false,
      error: { code: "action_refused" },
      refusal: "movement_off",
    });
    expect(publishes(h)).toBe(before);
  });

  it("maps the sender's refusal onto the existing command error codes", async () => {
    const h = await harness(true);
    // The device never came online, so the sender refuses before the broker is reached.
    const res = await rawRequest(
      port(h),
      control({ device_id: DEVICE, action: "say", data: SAY_DATA }),
    );
    expect(res.status).toBe(409);
    expect(json(res)).toEqual({ ok: false, error: { code: "device_offline" } });

    const unknown = await rawRequest(
      port(h),
      control({ device_id: "xlu_999999", action: "say", data: SAY_DATA }),
    );
    expect(unknown.status).toBe(404);
    expect(json(unknown)).toEqual({ ok: false, error: { code: "unknown_device" } });
  });

  it("refuses a malformed data body as invalid_command, publishing nothing", async () => {
    const h = await harness(true);
    await h.online();
    const before = publishes(h);
    const res = await rawRequest(port(h), control({ device_id: DEVICE, action: "say", data: {} }));
    expect(res.status).toBe(422);
    expect((json(res)["error"] as Record<string, unknown>)["code"]).toBe("invalid_command");
    expect(publishes(h)).toBe(before);
  });
});

describe("POST /v1/commands is untouched (Req 5.6, C10)", () => {
  it("still accepts config, which the gate does not allow, with the route enabled", async () => {
    const h = await harness(true);
    await h.online();
    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: DEVICE, action: "config", data: { volume: 40 } }),
    });
    expect(res.status).toBe(200);
    expect(json(res)["ok"]).toBe(true);
    expect(typeof json(res)["cmd_id"]).toBe("string");
  });

  it("still accepts move, because it is the ungated operator route by design", async () => {
    const h = await harness(true);
    await h.online();
    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({
        device_id: DEVICE,
        action: "move",
        data: { cmd: "stop", max_dist_mm: 0 },
      }),
    });
    expect(res.status).toBe(200);
    expect(json(res)["ok"]).toBe(true);
  });

  it("keeps its own error codes and its own body rules", async () => {
    const h = await harness(true);
    await h.online();
    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: DEVICE, action: "say", data: SAY_DATA, extra: 1 }),
    });
    expect(res.status).toBe(400);
    expect((json(res)["error"] as Record<string, unknown>)["code"]).toBe("invalid_fields");
  });

  it("answers with no Device_Control_Argument at all, unlike the new route", async () => {
    const h = await harness(false);
    await h.online();
    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: DEVICE, action: "say", data: SAY_DATA }),
    });
    expect(res.status).toBe(200);
    expect(json(res)["ok"]).toBe(true);
  });
});
