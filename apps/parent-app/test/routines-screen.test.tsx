// Screen 10, Routines, over the routines In_App_Store (Phase 4 Req 19.5, 21.10). Key-interaction
// tests only, example-based, no fast-check.
//
// Property 11: a local change touches exactly one row.
//
// The rows come from the SAME shared Starter_Content templates the Gateway seeds from, mapped onto
// the Reference's rows by `routine_id` through `ROUTINE_PRESENTATION`. Three assertions here exist
// so the template list and the row presentation cannot drift apart silently: the six rows still
// carry the Reference's titles, subtitles, icons, tones and 12-hour labels; a template with no map
// entry renders no row; and each template's `at` still agrees with its row's `time_label`.

import { describe, expect, it } from "@jest/globals";
import { createStarterRoutines } from "@xelulu/shared";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { ROUTINE_PRESENTATION } from "../src/features/routines/mock-routines";
import { RoutinesScreen } from "../src/features/routines/routines-screen";
import { ROUTINES_STRINGS } from "../src/features/routines/strings";
import { createAppRoutineStore, APP_ROUTINE_STORE } from "../src/lib/stores/routine-store";

/** Fixed metrics so SafeAreaView resolves without a measured window. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const ROWS = ROUTINES_STRINGS.rows;

/** The rows the screen opens with, from the default store over the Starter_Content templates. */
const STORE_ROWS = APP_ROUTINE_STORE.routines().rows;

function renderRoutines(): void {
  renderWithSafeArea(<RoutinesScreen />);
}

/** Opens the inline add form and types into it. */
function openForm(name: string, time: string): void {
  fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.addRoutine }));
  fireEvent.changeText(screen.getByLabelText(ROUTINES_STRINGS.routineName), name);
  if (time.length > 0) fireEvent.changeText(screen.getByLabelText(ROUTINES_STRINGS.time), time);
}

/** `"07:00"` → `"7:00 AM"`: the Reference's label shape, so the two sources can be compared. */
function twelveHour(at: string): string {
  const [rawHour = "", minute = ""] = at.split(":");
  const hour24 = Number(rawHour);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${hour24 < 12 ? "AM" : "PM"}`;
}

describe("screen 10, Routines", () => {
  it("shows the six Reference rows with their times, all on (Req 13.1, 13.2, 19.5)", () => {
    renderRoutines();

    expect(screen.getByRole("header", { name: "Daily Routines" })).toBeOnTheScreen();
    expect(screen.getByText(ROUTINES_STRINGS.subheader)).toBeOnTheScreen();
    for (const row of Object.values(ROWS)) {
      expect(screen.getByText(row.title)).toBeOnTheScreen();
      expect(screen.getByText(row.subtitle)).toBeOnTheScreen();
      expect(screen.getByText(row.timeLabel)).toBeOnTheScreen();
      expect(screen.getByRole("switch", { name: row.title })).toBeChecked();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(STORE_ROWS.length);
  });

  it("maps every template onto its Reference row, in the template order (Req 19.5)", () => {
    const templates = createStarterRoutines();
    expect(STORE_ROWS).toHaveLength(templates.length);

    expect(STORE_ROWS.map((row) => row.routine_id)).toEqual(
      templates.map((template) => template.routine_id),
    );
    for (const [index, row] of STORE_ROWS.entries()) {
      const template = templates[index];
      const presentation = ROUTINE_PRESENTATION[row.routine_id];
      expect(template).toBeDefined();
      expect(presentation).toBeDefined();
      expect(row.title).toBe(presentation?.text.title);
      expect(row.subtitle).toBe(presentation?.text.subtitle);
      expect(row.time_label).toBe(presentation?.text.timeLabel);
      expect(row.icon).toBe(presentation?.icon);
      expect(row.icon_tone).toBe(presentation?.tone);
      expect(row.enabled).toBe(template?.enabled);
      // The two sources of the time: the template's 24-hour `at` and the Reference's label.
      expect(row.time_label).toBe(twelveHour(template?.at ?? ""));
    }
  });

  it("renders no row for a template with no presentation entry (Req 19.5)", () => {
    const store = createAppRoutineStore([
      { routine_id: "morning", name: "morning", at: "07:00", enabled: true, behaviour: "morning" },
      {
        routine_id: "homework",
        name: "homework",
        at: "16:00",
        enabled: true,
        behaviour: "homework",
      },
    ]);
    expect(store.routines().rows.map((row) => row.routine_id)).toEqual(["morning"]);

    renderWithSafeArea(<RoutinesScreen store={store} />);

    expect(screen.getByRole("switch", { name: ROWS.morning.title })).toBeOnTheScreen();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
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
    expect(screen.getAllByRole("switch")).toHaveLength(STORE_ROWS.length + 1);
  });

  it("disables the confirm control while the name is blank (Req 13.5)", () => {
    renderRoutines();

    fireEvent.press(screen.getByRole("button", { name: ROUTINES_STRINGS.addRoutine }));
    const confirm = screen.getByRole("button", { name: ROUTINES_STRINGS.confirmAdd });
    expect(confirm).toBeDisabled();

    fireEvent.press(confirm);
    expect(screen.getAllByRole("switch")).toHaveLength(STORE_ROWS.length);

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
    expect(screen.getAllByRole("switch")).toHaveLength(STORE_ROWS.length);
  });
});
