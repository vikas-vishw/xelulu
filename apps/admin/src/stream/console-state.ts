// Pure console state: reducer and selectors for the Operator_Stream (Req 5.1, 6.2, 6.3, 6.4,
// 6.6, 7.3). No I/O, no DOM. The reducer never mutates its input and returns new objects.
import type {
  ConversationTurnView,
  DeviceSummary,
  GatewayLogEntry,
  GatewayLogKind,
} from "@xelulu/shared";

/** Stream_Client connection state (Req 7.1). */
export type StreamState = "connecting" | "live" | "reconnecting";

/** At most this many Log_Entries are kept, the highest seq (Req 6.3). */
export const LIVE_LOG_CAP = 500;

/** At most this many Conversation_Turn_Views are kept, the most recent (Req 20.4). */
export const CONVERSATION_CAP = 50;

export type ConsoleState = Readonly<{
  connection: StreamState;
  /** null until the first devices event of the current connection. */
  devices: readonly DeviceSummary[] | null;
  /** Ascending seq, unique, at most LIVE_LOG_CAP. */
  entries: readonly GatewayLogEntry[];
  /** null until the first turn event of the current connection; at most CONVERSATION_CAP. */
  turns: readonly ConversationTurnView[] | null;
  /** True while reconnecting after data was shown (Req 7.3). */
  stale: boolean;
}>;

export type ConsoleAction =
  | { type: "state"; state: StreamState }
  | { type: "reset" }
  | { type: "devices"; devices: readonly DeviceSummary[] }
  | { type: "entry"; entry: GatewayLogEntry }
  | { type: "turn"; view: ConversationTurnView };

function isStale(
  connection: StreamState,
  devices: readonly DeviceSummary[] | null,
  entries: readonly GatewayLogEntry[],
): boolean {
  return connection === "reconnecting" && (devices !== null || entries.length > 0);
}

/** Index of the first entry whose seq is >= `seq` (entries are ascending). */
function lowerBound(entries: readonly GatewayLogEntry[], seq: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((entries[mid] as GatewayLogEntry).seq < seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insertEntry(
  entries: readonly GatewayLogEntry[],
  entry: GatewayLogEntry,
): readonly GatewayLogEntry[] {
  const at = lowerBound(entries, entry.seq);
  if (at < entries.length && (entries[at] as GatewayLogEntry).seq === entry.seq) return entries;
  const next = [...entries.slice(0, at), entry, ...entries.slice(at)];
  return next.length > LIVE_LOG_CAP ? next.slice(next.length - LIVE_LOG_CAP) : next;
}

/**
 * Arrival order, newest last (Req 20.4): a view whose `turn_id` is already held replaces it in
 * place, so a turn keeps its position as it moves from `listening` to `done`; any other view is
 * appended and the oldest is dropped past the cap. A new array every time.
 */
function recordTurn(
  turns: readonly ConversationTurnView[] | null,
  view: ConversationTurnView,
): readonly ConversationTurnView[] {
  const held = turns ?? [];
  const at = held.findIndex((turn) => turn.turn_id === view.turn_id);
  if (at >= 0) return [...held.slice(0, at), view, ...held.slice(at + 1)];
  const next = [...held, view];
  return next.length > CONVERSATION_CAP ? next.slice(next.length - CONVERSATION_CAP) : next;
}

export function consoleReducer(s: ConsoleState, a: ConsoleAction): ConsoleState {
  switch (a.type) {
    case "state":
      return { ...s, connection: a.state, stale: isStale(a.state, s.devices, s.entries) };
    case "reset":
      return { ...s, devices: null, entries: [], turns: null, stale: false };
    case "devices": {
      const devices = [...a.devices];
      return { ...s, devices, stale: isStale(s.connection, devices, s.entries) };
    }
    case "entry": {
      const entries = insertEntry(s.entries, a.entry);
      if (entries === s.entries) return s;
      return { ...s, entries, stale: isStale(s.connection, s.devices, entries) };
    }
    case "turn":
      return { ...s, turns: recordTurn(s.turns, a.view) };
  }
}

/** A descending-seq copy (Req 6.2). */
export function newestFirst(entries: readonly GatewayLogEntry[]): readonly GatewayLogEntry[] {
  return [...entries].sort((x, y) => y.seq - x.seq);
}

/** A newest-first copy of the held turns (Req 20.1). Mirrors `newestFirst`. */
export function newestTurnsFirst(
  turns: readonly ConversationTurnView[] | null,
): readonly ConversationTurnView[] {
  return turns === null ? [] : [...turns].reverse();
}

/** Entries of one kind, or all of them (Req 6.4). Order is preserved. */
export function filterByKind(
  entries: readonly GatewayLogEntry[],
  kind: GatewayLogKind | "all",
): readonly GatewayLogEntry[] {
  return kind === "all" ? [...entries] : entries.filter((e) => e.kind === kind);
}

/** Dashboard tiles (Req 5.1). An `unknown` device counts in the total only. */
export function tileCounts(devices: readonly DeviceSummary[]): {
  total: number;
  online: number;
  offline: number;
} {
  let online = 0;
  let offline = 0;
  for (const d of devices) {
    if (d.presence === "online") online += 1;
    else if (d.presence === "offline") offline += 1;
  }
  return { total: devices.length, online, offline };
}
