// Command handler (Req 17.1, 17.2, 17.8–17.10, 18.4, 18.5, G27, G29, G30).
//
// 1. `parseCmdMessage` runs first. On failure: one `message_rejected` entry with Safe_Issues and
//    `proto_ver_mismatch` (true when an issue path is exactly ["proto_ver"]), no ack, nothing
//    applied or recorded.
// 2. A `cmd_id` in the 1,000-entry idempotency memory: the acks already sent are re-published in
//    order, nothing is applied again, and an ack still due for the first receipt (a `say` waiting
//    on its turn's reply) is sent once, when it falls due.
// 3. Otherwise the plan is fixed from the Ack_Policy in force now, the command is applied under
//    G27 (unless the plan is `reject`) and the acks are published, `done` in the same tick as
//    `accepted`. A `say` with no override while an audio turn is in progress gets `accepted`
//    now and `done` on the turn's reply `audio_end` (or `failed ""` if the turn fails).
//    `stop_audio` during a turn stops reply counting before its acks.
//
// Every ack is built with `serialiseAckMessage`, goes to `buildTopic(deviceId, "ack")` at QoS 1
// unretained, and carries `ts` at the moment it is published. Logs carry ids, actions and ack
// statuses only: no command `data` value (`manifest_url`, `active_child_id`, free text) is logged.
import {
  buildTopic,
  parseCmdMessage,
  serialiseAckMessage,
  toSafeIssues,
  type CmdAction,
  type CmdMessage,
} from "@xelulu/shared";

import { unixSeconds, type Clock } from "../clock.js";
import type { SimLog } from "../log/logger.js";
import { ackPlan, resolveOverride, type AckPolicy, type PlannedAck } from "./ack-policy.js";
import type { DeviceState } from "./device-state.js";

export const IDEMPOTENCY_MEMORY_LIMIT = 1_000;
export const RECEIVED_COMMANDS_VIEW_LIMIT = 50;
/** Acks go out at QoS 1 (Req 17.10). */
const ACK_QOS = 1;

/** The audio turn as the handler sees it (the turn client provides it). */
export interface TurnView {
  /** True from the turn request until its result is reported. */
  inProgress(): boolean;
  /** Reply frames arriving from now on are not counted (Req 18.5). */
  stopReply(): void;
}

export type CommandHandlerDeps = Readonly<{
  deviceId: string;
  clock: Clock;
  /** The device state the handler changes (G27). */
  state: DeviceState;
  log: SimLog;
  /** The Ack_Policy in force right now. */
  policy: () => AckPolicy;
  /**
   * Publishes at `qos`, not retained, on the current connection. Returns false, publishing
   * nothing, when there is no connection. A PUBACK failure is the link's business.
   */
  publish: (topic: string, payload: string, qos: 0 | 1) => boolean;
  turn?: TurnView | undefined;
}>;

export type ReceivedCommand = Readonly<{
  cmd_id: string;
  action: CmdAction;
  acks: readonly PlannedAck[];
}>;

export interface CommandHandler {
  /** One payload from the `cmd` topic, as text. */
  handle(text: string): void;
  /** The audio turn's result: `reply_ended` once its reply `audio_end` arrived, else `failed`. */
  turnEnded(outcome: "reply_ended" | "failed"): void;
  /** The last 50 received commands with the acks sent for each, oldest first (copies). */
  receivedCommands(): readonly ReceivedCommand[];
  /** Whether `cmdId` is in the idempotency memory. */
  remembers(cmdId: string): boolean;
}

type Handled = {
  readonly cmdId: string;
  readonly action: CmdAction;
  /** Acks actually published for the first receipt, in order. */
  readonly sent: PlannedAck[];
  /** A `say` waiting on its turn's reply `audio_end`. */
  awaitingTurn: boolean;
};

const DONE: PlannedAck = Object.freeze({ status: "done", reason: "" });
const FAILED: PlannedAck = Object.freeze({ status: "failed", reason: "" });

export function createCommandHandler(deps: CommandHandlerDeps): CommandHandler {
  const ackTopic = buildTopic(deps.deviceId, "ack");
  /** Insertion order is receipt order; the oldest is evicted first. */
  const memory = new Map<string, Handled>();

  function publishAck(record: Handled, ack: PlannedAck, repeat: boolean): boolean {
    const payload = serialiseAckMessage({
      proto_ver: 2,
      ts: unixSeconds(deps.clock.now()),
      type: "ack",
      cmd_id: record.cmdId,
      status: ack.status,
      reason: ack.reason,
    });
    if (!deps.publish(ackTopic, payload, ACK_QOS)) return false;
    deps.log.add({
      kind: "message_out",
      variant: "ack",
      event_id: null,
      cmd_id: record.cmdId,
      turn_id: null,
      ack_status: ack.status,
      ack_reason: ack.reason,
      replay: repeat,
      time_uncertain: false,
    });
    return true;
  }

  /** Publishes a first-receipt ack and records it only if it really went out. */
  function sendFirst(record: Handled, ack: PlannedAck): void {
    if (publishAck(record, ack, false)) record.sent.push(ack);
  }

  function remember(record: Handled): void {
    memory.set(record.cmdId, record);
    while (memory.size > IDEMPOTENCY_MEMORY_LIMIT) {
      const oldest = memory.keys().next();
      if (oldest.done === true) break;
      memory.delete(oldest.value);
    }
  }

  function apply(msg: CmdMessage): void {
    switch (msg.action) {
      case "set_mode":
        deps.state.mode = msg.data.mode;
        break;
      case "volume":
        deps.state.volume = msg.data.level;
        break;
      case "config": {
        const d = msg.data;
        if (d.volume !== undefined) deps.state.volume = d.volume;
        if (d.active_child_id !== undefined) deps.state.active_child_id = d.active_child_id;
        if (d.quiet_hours !== undefined) deps.state.settings.quiet_hours = { ...d.quiet_hours };
        if (d.movement_on !== undefined) deps.state.settings.movement_on = d.movement_on;
        if (d.language !== undefined) deps.state.settings.language = d.language;
        break;
      }
      case "stop_audio":
        if (deps.turn?.inProgress() === true) deps.turn.stopReply();
        break;
      // `ota` fetches nothing (Req 21.5); every other action is only logged.
      default:
        break;
    }
    deps.log.add({ kind: "command_applied", cmd_id: msg.cmd_id, action: msg.action });
  }

  function logIn(action: CmdAction, cmdId: string, duplicate: boolean): void {
    deps.log.add({ kind: "message_in", variant: action, cmd_id: cmdId, turn_id: null, duplicate });
  }

  function handleNew(msg: CmdMessage): void {
    const override = resolveOverride(deps.policy(), msg.action);
    const plan = ackPlan(override);
    const record: Handled = {
      cmdId: msg.cmd_id,
      action: msg.action,
      sent: [],
      awaitingTurn: false,
    };
    remember(record);
    logIn(msg.action, msg.cmd_id, false);
    if (plan.apply) apply(msg);

    const waitForTurn =
      msg.action === "say" && override === null && deps.turn?.inProgress() === true;
    if (waitForTurn) {
      // Default plan, minus `done`, which follows the turn's reply `audio_end` (Req 18.4).
      for (const ack of plan.acks) {
        if (ack.status === "done") continue;
        sendFirst(record, ack);
      }
      record.awaitingTurn = true;
      return;
    }
    for (const ack of plan.acks) sendFirst(record, ack);
  }

  function handleRepeat(record: Handled, msg: CmdMessage): void {
    logIn(msg.action, msg.cmd_id, true);
    for (const ack of [...record.sent]) publishAck(record, ack, true);
  }

  return {
    handle(text) {
      const parsed = parseCmdMessage(text);
      if (!parsed.ok) {
        const issues = toSafeIssues(parsed.error.issues);
        const protoVerMismatch = parsed.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === "proto_ver",
        );
        deps.log.add({
          kind: "message_rejected",
          transport: "mqtt",
          proto_ver_mismatch: protoVerMismatch,
          issues,
        });
        return;
      }
      const msg = parsed.value;
      const known = memory.get(msg.cmd_id);
      if (known !== undefined) handleRepeat(known, msg);
      else handleNew(msg);
    },

    turnEnded(outcome) {
      const ack = outcome === "reply_ended" ? DONE : FAILED;
      for (const record of memory.values()) {
        if (!record.awaitingTurn) continue;
        record.awaitingTurn = false;
        sendFirst(record, ack);
      }
    },

    receivedCommands() {
      const all = [...memory.values()];
      return all
        .slice(-RECEIVED_COMMANDS_VIEW_LIMIT)
        .map((r) =>
          Object.freeze({ cmd_id: r.cmdId, action: r.action, acks: Object.freeze([...r.sent]) }),
        );
    },

    remembers: (cmdId) => memory.has(cmdId),
  };
}
