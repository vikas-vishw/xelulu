// Status messages and the 15 s heartbeat (Req 15.3, 15.4, 15.6, G26). A status carries exactly
// the contract status fields, built from the device state and serialised with the shared codec.
// The schedule is anchored on the first status of a connection: status n goes out at
// t1 + 15,000 × n on the injected clock, so the interval is exactly 15,000 ms; `start` re-anchors
// it, which is how the timer restarts from each new hello.
import { serialiseStatusMessage, type StatusMessage } from "@xelulu/shared";

import { unixSeconds, type Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { DeviceState } from "./device-state.js";

export const HEARTBEAT_INTERVAL_MS = 15_000;

/** The deadline key of the next status. */
export const HEARTBEAT_DEADLINE_KEY = "heartbeat";

/** A status with exactly the contract's status fields (Req 15.3). */
export function buildStatus(state: DeviceState, ts: number): StatusMessage {
  return {
    proto_ver: 2,
    ts,
    type: "status",
    battery_pct: state.battery_pct,
    charging: state.charging,
    mode: state.mode,
    wifi_rssi: state.wifi_rssi,
    fault: [...state.fault],
    active_child_id: state.active_child_id,
    temp_c: state.temp_c,
  };
}

/** The status payload at clock time `nowMs`. Throws a ContractError if the state is invalid. */
export function serialiseStatus(state: DeviceState, nowMs: number): string {
  return serialiseStatusMessage(buildStatus(state, unixSeconds(nowMs)));
}

export type HeartbeatDeps = Readonly<{
  clock: Clock;
  deadlines: Deadlines;
  /** Publishes one status now. */
  send: () => void;
}>;

export interface Heartbeat {
  /** Sends a status now and every 15,000 ms after it, replacing any running schedule. */
  start(): void;
  stop(): void;
  running(): boolean;
}

export function createHeartbeat(deps: HeartbeatDeps): Heartbeat {
  let anchor: number | null = null;
  let n = 0;

  function arm(): void {
    if (anchor === null) return;
    const t1 = anchor;
    deps.deadlines.schedule(HEARTBEAT_DEADLINE_KEY, t1 + HEARTBEAT_INTERVAL_MS * n, () => {
      // A late timer skips the slots it missed, so statuses never bunch up.
      const behind = Math.floor((deps.clock.now() - t1) / HEARTBEAT_INTERVAL_MS);
      n = Math.max(n, behind) + 1;
      arm();
      deps.send();
    });
  }

  return {
    start() {
      anchor = deps.clock.now();
      n = 1;
      arm();
      deps.send();
    },
    stop() {
      anchor = null;
      deps.deadlines.cancel(HEARTBEAT_DEADLINE_KEY);
    },
    running: () => anchor !== null,
  };
}
