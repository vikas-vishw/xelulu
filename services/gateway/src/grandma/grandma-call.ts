// The live Grandma call (XL-G05, Phase 4 Req 9): a state machine, three behaviours and a
// timeout. There is NO media here at all.
//
// What this module does not do is the point of it (Req 9.7, C12): it opens no socket, carries no
// audio in either direction, adds no dependency and records nothing of a call but its state and
// its times. The call's audio plane is a later phase's work; what Phase 4 owns is the state a
// parent, a console and the robot's face agree on.
//
// Two rules shape the rest:
//
//  - The transition table is FROZEN DATA, so an illegal transition is a missing entry rather than
//    a forgotten `if` (Req 9.2). Every refusal changes nothing and sends nothing.
//  - Every command goes through the unchanged Phase 3 Device_Policy_Gate (Req 9.3–9.6, C16). The
//    ring is asked for BEFORE the call moves to `ringing`, so a refused ring leaves the call
//    `requested` and the request expires on the Clock instead of ringing a sleeping house.
import {
  type GrandmaCallState,
  type GrandmaEvent,
  type GrandmaRefusal,
  type SupportedLang,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { IdSource } from "../ids.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { ChildContextTable } from "../brain/state/child-context.js";
import type { DeviceActions } from "../brain/tools/device-action.js";
import type { behaviourActions, FireResult } from "../routines/routine-behaviours.js";
import type { GrandmaResult } from "./grandma-store.js";

/** How long an unanswered request or ring stands before the call ends itself. */
export const CALL_RING_TIMEOUT_MS = 45_000;

export const CALL_ID_PREFIX = "call_";

export type GrandmaCall = Readonly<{
  call_id: string;
  device_id: string;
  household_id: string;
  requested_by_user_id: string;
  state: GrandmaCallState;
  requested_at: string;
  ended_at: string | null;
}>;

/**
 * The operations a caller may apply. A frozen list as well as a type, because the Operator route
 * has to test a submitted string for membership and no runtime code can test against a type.
 */
export const CALL_OPS = Object.freeze(["request", "accept", "decline", "end"] as const);
export type CallOp = (typeof CALL_OPS)[number];

/**
 * Exactly Requirement 9.2's transitions, as data: `idle` → `requested` → `ringing` → `active` →
 * `ended`; `requested` or `ringing` → `declined`; `ringing` or `active` → `ended`. A finished
 * call (`ended`, `declined`) accepts a fresh `request`, which starts a NEW call record, because
 * "at most one call per device at a time" (Req 9.1) is about calls in flight.
 *
 * `requested` → `ringing` is deliberately NOT an op: the ring is the gate's answer, not a
 * caller's (Req 9.3), so it is applied internally when the gate allowed the ring behaviour.
 */
export const CALL_TRANSITIONS: Readonly<
  Record<GrandmaCallState, Readonly<Partial<Record<CallOp, GrandmaCallState>>>>
> = Object.freeze({
  idle: Object.freeze({ request: "requested" }),
  requested: Object.freeze({ decline: "declined" }),
  ringing: Object.freeze({ accept: "active", decline: "declined", end: "ended" }),
  active: Object.freeze({ end: "ended" }),
  ended: Object.freeze({ request: "requested" }),
  declined: Object.freeze({ request: "requested" }),
});

export interface GrandmaCalls {
  current(deviceId: string): GrandmaCall | null;
  /**
   * `by` is always `DEV_USER_ID`, bound in the composition root and never read from a body
   * (Req 7.9a). The route's accepted body is `{ device_id, op }` and nothing else.
   */
  apply(deviceId: string, op: CallOp, by: string): GrandmaResult<GrandmaCall>;
}

/** The deadline key a device's pending ring is scheduled under. One per device. */
function ringKey(deviceId: string): string {
  return `grandma:call:ring:${deviceId}`;
}

export function createGrandmaCalls(
  deps: Readonly<{
    clock: Clock;
    deadlines: Deadlines;
    ids: IdSource;
    log: Pick<GatewayLog, "add">;
    /** The unchanged Phase 3 gate: the only path to the wire for the ring, announce and end. */
    actions: DeviceActions;
    context: ChildContextTable;
    /** `householdForDevice`, bound in the composition root. Never read from a body (Req 7.9). */
    household: (deviceId: string) => string | null;
    behaviours: typeof behaviourActions;
  }>,
): GrandmaCalls {
  const calls = new Map<string, GrandmaCall>();

  function logEvent(
    call: GrandmaCall,
    event: GrandmaEvent,
    outcome: "ok" | "refused",
    reason: GrandmaRefusal | null,
  ): void {
    deps.log.add({
      kind: "grandma_event",
      device_id: call.device_id,
      asset_id: null,
      call_id: call.call_id,
      event,
      outcome,
      reason,
      call_state: call.state,
    });
  }

  /**
   * One behaviour through the Device_Policy_Gate, in order, stopping at the first refusal
   * (Req 10.4). `policyRefusal` is read first for the enum a log entry needs, because
   * `DeviceActions.request` deliberately answers the opaque `policy` and must not change; a
   * SEND failure stops the behaviour too and is counted with `refusal: null`, because no
   * `PolicyRefusal` value covers it and none is invented (Req 10.4a).
   */
  function fire(deviceId: string, id: Parameters<typeof behaviourActions>[0]): FireResult {
    const ctx = deps.context.forDevice(deviceId);
    const lang: SupportedLang = ctx.langs[0] ?? "en-IN";
    const actions = deps.behaviours(id, {
      lang,
      ageStage: ctx.ageStage,
      refId: null,
      word: null,
      title: null,
    });
    let sent = 0;
    for (const action of actions) {
      const refusal = deps.actions.policyRefusal(deviceId, action.action);
      if (refusal !== null) {
        return { actions: actions.length, sent, refused: 1, refusal };
      }
      const result = deps.actions.request(deviceId, { action: action.action, data: action.data });
      if (!result.ok) {
        return { actions: actions.length, sent, refused: 1, refusal: null };
      }
      sent += 1;
    }
    return { actions: actions.length, sent, refused: 0, refusal: null };
  }

  /** Ends a call that nobody answered. The ring's LED is put back through the same gate. */
  function expire(deviceId: string): void {
    const call = calls.get(deviceId);
    if (call === undefined) return;
    if (call.state !== "requested" && call.state !== "ringing") return;
    // Nothing was ever lit for a call still `requested` (the ring was refused), so nothing is put
    // back; a `ringing` call gets its belly returned to a dim solid (Req 9.6).
    if (call.state === "ringing") fire(deviceId, "call_end");
    const ended: GrandmaCall = Object.freeze({
      ...call,
      state: "ended",
      ended_at: isoAt(deps.clock.now()),
    });
    calls.set(deviceId, ended);
    logEvent(ended, "call_ended", "ok", null);
  }

  function armRing(deviceId: string): void {
    deps.deadlines.schedule(ringKey(deviceId), deps.clock.now() + CALL_RING_TIMEOUT_MS, () => {
      expire(deviceId);
    });
  }

  function refuse(
    call: GrandmaCall | null,
    reason: GrandmaRefusal,
    event: GrandmaEvent,
  ): GrandmaResult<GrandmaCall> {
    if (call !== null) logEvent(call, event, "refused", reason);
    return { ok: false, reason, field: null, gate: null };
  }

  return {
    current: (deviceId) => calls.get(deviceId) ?? null,

    apply(deviceId, op, by) {
      const existing = calls.get(deviceId) ?? null;
      const from: GrandmaCallState = existing?.state ?? "idle";
      const to = CALL_TRANSITIONS[from][op];
      if (to === undefined) {
        return refuse(existing, "invalid_transition", "call_requested");
      }

      if (op === "request") {
        const householdId = deps.household(deviceId);
        if (householdId === null) {
          return { ok: false, reason: "invalid_field", field: "device_id", gate: null };
        }
        // A fresh record each time, so a finished call is never reopened (Req 9.1).
        const requested: GrandmaCall = Object.freeze({
          call_id: CALL_ID_PREFIX + deps.ids.next(""),
          device_id: deviceId,
          household_id: householdId,
          requested_by_user_id: by,
          state: "requested",
          requested_at: isoAt(deps.clock.now()),
          ended_at: null,
        });
        calls.set(deviceId, requested);
        logEvent(requested, "call_requested", "ok", null);

        // The ring decides whether the call rings at all (Req 9.3, 9.4).
        const ring = fire(deviceId, "call_ring");
        armRing(deviceId);
        if (ring.sent < ring.actions) {
          // Nothing sent past the refusal, the call STAYS `requested`, and the request expires on
          // the Clock. The entry carries `policy`, which is the only refusal `grandma_event`
          // records; the precise Policy_Refusal is a `routine_fired` field and not one of these.
          logEvent(requested, "call_ringing", "refused", "policy");
          return { ok: true, value: requested };
        }
        const ringing: GrandmaCall = Object.freeze({ ...requested, state: "ringing" });
        calls.set(deviceId, ringing);
        logEvent(ringing, "call_ringing", "ok", null);
        return { ok: true, value: ringing };
      }

      if (existing === null) {
        // Unreachable: only `request` is legal from `idle`, which is the only state with no row.
        return { ok: false, reason: "invalid_transition", field: null, gate: null };
      }

      const moved: GrandmaCall = Object.freeze({
        ...existing,
        state: to,
        ended_at: to === "ended" || to === "declined" ? isoAt(deps.clock.now()) : existing.ended_at,
      });
      calls.set(deviceId, moved);

      if (op === "accept") {
        deps.deadlines.cancel(ringKey(deviceId));
        fire(deviceId, "call_announce");
        logEvent(moved, "call_accepted", "ok", null);
        return { ok: true, value: moved };
      }
      // Declined or ended: the belly goes back to a dim solid and the times are set (Req 9.6).
      deps.deadlines.cancel(ringKey(deviceId));
      fire(deviceId, "call_end");
      logEvent(moved, op === "decline" ? "call_declined" : "call_ended", "ok", null);
      return { ok: true, value: moved };
    },
  };
}
