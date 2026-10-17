// Example tests for the Live_Log entry label (Req 6.5, 8.3). Node environment, no DOM.
import { describe, expect, it } from "vitest";

import type {
  AckResultLogEntry,
  EventAcceptedLogEntry,
  EventDuplicateLogEntry,
  GatewayLogEntry,
  MessageInLogEntry,
} from "@xelulu/shared";

import { entryLabel } from "../src/log/entry-label";

const base = { log_ver: 3, seq: 1, at: "2026-10-20T10:00:01.250Z" } as const;
const eventFields = {
  device_id: "xlu_000123",
  event_id: "ev_1",
  time_uncertain: false,
  back_dated: false,
  ordering: "device_ts",
  device_ts: 1792490401,
  received_at: "2026-10-20T10:00:01.250Z",
} as const;

const touch: EventAcceptedLogEntry = {
  ...base,
  ...eventFields,
  kind: "event_accepted",
  event: "touch",
  data: { zone: "belly", gesture: "tap" },
};

function ack(over: Partial<AckResultLogEntry>): AckResultLogEntry {
  return {
    ...base,
    kind: "ack_result",
    device_id: "xlu_000123",
    cmd_id: "c_1",
    action: "say",
    outcome: "done",
    reason: "",
    timeout_cause: null,
    ...over,
  };
}

function status(over: Partial<MessageInLogEntry>): MessageInLogEntry {
  return {
    ...base,
    kind: "message_in",
    transport: "mqtt",
    device_id: "xlu_000123",
    topic_suffix: "status",
    variant: "status",
    event_id: null,
    cmd_id: null,
    turn_id: null,
    battery_pct: 87,
    charging: false,
    mode: "idle",
    ...over,
  };
}

describe("entryLabel", () => {
  it("labels event_accepted by event kind and data", () => {
    expect(entryLabel(touch)).toBe("touch belly (tap)");
    expect(entryLabel({ ...touch, event: "wake", data: { source: "hey_lulu" } })).toBe(
      "wake (hey_lulu)",
    );
    expect(entryLabel({ ...touch, event: "motion", data: { event: "pickup" } })).toBe(
      "motion pickup",
    );
    expect(
      entryLabel({ ...touch, event: "button", data: { button: "belly_talk", action: "press" } }),
    ).toBe("button belly_talk press");
    expect(entryLabel({ ...touch, event: "cry", data: {} })).toBe("cry");
  });

  it("prefixes event_duplicate with duplicate", () => {
    const dup: EventDuplicateLogEntry = { ...touch, kind: "event_duplicate", back_dated: false };
    expect(entryLabel(dup)).toBe("duplicate touch belly (tap)");
  });

  it("labels ack_result with and without a reason, unmatched and timed_out", () => {
    expect(entryLabel(ack({}))).toBe("ack done for say c_1");
    expect(entryLabel(ack({ outcome: "rejected", reason: "picked_up" }))).toBe(
      "ack rejected for say c_1 (picked_up)",
    );
    expect(entryLabel(ack({ outcome: "unmatched", action: null }))).toBe(
      "ack unmatched for unknown command c_1",
    );
    expect(entryLabel(ack({ outcome: "timed_out", reason: null, timeout_cause: "no_ack" }))).toBe(
      "ack timed_out for say c_1 (no_ack)",
    );
  });

  it("labels message_in with battery and charging for status only", () => {
    expect(entryLabel(status({}))).toBe("received status, battery 87%, charging no");
    expect(entryLabel(status({ battery_pct: 20, charging: true }))).toBe(
      "received status, battery 20%, charging yes",
    );
    expect(
      entryLabel(
        status({
          topic_suffix: "status",
          variant: "hello",
          battery_pct: null,
          charging: null,
          mode: null,
        }),
      ),
    ).toBe("received hello");
  });

  it("labels the remaining kinds", () => {
    const samples: readonly [GatewayLogEntry, string][] = [
      [
        {
          ...base,
          kind: "message_out",
          transport: "mqtt",
          device_id: "xlu_000123",
          variant: "say",
          cmd_id: "c_1",
          turn_id: null,
        },
        "sent say c_1",
      ],
      [
        {
          ...base,
          kind: "message_out",
          transport: "ws",
          device_id: "xlu_000123",
          variant: "audio_end",
          cmd_id: null,
          turn_id: "t_1",
        },
        "sent audio_end t_1",
      ],
      [
        { ...base, kind: "presence", device_id: "xlu_000123", state: "offline", cause: "silence" },
        "offline (silence)",
      ],
      [{ ...base, kind: "gateway", state: "broker_connected" }, "gateway broker_connected"],
      [
        { ...base, kind: "auth", transport: "ws", device_id: null, outcome: "failed" },
        "auth failed",
      ],
      [
        {
          ...base,
          kind: "message_rejected",
          transport: "mqtt",
          device_id: "xlu_000123",
          topic_suffix: "event",
          issues: [
            { path: ["data", "zone"], kind: "invalid_type" },
            { path: ["extra"], kind: "unrecognized_keys" },
            { path: ["ts"], kind: "invalid_type" },
          ],
        },
        "rejected: invalid_type, unrecognized_keys",
      ],
      [
        {
          ...base,
          kind: "audio_turn",
          device_id: "xlu_000123",
          turn_id: "t_1",
          phase: "aborted",
          frames_in: 3,
          bytes_in: 120,
          frames_out: 0,
          cause: "idle_timeout",
          issues: [],
        },
        "audio turn aborted (idle_timeout)",
      ],
      [
        {
          ...base,
          kind: "audio_turn",
          device_id: "xlu_000123",
          turn_id: "t_1",
          phase: "started",
          frames_in: 0,
          bytes_in: 0,
          frames_out: 0,
          cause: null,
          issues: [],
        },
        "audio turn started",
      ],
    ];
    for (const [entry, label] of samples) expect(entryLabel(entry)).toBe(label);
  });

  it("labels the six Phase 3 kinds from Closed_Enum and ID fields only", () => {
    const brain = {
      ...base,
      kind: "brain_turn",
      device_id: "xlu_000123",
      turn_id: "t_1",
      phase: "replied",
      lang: "en-IN",
      age_stage: "little",
      since_audio_end_ms: 420,
      frames_out: 0,
      cause: null,
    } as const;
    const safety = {
      ...base,
      kind: "safety_decision",
      device_id: "xlu_000123",
      turn_id: "t_1",
      stage: "input",
      decision: "defer",
      rule: "defer_topic",
      topic: "death",
    } as const;
    const tool = {
      ...base,
      kind: "tool_call",
      device_id: "xlu_000123",
      turn_id: "t_1",
      tool: "content_lookup",
      outcome: "ok",
      denied_reason: null,
    } as const;
    const alert = {
      ...base,
      kind: "parent_alert",
      device_id: "xlu_000123",
      turn_id: "t_1",
      alert_id: "al_1",
      alert: "cry",
      confidence: 0.9,
      duration_s: 7,
      topic: null,
    } as const;

    const samples: readonly [GatewayLogEntry, string][] = [
      [brain, "turn replied"],
      [{ ...brain, phase: "failed", cause: "stt_failed" }, "turn failed (stt_failed)"],
      [safety, "safety input defer (defer_topic) [death]"],
      [
        { ...safety, stage: "output", decision: "allow", rule: "none", topic: null },
        "safety output allow (none)",
      ],
      [tool, "tool content_lookup ok"],
      [
        { ...tool, tool: null, outcome: "denied", denied_reason: "not_allow_listed" },
        "tool unknown tool denied (not_allow_listed)",
      ],
      [
        {
          ...base,
          kind: "provider_check",
          capability: "stt",
          provider: "mock",
          retains: false,
          trains: false,
          outcome: "accepted",
        },
        "provider stt mock accepted",
      ],
      [alert, "parent alert cry al_1"],
      [
        { ...alert, alert: "deferred_question", confidence: null, duration_s: null, topic: "body" },
        "parent alert deferred_question al_1 (body)",
      ],
      [
        {
          ...base,
          kind: "transcript_retention",
          action: "expired",
          turns_removed: 3,
          turns_held: 12,
        },
        "transcripts expired: 3 removed, 12 held",
      ],
      [
        {
          ...base,
          kind: "transcript_retention",
          action: "deleted_all",
          turns_removed: 12,
          turns_held: 0,
        },
        "transcripts deleted_all: 12 removed, 0 held",
      ],
    ];
    for (const [entry, label] of samples) expect(entryLabel(entry)).toBe(label);
  });

  it("labels the five Phase 4 kinds from Closed_Enum, ID and count fields only", () => {
    const routine = {
      ...base,
      kind: "routine_fired",
      device_id: "xlu_000123",
      trigger: "schedule",
      ref_id: "morning",
      threshold: null,
      battery_pct: null,
      actions: 4,
      sent: 4,
      refused: 0,
      refusal: null,
    } as const;
    const gate = {
      ...base,
      kind: "content_gate",
      content_id: "content_1",
      action: "activate",
      outcome: "refused",
      rule: "length",
      age_stage: "tiny",
      lang: "en-IN",
    } as const;
    const grandma = {
      ...base,
      kind: "grandma_event",
      device_id: null,
      asset_id: "gma_1",
      call_id: null,
      event: "recording_added",
      outcome: "ok",
      reason: null,
      call_state: null,
    } as const;
    const story = {
      ...base,
      kind: "story_step",
      device_id: "xlu_000123",
      turn_id: "t_1",
      content_id: "content_1",
      step_id: "s_1",
      choice_id: null,
      outcome: "spoken",
      lang: "en-IN",
    } as const;

    const samples: readonly [GatewayLogEntry, string][] = [
      [routine, "routine schedule morning: 4 of 4 sent"],
      [
        { ...routine, trigger: "battery", ref_id: null, threshold: 20, battery_pct: 19 },
        "routine battery 20%: 4 of 4 sent",
      ],
      [
        { ...routine, sent: 1, refused: 1, refusal: "quiet_hours" },
        "routine schedule morning: 1 of 4 sent, 1 refused (quiet_hours)",
      ],
      [gate, "content activate refused content_1 (length) [tiny en-IN]"],
      [
        { ...gate, action: "seed", outcome: "passed", rule: null, age_stage: null, lang: null },
        "content seed passed content_1",
      ],
      [grandma, "grandma recording_added ok gma_1"],
      [
        {
          ...grandma,
          asset_id: null,
          call_id: "call_1",
          device_id: "xlu_000123",
          event: "call_ringing",
          outcome: "refused",
          reason: "policy",
          call_state: "requested",
        },
        "grandma call_ringing refused call_1 [requested] (policy)",
      ],
      [story, "story spoken content_1 s_1"],
      [{ ...story, outcome: "ended", choice_id: "c_yes" }, "story ended content_1 s_1 (c_yes)"],
      [
        {
          ...base,
          kind: "report_built",
          device_id: "xlu_000123",
          period: "daily",
          window_days: 1,
          turns: 5,
          play_minutes: 12,
          routines_completed: 2,
          stories_heard: 1,
          words_learned: 1,
          cry_moments: 0,
          categories: 3,
        },
        "report daily over 1d: 5 turns, 12 play min, 2 routines, 1 stories",
      ],
    ];
    for (const [entry, label] of samples) expect(entryLabel(entry)).toBe(label);
  });
});
