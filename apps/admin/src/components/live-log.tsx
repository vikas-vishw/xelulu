// The Live_Log (Req 6.2, 6.4, 6.5, 8.4): a labelled type filter over "All" plus every kind in
// GATEWAY_LOG_KINDS, and an ordered list of entries, newest first, keyed by seq. Each row shows
// the entry's time, kind, device (when it has one) and a label built by entryLabel from Closed_Enum
// and ID fields only; no raw value is ever rendered. Nothing here animates.
import { useId, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { GATEWAY_LOG_KINDS } from "@xelulu/shared";
import type { GatewayLogEntry, GatewayLogKind } from "@xelulu/shared";

import { entryLabel } from "../log/entry-label";
import { LIVE_LOG_CAP, filterByKind, newestFirst } from "../stream/console-state";

/** The filter's value: one kind, or every kind. */
export type LiveLogFilter = GatewayLogKind | "all";

export type LiveLogProps = Readonly<{
  /** Held entries, ascending seq, at most LIVE_LOG_CAP (from ConsoleState). */
  entries: readonly GatewayLogEntry[];
}>;

const KIND_VALUES: readonly string[] = GATEWAY_LOG_KINDS;

function toFilter(value: string): LiveLogFilter {
  return KIND_VALUES.includes(value) ? (value as GatewayLogKind) : "all";
}

/** The device an entry names, or null (gateway entries and unmatched devices name none). */
function entryDevice(entry: GatewayLogEntry): string | null {
  return "device_id" in entry ? entry.device_id : null;
}

/** HH:MM:SS.mmm from an ISO 8601 UTC time; the text as given when it is not one. */
function timeText(at: string): string {
  const match = /T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/.exec(at);
  return match?.[1] ?? at;
}

export function LiveLog({ entries }: LiveLogProps) {
  const [filter, setFilter] = useState<LiveLogFilter>("all");
  const filterId = useId();
  const headingId = useId();

  const shown = useMemo(() => newestFirst(filterByKind(entries, filter)), [entries, filter]);

  const onFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFilter(toFilter(event.target.value));
  };

  return (
    <section className="live-log" aria-labelledby={headingId}>
      <h2 id={headingId}>Recent logs and events</h2>
      <div className="live-log-filter">
        <label htmlFor={filterId}>Entry type</label>
        <select id={filterId} value={filter} onChange={onFilterChange}>
          <option value="all">All</option>
          {GATEWAY_LOG_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>
      <p className="live-log-summary">
        Showing {shown.length} of {entries.length} entries, newest first. The last {LIVE_LOG_CAP}{" "}
        are kept.
      </p>
      {shown.length === 0 ? (
        <p className="live-log-empty">
          {entries.length === 0 ? "No entries yet." : "No entries of this type."}
        </p>
      ) : (
        <ol className="live-log-list" aria-labelledby={headingId}>
          {shown.map((entry) => {
            const device = entryDevice(entry);
            return (
              <li key={entry.seq} className="live-log-entry">
                <time className="live-log-time" dateTime={entry.at}>
                  {timeText(entry.at)}
                </time>{" "}
                <span className="live-log-kind">{entry.kind}</span>{" "}
                {device === null ? null : (
                  <>
                    <span className="live-log-device">{device}</span>{" "}
                  </>
                )}
                <span className="live-log-label">{entryLabel(entry)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
