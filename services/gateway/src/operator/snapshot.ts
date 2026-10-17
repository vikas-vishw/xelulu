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
  Consent,
  ConsentPurpose,
  ContentItem,
  ProviderCapability,
  ProviderId,
  TimeoutCause,
  VerificationMethod,
} from "@xelulu/shared";

import type { GateVerdict } from "../content/content-gate.js";
import type { GrandmaRecording } from "../grandma/grandma-store.js";
import type { Routine, RoutineSummary } from "../routines/routine-store.js";
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

// ---------------------------------------------------------------------------------------------
// The Phase 4 content, Grandma, routine and report snapshots (Req 16.5, 16.9, 16.10).
//
// Every one of them is built with an EXPLICIT field list rather than a spread-and-delete, so a
// field added to a row model cannot leak into a response by accident. None of them carries a
// Media_Handle, a step text, a choice prompt, a title beyond the row's own, a token or an env
// value, and the Consent summary carries no `user_id` and no `household_id`: the first two are
// in-process constants the console has no business reading back, and no name or contact detail
// exists in the Consent_Store to show (Req 6.4, 16.10).

/** One Content_Item without its prose: what the Content page lists (Req 16.5). */
export type ContentSummary = Omit<ContentItem, "steps"> &
  Readonly<{ step_count: number; verdict: GateVerdict | null }>;

/**
 * One Grandma_Recording with its consent state as a BOOLEAN and no Media_Handle, so the console
 * can show whether a live Consent_Record backs a recording without seeing either (Req 7.5, 17.3).
 */
export type GrandmaSummary = Omit<GrandmaRecording, "media_handle" | "consent_record_id"> &
  Readonly<{ consent_live: boolean }>;

/** One Consent_Record: ids, closed enums and times, and nothing else (Req 16.2, 17.3). */
export type ConsentSummary = Readonly<{
  consent_id: string;
  purpose: ConsentPurpose;
  version: string;
  verification_method: VerificationMethod;
  given_at: string;
  withdrawn_at: string | null;
}>;

export type ContentSnapshotSources = Readonly<{
  items: readonly ContentItem[];
  verdict: (contentId: string) => GateVerdict | null;
}>;

export function buildContentSummaries(src: ContentSnapshotSources): readonly ContentSummary[] {
  return src.items.map((item) => ({
    content_id: item.content_id,
    household_id: item.household_id,
    kind: item.kind,
    title: item.title,
    languages: [...item.languages],
    age_stages: [...item.age_stages],
    categories: [...item.categories],
    status: item.status,
    licence_note: item.licence_note,
    source: item.source,
    created_at: item.created_at,
    updated_at: item.updated_at,
    step_count: item.steps.length,
    verdict: src.verdict(item.content_id),
  }));
}

export type GrandmaSnapshotSources = Readonly<{
  recordings: readonly GrandmaRecording[];
  /** `isLiveFor` through the Consent_Store, bound by the caller. Answers a boolean, not a row. */
  consentLive: (recording: GrandmaRecording) => boolean;
}>;

export function buildGrandmaSummaries(src: GrandmaSnapshotSources): readonly GrandmaSummary[] {
  return src.recordings.map((recording) => ({
    asset_id: recording.asset_id,
    household_id: recording.household_id,
    recorded_by_user_id: recording.recorded_by_user_id,
    kind: recording.kind,
    title: recording.title,
    lang: recording.lang,
    duration_s: recording.duration_s,
    status: recording.status,
    schedule: recording.schedule === null ? null : { ...recording.schedule },
    created_at: recording.created_at,
    consent_live: src.consentLive(recording),
  }));
}

export function buildConsentSummaries(records: readonly Consent[]): readonly ConsentSummary[] {
  return records.map((record) => ({
    consent_id: record.consent_id,
    purpose: record.purpose,
    version: record.version,
    verification_method: record.verification_method,
    given_at: record.given_at,
    withdrawn_at: record.withdrawn_at,
  }));
}

export type RoutineSnapshotSources = Readonly<{
  routines: readonly Routine[];
  /** How many actions the routine's behaviour sends, so `sent` reads against a total. */
  actions: (routine: Routine) => number;
  /** Whether it already fired on the current Local_Day_Key. Reads only; marks nothing. */
  firedToday: (routine: Routine) => boolean;
}>;

export function buildRoutineSummaries(src: RoutineSnapshotSources): readonly RoutineSummary[] {
  return src.routines.map((routine) => ({
    routine_id: routine.routine_id,
    name: routine.name,
    at: routine.at,
    enabled: routine.enabled,
    behaviour: routine.behaviour,
    actions: src.actions(routine),
    fired_today: src.firedToday(routine),
  }));
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
