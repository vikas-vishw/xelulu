import type { IsoDate, IsoDateTime } from "./common.js";

export type ReportPeriod = "daily" | "weekly";

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
