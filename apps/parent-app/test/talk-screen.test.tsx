// Screen 7, Live View & Voice Call (Req 26.13). Smoke and key-interaction only, example-based,
// no fast-check (Req 26.1).
//
// Property 4: state is never colour alone — Mute and Speaker carry their state in visible text
// and in their accessible name.

import { describe, expect, it } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { ROUTE_PATH } from "../src/features/shell/routes";
import { MOCK_CALL } from "../src/features/talk/mock-call";
import { TALK_STRINGS } from "../src/features/talk/strings";

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

/** `CircleButton` composes its accessible name as "<label>, <stateText>". */
const control = (label: string, state: string): string => `${label}, ${state}`;

describe("screen 7, Live View & Voice Call", () => {
  it("shows the connection status and the static duration as text (Req 9.6, 9.7)", () => {
    openApp(ROUTE_PATH["voice-call"]);

    expect(screen.getByRole("header", { name: "Live with Xelulu" })).toBeOnTheScreen();
    expect(screen.getByText(MOCK_CALL.status_label)).toBeOnTheScreen();
    expect(screen.getByText(MOCK_CALL.duration_label)).toBeOnTheScreen();
  });

  it("flips Mute and reports the new state in text and label (Req 9.4)", () => {
    openApp(ROUTE_PATH["voice-call"]);

    expect(screen.getByText(TALK_STRINGS.micOn)).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole("button", { name: control(TALK_STRINGS.mute, TALK_STRINGS.micOn) }),
    );

    expect(screen.getByText(TALK_STRINGS.micOff)).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: control(TALK_STRINGS.mute, TALK_STRINGS.micOff) }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(TALK_STRINGS.micOn)).toBeNull();
  });

  it("flips Speaker and reports the new state in text and label (Req 9.2, 9.4)", () => {
    openApp(ROUTE_PATH["voice-call"]);

    expect(screen.getByText(TALK_STRINGS.speakerOn)).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole("button", { name: control(TALK_STRINGS.speaker, TALK_STRINGS.speakerOn) }),
    );

    expect(screen.getByText(TALK_STRINGS.speakerOff)).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: control(TALK_STRINGS.speaker, TALK_STRINGS.speakerOff) }),
    ).toBeOnTheScreen();
  });

  it("keeps the End Call label in text and leaves the screen (Req 9.3, 9.5)", () => {
    const router = openApp(ROUTE_PATH["voice-call"]);

    expect(screen.getByText(TALK_STRINGS.endCall)).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: TALK_STRINGS.endCall }));

    expect(router.getPathname()).toBe(ROUTE_PATH.home);
  });

  it("opens /settings from the header gear (Req 9.1)", () => {
    const router = openApp(ROUTE_PATH["voice-call"]);

    fireEvent.press(screen.getByRole("button", { name: TALK_STRINGS.settings }));

    expect(router.getPathname()).toBe(ROUTE_PATH.settings);
  });
});
