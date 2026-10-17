// Gateway_Log entry types (Phase 1.2, Req 12.1–12.5; Phase 3 Req 17.2, 17.3). TypeScript types
// only, no Zod schema (G22). No entry type has a field for `auth`, tokens, passwords, `fw_ver`,
// Open_Vocabulary values, error `code` or `detail`, `card_id`, `active_child_id`, `manifest_url`,
// `quiet_hours`, audio bytes, transcripts, reply text, tool arguments or names (Req 12.5, G21,
// Req 17.3). The Phase 3 kinds are additive: every kind and field below them is unchanged, so an
// entry built for GATEWAY_LOG_VERSION 1 differs only in `log_ver` (Req 17.2).
import type {
  AckReason,
  ButtonAction,
  ButtonName,
  CmdAction,
  ContractIssueKind,
  EventKind,
  Mode,
  MotionKind,
  TopicSuffix,
  TouchGesture,
  TouchZone,
  WakeSource,
} from "../gateway-contract/index.js";
import type { AgeStage, ReportPeriod, SupportedLang } from "../domain/index.js";
import type {
  AbortCause,
  AckResultOutcome,
  AllowListedTool,
  AudioTurnPhase,
  BrainTurnCause,
  BrainTurnPhase,
  ContentGateAction,
  ContentGateOutcome,
  DeferralTopic,
  GATEWAY_LOG_VERSION,
  GatewayIssueKind,
  GatewayLogKind,
  GatewayState,
  GrandmaCallState,
  GrandmaEvent,
  GrandmaRefusal,
  ParentAlertKind,
  PolicyRefusal,
  PresenceCause,
  ProviderCapability,
  ProviderId,
  RoutineTrigger,
  SafetyDecisionName,
  SafetyRule,
  SafetyStage,
  StoryStepOutcome,
  TimeoutCause,
  ToolDeniedReason,
  ToolOutcome,
  TranscriptRetentionAction,
} from "./constants.js";

export type LogTransport = "mqtt" | "ws";
export type LogTopicSuffix = Exclude<TopicSuffix, "cmd">;
export type MessageVariantName =
  "hello" | "status" | EventKind | "audio_start" | "audio_end" | "ack" | CmdAction;
export type AuthOutcome = "ok" | "failed";
export type EventOrdering = "device_ts" | "approximate";

export type SafeIssueKind = ContractIssueKind | GatewayIssueKind;
export type SafeIssue = {
  readonly path: readonly (string | number)[];
  readonly kind: SafeIssueKind;
};

type LogEntryBase<K extends GatewayLogKind> = {
  readonly log_ver: typeof GATEWAY_LOG_VERSION;
  /** 1 for the first entry after process start, +1 each entry. */
  readonly seq: number;
  /** YYYY-MM-DDTHH:mm:ss.sssZ from the gateway Clock. */
  readonly at: string;
  readonly kind: K;
};

export type GatewayStateLogEntry = LogEntryBase<"gateway"> & {
  readonly state: GatewayState;
};

export type MessageInLogEntry = LogEntryBase<"message_in"> & {
  readonly transport: LogTransport;
  readonly device_id: string;
  /** null for ws. */
  readonly topic_suffix: LogTopicSuffix | null;
  readonly variant: MessageVariantName;
  readonly event_id: string | null;
  readonly cmd_id: string | null;
  readonly turn_id: string | null;
  /** status only. */
  readonly battery_pct: number | null;
  /** status only. */
  readonly charging: boolean | null;
  /** status only. */
  readonly mode: Mode | null;
};

export type MessageOutLogEntry = LogEntryBase<"message_out"> & {
  readonly transport: LogTransport;
  readonly device_id: string;
  readonly variant: CmdAction | "audio_end";
  /** null for ws. */
  readonly cmd_id: string | null;
  /** null for mqtt. */
  readonly turn_id: string | null;
};

export type MessageRejectedLogEntry = LogEntryBase<"message_rejected"> & {
  readonly transport: LogTransport;
  /** null for invalid_topic / unknown_device (G37). */
  readonly device_id: string | null;
  /** null for ws or an unparsable topic. */
  readonly topic_suffix: TopicSuffix | null;
  /** 1 to 20. */
  readonly issues: readonly SafeIssue[];
};

export type AuthLogEntry = LogEntryBase<"auth"> & {
  readonly transport: LogTransport;
  /** null when no Registered_Device matches. */
  readonly device_id: string | null;
  readonly outcome: AuthOutcome;
};

export type PresenceLogEntry = LogEntryBase<"presence"> & {
  readonly device_id: string;
  readonly state: "online" | "offline";
  readonly cause: PresenceCause;
};

/** Only Closed_Enum data keys are logged (Req 12.4). */
export type LoggedEvent =
  | {
      readonly event: "touch";
      readonly data: { readonly zone: TouchZone; readonly gesture: TouchGesture };
    }
  | { readonly event: "wake"; readonly data: { readonly source: WakeSource } }
  | { readonly event: "motion"; readonly data: { readonly event: MotionKind } }
  | {
      readonly event: "button";
      readonly data: { readonly button: ButtonName; readonly action: ButtonAction };
    }
  | {
      readonly event: "cry" | "nfc" | "interrupt" | "error";
      readonly data: { readonly [k: string]: never };
    };

type EventLogFields = {
  readonly device_id: string;
  readonly event_id: string;
  /** false when the event leaves it out. */
  readonly time_uncertain: boolean;
  readonly back_dated: boolean;
  readonly ordering: EventOrdering;
  /** The event's ts, unix seconds, unchanged. */
  readonly device_ts: number;
  /** Same form as `at`. */
  readonly received_at: string;
} & LoggedEvent;

export type EventAcceptedLogEntry = LogEntryBase<"event_accepted"> & EventLogFields;
export type EventDuplicateLogEntry = LogEntryBase<"event_duplicate"> &
  EventLogFields & {
    readonly back_dated: false;
  };

export type AckResultLogEntry = LogEntryBase<"ack_result"> & {
  readonly device_id: string;
  readonly cmd_id: string;
  /** null for unmatched. */
  readonly action: CmdAction | null;
  readonly outcome: AckResultOutcome;
  /** null for timed_out. */
  readonly reason: "" | AckReason | null;
  /** Set only when outcome is timed_out. */
  readonly timeout_cause: TimeoutCause | null;
};

export type AudioTurnLogEntry = LogEntryBase<"audio_turn"> & {
  readonly device_id: string;
  /** null before a valid audio_start. */
  readonly turn_id: string | null;
  readonly phase: AudioTurnPhase;
  readonly frames_in: number;
  readonly bytes_in: number;
  readonly frames_out: number;
  /** aborted: an Abort_Cause; interrupted: null or an InterruptCause. */
  readonly cause: AbortCause | null;
  /** Only for cause invalid_message, else []. */
  readonly issues: readonly SafeIssue[];
};

// ---------------------------------------------------------------------------------------------
// Phase 3 (C3, C4): six additive kinds. Closed-enum values, identifiers, booleans, counts and
// times only. None of them has a field for a transcript, a reply text, a tool argument,
// `active_child_id`, a child name, audio bytes, an `auth` value or a token (Req 17.3). `age_stage`
// is one of four buckets and names nobody; `lang` is one of the two Supported_Langs.

export type BrainTurnLogEntry = LogEntryBase<"brain_turn"> & {
  readonly device_id: string;
  readonly turn_id: string | null;
  readonly phase: BrainTurnPhase;
  readonly lang: SupportedLang;
  readonly age_stage: AgeStage;
  /** Milliseconds since the device's audio_end; null before it. */
  readonly since_audio_end_ms: number | null;
  readonly frames_out: number;
  readonly cause: BrainTurnCause | null;
};

export type SafetyDecisionLogEntry = LogEntryBase<"safety_decision"> & {
  readonly device_id: string;
  readonly turn_id: string | null;
  readonly stage: SafetyStage;
  readonly decision: SafetyDecisionName;
  readonly rule: SafetyRule;
  readonly topic: DeferralTopic | null;
};

export type ToolCallLogEntry = LogEntryBase<"tool_call"> & {
  readonly device_id: string;
  readonly turn_id: string;
  /** null when the requested name was not allow-listed: the name itself is never logged. */
  readonly tool: AllowListedTool | null;
  readonly outcome: ToolOutcome;
  readonly denied_reason: ToolDeniedReason | null;
};

export type ProviderCheckLogEntry = LogEntryBase<"provider_check"> & {
  readonly capability: ProviderCapability;
  readonly provider: ProviderId;
  readonly retains: boolean;
  readonly trains: boolean;
  readonly outcome: "accepted" | "refused";
};

export type ParentAlertLogEntry = LogEntryBase<"parent_alert"> & {
  readonly device_id: string;
  readonly turn_id: string | null;
  readonly alert_id: string;
  readonly alert: ParentAlertKind;
  /** cry only: the event's own values (safety.md §1). */
  readonly confidence: number | null;
  readonly duration_s: number | null;
  /** deferred_question only. */
  readonly topic: DeferralTopic | null;
};

export type TranscriptRetentionLogEntry = LogEntryBase<"transcript_retention"> & {
  readonly action: TranscriptRetentionAction;
  readonly turns_removed: number;
  readonly turns_held: number;
};

// ---------------------------------------------------------------------------------------------
// Phase 4 (C22): five additive kinds. No entry has a field for a title, a step text, a choice
// prompt, a child answer, a Media_Handle, `active_child_id` or a name (Req 15.3). `age_stage`
// appears as before: four buckets, naming nobody.

export type RoutineFiredLogEntry = LogEntryBase<"routine_fired"> & {
  readonly device_id: string;
  readonly trigger: RoutineTrigger;
  /** The routine, asset or nap id; null for a battery trigger. */
  readonly ref_id: string | null;
  /** 20 or 10 for a battery trigger; null otherwise. */
  readonly threshold: number | null;
  readonly battery_pct: number | null;
  readonly actions: number;
  readonly sent: number;
  readonly refused: number;
  readonly refusal: PolicyRefusal | null;
};

export type ContentGateLogEntry = LogEntryBase<"content_gate"> & {
  readonly content_id: string;
  readonly action: ContentGateAction;
  readonly outcome: ContentGateOutcome;
  /** The refusing rule, stage and language; all null on a pass. Never the text. */
  readonly rule: SafetyRule | null;
  readonly age_stage: AgeStage | null;
  readonly lang: SupportedLang | null;
};

export type GrandmaEventLogEntry = LogEntryBase<"grandma_event"> & {
  readonly device_id: string | null;
  readonly asset_id: string | null;
  readonly call_id: string | null;
  readonly event: GrandmaEvent;
  readonly outcome: "ok" | "refused";
  readonly reason: GrandmaRefusal | null;
  readonly call_state: GrandmaCallState | null;
};

export type StoryStepLogEntry = LogEntryBase<"story_step"> & {
  readonly device_id: string;
  readonly turn_id: string | null;
  readonly content_id: string;
  readonly step_id: string;
  readonly choice_id: string | null;
  readonly outcome: StoryStepOutcome;
};

export type ReportBuiltLogEntry = LogEntryBase<"report_built"> & {
  readonly device_id: string;
  readonly period: ReportPeriod;
  readonly window_days: number;
  readonly turns: number;
  readonly play_minutes: number;
  readonly routines_completed: number;
  readonly stories_heard: number;
  readonly words_learned: number;
  readonly cry_moments: number;
  readonly categories: number;
};

export type GatewayLogEntry =
  | GatewayStateLogEntry
  | MessageInLogEntry
  | MessageOutLogEntry
  | MessageRejectedLogEntry
  | AuthLogEntry
  | PresenceLogEntry
  | EventAcceptedLogEntry
  | EventDuplicateLogEntry
  | AckResultLogEntry
  | AudioTurnLogEntry
  | BrainTurnLogEntry
  | SafetyDecisionLogEntry
  | ToolCallLogEntry
  | ProviderCheckLogEntry
  | ParentAlertLogEntry
  | TranscriptRetentionLogEntry
  | RoutineFiredLogEntry
  | ContentGateLogEntry
  | GrandmaEventLogEntry
  | StoryStepLogEntry
  | ReportBuiltLogEntry;

export type GatewayLogEntryOf<K extends GatewayLogKind> = Extract<GatewayLogEntry, { kind: K }>;
