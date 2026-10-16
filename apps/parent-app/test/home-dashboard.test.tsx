// Home Dashboard smoke test (Req 11.4, 5.1–5.8, 6.1–6.3). Example-based only (C16).
// Property 8: Home shows the data it is given, from the Mock_Home_Data and a fixed Clock.

import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { BATTERY_PILL_TEST_ID, HomeDashboard } from "../src/features/home/home-dashboard";
import { MOCK_HOME } from "../src/features/home/mock-home";
import { color } from "../src/theme/theme";

/** Fixed metrics so SafeAreaView resolves without a measured window. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/** 09:00 local on a fixed day: the morning greeting (Req 6.1). */
const NINE_AM = new Date(2026, 0, 15, 9, 0, 0, 0);

function renderHome(): void {
  renderWithSafeArea(<HomeDashboard now={() => NINE_AM} data={MOCK_HOME} />);
}

/**
 * The colour of the battery pill's dot: the pill's first child View. `StatusPill` renders the
 * dot before its label, and the dot carries the only `backgroundColor` in the pill.
 */
function batteryDotColor(): string | undefined {
  const pill = screen.getByTestId(BATTERY_PILL_TEST_ID);
  for (const child of pill.children) {
    if (typeof child === "string") continue;
    const flat = StyleSheet.flatten(child.props.style as ViewStyle | undefined);
    if (typeof flat?.backgroundColor === "string") return flat.backgroundColor;
  }
  return undefined;
}

/** Every value Req 5.2–5.6 puts on the screen, for the Mock_Home_Data at 09:00. */
const EXPECTED_TEXT = [
  "Good morning, Mom",
  "Aarav is playing with Xelulu",
  "Xelulu",
  "Online",
  "Battery 78%",
  "Play",
  "Routines",
  "Voice Call",
  "Settings",
  "Today with Xelulu",
  "3",
  "Activities",
  "25 min",
  "Play time",
  "Great Mood",
  "Last Activity",
  "Story Time",
  "The Brave Elephant",
  "10:30 AM",
] as const;

describe("HomeDashboard", () => {
  it.each(EXPECTED_TEXT)("shows %s", (text) => {
    renderHome();
    expect(screen.getByText(text)).toBeOnTheScreen();
  });

  it("shows the character placeholder with the image role", () => {
    renderHome();
    expect(screen.getByRole("image", { name: "Xelulu robot" })).toBeOnTheScreen();
  });

  it("makes only the header, robot card and quick actions pressable (Req 5.8)", () => {
    renderHome();

    const labels = screen
      .getAllByRole("button")
      .map((element) => String(element.props.accessibilityLabel))
      .sort();

    expect(labels).toEqual([
      "Play",
      "Routines",
      "Settings", // the header's round settings button
      "Settings", // the Settings quick action
      "Voice Call",
      "Xelulu, Online, Battery 78%. Open device",
    ]);
  });

  // Property 12: the status pill follows the charge thresholds, and the percentage is always in
  // the text, so a battery state is never carried by colour alone (D15, Req 21.3). Both halves
  // are asserted: the dot's tone and the words beside it.
  it.each([
    [20, color.success],
    [19, color.warning],
    [10, color.warning],
    [9, color.danger],
  ])("shows %i%% in the pill text, with its tone on the dot", (pct, tone) => {
    renderWithSafeArea(
      <HomeDashboard
        now={() => NINE_AM}
        data={{ ...MOCK_HOME, device: { ...MOCK_HOME.device, battery_pct: pct } }}
      />,
    );

    expect(screen.getByText(`Battery ${pct}%`)).toBeOnTheScreen();
    expect(batteryDotColor()).toBe(tone);
  });

  it("gives the today tiles and the last-activity card no button role (Req 5.8)", () => {
    renderHome();

    for (const name of [
      "3 Activities",
      "25 min Play time",
      "Great Mood",
      "Story Time",
      "The Brave Elephant",
      "10:30 AM",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });
});
