// Operator_Stream payload types (Phase 1.3, C2, C3, Req 2.2, 2.5; Phase 3 C4, Req 18.1, 18.3).
// Not part of the frozen Document B contract, not covered by proto_ver, and no Log_Entry type:
// the Conversation_Turn_View travels only on the operator channel, is never written to stdout and
// puts none of its text in any Log_Entry.
import type { AgeStage, SupportedLang } from "../domain/index.js";
import type { AckReason, CmdAction } from "../gateway-contract/index.js";
import type {
  AckResultOutcome,
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

/**
 * The Device_Session lifecycle of Document C Part 2 (Phase 6 C5). Gateway-owned and derived from
 * Document B messages the Gateway already parses, so it adds no wire field: `unpaired` before any
 * accepted `hello`, `connected` on one, `idle` on a Heartbeat, `in_turn` while an audio turn is
 * open, `error` on an auth failure, a rejected message or an `error` event, and `offline` on the
 * existing 45 s Silence_Window.
 */
export const DEVICE_SESSION_STATES = Object.freeze([
  "unpaired",
  "connected",
  "idle",
  "in_turn",
  "error",
  "offline",
] as const);
export type DeviceSessionState = (typeof DEVICE_SESSION_STATES)[number];

/**
 * The latest `ack` the Gateway matched to one of its commands (Phase 6 C6). Closed enums and a
 * `cmd_id` only; the ack `reason` is carried exactly as received, because it is final.
 */
export type DeviceLastAck = Readonly<{
  action: CmdAction;
  outcome: AckResultOutcome;
  reason: "" | AckReason | null;
  cmd_id: string;
}>;

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
  // ---- Phase 6 (C6), additive. Stream-only, like everything above: no proto_ver, no Log_Entry.
  session: DeviceSessionState;
  /** The derived Pairing_Code; null before the first accepted `hello` (Phase 6 C4). */
  pairing_code: string | null;
  /** Non-secret, from the latest accepted `hello`; null before it. Never put in a Log_Entry. */
  fw_ver: string | null;
  /** null before the first ack this Gateway matched to a command of its own. */
  last_ack: DeviceLastAck | null;
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
