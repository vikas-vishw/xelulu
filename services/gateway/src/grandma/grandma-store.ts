// The Grandma_Store (Phase 4 Req 7, 8.1, C11, C14, C41): adult-provided recordings, held as
// metadata and nothing else.
//
// NO AUDIO BYTE EVER REACHES THIS MODULE, and none can. A recording carries a `media_handle`
// which the store SETS ITSELF from the `asset_id`, refusing any submitted one, and which nothing
// in this repo reads, writes, decodes, streams or resolves (Req 7.5, 7.10). There is no file
// path, no byte-typed value and no socket here. TTS stands in for playback this phase, so the
// handle is an opaque id waiting for Phase 5's Storage under RLS.
//
// `add` checks in exactly this order, and the order is the design's (Req 7.7, 7.7a, 7.8, 7.3):
//
//   1. the field rules          — shape, caps and closed lists, naming the path, echoing nothing
//   2. the TITLE GATE           — `checkOutput` over the playback narration built from the title,
//                                 at every title-naming Age_Stage and in BOTH languages
//   3. the capacity
//   4. live consent             — existing, same household, right purpose, not withdrawn
//
// The title gate is step 2 because a Grandma title is operator-submitted free text that goes
// straight into spoken narration, and the Content_Gate covers Content_Items only: without it,
// "Nani's doctor story" would be stored, scheduled, and then silently unplayable (C41). Six
// checks, not three, because the active child's language at playback time is not known at write
// time and may differ from the recording's own `lang`.
//
// There is no second path to the recordings map, so "a recording exists only with live consent"
// is a property of this module rather than of its callers (Property 5).
import {
  GRANDMA_ASSET_KINDS,
  SUPPORTED_LANGS,
  type AgeStage,
  type GrandmaAssetKind,
  type GrandmaEvent,
  type GrandmaRefusal,
  type SafetyRule,
  type SupportedLang,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { IdSource } from "../ids.js";
import type { GatewayLog } from "../log/gateway-log.js";
import { checkOutput } from "../brain/safety/output-guard.js";
import { TITLE_NAMING_STAGES } from "../routines/routine-behaviours.js";
import { hhmmToMinutes, withinCatchUp } from "../routines/schedule-time.js";
import type { ConsentStore } from "./consent-store.js";

/** Per household. A create past it is refused rather than evicting an existing recording. */
export const GRANDMA_MAX_RECORDINGS_PER_HOUSEHOLD = 50;
export const GRANDMA_MAX_DURATION_S = 1_800;
/**
 * A structural ceiling, NOT the usable budget. The operative bound on a title is the narrowest
 * title-naming stage's: at `little` the narration is two sentences of twenty words, of which the
 * template spends eight, so a title much longer than a dozen words is refused `length` by the
 * title gate (Req 7.7b).
 */
export const GRANDMA_MAX_TITLE_CODE_POINTS = 80;

export const ASSET_ID_PREFIX = "gma_";
/** The opaque handle's prefix. Derived from the `asset_id`; dereferenced by nothing (C11). */
export const MEDIA_HANDLE_PREFIX = "mh_";

export type GrandmaSchedule = Readonly<{ at: string; enabled: boolean }>;

export type GrandmaRecording = Readonly<{
  asset_id: string;
  household_id: string;
  recorded_by_user_id: string;
  consent_record_id: string;
  kind: GrandmaAssetKind;
  title: string;
  lang: SupportedLang;
  duration_s: number;
  /** Opaque. Nothing in this repo reads, resolves, decodes or streams it (C11). */
  media_handle: string;
  status: "ready" | "withdrawn";
  schedule: GrandmaSchedule | null;
  created_at: string;
}>;

/** Which guard rule refused a title, and where. Ids, enums and a stage — never the title. */
export type GrandmaGateRefusal = Readonly<{
  rule: SafetyRule;
  age_stage: AgeStage;
  lang: SupportedLang;
}>;

/**
 * Every refusal is the STORE-level enum; the route maps it onto the single wire code (Req 7.11,
 * 16.4a). `field` is a dotted path with no bracket notation, so a route's mapping is exactly
 * `field.split(".")`, and `gate` carries the title gate's rule, stage and language so the console
 * can show all three as text (Req 7.7b).
 */
export type GrandmaResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: GrandmaRefusal;
      readonly field: string | null;
      readonly gate: GrandmaGateRefusal | null;
    };

export type GrandmaRecordingInput = Readonly<{
  /** Resolved by `householdForDevice` before the call. A body naming one is refused (Req 7.9). */
  household_id: string;
  /** `DEV_USER_ID`, bound in the composition root. A body naming one is refused (Req 7.9a). */
  recorded_by_user_id: string;
  consent_record_id: string;
  kind: GrandmaAssetKind;
  title: string;
  lang: SupportedLang;
  duration_s: number;
  // NOTE: no `media_handle` and no `asset_id`. The store sets both (Req 7.10, C11).
}>;

export interface GrandmaStore {
  /** Takes its household rather than defaulting it, so no caller can list every household. */
  recordings(householdId: string): readonly GrandmaRecording[];
  get(assetId: string): GrandmaRecording | null;
  add(input: GrandmaRecordingInput): GrandmaResult<GrandmaRecording>;
  /** `at` is a local `HH:MM`; any other shape is refused `invalid_field` on `at` (Req 8.1). */
  schedule(assetId: string, at: string, enabled: boolean): GrandmaResult<GrandmaRecording>;
  /** Marks every recording citing a withdrawn consent and cancels its schedule (Req 7.4). */
  onConsentWithdrawn(consentId: string): number;
  /** Enabled, `ready`, inside the catch-up window and not yet played on `dayKey` (Req 8.7). */
  dueAt(nowMinutes: number, dayKey: string): readonly GrandmaRecording[];
  markPlayed(assetId: string, dayKey: string): void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function memberOf(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

function fieldRefusal<T>(field: string): GrandmaResult<T> {
  return { ok: false, reason: "invalid_field", field, gate: null };
}

export function createGrandmaStore(
  deps: Readonly<{
    clock: Clock;
    ids: IdSource;
    log: Pick<GatewayLog, "add">;
    consent: Pick<ConsentStore, "get" | "isLiveFor">;
    /** The per-language, per-stage playback narration, for the title gate (Req 7.7a, C41). */
    narration: (title: string, lang: SupportedLang, stage: AgeStage) => string;
  }>,
): GrandmaStore {
  const rows = new Map<string, GrandmaRecording>();
  /** `asset_id` -> the Local_Day_Key it last played on, so an occurrence fires once a day. */
  const played = new Map<string, string>();

  function logEvent(
    event: GrandmaEvent,
    over: Readonly<{
      assetId?: string | null;
      outcome: "ok" | "refused";
      reason?: GrandmaRefusal | null;
    }>,
  ): void {
    deps.log.add({
      kind: "grandma_event",
      device_id: null,
      asset_id: over.assetId ?? null,
      call_id: null,
      event,
      outcome: over.outcome,
      reason: over.reason ?? null,
      call_state: null,
    });
  }

  /** Every field rule of Req 7.7, in a fixed order, before the gate ever runs. */
  function validate(input: GrandmaRecordingInput): string | null {
    if (!isNonEmptyString(input.household_id)) return "household_id";
    if (!isNonEmptyString(input.recorded_by_user_id)) return "recorded_by_user_id";
    if (!isNonEmptyString(input.consent_record_id)) return "consent_record_id";
    if (!memberOf(GRANDMA_ASSET_KINDS, input.kind)) return "kind";
    if (!isNonEmptyString(input.title)) return "title";
    if ([...input.title].length > GRANDMA_MAX_TITLE_CODE_POINTS) return "title";
    if (!memberOf(SUPPORTED_LANGS, input.lang)) return "lang";
    if (typeof input.duration_s !== "number" || !Number.isFinite(input.duration_s)) {
      return "duration_s";
    }
    if (input.duration_s <= 0 || input.duration_s > GRANDMA_MAX_DURATION_S) return "duration_s";
    // A submitted handle or asset id is refused rather than ignored: the store owns both (Req 7.10).
    const submitted = input as Readonly<Record<string, unknown>>;
    if (submitted["media_handle"] !== undefined) return "media_handle";
    if (submitted["asset_id"] !== undefined) return "asset_id";
    return null;
  }

  /**
   * The title gate (Req 7.7a). The narration built from the submitted title, measured at every
   * Age_Stage whose template names it and in BOTH Supported_Langs: six checks, because playback
   * happens for whichever child is active, in whichever language that child is spoken to.
   */
  function gateTitle(title: string): GrandmaGateRefusal | null {
    for (const lang of SUPPORTED_LANGS) {
      for (const stage of TITLE_NAMING_STAGES) {
        const verdict = checkOutput(deps.narration(title, lang, stage), {
          ageStage: stage,
          lang,
          allowedCategories: [],
          deferTopics: [],
        });
        if (verdict.decision !== "allow") {
          return { rule: verdict.rule, age_stage: stage, lang };
        }
      }
    }
    return null;
  }

  /**
   * Which of the four consent refusals applies, or null when the consent is live. The reasons are
   * distinguished rather than collapsed, because "no such record" and "withdrawn" are different
   * things for the adult reading the console (Req 7.3). `isLiveFor` is still the final authority.
   */
  function consentRefusal(
    consentId: string,
    householdId: string,
  ): Extract<
    GrandmaRefusal,
    "no_consent" | "consent_wrong_purpose" | "other_household" | "consent_withdrawn"
  > | null {
    const record = deps.consent.get(consentId);
    if (record === null) return "no_consent";
    if (record.purpose !== "grandma_recording") return "consent_wrong_purpose";
    if (record.household_id !== householdId) return "other_household";
    if (record.withdrawn_at !== null) return "consent_withdrawn";
    return deps.consent.isLiveFor(consentId, householdId, "grandma_recording")
      ? null
      : "no_consent";
  }

  function ordered(list: readonly GrandmaRecording[]): readonly GrandmaRecording[] {
    return [...list].sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return a.asset_id < b.asset_id ? -1 : 1;
    });
  }

  return {
    recordings(householdId) {
      return ordered([...rows.values()].filter((row) => row.household_id === householdId));
    },

    get: (assetId) => rows.get(assetId) ?? null,

    add(input) {
      // (1) The field rules.
      const field = validate(input);
      if (field !== null) {
        logEvent("recording_refused", { outcome: "refused", reason: "invalid_field" });
        return fieldRefusal(field);
      }
      // (2) The title gate, before anything is stored (Req 7.7a).
      const gate = gateTitle(input.title);
      if (gate !== null) {
        logEvent("recording_refused", { outcome: "refused", reason: "gate_refused" });
        return { ok: false, reason: "gate_refused", field: "title", gate };
      }
      // (3) The capacity, per household.
      const held = [...rows.values()].filter(
        (row) => row.household_id === input.household_id,
      ).length;
      if (held >= GRANDMA_MAX_RECORDINGS_PER_HOUSEHOLD) {
        logEvent("recording_refused", { outcome: "refused", reason: "at_capacity" });
        return { ok: false, reason: "at_capacity", field: null, gate: null };
      }
      // (4) Live consent, and only then is anything held (Req 7.3, Property 5).
      const refusal = consentRefusal(input.consent_record_id, input.household_id);
      if (refusal !== null) {
        logEvent("recording_refused", { outcome: "refused", reason: refusal });
        return { ok: false, reason: refusal, field: null, gate: null };
      }

      const assetId = ASSET_ID_PREFIX + deps.ids.next("");
      const recording: GrandmaRecording = Object.freeze({
        asset_id: assetId,
        household_id: input.household_id,
        recorded_by_user_id: input.recorded_by_user_id,
        consent_record_id: input.consent_record_id,
        kind: input.kind,
        title: input.title,
        lang: input.lang,
        duration_s: input.duration_s,
        // Set here, from the asset id, and never from a caller (Req 7.10).
        media_handle: MEDIA_HANDLE_PREFIX + assetId,
        status: "ready",
        schedule: null,
        created_at: isoAt(deps.clock.now()),
      });
      rows.set(assetId, recording);
      logEvent("recording_added", { assetId, outcome: "ok" });
      return { ok: true, value: recording };
    },

    schedule(assetId, at, enabled) {
      const row = rows.get(assetId);
      if (row === undefined) {
        logEvent("scheduled", { outcome: "refused", reason: "invalid_field" });
        return fieldRefusal("asset_id");
      }
      if (row.status !== "ready") {
        logEvent("scheduled", { assetId, outcome: "refused", reason: "consent_withdrawn" });
        return { ok: false, reason: "consent_withdrawn", field: null, gate: null };
      }
      if (hhmmToMinutes(at) === null) {
        logEvent("scheduled", { assetId, outcome: "refused", reason: "invalid_field" });
        return fieldRefusal("at");
      }
      // A live consent is required to schedule as well as to create: a withdrawal between the two
      // would otherwise leave a schedule standing (Req 7.4).
      const refusal = consentRefusal(row.consent_record_id, row.household_id);
      if (refusal !== null) {
        logEvent("scheduled", { assetId, outcome: "refused", reason: refusal });
        return { ok: false, reason: refusal, field: null, gate: null };
      }
      const updated: GrandmaRecording = Object.freeze({ ...row, schedule: { at, enabled } });
      rows.set(assetId, updated);
      logEvent(enabled ? "scheduled" : "schedule_cancelled", { assetId, outcome: "ok" });
      return { ok: true, value: updated };
    },

    onConsentWithdrawn(consentId) {
      let marked = 0;
      for (const [assetId, row] of [...rows.entries()]) {
        if (row.consent_record_id !== consentId || row.status === "withdrawn") continue;
        // Marked `withdrawn` AND the schedule cancelled, so nothing can fire for it (Req 7.4).
        rows.set(assetId, Object.freeze({ ...row, status: "withdrawn", schedule: null }));
        marked += 1;
        logEvent("recording_withdrawn", { assetId, outcome: "ok" });
      }
      return marked;
    },

    dueAt(nowMinutes, dayKey) {
      return ordered(
        [...rows.values()].filter((row) => {
          if (row.status !== "ready" || row.schedule === null) return false;
          if (!row.schedule.enabled) return false;
          if (played.get(row.asset_id) === dayKey) return false;
          const atMinutes = hhmmToMinutes(row.schedule.at);
          return atMinutes !== null && withinCatchUp(atMinutes, nowMinutes);
        }),
      );
    },

    markPlayed(assetId, dayKey) {
      if (rows.has(assetId)) played.set(assetId, dayKey);
    },
  };
}
