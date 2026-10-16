// Screen 13, Grandma Mode: key-interaction tests (Req 26.1, 26.8). Example-based only, no
// fast-check.
//
// The first row is a VOICE call (D5, Req 16.2): there is no camera in v1, so the screen offers
// no video anywhere. The record and schedule panels capture and save nothing (Req 16.4, 16.5).

import { describe, expect, it } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { MOCK_GRANDMA } from "../src/features/grandma/mock-grandma";
import { GRANDMA_STRINGS } from "../src/features/grandma/strings";
import { ROUTE_PATH } from "../src/features/shell/routes";

/** The real route tree, as an absolute path so the test does not depend on the Jest cwd. */
const APP_DIR = join(__dirname, "..", "app");

const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: Readonly<{ children?: ReactNode }>): React.JSX.Element {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

function openGrandmaMode(): { getPathname: () => string } {
  return renderRouter(APP_DIR, { initialUrl: ROUTE_PATH["grandma-mode"], wrapper: Wrapper });
}

const ROWS = GRANDMA_STRINGS.rows;

describe("screen 13, Grandma Mode", () => {
  it("shows the Reference's four rows and the consent note (Req 16.1, 16.6)", () => {
    openGrandmaMode();

    expect(screen.getByRole("header", { name: "Grandma Mode" })).toBeOnTheScreen();
    expect(screen.getByText(GRANDMA_STRINGS.subheader)).toBeOnTheScreen();
    for (const row of MOCK_GRANDMA.rows) {
      expect(screen.getByText(row.title)).toBeOnTheScreen();
      expect(screen.getByText(row.subtitle)).toBeOnTheScreen();
    }
    expect(screen.getByText(GRANDMA_STRINGS.consentNote)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: GRANDMA_STRINGS.callGrandmaMode })).toBeOnTheScreen();
  });

  // D5, Req 16.2: the row is a voice call, and no copy on the screen offers a picture.
  it("names the first row Voice Call with Xelulu and nothing else", () => {
    openGrandmaMode();

    expect(screen.getByText(ROWS.call.title)).toBeOnTheScreen();
    expect(screen.getByText(ROWS.call.subtitle)).toBeOnTheScreen();
    expect(screen.queryAllByText(/video/i)).toHaveLength(0);
  });

  // Req 16.3: both the row and the primary button open the audio-only live screen.
  it.each([ROWS.call.title, GRANDMA_STRINGS.callGrandmaMode])(
    "opens /voice-call from %s",
    (name) => {
      const router = openGrandmaMode();

      fireEvent.press(screen.getByRole("button", { name }));

      expect(router.getPathname()).toBe(ROUTE_PATH["voice-call"]);
    },
  );

  it("leaves the Festival row static with its later-phase text (Req 16.1)", () => {
    openGrandmaMode();

    expect(screen.getByText(GRANDMA_STRINGS.laterPhase)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ROWS.festival.title })).toBeNull();
  });

  // Req 16.5: the record control reveals one line and captures nothing.
  it("shows the later-phase line when Record is pressed", () => {
    const router = openGrandmaMode();

    fireEvent.press(screen.getByRole("button", { name: ROWS.stories.title }));
    expect(screen.queryByText(GRANDMA_STRINGS.recordLater)).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: GRANDMA_STRINGS.record }));

    expect(screen.getByText(GRANDMA_STRINGS.recordLater)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(ROUTE_PATH["grandma-mode"]);
  });

  // Req 16.4: the schedule panel confirms with a line saying nothing was saved.
  it("confirms the mock story time and saves nothing", () => {
    openGrandmaMode();

    fireEvent.press(screen.getByRole("button", { name: ROWS.schedule.title }));

    const field = screen.getByLabelText(GRANDMA_STRINGS.storyTime);
    expect(field.props.value).toBe(MOCK_GRANDMA.default_story_time);

    fireEvent.press(screen.getByRole("button", { name: GRANDMA_STRINGS.setTime }));

    expect(
      screen.getByText(GRANDMA_STRINGS.scheduleMock(MOCK_GRANDMA.default_story_time)),
    ).toBeOnTheScreen();
  });

  it("keeps one inline panel open at a time", () => {
    openGrandmaMode();

    fireEvent.press(screen.getByRole("button", { name: ROWS.stories.title }));
    expect(screen.getByRole("button", { name: GRANDMA_STRINGS.record })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: ROWS.schedule.title }));

    expect(screen.getByRole("button", { name: GRANDMA_STRINGS.setTime })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: GRANDMA_STRINGS.record })).toBeNull();
  });
});
