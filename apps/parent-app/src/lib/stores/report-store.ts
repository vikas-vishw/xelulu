// The reports In_App_Store (Phase 4 Req 19.1, 19.4, 19.7). The Grow and Reports screens depend on
// this interface and on nothing else.
//
// Every number both screens show is a count out of the shared `summariseActivity`, the same pure
// function the Gateway's `GET /v1/reports` and the Admin_Console read, so the three cannot drift.
// It is computed on request and cached nowhere. There is no average, no trend, no score, no rank,
// no prediction and no "favourite": a summary is counts and a set of Content_Categories, which is
// the DPDP s.9 posture this phase holds (Req 19.8, safety.md §2).
//
// One of the four app files allowed a runtime import from `@xelulu/shared` (Req 19.7). No network
// call, no environment read and no fetch.

import { reportWindow, summariseActivity } from "@xelulu/shared";
import type { ActivityRecord, ReportSummary, ReportWindow } from "@xelulu/shared";

import {
  GROW_CATEGORY_PRESENTATION,
  GROW_METRIC_PRESENTATION,
  type GrowInterest,
  type GrowMetric,
  type GrowMetricKey,
} from "../../features/grow/mock-grow";
import {
  REPORT_TILE_PRESENTATION,
  type ReportPeriodKey,
  type ReportTile,
  type ReportTileKey,
} from "../../features/reports/mock-reports";
import { REPORTS_STRINGS } from "../../features/reports/strings";

import { createMockActivity } from "./mock-activity";

const DAY_MS = 86_400_000;

/**
 * The Month segment's window: four weekly windows. The shared `ReportPeriod` union has no monthly
 * member and this phase invents none — `summariseActivity` takes a window, so the segment supplies
 * one rather than a new period.
 */
const MONTH_DAYS = 28;

/** Which count each metric row shows, and how it reads. The Reference draws Language with a "+". */
const METRIC_VALUE: Readonly<Record<GrowMetricKey, (summary: ReportSummary) => string>> =
  Object.freeze({
    language: (summary) => `+${summary.words_learned}`,
    reading: (summary) => String(summary.stories_heard),
    curiosity: (summary) => String(summary.turns),
    physicalPlay: (summary) => String(summary.play_sessions),
  });

/** Which count each Reports tile shows. */
const TILE_VALUE: Readonly<Record<ReportTileKey, (summary: ReportSummary) => number>> =
  Object.freeze({
    "stories-heard": (summary) => summary.stories_heard,
    "new-words": (summary) => summary.words_learned,
    "questions-asked": (summary) => summary.turns,
    "play-sessions": (summary) => summary.play_sessions,
  });

function windowFor(period: ReportPeriodKey, nowMs: number): ReportWindow {
  const toIso = new Date(nowMs).toISOString();
  if (period === "week") return reportWindow("weekly", toIso);
  return { from: new Date(nowMs - MONTH_DAYS * DAY_MS).toISOString(), to: toIso };
}

export interface AppReportStore {
  /** The summary for a segment, counted on request. Nothing is cached between calls. */
  summary(period: ReportPeriodKey): ReportSummary;
  /** Screen 9's four metric rows, counted over the week. */
  growMetrics(): readonly GrowMetric[];
  /** Screen 9's interest cards: the week's `categories_heard`, in the canonical order. */
  growInterests(): readonly GrowInterest[];
  /** Screen 15's four tiles for a segment. */
  reportTiles(period: ReportPeriodKey): readonly ReportTile[];
  /** Screen 15's one interests line for a segment. */
  interestsLabel(period: ReportPeriodKey): string;
}

export function createAppReportStore(
  deps: Readonly<{ records?: readonly ActivityRecord[]; now?: () => number }> = {},
): AppReportStore {
  const now = deps.now ?? ((): number => Date.now());
  const records = deps.records ?? createMockActivity(now());

  const summary = (period: ReportPeriodKey): ReportSummary =>
    summariseActivity(records, windowFor(period, now()));

  return {
    summary,

    growMetrics: () => {
      const week = summary("week");
      return GROW_METRIC_PRESENTATION.map((metric) => ({
        key: metric.key,
        icon: metric.icon,
        icon_tone: metric.icon_tone,
        title: metric.title,
        subtitle: metric.subtitle,
        value: METRIC_VALUE[metric.key](week),
      }));
    },

    growInterests: () =>
      summary("week").categories_heard.flatMap((category) => {
        const presentation = GROW_CATEGORY_PRESENTATION[category];
        if (presentation === undefined) return [];
        return [
          {
            key: category,
            label: presentation.label,
            detail: presentation.detail,
            illustration: presentation.illustration,
          } satisfies GrowInterest,
        ];
      }),

    reportTiles: (period) => {
      const set = summary(period);
      return REPORT_TILE_PRESENTATION.map((tile) => ({
        key: tile.key,
        icon: tile.icon,
        icon_tone: tile.icon_tone,
        value: String(TILE_VALUE[tile.key](set)),
        label: tile.label,
      }));
    },

    interestsLabel: (period) => {
      const labels = summary(period).categories_heard.flatMap((category) => {
        const presentation = GROW_CATEGORY_PRESENTATION[category];
        return presentation === undefined ? [] : [presentation.label];
      });
      return labels.length === 0 ? REPORTS_STRINGS.interestsEmpty : labels.join(", ");
    },
  };
}

/** The app's one store instance, over the app's activity fixture. */
export const APP_REPORT_STORE: AppReportStore = createAppReportStore();
