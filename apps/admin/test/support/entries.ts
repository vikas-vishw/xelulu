// Typed sample stream payloads for the admin console tests: Device_Summaries and Log_Entries
// with the exact shapes the Gateway writes (IDs and Closed_Enum values only).
import type {
  AckReason,
  AckResultLogEntry,
  AckResultOutcome,
  AudioTurnLogEntry,
  AudioTurnPhase,
  CmdAction,
  ConversationTurnView,
  DeviceSummary,
  EventAcceptedLogEntry,
  EventKind,
  MessageOutLogEntry,
  TouchGesture,
  TouchZone,
} from "@xelulu/shared";

export const DEVICE_ID = "xlu_000123";

export const TURN_ID = "turn_000001";

const BASE_MS = Date.parse("2026-10-20T10:00:00.000Z");

/** The Gateway clock time for a seq: one second per entry after a fixed start. */
export function atFor(seq: number): string {
  return new Date(BASE_MS + seq * 1_000).toISOString();
}

/** A six-digit, zero-padded ID suffix, so IDs stay distinct and easy to match. */
function pad(seq: number): string {
  return String(seq).padStart(6, "0");
}

export function deviceSummary(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    device_id: DEVICE_ID,
    presence: "online",
    last_heartbeat_at: atFor(0),
    battery_pct: 100,
    charging: false,
    events_accepted: 0,
    events_duplicate: 0,
    session: "idle",
    pairing_code: "B7K2QD",
    fw_ver: "0.1.0",
    last_ack: null,
    ...overrides,
  };
}

export function touchAccepted(
  seq: number,
  zone: TouchZone = "belly",
  gesture: TouchGesture = "tap",
): EventAcceptedLogEntry {
  return {
    log_ver: 3,
    seq,
    at: atFor(seq),
    kind: "event_accepted",
    device_id: DEVICE_ID,
    event_id: `ev_${pad(seq)}`,
    event: "touch",
    data: { zone, gesture },
    time_uncertain: false,
    back_dated: false,
    ordering: "device_ts",
    device_ts: Math.floor((BASE_MS + seq * 1_000) / 1_000),
    received_at: atFor(seq),
  };
}

/** A `say` command sent on MQTT; its label is `sent say cmd_<seq>`. */
export function sayOut(seq: number): MessageOutLogEntry {
  return {
    log_ver: 3,
    seq,
    at: atFor(seq),
    kind: "message_out",
    transport: "mqtt",
    device_id: DEVICE_ID,
    variant: "say",
    cmd_id: `cmd_${pad(seq)}`,
    turn_id: null,
  };
}

/** A `done` ack for a `say` command; its label is `ack done for say cmd_<seq>`. */
export function sayAckDone(seq: number): AckResultLogEntry {
  return {
    log_ver: 3,
    seq,
    at: atFor(seq),
    kind: "ack_result",
    device_id: DEVICE_ID,
    cmd_id: `cmd_${pad(seq)}`,
    action: "say",
    outcome: "done",
    reason: "",
    timeout_cause: null,
  };
}

/**
 * A finished Conversation_Turn_View with no text, as the Gateway sends it without the
 * Transcripts_Argument: IDs, Closed_Enum values, counts and times only.
 */
export function turnView(overrides: Partial<ConversationTurnView> = {}): ConversationTurnView {
  return {
    turn_id: TURN_ID,
    device_id: DEVICE_ID,
    at: atFor(1),
    state: "done",
    lang: "en-IN",
    age_stage: "little",
    input_decision: "allow",
    input_rule: "none",
    input_topic: null,
    output_decision: "allow",
    output_rule: "none",
    tools: [{ tool: "content_lookup", outcome: "ok" }],
    latency_ms: 820,
    filler_spoken: false,
    frames_out: 24,
    transcript_len: 16,
    reply_len: 31,
    transcript_text: null,
    reply_text: null,
    ...overrides,
  };
}

/**
 * An accepted event of any kind but `touch`, with the Closed_Enum `data` its kind carries
 * (Phase 6: the Test_Matrix's observed rows). `touch` has `touchAccepted` above, because its
 * `data` needs a zone.
 */
export function eventAccepted(
  seq: number,
  event: Exclude<EventKind, "touch">,
): EventAcceptedLogEntry {
  const base = {
    log_ver: 3 as const,
    seq,
    at: atFor(seq),
    kind: "event_accepted" as const,
    device_id: DEVICE_ID,
    event_id: `ev_${pad(seq)}`,
    time_uncertain: false,
    back_dated: false,
    ordering: "device_ts" as const,
    device_ts: Math.floor((BASE_MS + seq * 1_000) / 1_000),
    received_at: atFor(seq),
  };
  if (event === "wake") return { ...base, event, data: { source: "hey_lulu" } };
  if (event === "motion") return { ...base, event, data: { event: "pickup" } };
  if (event === "button") {
    return { ...base, event, data: { button: "belly_talk", action: "press" } };
  }
  return { ...base, event, data: {} };
}

/** One phase of one audio turn (Phase 6: the `audio_turn` fixed row). Counts and enums only. */
export function audioTurn(
  seq: number,
  phase: AudioTurnPhase,
  turnId: string = TURN_ID,
): AudioTurnLogEntry {
  return {
    log_ver: 3,
    seq,
    at: atFor(seq),
    kind: "audio_turn",
    device_id: DEVICE_ID,
    turn_id: turnId,
    phase,
    frames_in: 0,
    bytes_in: 0,
    frames_out: 0,
    cause: null,
    issues: [],
  };
}

/** An ack the Gateway matched to one of its commands (Phase 6: every driven row's verdict). */
export function ackResult(
  seq: number,
  fields: Readonly<{
    cmd_id: string;
    action: CmdAction | null;
    outcome: AckResultOutcome;
    reason?: "" | AckReason | null;
  }>,
): AckResultLogEntry {
  return {
    log_ver: 3,
    seq,
    at: atFor(seq),
    kind: "ack_result",
    device_id: DEVICE_ID,
    cmd_id: fields.cmd_id,
    action: fields.action,
    outcome: fields.outcome,
    reason: fields.reason ?? "",
    timeout_cause: null,
  };
}

/** A `move` refused by the device; its label is `ack rejected for move cmd_<seq> (picked_up)`. */
export function moveAckRejected(seq: number): AckResultLogEntry {
  return {
    log_ver: 3,
    seq,
    at: atFor(seq),
    kind: "ack_result",
    device_id: DEVICE_ID,
    cmd_id: `cmd_${pad(seq)}`,
    action: "move",
    outcome: "rejected",
    reason: "picked_up",
    timeout_cause: null,
  };
}
