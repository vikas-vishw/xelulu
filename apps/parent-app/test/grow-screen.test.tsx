// Screen 9, Grow / Learning Insights, over the reports In_App_Store (Phase 4 Req 19.4, 21.10).
// Smoke and key-interaction only, example-based, no fast-check.
//
// Property 10: a segmented control swaps the panel. The four metric values and the interest cards
// are counts out of the shared `summariseActivity`, so the numbers this suite asserts are computed
// from the injected Activity_Records rather than pinned to a mock.

import { describe, expect, it } from "@jest/globals";
import type { ActivityKind, ActivityRecord } from "@xelulu/shared";
import { renderRouter, screen } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { GrowScreen } from "../src/features/grow/grow-screen";
import { GROW_STRINGS } from "../src/features/grow/strings";
import { ROUTE_PATH } from "../src/features/shell/routes";
import { createAppReportStore, type AppReportStore } from "../src/lib/stores/report-store";

import { expectOneSelectedSegment, pressSegment } from "./support/segments";

const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: Readonly<{ children?: ReactNode }>): React.JSX.Element {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

/** A fixed instant, so the window arithmetic is the same on every run. */
const NOW_MS = Date.UTC(2026, 9, 24, 9, 0, 0);
const HOUR_MS = 3_600_000;

let nextId = 0;

function record(kind: ActivityKind, categories: readonly string[]): ActivityRecord {
  nextId += 1;
  return {
    activity_id: `activity_test_${nextId}`,
    device_id: "xlu_test_1",
    kind,
    at: new Date(NOW_MS - nextId * HOUR_MS).toISOString(),
    ref_id: null,
    minutes: kind === "play" ? 6 : null,
    categories: [...categories],
  };
}

function storeWith(records: readonly ActivityRecord[]): AppReportStore {
  return createAppReportStore({ records, now: () => NOW_MS });
}

/**
 * Two turns, one story, three words and two play sessions inside the week, touching `stories`
 * and `animals`. Every rendered number below is one of those counts.
 */
function fixtureStore(): AppReportStore {
  nextId = 0;
  return storeWith([
    record("turn", ["stories"]),
    record("turn", ["animals"]),
    record("story", ["stories"]),
    record("word", []),
    record("word", []),
    record("word", []),
    record("play", []),
    record("play", []),
  ]);
}

function openGrow(store: AppReportStore): void {
  renderRouter(
    { grow: () => <GrowScreen store={store} /> },
    { initialUrl: ROUTE_PATH.grow, wrapper: Wrapper },
  );
}

describe("screen 9, Grow / Learning Insights", () => {
  const METRIC = GROW_STRINGS.metrics;
  const CATEGORY = GROW_STRINGS.categories;

  it("shows the Overview panel with the counted values (Req 11.1, 11.2, 19.4)", () => {
    openGrow(fixtureStore());

    expect(screen.getByRole("header", { name: "Growing Together" })).toBeOnTheScreen();
    expect(screen.getByText(GROW_STRINGS.subheader)).toBeOnTheScreen();
    for (const [value, metric] of [
      ["+3", METRIC.language],
      ["1", METRIC.reading],
      ["2", METRIC.curiosity],
      ["2", METRIC.physicalPlay],
    ] as const) {
      expect(screen.getByLabelText(`${value} ${metric.title}`, { exact: true })).toBeOnTheScreen();
    }
    expect(screen.getByRole("header", { name: GROW_STRINGS.currentInterests })).toBeOnTheScreen();
    expect(screen.getByText(CATEGORY.stories.label)).toBeOnTheScreen();
    expect(screen.getByText(CATEGORY.animals.label)).toBeOnTheScreen();
    expectOneSelectedSegment(GROW_STRINGS.segmentsLabel);
  });

  // Property 10: selecting a segment swaps the panel.
  it("swaps to the Interests panel with its detail lines (Req 11.3, 11.4, 19.4)", () => {
    openGrow(fixtureStore());

    pressSegment(GROW_STRINGS.segments.interests);

    expect(screen.getByText(CATEGORY.stories.detail)).toBeOnTheScreen();
    expect(screen.getByText(CATEGORY.animals.detail)).toBeOnTheScreen();
    expect(screen.queryByText(METRIC.language.subtitle)).toBeNull();
    expectOneSelectedSegment(GROW_STRINGS.segmentsLabel);
  });

  it("swaps to the Milestones panel with its times (Req 11.3, 11.4)", () => {
    openGrow(fixtureStore());

    pressSegment(GROW_STRINGS.segments.milestones);

    expect(screen.getByText(GROW_STRINGS.milestones.firstSentence.title)).toBeOnTheScreen();
    expect(screen.getByText(GROW_STRINGS.milestones.firstSentence.timeLabel)).toBeOnTheScreen();
    expect(screen.queryByText(CATEGORY.stories.detail)).toBeNull();
    expectOneSelectedSegment(GROW_STRINGS.segmentsLabel);
  });

  it("keeps the reports row on every segment (Req 11.5)", () => {
    openGrow(fixtureStore());

    for (const segment of [
      GROW_STRINGS.segments.interests,
      GROW_STRINGS.segments.milestones,
      GROW_STRINGS.segments.overview,
    ]) {
      pressSegment(segment);
      expect(screen.getByRole("button", { name: GROW_STRINGS.reportsRow.title })).toBeOnTheScreen();
    }
  });

  it("shows zero counts and no interest card when the store holds nothing (Req 19.6)", () => {
    openGrow(storeWith([]));

    expect(screen.getByLabelText(`+0 ${METRIC.language.title}`, { exact: true })).toBeOnTheScreen();
    expect(screen.getByLabelText(`0 ${METRIC.reading.title}`, { exact: true })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: GROW_STRINGS.currentInterests })).toBeOnTheScreen();
    expect(screen.queryByText(CATEGORY.stories.label)).toBeNull();
  });

  it("counts only the records inside the week's window (Req 19.4)", () => {
    nextId = 0;
    const old = record("story", ["songs"]);
    const store = storeWith([
      { ...old, at: new Date(NOW_MS - 10 * 86_400_000).toISOString() },
      record("story", ["stories"]),
    ]);

    expect(store.summary("week").stories_heard).toBe(1);
    expect(store.summary("month").stories_heard).toBe(2);
    expect(store.summary("week").categories_heard).toEqual(["stories"]);
  });
});
