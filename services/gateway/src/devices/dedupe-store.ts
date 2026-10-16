// Event dedupe (Req 7.1–7.12): (device_id, event_id) pairs with their first-acceptance time,
// per-device counts and the highest accepted `ts`. `ts` never affects acceptance or order.
// Pairs expire 7 days after first acceptance; a device holds at most 10,000, oldest evicted first.
import type { EventMessage } from "@xelulu/shared";

import { isoAt } from "../clock.js";
import type { LogEntryFields } from "../log/gateway-log.js";
import { toLoggedEvent } from "./event-log-data.js";

export const DEDUPE_MAX_PAIRS = 10_000;
export const DEDUPE_EXPIRY_MS = 604_800_000;

export type DeviceDedupe = {
  /** event_id -> first-acceptance time; insertion order is time order (the Clock never goes back). */
  readonly pairs: Map<string, number>;
  /** Over all accepted events since start, unaffected by eviction. */
  highestTs: number | null;
  accepted: number;
  duplicates: number;
};

export type DedupeOutcome = { kind: "accepted"; backDated: boolean } | { kind: "duplicate" };

export function createDeviceDedupe(): DeviceDedupe {
  return { pairs: new Map(), highestTs: null, accepted: 0, duplicates: 0 };
}

/** The design's three-step algorithm for one valid event at Clock time `now`. */
export function observeEvent(
  d: DeviceDedupe,
  eventId: string,
  ts: number,
  now: number,
): DedupeOutcome {
  // 1. Expire from the head (Req 7.8).
  for (const [id, firstAt] of d.pairs) {
    if (now - firstAt < DEDUPE_EXPIRY_MS) break;
    d.pairs.delete(id);
  }
  // 2. Duplicate (Req 7.2).
  if (d.pairs.has(eventId)) {
    d.duplicates += 1;
    return { kind: "duplicate" };
  }
  // 3. Accept (Req 7.1, 7.3, 7.4, 7.7).
  const backDated = d.highestTs !== null && ts < d.highestTs;
  d.highestTs = d.highestTs === null ? ts : Math.max(d.highestTs, ts);
  if (d.pairs.size >= DEDUPE_MAX_PAIRS) {
    const head = d.pairs.keys().next();
    if (head.done !== true) d.pairs.delete(head.value);
  }
  d.pairs.set(eventId, now);
  d.accepted += 1;
  return { kind: "accepted", backDated };
}

export type EventLogFields = LogEntryFields<"event_accepted" | "event_duplicate">;

export interface DedupeStore {
  /** The device's record, created empty on first use. */
  forDevice(deviceId: string): DeviceDedupe;
  /** Observes one valid event and returns the `event_accepted` or `event_duplicate` entry. */
  process(deviceId: string, message: EventMessage, now: number): EventLogFields;
}

export function createDedupeStore(): DedupeStore {
  const devices = new Map<string, DeviceDedupe>();

  function forDevice(deviceId: string): DeviceDedupe {
    let d = devices.get(deviceId);
    if (d === undefined) {
      d = createDeviceDedupe();
      devices.set(deviceId, d);
    }
    return d;
  }

  return {
    forDevice,
    process(deviceId, message, now) {
      const outcome = observeEvent(forDevice(deviceId), message.event_id, message.ts, now);
      const timeUncertain = message.time_uncertain === true;
      const common = {
        device_id: deviceId,
        event_id: message.event_id,
        time_uncertain: timeUncertain,
        ordering: timeUncertain ? ("approximate" as const) : ("device_ts" as const),
        device_ts: message.ts,
        received_at: isoAt(now),
        ...toLoggedEvent(message),
      };
      return outcome.kind === "accepted"
        ? { kind: "event_accepted", ...common, back_dated: outcome.backDated }
        : { kind: "event_duplicate", ...common, back_dated: false };
    },
  };
}
