// The report arithmetic (Phase 4 C20, C21, Req 14.4, 14.5). One pure shared function, so the
// Gateway's `GET /v1/reports`, the Admin_Console and the parent app cannot drift and the DPDP
// s.9 posture is testable in one place.
//
// There is deliberately no average, no trend, no score and no "favourite": every field is a
// count or a set. A record whose `at` does not parse is excluded from every count and throws
// nothing.
import type { ActivityRecord } from "./activity.js";
import type { IsoDateTime } from "./common.js";
import { CONTENT_CATEGORIES } from "./content-item.js";
import type { ReportPeriod } from "./report.js";

/**
 * The two report periods. `ReportPeriod` is NOT declared here — it already exists in
 * `report.ts`, which derives it from this list, so there is one value list and one type.
 */
export const REPORT_PERIODS = Object.freeze(["daily", "weekly"] as const);

/** Whole days in each period's window. */
const PERIOD_DAYS: Readonly<Record<ReportPeriod, number>> = Object.freeze({ daily: 1, weekly: 7 });

const DAY_MS = 86_400_000;

export type ReportWindow = Readonly<{ from: IsoDateTime; to: IsoDateTime }>;

export type ReportSummary = Readonly<{
  window: ReportWindow;
  turns: number;
  play_minutes: number;
  play_sessions: number;
  routines_completed: number;
  stories_heard: number;
  words_learned: number;
  cry_moments: number;
  /**
   * De-duplicated Content_Categories in `CONTENT_CATEGORIES` order — the system's canonical
   * order, so the list is deterministic and its order carries no frequency, weight or rank (C20).
   */
  categories_heard: readonly string[];
}>;

/** A time that parsed, or null. Never throws. */
function msOf(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Deterministic order: the canonical category index first, then the name, so nothing is random. */
function categoryOrder(category: string): number {
  const at = (CONTENT_CATEGORIES as readonly string[]).indexOf(category);
  return at === -1 ? CONTENT_CATEGORIES.length : at;
}

/**
 * Counts the records whose `at` falls in the HALF-OPEN `[window.from, window.to)`, so two
 * adjacent windows count each record once. Pure: no clock, no I/O, no randomness, same input
 * gives the same output, and the record order does not matter (C21, Property 8).
 *
 * The eight values, defined once (Req 14.4):
 *   turns              = count of kind `turn`
 *   play_minutes       = sum of `minutes` over kind `play`, a null counted as 0
 *   play_sessions      = count of kind `play`
 *   routines_completed = count of kind `routine`
 *   stories_heard      = count of kind `story`, NOT de-duplicated by ref_id
 *   words_learned      = count of kind `word`, NOT de-duplicated
 *   cry_moments        = count of kind `cry`
 *   categories_heard   = union of every record's `categories`, de-duplicated, ordered by the
 *                        index in CONTENT_CATEGORIES — deterministic, carrying no frequency
 *
 * De-duplicating `stories_heard` or `words_learned` was considered and rejected: a distinct
 * count is a step toward "favourite story", which is the shape of a preference profile.
 */
export function summariseActivity(
  records: readonly ActivityRecord[],
  window: ReportWindow,
): ReportSummary {
  const from = msOf(window.from);
  const to = msOf(window.to);
  let turns = 0;
  let playMinutes = 0;
  let playSessions = 0;
  let routines = 0;
  let stories = 0;
  let words = 0;
  let cries = 0;
  const categories = new Set<string>();

  if (from !== null && to !== null) {
    for (const record of records) {
      const at = msOf(record.at);
      if (at === null || at < from || at >= to) continue;
      switch (record.kind) {
        case "turn":
          turns += 1;
          break;
        case "play":
          playSessions += 1;
          playMinutes += record.minutes ?? 0;
          break;
        case "routine":
          routines += 1;
          break;
        case "story":
          stories += 1;
          break;
        case "word":
          words += 1;
          break;
        case "cry":
          cries += 1;
          break;
      }
      for (const category of record.categories) categories.add(category);
    }
  }

  return {
    window,
    turns,
    play_minutes: playMinutes,
    play_sessions: playSessions,
    routines_completed: routines,
    stories_heard: stories,
    words_learned: words,
    cry_moments: cries,
    categories_heard: Object.freeze(
      [...categories].sort((a, b) => {
        const order = categoryOrder(a) - categoryOrder(b);
        return order !== 0 ? order : a < b ? -1 : a > b ? 1 : 0;
      }),
    ),
  };
}

/**
 * The window for a period ending at `toIso`: exactly 24 h for `daily`, 7 × 24 h for `weekly`.
 * `to` is the requested instant and is exclusive, so a record at `to` belongs to the next window.
 * An unparseable `toIso` is answered with itself on both ends, which counts nothing.
 */
export function reportWindow(period: ReportPeriod, toIso: IsoDateTime): ReportWindow {
  const to = msOf(toIso);
  if (to === null) return { from: toIso, to: toIso };
  return { from: new Date(to - PERIOD_DAYS[period] * DAY_MS).toISOString(), to: toIso };
}
