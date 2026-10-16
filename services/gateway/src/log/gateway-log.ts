// The Gateway_Log (Req 12.3, 12.6–12.8, 12.11, G23): numbered, timed entries, written to stdout as
// one JSON line each and delivered to in-process subscribers, with a 1,000-entry backlog.
import {
  GATEWAY_LOG_VERSION,
  type GatewayLogEntry,
  type GatewayLogEntryOf,
  type GatewayLogKind,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { LineSink } from "./logger.js";

/** Omit applied to each member of a union (plain Omit would keep only the common keys). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A Log_Entry of kind K without the fields the log adds (`log_ver`, `seq`, `at`). */
export type LogEntryFields<K extends GatewayLogKind = GatewayLogKind> = DistributiveOmit<
  GatewayLogEntryOf<K>,
  "log_ver" | "seq" | "at"
>;

export interface GatewayLog {
  /** Adds seq, at and log_ver, stores, writes stdout, delivers. Returns the full entry. */
  add<K extends GatewayLogKind>(
    fields: { readonly kind: K } & LogEntryFields<K>,
  ): GatewayLogEntryOf<K>;
  /** Delivers the backlog in seq order, then later entries. Returns an idempotent unsubscribe. */
  subscribe(fn: (entry: GatewayLogEntry) => void): () => void;
  /** Retained entries with seq > after (all retained when after is undefined). */
  since(after?: number): readonly GatewayLogEntry[];
}

/** The number of entries kept for new subscribers and `since` (G23). */
export const GATEWAY_LOG_BACKLOG = 1_000;

type Subscriber = { readonly fn: (entry: GatewayLogEntry) => void; active: boolean };

/** Copies plain objects and arrays and freezes every level, so no caller can change an entry. */
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((v: unknown) => frozenCopy(v))) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = frozenCopy(v);
    return Object.freeze(out) as T;
  }
  return value;
}

export function createGatewayLog(clock: Clock, sink: LineSink): GatewayLog {
  const ring: GatewayLogEntry[] = [];
  let subscribers: Subscriber[] = [];
  let seq = 0;

  function remove(sub: Subscriber): void {
    sub.active = false;
    subscribers = subscribers.filter((s) => s !== sub);
  }

  /** A subscriber that throws is removed silently: its error text could hold anything. */
  function deliver(sub: Subscriber, entry: GatewayLogEntry): void {
    if (!sub.active) return;
    try {
      sub.fn(entry);
    } catch {
      remove(sub);
    }
  }

  function addEntry(fields: LogEntryFields): GatewayLogEntry {
    seq += 1;
    const entry = frozenCopy({
      log_ver: GATEWAY_LOG_VERSION,
      seq,
      at: isoAt(clock.now()),
      ...fields,
    }) as GatewayLogEntry;
    ring.push(entry);
    if (ring.length > GATEWAY_LOG_BACKLOG) ring.shift();
    sink.writeLine(JSON.stringify(entry));
    for (const sub of [...subscribers]) deliver(sub, entry);
    return entry;
  }

  return {
    // The generic signature only narrows the return type by kind; the entry is built the same way.
    add: addEntry as GatewayLog["add"],
    subscribe(fn) {
      const sub: Subscriber = { fn, active: true };
      // add() is synchronous, so nothing can be added between this backlog and the registration.
      for (const entry of [...ring]) deliver(sub, entry);
      if (sub.active) subscribers.push(sub);
      return () => {
        if (sub.active) remove(sub);
      };
    },
    since(after) {
      return after === undefined ? [...ring] : ring.filter((e) => e.seq > after);
    },
  };
}
