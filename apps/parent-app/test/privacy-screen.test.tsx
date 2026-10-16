// Screen 14, Privacy & Memory: the DPDP surface and the memory list (Req 26.1, 26.12).
// Example-based only, no fast-check.
//
// Property 14: the DPDP surface changes nothing and claims nothing. Opening the dialog exposes
// the `alert` role and the modal flag; cancelling leaves every rendered value identical; either
// action leaves the mock data untouched, shows one line, and claims no deletion and no export.

import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { MOCK_PRIVACY } from "../src/features/privacy/mock-privacy";
import { CONFIRM_DIALOG_TEST_ID, PrivacyScreen } from "../src/features/privacy/privacy-screen";
import { PRIVACY_STRINGS } from "../src/features/privacy/strings";

/** Fixed metrics so SafeAreaView resolves without a measured window. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/**
 * Any line that would claim a deletion, an export or a transfer happened. The mock line is the
 * only text in the Memory panel that matches it, and it reads "Nothing was deleted, exported or
 * sent" (Req 17.9).
 */
const CLAIM = /\b(?:deleted|exported|sent)\b/i;

function memory(index: number): string {
  const row = MOCK_PRIVACY.memories[index];
  if (row === undefined) throw new Error(`no mock memory at index ${index}`);
  return row.label;
}

/** The last of the fifteen, so "expanded" is distinguishable from "recent only". */
const LAST_MEMORY = memory(MOCK_PRIVACY.memories.length - 1);

const openDialog = (): void => {
  fireEvent.press(screen.getByRole("button", { name: PRIVACY_STRINGS.deleteOrExport }));
};

describe("screen 14, the memory list", () => {
  it("shows the recent memories with their age labels and not the rest (Req 17.2)", () => {
    renderWithSafeArea(<PrivacyScreen />);

    for (let index = 0; index < MOCK_PRIVACY.recent_count; index += 1) {
      const row = MOCK_PRIVACY.memories[index];
      expect(row).toBeDefined();
      if (row === undefined) continue;
      expect(screen.getByText(row.label)).toBeOnTheScreen();
      expect(screen.getByText(row.age_label)).toBeOnTheScreen();
    }
    expect(screen.queryByText(LAST_MEMORY)).toBeNull();
  });

  it("expands to all fifteen in place and collapses again (Req 17.3)", () => {
    renderWithSafeArea(<PrivacyScreen />);

    fireEvent.press(screen.getByRole("button", { name: PRIVACY_STRINGS.viewAll }));

    expect(screen.getByText(LAST_MEMORY)).toBeOnTheScreen();
    expect(screen.getByText(memory(0))).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: PRIVACY_STRINGS.showLess }));

    expect(screen.queryByText(LAST_MEMORY)).toBeNull();
    expect(screen.getByText(memory(0))).toBeOnTheScreen();
  });

  it("expands from the What Xelulu Remembers row as well (Req 17.3)", () => {
    renderWithSafeArea(<PrivacyScreen />);

    fireEvent.press(screen.getByRole("button", { name: PRIVACY_STRINGS.remembersTitle }));

    expect(screen.getByText(LAST_MEMORY)).toBeOnTheScreen();
  });
});

describe("screen 14, the delete-or-export surface", () => {
  // Property 14: the dialog is an alert and a modal (Req 17.6, 21.8).
  //
  // The dialog is found by its testID and its role is read off its props, exactly as the kit's
  // own Confirm_Dialog case does it: the wrapper is deliberately not marked `accessible`, so
  // its buttons stay reachable, and RNTL's role query matches only `accessible` elements.
  it("opens the Confirm_Dialog with its actions (Req 17.6)", () => {
    renderWithSafeArea(<PrivacyScreen />);

    expect(screen.queryByTestId(CONFIRM_DIALOG_TEST_ID)).toBeNull();

    openDialog();

    const dialog = screen.getByTestId(CONFIRM_DIALOG_TEST_ID);
    expect(dialog.props.accessibilityRole).toBe("alert");
    expect(dialog.props.accessibilityLabel).toBe(PRIVACY_STRINGS.dialog.title);
    expect(dialog.props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByText(PRIVACY_STRINGS.dialog.body)).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: PRIVACY_STRINGS.dialog.deleteEverything }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: PRIVACY_STRINGS.dialog.exportData }),
    ).toBeOnTheScreen();
  });

  // Property 14: cancelling changes nothing (Req 17.7).
  it("closes on cancel and changes nothing", () => {
    renderWithSafeArea(<PrivacyScreen />);

    openDialog();
    fireEvent.press(screen.getByRole("button", { name: PRIVACY_STRINGS.dialog.cancel }));

    expect(screen.queryByTestId(CONFIRM_DIALOG_TEST_ID)).toBeNull();
    expect(screen.queryByText(PRIVACY_STRINGS.mockLine)).toBeNull();
    expect(screen.getByText(memory(0))).toBeOnTheScreen();
    expect(
      screen.getByText(PRIVACY_STRINGS.remembersRow(MOCK_PRIVACY.memories.length)),
    ).toBeOnTheScreen();
    expect(screen.queryAllByText(CLAIM)).toHaveLength(0);
  });

  // Property 14: either action claims nothing and leaves the mock data as it was (Req 17.8,
  // 17.9).
  it.each([PRIVACY_STRINGS.dialog.deleteEverything, PRIVACY_STRINGS.dialog.exportData])(
    "shows the mock line after %s and changes no value",
    (action) => {
      renderWithSafeArea(<PrivacyScreen />);

      openDialog();
      fireEvent.press(screen.getByRole("button", { name: action }));

      expect(screen.queryByTestId(CONFIRM_DIALOG_TEST_ID)).toBeNull();
      expect(screen.getByText(PRIVACY_STRINGS.mockLine)).toBeOnTheScreen();
      expect(screen.getByText(memory(0))).toBeOnTheScreen();
      expect(
        screen.getByText(PRIVACY_STRINGS.remembersRow(MOCK_PRIVACY.memories.length)),
      ).toBeOnTheScreen();

      // The one line that mentions a deletion or an export is the mock line, which says that
      // neither happened.
      const claims = screen.queryAllByText(CLAIM);
      expect(claims).toHaveLength(1);
      expect(screen.getByText(PRIVACY_STRINGS.mockLine)).toBe(claims[0]);
    },
  );
});

describe("screen 14, the Recordings panel", () => {
  it("lists adult-provided recordings with their consent statements (Req 17.4)", () => {
    renderWithSafeArea(<PrivacyScreen />);

    fireEvent.press(screen.getByRole("tab", { name: PRIVACY_STRINGS.segments.recordings }));

    for (const recording of MOCK_PRIVACY.recordings) {
      expect(screen.getByText(recording.title)).toBeOnTheScreen();
      expect(screen.getByText(recording.recorded_label)).toBeOnTheScreen();
      expect(screen.getByText(recording.consent_statement)).toBeOnTheScreen();
    }
    expect(screen.getByText(PRIVACY_STRINGS.noChildAudio)).toBeOnTheScreen();
  });
});
