// The Activity_Store (Phase 4 Req 14.1, 14.2, C20): the counted things that happened, in memory
// and bounded.
//
// An Activity_Record is ids, closed enums, counts and times. There is NO text field on it at all,
// so nothing a child said, nothing a model answered and no content title can reach it — which is
// what keeps a report a count rather than a profile (safety.md §2, Req 14.3).
//
// Capacity drops the OLDEST first, so a long window may be partial. That is the conservative
// direction: a report that under-counts is a weaker claim than one that evicts recent care.
import type { ActivityRecord } from "@xelulu/shared";

import type { IdSource } from "../ids.js";

/** The bound on held records. A full store drops the oldest to make room. */
export const ACTIVITY_MAX_RECORDS = 5_000;

export const ACTIVITY_ID_PREFIX = "act_";

export interface ActivityStore {
  add(input: Omit<ActivityRecord, "activity_id">): ActivityRecord;
  records(deviceId?: string): readonly ActivityRecord[];
  /** Capacity drops the oldest first; a report over a long window may therefore be partial. */
  count(): number;
}

/**
 * Takes an `IdSource` rather than the Clock: every caller already stamps `at` from the one Clock
 * it is holding, so the only thing this store has to issue is the `activity_id`.
 */
export function createActivityStore(deps: Readonly<{ ids: IdSource }>): ActivityStore {
  const rows: ActivityRecord[] = [];

  return {
    add(input) {
      const record: ActivityRecord = Object.freeze({
        activity_id: ACTIVITY_ID_PREFIX + deps.ids.next(""),
        device_id: input.device_id,
        kind: input.kind,
        at: input.at,
        ref_id: input.ref_id,
        minutes: input.minutes,
        categories: Object.freeze([...input.categories]) as string[],
      });
      rows.push(record);
      if (rows.length > ACTIVITY_MAX_RECORDS) rows.shift();
      return record;
    },

    records: (deviceId) =>
      deviceId === undefined ? [...rows] : rows.filter((row) => row.device_id === deviceId),

    count: () => rows.length,
  };
}
