// Device_Summaries for the Operator_Stream's `devices` event (Phase 1.3 C3, Req 2.2, 2.3). Per
// Registered_Device: presence, last Heartbeat time (ISO 8601 UTC or null), event counts, and the
// `battery_pct` and `charging` of its latest accepted status (null before the first). IDs, enums,
// a time, counts and telemetry only. Pure: no network import. `GET /v1/devices` stays on
// snapshot.ts unchanged (Phase 1.2 Req 13.4).
import type { DeviceSummary } from "@xelulu/shared";

import { isoAt } from "../clock.js";
import type { DedupeStore } from "../devices/dedupe-store.js";
import type { Presence } from "../devices/presence.js";

export type StatusTelemetry = Readonly<{ battery_pct: number; charging: boolean }>;

/** The latest accepted status values per device since the Gateway process started (C3). */
export interface StatusMemory {
  record(deviceId: string, batteryPct: number, charging: boolean): void;
  latest(deviceId: string): StatusTelemetry | null;
}

export function createStatusMemory(): StatusMemory {
  const latest = new Map<string, StatusTelemetry>();
  return {
    record(deviceId, batteryPct, charging) {
      latest.set(deviceId, Object.freeze({ battery_pct: batteryPct, charging }));
    },
    latest: (deviceId) => latest.get(deviceId) ?? null,
  };
}

export type SummarySources = Readonly<{
  deviceIds: readonly string[];
  presence: Pick<Presence, "state" | "lastHeartbeatAt">;
  dedupe: Pick<DedupeStore, "forDevice">;
  status: Pick<StatusMemory, "latest">;
}>;

/** One frozen Device_Summary per id, in `deviceIds` order. Reads only; changes no state. */
export function buildDeviceSummaries(src: SummarySources): readonly DeviceSummary[] {
  return Object.freeze(
    src.deviceIds.map((deviceId): DeviceSummary => {
      const lastHeartbeat = src.presence.lastHeartbeatAt(deviceId);
      const dedupe = src.dedupe.forDevice(deviceId);
      const status = src.status.latest(deviceId);
      return Object.freeze({
        device_id: deviceId,
        presence: src.presence.state(deviceId),
        last_heartbeat_at: lastHeartbeat === null ? null : isoAt(lastHeartbeat),
        battery_pct: status === null ? null : status.battery_pct,
        charging: status === null ? null : status.charging,
        events_accepted: dedupe.accepted,
        events_duplicate: dedupe.duplicates,
      });
    }),
  );
}
