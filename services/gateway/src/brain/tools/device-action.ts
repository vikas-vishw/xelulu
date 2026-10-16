// The `device_action` tool (Req 9.5, 9.6, safety.md §5).
//
// This is the only path from a model's tool request to a command on the wire, and it is a gate
// before it is a sender. safety.md §5 says the cloud respects quiet hours, play limits and the
// movement toggle "before sending commands at all", so every one of those is checked here and a
// refused request never reaches the broker.
//
// Two rules that are easy to get wrong, so they are written out:
//
//  - Only five actions are reachable (`DEVICE_ACTION_ALLOWED`). `move` is deliberately NOT among
//    them: movement belongs to the body controller's hard limits, and a model has no business
//    asking for it in this phase. `ota`, `config`, `set_mode`, `volume` and `stop_audio` are not
//    reachable either — they are operator and pipeline concerns, not conversational ones.
//  - An ack `reason` is final (Req 9.6). This module sends once and returns. It registers no ack
//    callback and holds no retry, so there is no code path that could answer a `rejected` with a
//    replacement command, and no reason string is ever put into text a child could hear.
import { CMD_ACTIONS, type CmdAction } from "@xelulu/shared";

import type { CommandRequest, CommandResult } from "../../mqtt/command-sender.js";
import type { ChildContextTable, DevicePolicy } from "../state/child-context.js";
import type { Routines } from "./routines.js";
import type { ToolResult } from "./tool-router.js";

/**
 * Which of Document B's actions a conversation may ask for. Written as an exhaustive decision
 * over `CmdAction` rather than as a list of wire values, for two reasons: the contract stays the
 * only place those values are listed (the `wire_value_list` Repo_Check enforces that), and if
 * Document B ever gains an action, this record stops compiling until someone decides whether a
 * model may reach it. A silent default would be the dangerous outcome.
 */
const CONVERSATIONAL: Readonly<Record<CmdAction, boolean>> = Object.freeze({
  say: true,
  animate: true,
  gesture: true,
  led: true,
  play: true,
  // Movement belongs to the body controller's hard limits, not to a model (safety.md §5).
  move: false,
  // Operator and pipeline concerns, not conversational ones.
  set_mode: false,
  volume: false,
  config: false,
  stop_audio: false,
  ota: false,
});

/** Only these five, and only through this gate (Req 9.5). Derived, never re-listed. */
export const DEVICE_ACTION_ALLOWED: readonly CmdAction[] = Object.freeze(
  CMD_ACTIONS.filter((action) => CONVERSATIONAL[action]),
);

/** The actions the movement toggle governs: the ones that move the robot's body. */
const MOVEMENT_ACTIONS: readonly CmdAction[] = Object.freeze(["gesture"]);

export type DeviceActionRequest = Readonly<{ action: CmdAction; data: Record<string, unknown> }>;

/** Why the policy gate refused. A log and test code, never spoken (Req 9.6). */
export type PolicyRefusal = "quiet_hours" | "play_limit" | "movement_off" | "action_not_allowed";

export interface DeviceActions {
  /** Denied with `policy` under quiet hours, a reached play limit, or movement off. */
  request(deviceId: string, req: DeviceActionRequest): ToolResult;
  /** The refusal the policy would give now, or null. Exposed so tests can read the gate alone. */
  policyRefusal(deviceId: string, action: CmdAction): PolicyRefusal | null;
}

/** `HH:MM` as minutes past midnight, or null when it is not that shape. */
function minutesOf(hhmm: string): number | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(hhmm);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * True when `nowMinutes` is inside the quiet window, which may wrap midnight (22:00 to 07:00).
 * An unparseable window is treated as quiet: a misconfigured quiet hour should silence the robot
 * rather than ignore the parent's setting (safety.md §8).
 */
export function inQuietHours(policy: DevicePolicy, nowMinutes: number): boolean {
  if (policy.quietHours === null) return false;
  const start = minutesOf(policy.quietHours.start);
  const end = minutesOf(policy.quietHours.end);
  if (start === null || end === null) return true;
  if (start === end) return false;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

export function createDeviceActions(
  deps: Readonly<{
    sendCommand: (request: CommandRequest) => CommandResult;
    context: ChildContextTable;
    routines: Routines;
    /** Local minutes past midnight, from the Clock. Injected so tests are not clock-bound. */
    nowMinutes: () => number;
  }>,
): DeviceActions {
  function policyRefusal(deviceId: string, action: CmdAction): PolicyRefusal | null {
    if (!DEVICE_ACTION_ALLOWED.includes(action)) return "action_not_allowed";
    const policy = deps.context.forDevice(deviceId).policy;
    // Quiet hours silence everything, not just motion. safety.md §5 names movement, and the
    // conservative reading of "quiet" is that a talking robot is not quiet either.
    if (inQuietHours(policy, deps.nowMinutes())) return "quiet_hours";
    if (
      policy.playLimitMinutes !== null &&
      deps.routines.playMinutesUsed(deviceId) >= policy.playLimitMinutes
    ) {
      return "play_limit";
    }
    if (MOVEMENT_ACTIONS.includes(action) && !policy.movementOn) return "movement_off";
    return null;
  }

  return {
    policyRefusal,

    request(deviceId, req) {
      // The gate runs before the sender, so a refused request puts nothing on the wire.
      if (policyRefusal(deviceId, req.action) !== null) {
        return { ok: false, tool: "device_action", outcome: "denied", reason: "policy" };
      }
      // Sent exactly once. No ack callback, no retry: an ack `reason` is the hardware's truth
      // and the Phase 1.2 tracker records it (Req 9.6, safety.md §5).
      const result = deps.sendCommand({
        device_id: deviceId,
        action: req.action,
        data: req.data,
      });
      if (!result.ok) {
        return { ok: false, tool: "device_action", outcome: "error", reason: null };
      }
      // The text names the action only. No `cmd_id`, no ack reason, nothing a child would hear
      // as a machine detail.
      return { ok: true, tool: "device_action", text: `asked Xelulu to ${req.action}` };
    },
  };
}
