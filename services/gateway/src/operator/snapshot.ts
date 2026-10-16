// The devices snapshot (Req 13.4, G44): per Registered_Device, with no other field, its Presence,
// last Heartbeat time (ISO 8601 UTC or null), auth_failed mark, event counts and its last 100
// Retained_Commands, oldest first. No token, auth value or other env value appears in it.
//
// Also the brain snapshot (Phase 3 Req 7.4, 8.5, 15.5, 16.5, D3): the body of `GET /v1/brain`.
// Transcript COUNTS, never a transcript's text; the Parent_Alerts and Deferred_Questions as the
// brain holds them; and one row per provider capability carrying its id and the two booleans the
// Provider_Gate checked, so the surface reports exactly what the gate saw. No token, env value or
// transcript text appears in it.
import type {
  AckReason,
  CmdAction,
  ProviderCapability,
  ProviderId,
  TimeoutCause,
} from "@xelulu/shared";

import type { Alerts, DeferredQuestion, ParentAlert } from "../brain/state/alerts.js";
import type { TranscriptCounts, TranscriptStore } from "../brain/state/transcript-store.js";
import { isoAt } from "../clock.js";
import type { DedupeStore } from "../devices/dedupe-store.js";
import type { Presence, PresenceState } from "../devices/presence.js";
import type { Registry } from "../devices/registry.js";
import type { AckTracker, RetainedCommandView } from "../mqtt/ack-tracker.js";

/** Retained_Commands reported per device. */
export const SNAPSHOT_COMMANDS = 100;

export type CommandSnapshot = Readonly<{
  cmd_id: string;
  action: CmdAction;
  state: RetainedCommandView["state"];
  reason: "" | AckReason | null;
  timeout_cause: TimeoutCause | null;
}>;

export type DeviceSnapshot = Readonly<{
  device_id: string;
  presence: PresenceState;
  last_heartbeat_at: string | null;
  auth_failed: boolean;
  events_accepted: number;
  events_duplicate: number;
  commands: readonly CommandSnapshot[];
}>;

export type DevicesSnapshot = Readonly<{ devices: readonly DeviceSnapshot[] }>;

export type SnapshotSources = Readonly<{
  deviceIds: readonly string[];
  presence: Pick<Presence, "state" | "lastHeartbeatAt">;
  registry: Pick<Registry, "isAuthFailed">;
  dedupe: Pick<DedupeStore, "forDevice">;
  tracker: Pick<AckTracker, "commands">;
}>;

export function buildDevicesSnapshot(src: SnapshotSources): DevicesSnapshot {
  return {
    devices: src.deviceIds.map((deviceId): DeviceSnapshot => {
      const lastHeartbeat = src.presence.lastHeartbeatAt(deviceId);
      const dedupe = src.dedupe.forDevice(deviceId);
      return {
        device_id: deviceId,
        presence: src.presence.state(deviceId),
        last_heartbeat_at: lastHeartbeat === null ? null : isoAt(lastHeartbeat),
        auth_failed: src.registry.isAuthFailed(deviceId),
        events_accepted: dedupe.accepted,
        events_duplicate: dedupe.duplicates,
        commands: src.tracker
          .commands(deviceId)
          .slice(-SNAPSHOT_COMMANDS)
          .map((c) => ({
            cmd_id: c.cmd_id,
            action: c.action,
            state: c.state,
            reason: c.reason,
            timeout_cause: c.timeout_cause,
          })),
      };
    }),
  };
}

/** One provider capability as the Provider_Gate declared it. Never a key, a URL or an env value. */
export type ProviderSnapshot = Readonly<{
  capability: ProviderCapability;
  provider: ProviderId;
  retains: boolean;
  trains: boolean;
}>;

export type BrainSnapshot = Readonly<{
  transcripts: TranscriptCounts;
  alerts: readonly ParentAlert[];
  deferred: readonly DeferredQuestion[];
  providers: readonly ProviderSnapshot[];
}>;

export type BrainSnapshotSources = Readonly<{
  transcripts: Pick<TranscriptStore, "counts">;
  alerts: Pick<Alerts, "parentAlerts" | "deferredQuestions">;
  /** Built in the composition root from the live provider instances (D3). */
  providers: readonly ProviderSnapshot[];
}>;

export function buildBrainSnapshot(src: BrainSnapshotSources): BrainSnapshot {
  return {
    // Counts only: `textFor` is never read here, so no route can answer with a turn's words
    // (Req 15.5, 18.5). Transcript text leaves only on the Conversation_Turn_View.
    transcripts: src.transcripts.counts(),
    alerts: src.alerts.parentAlerts(),
    deferred: src.alerts.deferredQuestions(),
    providers: src.providers.map((p) => ({
      capability: p.capability,
      provider: p.provider,
      retains: p.retains,
      trains: p.trains,
    })),
  };
}
