// Human label for one Live_Log entry (Req 6.5, 8.3). Built only from Closed_Enum and ID fields
// already on the entry; never a free-text value and never a Panel_Key name.
import type { AckResultLogEntry, GatewayLogEntry, LoggedEvent } from "@xelulu/shared";

function eventText(e: LoggedEvent): string {
  switch (e.event) {
    case "touch":
      return `touch ${e.data.zone} (${e.data.gesture})`;
    case "wake":
      return `wake (${e.data.source})`;
    case "motion":
      return `motion ${e.data.event}`;
    case "button":
      return `button ${e.data.button} ${e.data.action}`;
    default:
      return e.event;
  }
}

function ackText(entry: AckResultLogEntry): string {
  const action = entry.action ?? "unknown command";
  let text = `ack ${entry.outcome} for ${action} ${entry.cmd_id}`;
  if (typeof entry.reason === "string" && entry.reason !== "") text += ` (${entry.reason})`;
  if (entry.outcome === "timed_out" && entry.timeout_cause !== null) {
    text += ` (${entry.timeout_cause})`;
  }
  return text;
}

export function entryLabel(entry: GatewayLogEntry): string {
  switch (entry.kind) {
    case "event_accepted":
      return eventText(entry);
    case "event_duplicate":
      return `duplicate ${eventText(entry)}`;
    case "ack_result":
      return ackText(entry);
    case "message_out": {
      const id = entry.cmd_id ?? entry.turn_id;
      return id === null ? `sent ${entry.variant}` : `sent ${entry.variant} ${id}`;
    }
    case "message_in": {
      let text = `received ${entry.variant}`;
      if (entry.variant === "status") {
        if (entry.battery_pct !== null) text += `, battery ${entry.battery_pct}%`;
        if (entry.charging !== null) text += `, charging ${entry.charging ? "yes" : "no"}`;
      }
      return text;
    }
    case "presence":
      return `${entry.state} (${entry.cause})`;
    case "gateway":
      return `gateway ${entry.state}`;
    case "auth":
      return `auth ${entry.outcome}`;
    case "message_rejected": {
      const kinds = [...new Set(entry.issues.map((issue) => issue.kind))];
      return `rejected: ${kinds.join(", ")}`;
    }
    case "audio_turn":
      return entry.cause === null
        ? `audio turn ${entry.phase}`
        : `audio turn ${entry.phase} (${entry.cause})`;
    case "brain_turn":
      return entry.cause === null ? `turn ${entry.phase}` : `turn ${entry.phase} (${entry.cause})`;
    case "safety_decision": {
      const where = `safety ${entry.stage} ${entry.decision} (${entry.rule})`;
      return entry.topic === null ? where : `${where} [${entry.topic}]`;
    }
    case "tool_call": {
      const tool = entry.tool ?? "unknown tool";
      const text = `tool ${tool} ${entry.outcome}`;
      return entry.denied_reason === null ? text : `${text} (${entry.denied_reason})`;
    }
    case "provider_check":
      return `provider ${entry.capability} ${entry.provider} ${entry.outcome}`;
    case "parent_alert":
      return entry.topic === null
        ? `parent alert ${entry.alert} ${entry.alert_id}`
        : `parent alert ${entry.alert} ${entry.alert_id} (${entry.topic})`;
    case "transcript_retention":
      return `transcripts ${entry.action}: ${entry.turns_removed} removed, ${entry.turns_held} held`;
    case "routine_fired": {
      // A battery trigger carries a threshold instead of a ref; everything here is a count,
      // a closed enum or an id.
      const what =
        entry.threshold === null
          ? `routine ${entry.trigger}${entry.ref_id === null ? "" : ` ${entry.ref_id}`}`
          : `routine ${entry.trigger} ${entry.threshold}%`;
      let text = `${what}: ${entry.sent} of ${entry.actions} sent`;
      if (entry.refused > 0) text += `, ${entry.refused} refused`;
      return entry.refusal === null ? text : `${text} (${entry.refusal})`;
    }
    case "content_gate": {
      const text = `content ${entry.action} ${entry.outcome} ${entry.content_id}`;
      if (entry.rule === null) return text;
      // The refusing rule, stage and language, never the text that failed.
      const where = [entry.age_stage, entry.lang].filter((v) => v !== null).join(" ");
      return where === "" ? `${text} (${entry.rule})` : `${text} (${entry.rule}) [${where}]`;
    }
    case "grandma_event": {
      const id = entry.asset_id ?? entry.call_id;
      let text = `grandma ${entry.event} ${entry.outcome}`;
      if (id !== null) text += ` ${id}`;
      if (entry.call_state !== null) text += ` [${entry.call_state}]`;
      return entry.reason === null ? text : `${text} (${entry.reason})`;
    }
    case "story_step": {
      const text = `story ${entry.outcome} ${entry.content_id} ${entry.step_id}`;
      return entry.choice_id === null ? text : `${text} (${entry.choice_id})`;
    }
    case "report_built":
      // Counts only: a report label names no child and infers nothing (DPDP s.9).
      return (
        `report ${entry.period} over ${entry.window_days}d: ${entry.turns} turns, ` +
        `${entry.play_minutes} play min, ${entry.routines_completed} routines, ` +
        `${entry.stories_heard} stories`
      );
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}
