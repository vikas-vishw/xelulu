// One counted thing that happened (Phase 4 Req 14.1, C20). Ids, closed enums, counts and times
// only: no text, no score, no rank, no prediction and no trait, so an Activity_Record can never
// become a profile (safety.md §2).
import type { IsoDateTime } from "./common.js";

export const ACTIVITY_KINDS = Object.freeze([
  "turn",
  "story",
  "word",
  "routine",
  "play",
  "cry",
] as const);
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One counted thing. Ids, an enum, a time and a number: no text, ever (Req 14.3). */
export interface ActivityRecord {
  activity_id: string;
  device_id: string;
  kind: ActivityKind;
  at: IsoDateTime;
  /** The content, word, routine or asset id this record points at, or null. */
  ref_id: string | null;
  /** Minutes, for a `play` record; null otherwise. */
  minutes: number | null;
  /** The Content_Categories this record touched. Content metadata, never a child trait (C20). */
  categories: string[];
}

/**
 * The battery thresholds of XL-C05, shared so the Gateway, the console and the app cannot
 * disagree. It lives in `domain/` and NOT in `gateway-log/constants.ts`: it is a product
 * constant the reminder logic reads, not a log value, and putting it among the log kinds,
 * triggers and refusal enums would also make C22's "five additive log kinds" blast radius read
 * wider than it is.
 */
export const CHARGE_THRESHOLDS = Object.freeze([20, 10] as const);
