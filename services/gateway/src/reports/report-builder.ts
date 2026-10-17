// The Reports (Phase 4 Req 14.6, 14.7, 14.9, C20, C21): the daily and weekly care summary a
// parent asked for, and nothing else.
//
// Three rules shape this module, and each is a line of code:
//
//  - COMPUTED ON REQUEST ONLY. `build` reads the records that are held, counts them and answers.
//    Nothing runs in the background, nothing is pre-computed and NO summary is cached — a cached
//    summary per child is the shape of a profile, which safety.md §2 forbids (C20). Two requests
//    one after the other therefore do the arithmetic twice, on purpose.
//  - THE ARITHMETIC IS NOT HERE. `summariseActivity` lives in `packages/shared` and is called by
//    the Gateway, the Admin_Console and the parent app, so the three cannot drift and the DPDP
//    s.9 posture is tested in one place (C21). This module resolves the window, calls it, and
//    writes the Log_Entry.
//  - NO TEXT, NO SCORE, NO RANK, NO PREDICTION. The answer is the window plus eight counts, and
//    the `report_built` entry carries the same counts and the period (Req 14.5, 14.7).
//
// The pending DPDP s.9 legal review of parent-facing reports and cry alerts stays OPEN (F2).
// Nothing here claims it closed.
import {
  reportWindow,
  summariseActivity,
  type ReportPeriod,
  type ReportSummary,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { ActivityStore } from "./activity-store.js";

/**
 * Whole days per period, for the `report_built` entry's `window_days` (Req 14.7, 14.9). Declared
 * here because `report-summary.ts` keeps its own table private and exports the window instead;
 * one entry per Report_Period, so a new period cannot be added without being given its length.
 */
const PERIOD_DAYS: Readonly<Record<ReportPeriod, number>> = Object.freeze({ daily: 1, weekly: 7 });

export interface Reports {
  /** Computes on request only; logs one `report_built` entry (Req 14.6, 14.7). */
  build(deviceId: string, period: ReportPeriod): ReportSummary;
}

export function createReports(
  deps: Readonly<{ clock: Clock; log: Pick<GatewayLog, "add">; activity: ActivityStore }>,
): Reports {
  return {
    build(deviceId, period) {
      // The window ends at the requested instant and is half-open, so two adjacent windows count
      // each record once (Req 14.8).
      const window = reportWindow(period, isoAt(deps.clock.now()));
      const summary = summariseActivity(deps.activity.records(deviceId), window);
      // One entry per request: the period, the window length and the counts. `categories` is the
      // SIZE of `categories_heard`, not the list, because a Log_Entry carries no list of what a
      // child heard (Req 14.7, safety.md §7).
      deps.log.add({
        kind: "report_built",
        device_id: deviceId,
        period,
        window_days: PERIOD_DAYS[period],
        turns: summary.turns,
        play_minutes: summary.play_minutes,
        routines_completed: summary.routines_completed,
        stories_heard: summary.stories_heard,
        words_learned: summary.words_learned,
        cry_moments: summary.cry_moments,
        categories: summary.categories_heard.length,
      });
      return summary;
    },
  };
}
