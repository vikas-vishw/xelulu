// The Device_Session (Document C Part 2; Phase 6 C5, Req 2.2–2.4). One session per
// Registered_Device, projected from Document B messages the Gateway already parses: there is no
// new topic, message, field or handler, and nothing here is logged — the session is derivable
// from Log_Entries the Gateway_Log already carries, so GATEWAY_LOG_VERSION stays as it is.
//
// `nextSession` is pure and total: every state answers every input with a state. Two rules decide
// the order of the table:
//   1. A `hello` decides on its own — accepted means `connected`, a failed auth match means
//      `error` — because that is the one message that re-announces a device.
//   2. An `unpaired` session absorbs every other input. A device the Gateway has never
//      authenticated is not in `error`; it is simply not here yet.
//
// A bare Heartbeat does NOT clear `offline`. Document B requires a `hello` on connect, so a
// device that resumes after a Silence_Window announces itself again; leaving the session
// `offline` until it does makes a firmware that skips its `hello` visible instead of hidden.
import type { DeviceLastAck, DeviceSessionState } from "@xelulu/shared";

import { pairingCode } from "./pairing-code.js";

/** Each input is one already-handled Document B message, or the existing presence timer. */
export type DeviceSessionInput =
  /** A `hello` on the `status` topic, with the Registry's auth outcome. */
  | { readonly kind: "hello"; readonly accepted: boolean }
  /** An accepted `status` Heartbeat. */
  | { readonly kind: "heartbeat" }
  /** A valid `audio_start` opened the device's audio turn. */
  | { readonly kind: "turn_open" }
  /** The turn ended: the reply's `audio_end`, an abort, or a barge-in `interrupt`. */
  | { readonly kind: "turn_closed" }
  /** An accepted `error` event. */
  | { readonly kind: "device_error" }
  /** A message rejected on any of the device's topics. */
  | { readonly kind: "message_rejected" }
  /** The existing 45 s Silence_Window expired. */
  | { readonly kind: "silence" };

/** Pure and total: every (state, input) pair answers with a Device_Session_State (Property 2). */
export function nextSession(
  state: DeviceSessionState,
  input: DeviceSessionInput,
): DeviceSessionState {
  if (input.kind === "hello") return input.accepted ? "connected" : "error";
  if (state === "unpaired") return "unpaired";
  switch (input.kind) {
    case "heartbeat":
      return state === "offline" ? "offline" : "idle";
    case "turn_open":
      return state === "connected" || state === "idle" ? "in_turn" : state;
    case "turn_closed":
      return state === "in_turn" ? "idle" : state;
    case "device_error":
    case "message_rejected":
      return "error";
    case "silence":
      return "offline";
  }
}

export interface DeviceSessions {
  /** `unpaired` for a device no accepted `hello` has been seen for. */
  state(deviceId: string): DeviceSessionState;
  /** From the latest accepted `hello`; null before it. */
  fwVer(deviceId: string): string | null;
  /** Derived from `device_id` and `fw_ver`; null before the first accepted `hello`. */
  pairingCode(deviceId: string): string | null;
  /** The latest ack matched to a command of this Gateway's; null before one. */
  lastAck(deviceId: string): DeviceLastAck | null;
  apply(deviceId: string, input: DeviceSessionInput): void;
  /**
   * The `fw_ver` of an accepted `hello`, which fixes the Pairing_Code. Re-announcing the same
   * `fw_ver` leaves the code unchanged (Req 2.4); new firmware gives a new code.
   */
  recordHello(deviceId: string, fwVer: string): void;
  recordAck(deviceId: string, ack: DeviceLastAck): void;
}

type SessionRecord = {
  state: DeviceSessionState;
  fwVer: string | null;
  pairingCode: string | null;
  lastAck: DeviceLastAck | null;
};

export function createDeviceSessions(): DeviceSessions {
  const records = new Map<string, SessionRecord>();

  function record(deviceId: string): SessionRecord {
    let r = records.get(deviceId);
    if (r === undefined) {
      r = { state: "unpaired", fwVer: null, pairingCode: null, lastAck: null };
      records.set(deviceId, r);
    }
    return r;
  }

  return {
    state: (deviceId) => records.get(deviceId)?.state ?? "unpaired",
    fwVer: (deviceId) => records.get(deviceId)?.fwVer ?? null,
    pairingCode: (deviceId) => records.get(deviceId)?.pairingCode ?? null,
    lastAck: (deviceId) => records.get(deviceId)?.lastAck ?? null,
    apply(deviceId, input) {
      const r = record(deviceId);
      r.state = nextSession(r.state, input);
    },
    recordHello(deviceId, fwVer) {
      const r = record(deviceId);
      r.fwVer = fwVer;
      r.pairingCode = pairingCode(deviceId, fwVer);
    },
    recordAck(deviceId, ack) {
      record(deviceId).lastAck = Object.freeze({ ...ack });
    },
  };
}
