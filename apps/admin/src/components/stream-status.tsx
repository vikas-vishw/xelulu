// Stream state as text in a polite live region (Req 7.1, 7.3). `role="status"` is polite by
// default. State is never shown by colour alone, and nothing here animates.
import type { StreamState } from "../stream/console-state";

const STATE_TEXT: Readonly<Record<StreamState, string>> = Object.freeze({
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
});

export type StreamStatusProps = Readonly<{
  connection: StreamState;
  /** True while reconnecting after data was shown. */
  stale: boolean;
}>;

export function StreamStatus({ connection, stale }: StreamStatusProps) {
  return (
    <p role="status" className="stream-status">
      <span className="stream-status-label">Stream: </span>
      <strong className={`stream-status-state stream-status-${connection}`}>
        {STATE_TEXT[connection]}
      </strong>
      {stale ? <span className="stream-status-note"> Data may be out of date.</span> : null}
      {connection === "reconnecting" ? (
        <span className="stream-status-hint"> If this lasts, see the README.</span>
      ) : null}
    </p>
  );
}
