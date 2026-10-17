// The report arithmetic (Phase 4 Req 14.4, 14.5, 14.8–14.10; design Property 8).
//
// A Report_Summary is counts and one de-duplicated list, computed on request from the records in
// a window. There is deliberately no average, no trend, no score and no "favourite": the DPDP
// s.9 posture is that a report is a parent-requested summary for care, not a profile, and the one
// place that is testable is here (safety.md §2).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CONTENT_CATEGORIES,
  REPORT_PERIODS,
  reportWindow,
  summariseActivity,
} from "../dist/index.js";
import type { ActivityRecord, ReportWindow } from "../dist/index.js";

const DAY_MS = 86_400_000;

function record(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    activity_id: "act_1",
    device_id: "xlu_000123",
    kind: "turn",
    at: "2026-10-24T10:00:00.000Z",
    ref_id: null,
    minutes: null,
    categories: [],
    ...over,
  };
}

const WINDOW: ReportWindow = {
  from: "2026-10-24T00:00:00.000Z",
  to: "2026-10-25T00:00:00.000Z",
};

describe("the eight counts (Req 14.4)", () => {
  it("counts each kind, sums play minutes, and de-duplicates nothing it should not", () => {
    const summary = summariseActivity(
      [
        record({ kind: "turn" }),
        record({ kind: "turn" }),
        record({ kind: "play", minutes: 12 }),
        record({ kind: "play", minutes: null }),
        record({ kind: "routine" }),
        record({ kind: "story", ref_id: "story_a" }),
        record({ kind: "story", ref_id: "story_a" }),
        record({ kind: "word", ref_id: "word_rain" }),
        record({ kind: "word", ref_id: "word_rain" }),
        record({ kind: "cry" }),
      ],
      WINDOW,
    );
    expect(summary.turns).toBe(2);
    expect(summary.play_sessions).toBe(2);
    expect(summary.play_minutes).toBe(12);
    expect(summary.routines_completed).toBe(1);
    // NOT de-duplicated by ref_id: a distinct count is a step toward "favourite story".
    expect(summary.stories_heard).toBe(2);
    expect(summary.words_learned).toBe(2);
    expect(summary.cry_moments).toBe(1);
  });

  it("orders `categories_heard` by the canonical index and de-duplicates it", () => {
    const summary = summariseActivity(
      [
        record({ categories: ["manners", "animals"] }),
        record({ categories: ["animals", "stories"] }),
      ],
      WINDOW,
    );
    expect(summary.categories_heard).toEqual(["stories", "animals", "manners"]);
    const indexes = summary.categories_heard.map((c) => CONTENT_CATEGORIES.indexOf(c as never));
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it("carries exactly the nine documented fields and nothing else (Req 14.3)", () => {
    expect(Object.keys(summariseActivity([], WINDOW)).sort()).toEqual([
      "categories_heard",
      "cry_moments",
      "play_minutes",
      "play_sessions",
      "routines_completed",
      "stories_heard",
      "turns",
      "window",
      "words_learned",
    ]);
  });
});

describe("the window is half-open (Req 14.5, 14.8)", () => {
  it("counts a record at `from` and excludes one at `to`", () => {
    const atFrom = summariseActivity([record({ at: WINDOW.from })], WINDOW);
    const atTo = summariseActivity([record({ at: WINDOW.to })], WINDOW);
    expect(atFrom.turns).toBe(1);
    expect(atTo.turns).toBe(0);
  });

  it("gives a daily window 24 h and a weekly one 7 x 24 h, ending at the instant asked for", () => {
    const to = "2026-10-24T18:30:00.000Z";
    for (const period of REPORT_PERIODS) {
      const window = reportWindow(period, to);
      expect(window.to).toBe(to);
      const span = Date.parse(window.to) - Date.parse(window.from);
      expect(span).toBe((period === "daily" ? 1 : 7) * DAY_MS);
    }
  });

  it("excludes an unparseable `at` and throws nothing (Req 14.9)", () => {
    const summary = summariseActivity(
      [record({ at: "not a time" }), record({ at: WINDOW.from })],
      WINDOW,
    );
    expect(summary.turns).toBe(1);
  });

  it("answers an unparseable window with a window that counts nothing", () => {
    const window = reportWindow("daily", "not a time");
    expect(window).toEqual({ from: "not a time", to: "not a time" });
    expect(summariseActivity([record()], window).turns).toBe(0);
  });
});

describe("Property 8: a report is a pure function of its window", () => {
  it("gives the same summary for the same records in any order, with no clock in it", () => {
    const kinds = ["turn", "play", "routine", "story", "word", "cry"] as const;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom(...kinds),
            hour: fc.integer({ min: -4, max: 28 }),
            minutes: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
            categories: fc.subarray([...CONTENT_CATEGORIES] as string[]),
          }),
          { maxLength: 40 },
        ),
        (rows) => {
          const records = rows.map((row, index) =>
            record({
              activity_id: `act_${String(index)}`,
              kind: row.kind,
              at: new Date(Date.parse(WINDOW.from) + row.hour * 3_600_000).toISOString(),
              minutes: row.minutes,
              categories: [...row.categories],
            }),
          );
          const once = summariseActivity(records, WINDOW);
          const twice = summariseActivity(records, WINDOW);
          const shuffled = summariseActivity([...records].reverse(), WINDOW);
          expect(twice).toEqual(once);
          expect(shuffled).toEqual(once);
          // Everything counted sits inside the half-open window.
          const inside = records.filter((r) => {
            const at = Date.parse(r.at);
            return at >= Date.parse(WINDOW.from) && at < Date.parse(WINDOW.to);
          });
          expect(once.turns).toBe(inside.filter((r) => r.kind === "turn").length);
          expect(once.cry_moments).toBe(inside.filter((r) => r.kind === "cry").length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
