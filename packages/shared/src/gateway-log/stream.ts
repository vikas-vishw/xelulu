// Operator_Stream payload types (Phase 1.3, C2, C3, Req 2.2, 2.5; Phase 3 C4, Req 18.1, 18.3).
// Not part of the frozen Document B contract, not covered by proto_ver, and no Log_Entry type:
// the Conversation_Turn_View travels only on the operator channel, is never written to stdout and
// puts none of its text in any Log_Entry.
import type { AgeStage, SupportedLang } from "../domain/index.js";
import type {
  AllowListedTool,
  DeferralTopic,
  SafetyDecisionName,
  SafetyRule,
  ToolOutcome,
} from "./constants.js";

/** SSE event names on the Operator_Stream (Phase 1.3 C2; Phase 3 C4 adds `turn`). */
export const OPERATOR_STREAM_EVENTS = Object.freeze(["devices", "entry", "turn"] as const);
export type OperatorStreamEvent = (typeof OPERATOR_STREAM_EVENTS)[number];

export type DevicePresence = "unknown" | "online" | "offline";

/** One device in a `devices` event (C3). IDs, presence, a time, counts and telemetry only. */
export type DeviceSummary = Readonly<{
  device_id: string;
  presence: DevicePresence;
  /** ISO 8601 UTC, or null before the first Heartbeat. */
  last_heartbeat_at: string | null;
  /** From the latest accepted status; null before the first. */
  battery_pct: number | null;
  charging: boolean | null;
  events_accepted: number;
  events_duplicate: number;
}>;

/** The data of a `devices` event. */
export type OperatorStreamDevices = Readonly<{ devices: readonly DeviceSummary[] }>;

export type ConversationTurnState =
  "listening" | "thinking" | "speaking" | "done" | "interrupted" | "failed";

/** The data of a `turn` event (C4). Not a Log_Entry; never written to stdout. */
export type ConversationTurnView = Readonly<{
  turn_id: string;
  device_id: string;
  at: string;
  state: ConversationTurnState;
  lang: SupportedLang;
  age_stage: AgeStage;
  input_decision: SafetyDecisionName | null;
  input_rule: SafetyRule | null;
  input_topic: DeferralTopic | null;
  output_decision: SafetyDecisionName | null;
  output_rule: SafetyRule | null;
  tools: readonly Readonly<{ tool: AllowListedTool | null; outcome: ToolOutcome }>[];
  latency_ms: number | null;
  filler_spoken: boolean;
  frames_out: number;
  /** Code-point counts, always present. */
  transcript_len: number;
  reply_len: number;
  /** Text, only with the Transcripts_Argument in Local_Mode (Req 18.4, 18.5). */
  transcript_text: string | null;
  reply_text: string | null;
}>;
