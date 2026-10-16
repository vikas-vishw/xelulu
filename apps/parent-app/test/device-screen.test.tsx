// Screen 11, the Device page: key-interaction tests (Req 26.1, 26.10, 26.11). Example-based
// only, no fast-check.
//
// Property 12: the battery tone follows the thresholds, and the percentage is always text.
// Property 13's behavioural half: the camera row is static text and no control.

import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { BATTERY_FILL_TEST_ID, DeviceScreen } from "../src/features/device/device-screen";
import { MOCK_DEVICE } from "../src/features/device/mock-device";
import { DEVICE_STRINGS } from "../src/features/device/strings";
import { color } from "../src/theme/theme";

/** Fixed metrics so SafeAreaView resolves without a measured window. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function renderDevice(overrides: Readonly<Partial<typeof MOCK_DEVICE>> = {}): void {
  renderWithSafeArea(<DeviceScreen data={{ ...MOCK_DEVICE, ...overrides }} />);
}

/** The battery bar's fill colour. The bar is hidden from accessibility, hence the option. */
function batteryFillColor(): string | undefined {
  const fill = screen.getByTestId(BATTERY_FILL_TEST_ID, { includeHiddenElements: true });
  const flat = StyleSheet.flatten(fill.props.style as ViewStyle | undefined);
  return typeof flat?.backgroundColor === "string" ? flat.backgroundColor : undefined;
}

describe("screen 11, the Device page", () => {
  it("shows the room, the online state and the Reference's six rows (Req 14.1)", () => {
    renderDevice();

    expect(screen.getByRole("header", { name: "Xelulu device" })).toBeOnTheScreen();
    expect(screen.getByText(MOCK_DEVICE.display_name)).toBeOnTheScreen();
    expect(screen.getByText(MOCK_DEVICE.room_label)).toBeOnTheScreen();
    expect(screen.getByText(DEVICE_STRINGS.online)).toBeOnTheScreen();
    expect(screen.getByRole("image", { name: "Xelulu robot" })).toBeOnTheScreen();
    for (const title of [
      DEVICE_STRINGS.movement.title,
      DEVICE_STRINGS.volume.title,
      DEVICE_STRINGS.quietHours.title,
      DEVICE_STRINGS.cameraRow.title,
      DEVICE_STRINGS.sleepWake.title,
      DEVICE_STRINGS.software.title,
    ]) {
      expect(screen.getByText(title)).toBeOnTheScreen();
    }
    expect(screen.getByText(MOCK_DEVICE.quiet_hours_label)).toBeOnTheScreen();
    expect(screen.getByText(MOCK_DEVICE.software_label)).toBeOnTheScreen();
  });

  // Property 12: 20 % and up success, 10-19 % warning, under 10 % danger, with the number in
  // the text every time (Req 14.7, 14.8).
  it.each([
    [20, color.success],
    [19, color.warning],
    [10, color.warning],
    [9, color.danger],
  ])("draws %i%% with its tone and prints the percentage", (batteryPct, tone) => {
    renderDevice({ battery_pct: batteryPct });

    expect(screen.getByText(DEVICE_STRINGS.batteryLabel(batteryPct))).toBeOnTheScreen();
    expect(batteryFillColor()).toBe(tone);
  });

  // Property 13: the camera row says the model has none, and it is not a control (Req 14.4).
  it("shows the camera row as static text with no control of any kind", () => {
    renderDevice();

    expect(screen.getByText(DEVICE_STRINGS.cameraRow.subtitle)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: DEVICE_STRINGS.cameraRow.title })).toBeNull();
    expect(screen.queryByRole("switch", { name: DEVICE_STRINGS.cameraRow.title })).toBeNull();

    // The positive half: the Movement row holds the screen's only switch.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(1);
    expect(String(switches[0]?.props.accessibilityLabel)).toBe(DEVICE_STRINGS.movement.title);
  });

  it("flips the Movement state word (Req 14.2)", () => {
    renderDevice();

    expect(screen.getByText(DEVICE_STRINGS.movement.enabled)).toBeOnTheScreen();

    fireEvent(
      screen.getByRole("switch", { name: DEVICE_STRINGS.movement.title }),
      "valueChange",
      false,
    );

    expect(screen.getByText(DEVICE_STRINGS.movement.disabled)).toBeOnTheScreen();
    expect(screen.queryByText(DEVICE_STRINGS.movement.enabled)).toBeNull();
  });

  it("steps the volume by 5 and clamps it at both bounds (Req 14.3)", () => {
    renderDevice();

    const increase = `Increase ${DEVICE_STRINGS.volume.title}`;
    const decrease = `Decrease ${DEVICE_STRINGS.volume.title}`;

    // The percentage is printed exactly once, by the Stepper: the row subtitle that repeated it
    // is gone (Phase 2 cleanup, fix 2).
    expect(screen.getAllByText(DEVICE_STRINGS.volume.value(60))).toHaveLength(1);

    fireEvent.press(screen.getByRole("button", { name: increase }));
    expect(screen.getAllByText(DEVICE_STRINGS.volume.value(65))).toHaveLength(1);

    fireEvent.press(screen.getByRole("button", { name: decrease }));
    fireEvent.press(screen.getByRole("button", { name: decrease }));
    expect(screen.getAllByText(DEVICE_STRINGS.volume.value(55))).toHaveLength(1);
  });

  it.each([
    [100, "Increase"],
    [0, "Decrease"],
  ])("disables the stepper control at %i%%", (volumePct, control) => {
    renderDevice({ volume_pct: volumePct });

    expect(
      screen.getByRole("button", { name: `${control} ${DEVICE_STRINGS.volume.title}` }),
    ).toBeDisabled();
  });

  it("keeps one inline detail panel open at a time (Req 14.5)", () => {
    renderDevice();

    const quietLine = MOCK_DEVICE.panels["quiet-hours"][0] ?? "";
    const sleepLine = MOCK_DEVICE.panels["sleep-wake"][0] ?? "";
    expect(quietLine.length).toBeGreaterThan(0);
    expect(sleepLine.length).toBeGreaterThan(0);

    fireEvent.press(screen.getByRole("button", { name: DEVICE_STRINGS.quietHours.title }));
    expect(screen.getByText(quietLine)).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: DEVICE_STRINGS.sleepWake.title }));
    expect(screen.getByText(sleepLine)).toBeOnTheScreen();
    expect(screen.queryByText(quietLine)).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: DEVICE_STRINGS.closePanel }));
    expect(screen.queryByText(sleepLine)).toBeNull();
  });
});
