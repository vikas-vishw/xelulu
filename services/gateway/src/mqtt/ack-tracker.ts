// Ack tracking (Req 8.3–8.9, 8.12, 8.13, G14, G49). Per device, the 1,000 most recently published
// commands (Retained_Commands) in publish order, each `pending`, `accepted` or with its Ack_Outcome.
// Two deadlines are armed at publish: `no_ack` at +10,000 ms and `no_completion` at +60,000 ms,
// both measured from publish. The first terminal ack decides the outcome; `reason` is recorded
// exactly as received and never changes the status. Every outcome is final: this module has no
// publish path at all, so nothing is ever retried or sent as a result of an ack or a timeout.
import type {
  AckMessage,
  AckReason,
  AckResultOutcome,
  AckStatus,
  CmdAction,
  TimeoutCause,
} from "@xelulu/shared";

import type { Deadlines } from "../deadlines.js";
import type { GatewayLog } from "../log/gateway-log.js";

export const NO_ACK_TIMEOUT_MS = 10_000;
export const NO_COMPLETION_TIMEOUT_MS = 60_000;
/** Retained_Commands kept per device (Req 8.13, G44). */
export const RETAINED_COMMANDS_PER_DEVICE = 1_000;

type TerminalStatus = Exclude<AckStatus, "accepted">;

export type CommandOutcome = Readonly<{
  status: TerminalStatus | "timed_out";
  reason: "" | AckReason | null;
  timeoutCause: TimeoutCause | null;
}>;

type RetainedCommand = {
  readonly cmdId: string;
  readonly action: CmdAction;
  readonly publishedAt: number;
  state: "pending" | "accepted";
  outcome: CommandOutcome | null;
};

/** A read-only view of one Retained_Command. */
export type RetainedCommandView = Readonly<{
  cmd_id: string;
  action: CmdAction;
  published_at: number;
  state: "pending" | "accepted" | TerminalStatus | "timed_out";
  reason: "" | AckReason | null;
  timeout_cause: TimeoutCause | null;
}>;

export interface AckTracker {
  /** Records a published command and arms its two deadlines. */
  record(deviceId: string, cmdId: string, action: CmdAction, publishedAt: number): void;
  /** Classifies one valid ack from `deviceId` and adds its `ack_result` entry. */
  handleAck(deviceId: string, ack: AckMessage): void;
  /** The device's Retained_Commands, oldest first. */
  commands(deviceId: string): readonly RetainedCommandView[];
  /** Cancels every deadline this tracker armed. */
  stop(): void;
}

export type AckTrackerDeps = Readonly<{
  deadlines: Deadlines;
  log: Pick<GatewayLog, "add">;
}>;

export function ackDeadlineKey(deviceId: string, cmdId: string, seconds: 10 | 60): string {
  return `ack:${deviceId}:${cmdId}:${seconds}`;
}

function view(c: RetainedCommand): RetainedCommandView {
  return Object.freeze({
    cmd_id: c.cmdId,
    action: c.action,
    published_at: c.publishedAt,
    state: c.outcome?.status ?? c.state,
    reason: c.outcome?.reason ?? null,
    timeout_cause: c.outcome?.timeoutCause ?? null,
  });
}

export function createAckTracker(deps: AckTrackerDeps): AckTracker {
  const devices = new Map<string, Map<string, RetainedCommand>>();

  function cancelDeadlines(deviceId: string, cmdId: string): void {
    deps.deadlines.cancel(ackDeadlineKey(deviceId, cmdId, 10));
    deps.deadlines.cancel(ackDeadlineKey(deviceId, cmdId, 60));
  }

  function entry(
    deviceId: string,
    cmdId: string,
    action: CmdAction | null,
    outcome: AckResultOutcome,
    reason: "" | AckReason | null,
    timeoutCause: TimeoutCause | null,
  ): void {
    deps.log.add({
      kind: "ack_result",
      device_id: deviceId,
      cmd_id: cmdId,
      action,
      outcome,
      reason,
      timeout_cause: timeoutCause,
    });
  }

  function timeOut(deviceId: string, c: RetainedCommand, cause: TimeoutCause): void {
    if (c.outcome !== null) return;
    c.outcome = { status: "timed_out", reason: null, timeoutCause: cause };
    cancelDeadlines(deviceId, c.cmdId);
    entry(deviceId, c.cmdId, c.action, "timed_out", null, cause);
  }

  return {
    record(deviceId, cmdId, action, publishedAt) {
      let commands = devices.get(deviceId);
      if (commands === undefined) {
        commands = new Map();
        devices.set(deviceId, commands);
      }
      const c: RetainedCommand = { cmdId, action, publishedAt, state: "pending", outcome: null };
      commands.set(cmdId, c);
      // Eviction: the oldest goes, with its deadlines and no entry (Req 8.13).
      while (commands.size > RETAINED_COMMANDS_PER_DEVICE) {
        const oldest = commands.keys().next();
        if (oldest.done === true) break;
        commands.delete(oldest.value);
        cancelDeadlines(deviceId, oldest.value);
      }
      deps.deadlines.schedule(
        ackDeadlineKey(deviceId, cmdId, 10),
        publishedAt + NO_ACK_TIMEOUT_MS,
        () => {
          if (c.state === "pending") timeOut(deviceId, c, "no_ack");
        },
      );
      deps.deadlines.schedule(
        ackDeadlineKey(deviceId, cmdId, 60),
        publishedAt + NO_COMPLETION_TIMEOUT_MS,
        () => timeOut(deviceId, c, c.state === "accepted" ? "no_completion" : "no_ack"),
      );
    },

    handleAck(deviceId, ack) {
      const c = devices.get(deviceId)?.get(ack.cmd_id);
      // No Retained_Command of this device (Req 8.9): nothing changes.
      if (c === undefined) {
        entry(deviceId, ack.cmd_id, null, "unmatched", ack.reason, null);
        return;
      }
      // Outcome already set (Req 8.8): duplicate for the same status, otherwise late.
      if (c.outcome !== null) {
        const same = c.outcome.status !== "timed_out" && c.outcome.status === ack.status;
        entry(deviceId, c.cmdId, c.action, same ? "duplicate" : "late", ack.reason, null);
        return;
      }
      if (ack.status === "accepted") {
        if (c.state === "accepted") {
          // A repeat accepted leaves state and timers unchanged (Req 8.12).
          entry(deviceId, c.cmdId, c.action, "duplicate", ack.reason, null);
          return;
        }
        // First accepted (Req 8.3): no_ack stops, no_completion keeps running.
        c.state = "accepted";
        deps.deadlines.cancel(ackDeadlineKey(deviceId, c.cmdId, 10));
        entry(deviceId, c.cmdId, c.action, "accepted", ack.reason, null);
        return;
      }
      // First terminal ack (Req 8.4): its status is final, the reason is kept unchanged.
      c.outcome = { status: ack.status, reason: ack.reason, timeoutCause: null };
      cancelDeadlines(deviceId, c.cmdId);
      entry(deviceId, c.cmdId, c.action, ack.status, ack.reason, null);
    },

    commands(deviceId) {
      return [...(devices.get(deviceId)?.values() ?? [])].map(view);
    },

    stop() {
      for (const [deviceId, commands] of devices) {
        for (const cmdId of commands.keys()) cancelDeadlines(deviceId, cmdId);
      }
    },
  };
}
