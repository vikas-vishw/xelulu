import type { IsoDate, IsoDateTime } from "./common.js";
import { REPORT_PERIODS } from "./report-summary.js";

/** Derived from the one value list in `report-summary.ts`, so there is no second declaration. */
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** A parent-requested summary for care and learning (safety.md §2). */
export interface Report {
  report_id: string;
  household_id: string;
  child_id: string;
  period: ReportPeriod;
  period_start: IsoDate;
  generated_at: IsoDateTime;
  requested_by_user_id: string;
  summary: string;
}
