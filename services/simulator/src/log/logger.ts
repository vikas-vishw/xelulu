// The only module in the simulator that writes to stdout (Req 21.3, 21.7): one JSON line per
// Simulator log entry. Every field is always present (null when empty). Values follow G21:
// identifiers, Closed_Enum values, booleans and counts only. No entry has a field for `auth`,
// tokens, `fw_ver`, `card_id`, error `code` or `detail`, `active_child_id`, `manifest_url`,
// `quiet_hours`, event `data`, frame bytes or any value from an invalid input (Req 21.4).
import type {
  AckReason,
  AckStatus,
  CmdAction,
  MessageVariantName,
  SafeIssue,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";

export interface LineSink {
  writeLine(json: string): void;
}

export const stdoutSink: LineSink = {
  writeLine(json) {
    process.stdout.write(json + "\n");
  },
};

/**
 * Calls `done` once every line written so far has left the process: an empty write is queued
 * behind them, and its callback runs after they are flushed. Used before a fatal exit.
 */
export function flushStdout(done: () => void): void {
  process.stdout.write("", () => done());
}

type SimLogBase<K extends string> = {
  readonly seq: number;
  readonly at: string;
  readonly kind: K;
};

export type SimulatorState =
  | "starting"
  | "broker_connected"
  | "broker_disconnected"
  | "control_listening"
  | "toggled_offline"
  | "toggled_online"
  | "stopping"
  | "crashed";

export type SimLogEntry =
  | (SimLogBase<"simulator"> & { readonly state: SimulatorState })
  | (SimLogBase<"message_out"> & {
      readonly variant: MessageVariantName;
      readonly event_id: string | null;
      readonly cmd_id: string | null;
      readonly turn_id: string | null;
      readonly ack_status: AckStatus | null;
      readonly ack_reason: "" | AckReason | null;
      readonly replay: boolean;
      readonly time_uncertain: boolean;
    })
  | (SimLogBase<"message_in"> & {
      readonly variant: CmdAction | "audio_end";
      readonly cmd_id: string | null;
      readonly turn_id: string | null;
      readonly duplicate: boolean;
    })
  | (SimLogBase<"message_rejected"> & {
      readonly transport: "mqtt" | "ws";
      readonly proto_ver_mismatch: boolean;
      readonly issues: readonly SafeIssue[];
    })
  | (SimLogBase<"command_applied"> & { readonly cmd_id: string; readonly action: CmdAction })
  | (SimLogBase<"queue_dropped"> & { readonly event_id: string })
  | (SimLogBase<"audio_turn"> & {
      readonly turn_id: string | null;
      readonly phase: "started" | "complete" | "interrupted" | "failed";
      readonly cause: string | null;
      readonly frames_out: number;
      readonly frames_in: number;
      readonly latency_ms: number | null;
    })
  | (SimLogBase<"control_rejected"> & {
      readonly code: string;
      readonly issues: readonly SafeIssue[];
    });

export type SimLogKind = SimLogEntry["kind"];
export type SimLogEntryOf<K extends SimLogKind> = Extract<SimLogEntry, { kind: K }>;
/** An entry without the fields the log adds (`seq`, `at`). */
export type SimLogFields<K extends SimLogKind = SimLogKind> =
  SimLogEntryOf<K> extends infer E
    ? E extends SimLogEntry
      ? Omit<E, "seq" | "at">
      : never
    : never;

export interface SimLog {
  /** Adds `seq` (1, 2, 3 …) and `at`, freezes the entry and writes one JSON line. */
  add<K extends SimLogKind>(fields: { readonly kind: K } & SimLogFields<K>): SimLogEntryOf<K>;
}

/** Copies plain objects and arrays and freezes every level, so a caller cannot change an entry. */
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((v: unknown) => frozenCopy(v))) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = frozenCopy(v);
    return Object.freeze(out) as T;
  }
  return value;
}

export function createSimLog(clock: Clock, sink: LineSink): SimLog {
  let seq = 0;
  function addEntry(fields: SimLogFields): SimLogEntry {
    seq += 1;
    const entry = frozenCopy({ seq, at: isoAt(clock.now()), ...fields }) as SimLogEntry;
    sink.writeLine(JSON.stringify(entry));
    return entry;
  }
  // The generic signature only narrows the return type by kind; the entry is built the same way.
  return { add: addEntry as SimLog["add"] };
}
