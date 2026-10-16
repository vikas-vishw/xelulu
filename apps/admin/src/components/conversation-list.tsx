// The Conversation list (Req 20.1, 20.2, 20.3, 20.7): an ordered list of Conversation_Turn_Views,
// newest first, each a labelled definition list of the turn's own fields. Every value is an ID, a
// Closed_Enum value, a count or a time, except the Transcript and reply text, which the Gateway
// sends only with the Transcripts_Argument in Local_Mode; when it does not, the lengths and a note
// that text is off are shown instead. State is always text, never colour alone, and nothing here
// animates. The console is read-only: this component holds no control and sends no request.
import { useMemo } from "react";
import type { ReactNode } from "react";

import type { ConversationTurnState, ConversationTurnView } from "@xelulu/shared";

import { newestTurnsFirst } from "../stream/console-state";

export type ConversationListProps = Readonly<{
  /** Held views in arrival order, newest last (from ConsoleState). */
  turns: readonly ConversationTurnView[];
  /** The id of the heading that names this list. */
  labelledBy: string;
}>;

const STATE_TEXT: Readonly<Record<ConversationTurnState, string>> = Object.freeze({
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  done: "Done",
  interrupted: "Interrupted",
  failed: "Failed",
});

/** Shown where a field has no value yet. */
const NO_VALUE = "—";

/** HH:MM:SS.mmm from an ISO 8601 UTC time; the text as given when it is not one. */
function timeText(at: string): string {
  const match = /T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/.exec(at);
  return match?.[1] ?? at;
}

/** `decision (rule)` with the rule code as text, plus the Defer_Topic when the view carries one. */
function decisionText(
  decision: string | null,
  rule: string | null,
  topic: string | null = null,
): string {
  if (decision === null) return NO_VALUE;
  const text = rule === null ? decision : `${decision} (${rule})`;
  return topic === null ? text : `${text} [${topic}]`;
}

/** `tool outcome` per call, in call order, or a plain "None". */
function toolsText(tools: ConversationTurnView["tools"]): string {
  if (tools.length === 0) return "None";
  return tools.map((call) => `${call.tool ?? "unknown tool"} ${call.outcome}`).join(", ");
}

function lengthText(codePoints: number): string {
  return `${codePoints} characters`;
}

function Field({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <div className="turn-field">
      <dt className="turn-term">{term}</dt>
      <dd className="turn-value">{children}</dd>
    </div>
  );
}

function TurnRow({ view }: Readonly<{ view: ConversationTurnView }>) {
  const textOff = view.transcript_text === null || view.reply_text === null;

  return (
    <li className="conversation-turn">
      <dl className="turn-fields">
        <Field term="Time">
          <time dateTime={view.at}>{timeText(view.at)}</time>
        </Field>
        <Field term="State">{STATE_TEXT[view.state]}</Field>
        <Field term="Device">{view.device_id}</Field>
        <Field term="Turn">{view.turn_id}</Field>
        <Field term="Language">{view.lang}</Field>
        <Field term="Age stage">{view.age_stage}</Field>
        <Field term="Input safety">
          {decisionText(view.input_decision, view.input_rule, view.input_topic)}
        </Field>
        <Field term="Output safety">{decisionText(view.output_decision, view.output_rule)}</Field>
        <Field term="Tools called">{toolsText(view.tools)}</Field>
        <Field term="Latency">
          {view.latency_ms === null ? NO_VALUE : `${view.latency_ms} ms`}
        </Field>
        <Field term="Filler spoken">{view.filler_spoken ? "Yes" : "No"}</Field>
        <Field term="Frames sent">{view.frames_out}</Field>
        <Field term="Child's words">
          {view.transcript_text ?? lengthText(view.transcript_len)}
        </Field>
        <Field term="Xelulu's reply">{view.reply_text ?? lengthText(view.reply_len)}</Field>
      </dl>
      {textOff ? (
        <p className="turn-text-off">Transcript text is off, so only lengths are shown.</p>
      ) : null}
    </li>
  );
}

export function ConversationList({ turns, labelledBy }: ConversationListProps) {
  const shown = useMemo(() => newestTurnsFirst(turns), [turns]);

  return (
    <ol className="conversation-list" aria-labelledby={labelledBy}>
      {shown.map((view) => (
        <TurnRow key={view.turn_id} view={view} />
      ))}
    </ol>
  );
}
