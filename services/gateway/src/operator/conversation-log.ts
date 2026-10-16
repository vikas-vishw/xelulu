// The retained Conversation_Turn_Views (Phase 3 Req 18.2, D1): the backlog one newly opened
// Operator_Stream replays as `turn` events, and the body of `GET /v1/conversation`.
//
// Pure: no clock, no I/O, no log. It holds the latest view per turn, because a turn's view is
// rebuilt on every phase change and only the newest one is worth showing. The cap matches the
// Admin_Console's own, so the backlog can never exceed what the console keeps.
//
// The views are built in src/brain/state/conversation-view.ts, which is the single place the
// Transcripts_Argument is honoured (D2). This module stores whatever it is handed and reads
// nothing out of it but `turn_id`, so no second text check can drift from the first.
import type { ConversationTurnView } from "@xelulu/shared";

export const CONVERSATION_VIEW_CAP = 50;

export interface ConversationLog {
  /** Replaces the view of the same `turn_id`, else appends; past the cap the oldest goes. */
  record(view: ConversationTurnView): void;
  /** The retained views, oldest first, as a copy. */
  views(): readonly ConversationTurnView[];
}

export function createConversationLog(): ConversationLog {
  const held: ConversationTurnView[] = [];

  return {
    record(view) {
      const index = held.findIndex((v) => v.turn_id === view.turn_id);
      if (index === -1) held.push(view);
      else held[index] = view;
      while (held.length > CONVERSATION_VIEW_CAP) held.shift();
    },

    views: () => [...held],
  };
}
