// Screen 10, Routines: key-interaction tests (Req 26.1, 26.9). Example-based only, no
// fast-check.
//
// Property 11: a local change touches exactly one row.

import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { MOCK_ROUTINES } from "../src/features/routines/mock-routines";
import { RoutinesScreen } from "../src/features/routines/routines-screen";
import { ROUTINES_STRINGS } from "../src/features/routines/strings";

/** Fixed metrics so SafeAreaView resolves without a measured window. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const ROWS = ROUTINES_STRINGS.rows;

function renderRoutines(): void {
  renderWithSafeArea(<RoutinesScreen />);
}

/** Opens the inline add form and types into it. */
function openForm(name: string, time: string): void {
  fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.addRoutine }));
  fireEvent.changeText(screen.getByLabelText(ROUTINES_STRINGS.routineName), name);
  if (time.length > 0) fireEvent.changeText(screen.getByLabelText(ROUTINES_STRINGS.time), time);
}

describe("screen 10, Routines", () => {
  it("shows the six Reference rows with their times, all on (Req 13.1, 13.2)", () => {
    renderRoutines();

    expect(screen.getByRole("header", { name: "Daily Routines" })).toBeOnTheScreen();
    expect(screen.getByText(ROUTINES_STRINGS.subheader)).toBeOnTheScreen();
    for (const row of Object.values(ROWS)) {
      expect(screen.getByText(row.title)).toBeOnTheScreen();
      expect(screen.getByText(row.subtitle)).toBeOnTheScreen();
      expect(screen.getByText(row.timeLabel)).toBeOnTheScreen();
      expect(screen.getByRole("switch", { name: row.title })).toBeChecked();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(MOCK_ROUTINES.rows.length);
  });

  // Property 11: one toggle flips its own row and leaves the other five alone.
  it("flips one row only (Req 13.3)", () => {
    renderRoutines();

    fireEvent(screen.getByRole("switch", { name: ROWS.meals.title }), "valueChange", false);

    expect(screen.getByRole("switch", { name: ROWS.meals.title })).not.toBeChecked();
    for (const row of [ROWS.morning, ROWS.brushing, ROWS.playTime, ROWS.windDown, ROWS.bedtime]) {
      expect(screen.getByRole("switch", { name: row.title })).toBeChecked();
    }
  });

  it("appends the typed name and time, switched on (Req 13.4)", () => {
    renderRoutines();

    openForm("Homework", "4:00 PM");
    fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.confirmAdd }));

    expect(screen.getByText("Homework")).toBeOnTheScreen();
    expect(screen.getByText("4:00 PM")).toBeOnTheScreen();
    expect(screen.getByRole("switch", { name: "Homework" })).toBeChecked();
    expect(screen.getAllByRole("switch")).toHaveLength(MOCK_ROUTINES.rows.length + 1);
  });

  it("disables the confirm control while the name is blank (Req 13.5)", () => {
    renderRoutines();

    fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.addRoutine }));
    const confirm = screen.getByRole("button", { name: ROUTINES_STRINGS.confirmAdd });
    expect(confirm).toBeDisabled();

    fireEvent.press(confirm);
    expect(screen.getAllByRole("switch")).toHaveLength(MOCK_ROUTINES.rows.length);

    fireEvent.changeText(screen.getByLabelText(ROUTINES_STRINGS.routineName), "Homework");
    expect(screen.getByRole("button", { name: ROUTINES_STRINGS.confirmAdd })).not.toBeDisabled();
  });

  it("appends the Not set time when the Time field is left empty", () => {
    renderRoutines();

    openForm("Homework", "");
    fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.confirmAdd }));

    expect(screen.getByText("Homework")).toBeOnTheScreen();
    expect(screen.getByText(ROUTINES_STRINGS.timeNotSet)).toBeOnTheScreen();
  });

  it("closes the form and keeps the rows when Cancel is pressed", () => {
    renderRoutines();

    openForm("Homework", "4:00 PM");
    fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.cancel }));

    expect(screen.queryByLabelText(ROUTINES_STRINGS.routineName)).toBeNull();
    expect(screen.queryByText("Homework")).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(MOCK_ROUTINES.rows.length);
  });
});
