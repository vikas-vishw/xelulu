// Screen 8, Play & Adventure, over the content In_App_Store (Phase 4 Req 19.3, 21.10). Smoke and
// key-interaction only, example-based, no fast-check.
//
// This suite is also the confirmation that Jest resolves the BUILT `@xelulu/shared` barrel at
// runtime (Req 19.7a): the default store is the shared Starter_Content, and the first case
// asserts the seeded titles reach the screen with no store injected. Nothing is copied into the
// app, so a resolution failure fails here rather than hiding.

import { describe, expect, it } from "@jest/globals";
import { createStarterContent } from "@xelulu/shared";
import type { ContentItem } from "@xelulu/shared";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { PlayScreen } from "../src/features/play/play-screen";
import { PLAY_STRINGS } from "../src/features/play/strings";
import { ROUTE_PATH } from "../src/features/shell/routes";
import { createAppContentStore } from "../src/lib/stores/content-store";

import { expectOneSelectedSegment, pressSegment } from "./support/segments";

/** The real route tree, as an absolute path so the test does not depend on the Jest cwd. */
const APP_DIR = join(__dirname, "..", "app");

const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: Readonly<{ children?: ReactNode }>): React.JSX.Element {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

function openApp(initialUrl: string): { getPathname: () => string } {
  return renderRouter(APP_DIR, { initialUrl, wrapper: Wrapper });
}

/** One Content_Item, with only the fields this screen's mapping reads given a value. */
function item(over: Partial<ContentItem> & Pick<ContentItem, "content_id">): ContentItem {
  return {
    household_id: null,
    kind: "story",
    title: over.content_id,
    languages: ["en-IN"],
    age_stages: ["little"],
    categories: ["stories"],
    steps: [],
    status: "active",
    licence_note: "Original retelling written for Xelulu.",
    source: "original",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  } as ContentItem;
}

type PlaySegment = "games" | "stories" | "learning";

/** A seeded title per segment, read off the Starter_Content so the anchors cannot go stale. */
function seededTitle(segment: PlaySegment): string {
  const rows = createAppContentStore()
    .playItems()
    .filter((row) => row.category === segment);
  const first = rows[0];
  if (first === undefined) throw new Error(`no seeded Play item in the ${segment} segment`);
  return first.title;
}

describe("screen 8, Play & Adventure", () => {
  it("lists the seeded library with no store injected (Req 19.3, 19.7a)", () => {
    const seeded = createStarterContent();
    const rows = createAppContentStore().playItems();
    expect(seeded.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(seeded.filter((row) => row.status === "active").length);

    openApp(ROUTE_PATH.play);

    expect(screen.getByRole("header", { name: "Play with Xelulu" })).toBeOnTheScreen();
    for (const segment of ["games", "stories", "learning"] as const) {
      expect(screen.getByText(seededTitle(segment))).toBeOnTheScreen();
    }
    expectOneSelectedSegment(PLAY_STRINGS.segmentsLabel);
  });

  // Property 10: selecting a segment filters the list to that category.
  const filterCases: [label: string, shown: PlaySegment, hidden: PlaySegment][] = [
    [PLAY_STRINGS.segments.games, "games", "stories"],
    [PLAY_STRINGS.segments.stories, "stories", "learning"],
    [PLAY_STRINGS.segments.learning, "learning", "games"],
  ];

  it.each(filterCases)("shows only the %s cards (Req 10.3, 19.3)", (label, shown, hidden) => {
    openApp(ROUTE_PATH.play);

    pressSegment(label);

    expect(screen.getByText(seededTitle(shown))).toBeOnTheScreen();
    expect(screen.queryByText(seededTitle(hidden))).toBeNull();
    expectOneSelectedSegment(PLAY_STRINGS.segmentsLabel);
  });

  it("shows every card again under All (Req 10.3)", () => {
    openApp(ROUTE_PATH.play);

    pressSegment(PLAY_STRINGS.segments.stories);
    pressSegment(PLAY_STRINGS.segments.all);

    expect(screen.getByText(seededTitle("games"))).toBeOnTheScreen();
    expect(screen.getByText(seededTitle("learning"))).toBeOnTheScreen();
  });

  it("shows the later-phase line on a card press, and navigates nowhere (Req 10.5)", () => {
    const router = openApp(ROUTE_PATH.play);

    expect(screen.queryByText(PLAY_STRINGS.startsFromRobot)).toBeNull();

    fireEvent.press(
      screen.getByRole("button", {
        name: `${seededTitle("games")}, ${PLAY_STRINGS.cardSubtitles.games}`,
      }),
    );

    expect(screen.getByText(PLAY_STRINGS.startsFromRobot)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(ROUTE_PATH.play);
  });

  it("shows the empty line when the store holds no card (Req 10.4, 19.6)", () => {
    renderRouter(
      { play: () => <PlayScreen store={createAppContentStore([])} /> },
      { initialUrl: ROUTE_PATH.play, wrapper: Wrapper },
    );

    expect(screen.getByText(PLAY_STRINGS.nothingHere)).toBeOnTheScreen();
  });

  it("offers no draft item (Req 19.3)", () => {
    const store = createAppContentStore([
      item({ content_id: "content_draft_1", status: "draft" }),
      item({ content_id: "content_active_1" }),
    ]);

    renderRouter(
      { play: () => <PlayScreen store={store} /> },
      { initialUrl: ROUTE_PATH.play, wrapper: Wrapper },
    );

    expect(screen.getByText("content_active_1")).toBeOnTheScreen();
    expect(screen.queryByText("content_draft_1")).toBeNull();
  });

  it("takes the segment from the first category in the canonical order (Req 19.3)", () => {
    const store = createAppContentStore([
      item({ content_id: "content_games_only", kind: "game", categories: ["games"] }),
      item({ content_id: "content_song", kind: "song", categories: ["songs"] }),
      item({ content_id: "content_learning", kind: "learning", categories: ["animals"] }),
      item({ content_id: "content_unplaceable", categories: [] }),
    ]);

    expect(
      store.playItems().map((row) => [row.item_id, row.category, row.subtitle, row.illustration]),
    ).toEqual([
      ["content_games_only", "games", PLAY_STRINGS.cardSubtitles.games, "play-scene"],
      ["content_song", "stories", PLAY_STRINGS.cardSubtitles.stories, "story-scene"],
      ["content_learning", "learning", PLAY_STRINGS.cardSubtitles.learning, "space-scene"],
    ]);
  });
});
