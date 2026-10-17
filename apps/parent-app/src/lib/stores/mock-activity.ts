// The app's Activity_Record fixture (Phase 4 Req 19.1, 19.4). Ids, closed enums, times, minutes
// and Content_Categories only: no text, no score, no rank, no prediction and no trait, so what
// the Grow and Reports screens count can never become a profile (Req 19.8, safety.md §2).
//
// Every record is placed relative to the instant the store is built rather than at a fixed date,
// so the week's window always holds the recent ones and the month's window holds those plus the
// older ones. Given the same instant the fixture is byte-identical, which is what lets a test
// pin a count.

import type { ActivityKind, ActivityRecord } from "@xelulu/shared";

import { MOCK_IDENTITY } from "../mock-identity";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** How many of each kind the recent block holds, in `at` order from newest backwards. */
const RECENT: readonly Readonly<{
  kind: ActivityKind;
  count: number;
  minutes: number | null;
  categories: readonly string[];
}>[] = Object.freeze([
  { kind: "turn", count: 8, minutes: null, categories: Object.freeze(["stories"]) },
  { kind: "story", count: 5, minutes: null, categories: Object.freeze(["stories", "animals"]) },
  { kind: "word", count: 12, minutes: null, categories: Object.freeze(["world"]) },
  { kind: "routine", count: 9, minutes: null, categories: Object.freeze([]) },
  { kind: "play", count: 6, minutes: 7, categories: Object.freeze([]) },
]);

/** The older block, inside the month's window and outside the week's. */
const OLDER: readonly Readonly<{
  kind: ActivityKind;
  count: number;
  minutes: number | null;
  categories: readonly string[];
}>[] = Object.freeze([
  { kind: "turn", count: 6, minutes: null, categories: Object.freeze(["songs"]) },
  { kind: "story", count: 4, minutes: null, categories: Object.freeze(["songs"]) },
  { kind: "word", count: 5, minutes: null, categories: Object.freeze(["world"]) },
  { kind: "routine", count: 7, minutes: null, categories: Object.freeze(["feelings"]) },
  { kind: "play", count: 4, minutes: 6, categories: Object.freeze([]) },
  { kind: "cry", count: 1, minutes: null, categories: Object.freeze([]) },
]);

/** The recent block starts an hour back; the older block starts nine days back. */
const RECENT_FROM_MS = HOUR_MS;
const OLDER_FROM_MS = 9 * DAY_MS;

/**
 * The fixture for an instant: the recent records an hour apart going back from `nowMs`, then the
 * older ones an hour apart going back from nine days before it. A fresh array per call.
 */
export function createMockActivity(nowMs: number): ActivityRecord[] {
  const out: ActivityRecord[] = [];
  for (const [block, fromMs] of [
    [RECENT, RECENT_FROM_MS],
    [OLDER, OLDER_FROM_MS],
  ] as const) {
    for (const spec of block) {
      for (let index = 0; index < spec.count; index += 1) {
        const at = nowMs - fromMs - out.length * HOUR_MS;
        out.push({
          activity_id: `activity_mock_${out.length + 1}`,
          device_id: MOCK_IDENTITY.deviceId,
          kind: spec.kind,
          at: new Date(at).toISOString(),
          ref_id: null,
          minutes: spec.minutes,
          categories: [...spec.categories],
        });
      }
    }
  }
  return out;
}
