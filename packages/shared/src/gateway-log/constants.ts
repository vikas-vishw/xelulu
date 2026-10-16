// Gateway_Log constants (Phase 1.2, G22, G43). Not part of the frozen Document B contract and
// not covered by proto_ver. Every list is a frozen readonly tuple, like the contract's enums.
import { ACK_STATUSES } from "../gateway-contract/index.js";

/** Numbers the Gateway_Log shape (G43). Bump by 1 whenever a kind or field changes. */
export const GATEWAY_LOG_VERSION = 2 as const;

export const GATEWAY_LOG_KINDS = Object.freeze([
  // The Phase 1.2 ten, unchanged and in the same order.
  "gateway",
  "message_in",
  "message_out",
  "message_rejected",
  "auth",
  "presence",
  "event_accepted",
  "event_duplicate",
  "ack_result",
  "audio_turn",
  // Phase 3, additive (C3).
  "brain_turn",
  "safety_decision",
  "tool_call",
  "provider_check",
  "parent_alert",
  "transcript_retention",
] as const);
export type GatewayLogKind = (typeof GATEWAY_LOG_KINDS)[number];

export const GATEWAY_STATES = Object.freeze([
  "starting",
  "broker_connected",
  "broker_disconnected",
  "audio_listening",
  "stopping",
] as const);
export type GatewayState = (typeof GATEWAY_STATES)[number];

/** The five Safe_Issue kinds the gateway adds (G38). Gateway_Log values, not wire values. */
export const GATEWAY_ISSUE_KINDS = Object.freeze([
  "invalid_topic",
  "unknown_device",
  "payload_too_large",
  "device_id_mismatch",
  "auth_failed",
] as const);
export type GatewayIssueKind = (typeof GATEWAY_ISSUE_KINDS)[number];

/** The fixed Abort_Cause list (glossary; Req 9.8, 9.9, 9.11, 9.12, 10.5, 10.7). */
export const ABORT_CAUSES = Object.freeze([
  "invalid_message",
  "text_too_large",
  "frame_before_start",
  "end_before_start",
  "duplicate_start",
  "turn_id_mismatch",
  "frame_too_large",
  "too_many_frames",
  "start_timeout",
  "idle_timeout",
  "client_closed",
  "replaced",
  "device_offline",
  "broker_disconnected",
] as const);
export type AbortCause = (typeof ABORT_CAUSES)[number];

/** Causes allowed on an `interrupted` entry besides null (Req 11.6). */
export const INTERRUPT_CAUSES = Object.freeze(["device_offline", "broker_disconnected"] as const);
export type InterruptCause = (typeof INTERRUPT_CAUSES)[number];

export const AUDIO_TURN_PHASES = Object.freeze([
  "started",
  "ended",
  "reply_started",
  "reply_ended",
  "interrupted",
  "aborted",
] as const);
export type AudioTurnPhase = (typeof AUDIO_TURN_PHASES)[number];

export const ACK_RESULT_OUTCOMES = Object.freeze([
  ...ACK_STATUSES,
  "timed_out",
  "duplicate",
  "late",
  "unmatched",
] as const);
export type AckResultOutcome = (typeof ACK_RESULT_OUTCOMES)[number];

export const TIMEOUT_CAUSES = Object.freeze(["no_ack", "no_completion"] as const);
export type TimeoutCause = (typeof TIMEOUT_CAUSES)[number];

export const PRESENCE_CAUSES = Object.freeze(["hello", "status", "silence"] as const);
export type PresenceCause = (typeof PRESENCE_CAUSES)[number];

/** R2 limits (G21, Req 4.5). */
export const SAFE_ISSUE_LIMITS = Object.freeze({
  max_issues: 20,
  max_unknown_key_code_points: 32,
} as const);

// ---------------------------------------------------------------------------------------------
// Phase 3 (C3): the closed lists of the six additive kinds. Log values, not wire values, so none
// of them touches Document B or proto_ver.

export const BRAIN_TURN_PHASES = Object.freeze([
  "started",
  "transcribed",
  "replied",
  "speaking",
  "filler",
  "done",
  "failed",
  "aborted",
] as const);
export type BrainTurnPhase = (typeof BRAIN_TURN_PHASES)[number];

/** Why a pipeline failed or stopped. Log values, not wire values. */
export const BRAIN_TURN_CAUSES = Object.freeze([
  "stt_failed",
  "llm_failed",
  "tts_failed",
  "provider_refused",
  "tool_failed",
  "interrupted",
  "client_closed",
  "replaced",
  "device_offline",
  "broker_disconnected",
  "gateway_stopping",
] as const);
export type BrainTurnCause = (typeof BRAIN_TURN_CAUSES)[number];

export const SAFETY_STAGES = Object.freeze(["input", "output"] as const);
export type SafetyStage = (typeof SAFETY_STAGES)[number];

export const SAFETY_DECISIONS = Object.freeze(["allow", "defer", "comfort", "refuse"] as const);
export type SafetyDecisionName = (typeof SAFETY_DECISIONS)[number];

export const SAFETY_RULES = Object.freeze([
  // input
  "blocked_category",
  "defer_topic",
  "distress",
  "harm_disclosure",
  "unsupported_language",
  "too_long",
  // output
  "url",
  "contact_detail",
  "price",
  "brand",
  "romantic",
  "frightening",
  "medical",
  "legal",
  "financial",
  "length",
  // either
  "uncertain",
  "none",
] as const);
export type SafetyRule = (typeof SAFETY_RULES)[number];

/** Parent-added topics are logged as `parent_added`, so no parent text is logged (Req 7.5). */
export const DEFERRAL_TOPICS = Object.freeze([
  "death",
  "body",
  "violence",
  "religion",
  "family_conflict",
  "parent_added",
] as const);
export type DeferralTopic = (typeof DEFERRAL_TOPICS)[number];

export const ALLOW_LISTED_TOOLS = Object.freeze([
  "content_lookup",
  "routine_lookup",
  "memory_read",
  "memory_write",
  "device_action",
] as const);
export type AllowListedTool = (typeof ALLOW_LISTED_TOOLS)[number];

export const TOOL_OUTCOMES = Object.freeze(["ok", "denied", "error"] as const);
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

export const TOOL_DENIED_REASONS = Object.freeze([
  "not_allow_listed",
  "policy",
  "too_many",
] as const);
export type ToolDeniedReason = (typeof TOOL_DENIED_REASONS)[number];

export const PROVIDER_CAPABILITIES = Object.freeze(["stt", "llm", "tts"] as const);
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/** Every adapter id that may ever appear in a log entry. Closed list, so no vendor string leaks. */
export const PROVIDER_IDS = Object.freeze([
  "mock",
  "sarvam",
  "elevenlabs",
  "faster_whisper",
  "indic_parler",
  "indic_f5",
  "hosted_llm",
] as const);
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PARENT_ALERT_KINDS = Object.freeze([
  "cry",
  "distress",
  "harm_disclosure",
  "deferred_question",
] as const);
export type ParentAlertKind = (typeof PARENT_ALERT_KINDS)[number];

export const TRANSCRIPT_RETENTION_ACTIONS = Object.freeze(["expired", "deleted_all"] as const);
export type TranscriptRetentionAction = (typeof TRANSCRIPT_RETENTION_ACTIONS)[number];
