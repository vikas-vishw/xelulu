// Command sending (Req 2.6, 3.7, 8.1, 8.2, 8.11, 13.3, G15, G39). Every check that can refuse runs
// before any side effect, in this order: registered, Presence `online`, broker connected, then the
// contract serialiser. Only after the first three pass is a `cmd_id` drawn. On success the command
// is published once, recorded in the ack tracker and logged as `message_out`. A refused command is
// never queued, so a later reconnect cannot publish it.
import {
  ContractError,
  PROTO_VER,
  serialiseCmdMessage,
  toSafeIssues,
  type CmdAction,
  type CmdMessage,
  type SafeIssue,
} from "@xelulu/shared";

import type { Clock } from "../clock.js";
import type { Presence } from "../devices/presence.js";
import type { Registry } from "../devices/registry.js";
import type { IdSource } from "../ids.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { AckTracker } from "./ack-tracker.js";

export type CommandRequest = Readonly<{ device_id: string; action: string; data: unknown }>;

export type CommandError =
  | { readonly code: "unknown_device" }
  | { readonly code: "device_offline" }
  | { readonly code: "broker_disconnected" }
  | { readonly code: "invalid_command"; readonly issues: readonly SafeIssue[] };

export type CommandResult =
  | { readonly ok: true; readonly cmd_id: string }
  | { readonly ok: false; readonly error: CommandError };

export type CommandSenderDeps = Readonly<{
  registry: Pick<Registry, "isRegistered">;
  presence: Pick<Presence, "state">;
  broker: Readonly<{
    connected(): boolean;
    publishCmd(deviceId: string, payload: string): void;
  }>;
  ids: IdSource;
  tracker: Pick<AckTracker, "record">;
  clock: Clock;
  log: Pick<GatewayLog, "add">;
}>;

export interface CommandSender {
  /** Synchronous: never waits for a PUBACK or an ack. */
  sendCommand(request: CommandRequest): CommandResult;
}

function refuse(error: CommandError): CommandResult {
  return { ok: false, error };
}

export function createCommandSender(deps: CommandSenderDeps): CommandSender {
  return {
    sendCommand(request) {
      const deviceId = request.device_id;
      if (!deps.registry.isRegistered(deviceId)) return refuse({ code: "unknown_device" });
      if (deps.presence.state(deviceId) !== "online") return refuse({ code: "device_offline" });
      if (!deps.broker.connected()) return refuse({ code: "broker_disconnected" });

      const cmdId = deps.ids.next("");
      let payload: string;
      try {
        // The serialiser validates the whole command, including `action` against CMD_ACTIONS.
        payload = serialiseCmdMessage({
          proto_ver: PROTO_VER,
          cmd_id: cmdId,
          action: request.action,
          data: request.data,
        } as CmdMessage);
      } catch (err) {
        // Only the issue paths and kinds are kept; the error text is never read.
        const issues =
          err instanceof ContractError
            ? toSafeIssues(err.issues)
            : [{ path: [], kind: "custom" as const }];
        return refuse({ code: "invalid_command", issues });
      }

      // The serialiser accepted it, so `action` is a Cmd_Action.
      const action = request.action as CmdAction;
      deps.broker.publishCmd(deviceId, payload);
      deps.tracker.record(deviceId, cmdId, action, deps.clock.now());
      deps.log.add({
        kind: "message_out",
        transport: "mqtt",
        device_id: deviceId,
        variant: action,
        cmd_id: cmdId,
        turn_id: null,
      });
      return { ok: true, cmd_id: cmdId };
    },
  };
}
