// Presence state machine (Req 6.1–6.7): unknown -> online <-> offline, per device. Only Heartbeats
// (a hello that passed auth, or a status) and Silence_Window expiry change it. The silence deadline
// `presence:<device_id>` is due at lastHeartbeatAt + 45,000 ms; none exists before the first
// Heartbeat, so a device never goes from unknown to offline.
import type { PresenceLogEntry } from "@xelulu/shared";

import type { Deadlines } from "../deadlines.js";

export type PresenceState = "unknown" | "online" | "offline";
export type HeartbeatCause = Exclude<PresenceLogEntry["cause"], "silence">;

/** The presence entry to add, without the fields the log adds. */
export type PresenceChange = Omit<PresenceLogEntry, "log_ver" | "seq" | "at">;

export interface Presence {
  state(deviceId: string): PresenceState;
  lastHeartbeatAt(deviceId: string): number | null;
  /** Returns the presence entry to add, if the state changed. Re-arms the silence deadline. */
  heartbeat(deviceId: string, at: number, cause: HeartbeatCause): PresenceChange | null;
  /** Called by the deadline at lastHeartbeat + 45,000. */
  expire(deviceId: string): PresenceChange | null;
}

/** Document B: a device is offline after 45 s of silence. */
export const SILENCE_WINDOW_MS = 45_000;

export function presenceDeadlineKey(deviceId: string): string {
  return `presence:${deviceId}`;
}

type PresenceRecord = { state: PresenceState; lastHeartbeatAt: number | null };

export type PresenceDeps = Readonly<{
  deadlines: Deadlines;
  /** Receives the `offline` change when a Silence_Window expires. */
  onSilence: (change: PresenceChange) => void;
}>;

export function createPresence(deps: PresenceDeps): Presence {
  const records = new Map<string, PresenceRecord>();

  function record(deviceId: string): PresenceRecord {
    let r = records.get(deviceId);
    if (r === undefined) {
      r = { state: "unknown", lastHeartbeatAt: null };
      records.set(deviceId, r);
    }
    return r;
  }

  const presence: Presence = {
    state: (deviceId) => records.get(deviceId)?.state ?? "unknown",
    lastHeartbeatAt: (deviceId) => records.get(deviceId)?.lastHeartbeatAt ?? null,
    heartbeat(deviceId, at, cause) {
      const r = record(deviceId);
      r.lastHeartbeatAt = at;
      deps.deadlines.schedule(presenceDeadlineKey(deviceId), at + SILENCE_WINDOW_MS, () => {
        const change = presence.expire(deviceId);
        if (change !== null) deps.onSilence(change);
      });
      if (r.state === "online") return null;
      r.state = "online";
      return { kind: "presence", device_id: deviceId, state: "online", cause };
    },
    expire(deviceId) {
      const r = records.get(deviceId);
      if (r === undefined || r.state !== "online") return null;
      r.state = "offline";
      return { kind: "presence", device_id: deviceId, state: "offline", cause: "silence" };
    },
  };
  return presence;
}
