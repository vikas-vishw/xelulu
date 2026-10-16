// Conversation page (Req 20.1, 20.4, 20.7): the heading, a short summary of what is held, and the
// turn list newest first. State arrives as props (app.tsx owns the stream hook), so each `turn`
// event simply re-renders. Read-only: no control, no request, nothing animated.
import { useId } from "react";

import type { ConversationTurnView } from "@xelulu/shared";

import { ConversationList } from "../components/conversation-list";
import { CONVERSATION_CAP } from "../stream/console-state";

export type ConversationPageProps = Readonly<{
  /** null until the first `turn` event of the current connection. */
  turns: readonly ConversationTurnView[] | null;
}>;

export function ConversationPage({ turns }: ConversationPageProps) {
  const headingId = useId();
  const held = turns ?? [];

  return (
    <section className="page conversation-page" aria-labelledby={headingId}>
      <h2 id={headingId}>Conversation</h2>
      <p className="conversation-summary">
        Showing {held.length} turns, newest first. The last {CONVERSATION_CAP} are kept.
      </p>
      {held.length === 0 ? (
        <p className="conversation-empty">No turns yet.</p>
      ) : (
        <ConversationList turns={held} labelledBy={headingId} />
      )}
    </section>
  );
}
