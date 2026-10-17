// Screen 15, Reports, over the reports In_App_Store (Phase 4 Req 19.4, 21.10). Smoke and
// key-interaction only, example-based, no fast-check.
//
// Property 10: the segment swaps the window behind all four tiles. The numbers are counts out of
// the shared `summariseActivity`, so this suite injects Activity_Records and asserts the counts
// they produce — one block inside the week, one older block the Month window also reaches.

import { describe, expect, it } from "@jest/globals";
import type { ActivityKind, ActivityRecord } from "@xelulu/shared";
import { renderRouter, screen } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { GROW_STRINGS } from "../src/features/grow/strings";
import { ReportsScreen } from "../src/features/reports/reports-screen";
import { REPORTS_STRINGS } from "../src/features/reports/strings";
import { ROUTE_PATH } from "../src/features/shell/routes";
import { MOCK_IDENTITY } from "../src/lib/mock-identity";
import { createAppReportStore, type AppReportStore } from "../src/lib/stores/report-store";

import { expectOneSelectedSegment, pressSegment } from "./support/segments";

const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: Readonly<{ children?: ReactNode }>): React.JSX.Element {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

const NOW_MS = Date.UTC(2026, 9, 24, 9, 0, 0);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

let nextId = 0;

function record(kind: ActivityKind, categories: readonly string[], daysAgo = 0): ActivityRecord {
  nextId += 1;
  return {
    activity_id: `activity_test_${nextId}`,
    device_id: "xlu_test_1",
    kind,
    at: new Date(NOW_MS - daysAgo * DAY_MS - nextId * HOUR_MS).toISOString(),
    ref_id: null,
    minutes: kind === "play" ? 5 : null,
    categories: [...categories],
  };
}

/**
 * Inside the week: two stories, three words, one turn, two play sessions, in `stories`. Nine days
 * back, which only the Month window reaches: one more story, in `songs`.
 */
function fixtureStore(): AppReportStore {
  nextId = 0;
  const records = [
    record("story", ["stories"]),
    record("story", ["stories"]),
    record("word", []),
    record("word", []),
    record("word", []),
    record("turn", ["stories"]),
    record("play", []),
    record("play", []),
    record("story", ["songs"], 9),
  ];
  return createAppReportStore({ records, now: () => NOW_MS });
}

function openReports(store: AppReportStore): void {
  renderRouter(
    { reports: () => <ReportsScreen store={store} /> },
    { initialUrl: ROUTE_PATH.reports, wrapper: Wrapper },
  );
}

const tileLabel = (value: string, label: string): string => `${value} ${label}`;

describe("screen 15, Reports", () => {
  const TILES = REPORTS_STRINGS.tiles;

  it("shows the week's counts, the interests line and the purpose note (Req 12.1, 12.3, 19.4)", () => {
    openReports(fixtureStore());

    expect(screen.getByRole("header", { name: "This Week with Xelulu" })).toBeOnTheScreen();
    expect(screen.getByText(REPORTS_STRINGS.subheader)).toBeOnTheScreen();
    for (const [value, label] of [
      ["2", TILES.storiesHeard],
      ["3", TILES.newWords],
      ["1", TILES.questionsAsked],
      ["2", TILES.playSessions],
    ] as const) {
      expect(screen.getByLabelText(tileLabel(value, label), { exact: true })).toBeOnTheScreen();
    }
    expect(
      screen.getByText(REPORTS_STRINGS.interestsHeading(MOCK_IDENTITY.child)),
    ).toBeOnTheScreen();
    expect(screen.getByText(GROW_STRINGS.categories.stories.label)).toBeOnTheScreen();
    expect(screen.getByText(REPORTS_STRINGS.purposeNote)).toBeOnTheScreen();
    expectOneSelectedSegment(REPORTS_STRINGS.segmentsLabel);
  });

  // Property 10: the segment swaps the window behind all four tiles.
  it("swaps the numbers and the interests line between Month and Week (Req 12.2, 19.4)", () => {
    openReports(fixtureStore());

    pressSegment(REPORTS_STRINGS.segments.month);

    expect(
      screen.getByLabelText(tileLabel("3", TILES.storiesHeard), { exact: true }),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(tileLabel("2", TILES.storiesHeard), { exact: true })).toBeNull();
    expect(
      screen.getByText(
        `${GROW_STRINGS.categories.stories.label}, ${GROW_STRINGS.categories.songs.label}`,
      ),
    ).toBeOnTheScreen();
    expectOneSelectedSegment(REPORTS_STRINGS.segmentsLabel);

    pressSegment(REPORTS_STRINGS.segments.week);

    expect(
      screen.getByLabelText(tileLabel("2", TILES.storiesHeard), { exact: true }),
    ).toBeOnTheScreen();
  });

  it("shows zeros and the empty interests line when the store holds nothing (Req 19.6)", () => {
    openReports(createAppReportStore({ records: [], now: () => NOW_MS }));

    expect(
      screen.getByLabelText(tileLabel("0", TILES.storiesHeard), { exact: true }),
    ).toBeOnTheScreen();
    expect(screen.getByText(REPORTS_STRINGS.interestsEmpty)).toBeOnTheScreen();
  });

  it("computes a summary on request and caches nothing (Req 19.4, 19.8)", () => {
    const store = fixtureStore();

    const first = store.summary("week");
    const second = store.summary("week");
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(Object.keys(first).sort()).toEqual([
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
