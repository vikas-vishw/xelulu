// Navigation shell tests (Req 11.2, 11.3, 11.5, 4.2–4.8, 6.4–6.6; Phase 2.2 Req 26.3, 26.16).
// Example-based only (C16). Properties 6 (exactly one tab is selected), 7 (every route opens
// with its title, and the splash leaves for Home once) and 10 (Home controls reach their
// routes), over the real `app` directory.

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act } from "@testing-library/react-native";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { GROW_STRINGS } from "../src/features/grow/strings";
import { ROUTE_PATH, STACK_KEYS, TAB_KEYS, type ShellRouteKey } from "../src/features/shell/routes";
import { SPLASH_DELAY_MS } from "../src/features/shell/splash-screen";
import { SCREEN_HEADER_NAME, SHELL_STRINGS, TAB_LABEL } from "../src/features/shell/strings";
import { SETTINGS_ROWS, SETTINGS_STRINGS } from "../src/features/settings/strings";
import { MOCK_IDENTITY } from "../src/lib/mock-identity";

/** The real route tree, as an absolute path so the test does not depend on the Jest cwd. */
const APP_DIR = join(__dirname, "..", "app");

/** Fixed metrics so the Tab_Bar's safe-area inset resolves without a measured window. */
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

const ALL_KEYS: readonly ShellRouteKey[] = [...TAB_KEYS, ...STACK_KEYS];

/** The four Setup_Flow routes, the ones opened by deep link in the back-control case. */
const SETUP_KEYS = ["onboarding", "auth", "pair-device", "child-profile"] as const;

/** The five Settings rows that open a route, read off the row table itself. */
const SETTINGS_ROUTE_ROWS = SETTINGS_ROWS.flatMap((row) =>
  row.route === undefined ? [] : [[row.title, ROUTE_PATH[row.route]] as const],
);

/** The four that open nothing, from the same table: a row has a route or it has none. */
const SETTINGS_INERT_ROWS = SETTINGS_ROWS.flatMap((row) =>
  row.route === undefined ? [[row.title] as const] : [],
);

const TAB_LABELS: ReadonlySet<string> = new Set(TAB_KEYS.map((k) => TAB_LABEL[k]));

/** The part of a rendered role node these helpers read. Naming it keeps the filter cast-free. */
type RoleNode = Readonly<{
  props: Readonly<{ accessibilityLabel?: unknown; accessibilityState?: { selected?: boolean } }>;
}>;

const isSelected = (t: RoleNode): boolean => t.props.accessibilityState?.selected === true;

/** Tab_Bar tabs only: `SegmentedTabs` options share the `tab` role. No segment label in this
 *  phase collides with a tab label, so the filter is exact — keep it that way. */
const tabBarTabs = (): RoleNode[] =>
  screen.queryAllByRole("tab").filter((t) => TAB_LABELS.has(String(t.props.accessibilityLabel)));

// Property 7: the splash leaves for Home once, and never after unmount (Req 4.2, 4.3).
describe("the splash screen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders at / and has not navigated yet (Req 4.1)", () => {
    const router = openApp("/");

    expect(screen.getByRole("header", { name: SHELL_STRINGS.wordmark })).toBeOnTheScreen();
    expect(screen.getByText(SHELL_STRINGS.footer)).toBeOnTheScreen();
    expect(router.getPathname()).toBe("/");
  });

  it("replaces / with /home once the delay elapses (Req 4.2)", () => {
    const router = openApp("/");

    act(() => {
      jest.advanceTimersByTime(SPLASH_DELAY_MS);
    });

    expect(router.getPathname()).toBe(ROUTE_PATH.home);
  });

  it("navigates nowhere when it unmounts before the delay (Req 4.3)", () => {
    const router = openApp("/");

    screen.unmount();
    act(() => {
      jest.advanceTimersByTime(SPLASH_DELAY_MS);
    });

    expect(router.getPathname()).toBe("/");
  });
});

describe("the navigation shell", () => {
  it("shows 5 tabs in the Reference's order with Home selected (Req 4.3, 4.4)", () => {
    openApp(ROUTE_PATH.home);

    const tabs = tabBarTabs();
    expect(tabs.map((tab) => String(tab.props.accessibilityLabel))).toEqual(
      TAB_KEYS.map((key) => TAB_LABEL[key]),
    );
    expect(tabs.filter(isSelected)).toHaveLength(1);
    expect(screen.getByRole("tab", { name: TAB_LABEL.home })).toBeSelected();
  });

  it("opens the Play tab with its title and selected state when Play is pressed (Req 4.5)", () => {
    const router = openApp(ROUTE_PATH.home);

    fireEvent.press(screen.getByRole("tab", { name: TAB_LABEL.play }));

    expect(router.getPathname()).toBe(ROUTE_PATH.play);
    expect(screen.getByRole("header", { name: SCREEN_HEADER_NAME.play })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: TAB_LABEL.play })).toBeSelected();
    expect(tabBarTabs().filter(isSelected)).toHaveLength(1);
  });

  // Property 6: every route in TAB_KEYS and STACK_KEYS renders its Built_Screen under its own
  // header name, with the Tab_Bar only on a Tab_Route. No route renders a placeholder: the
  // Placeholder_Screen and its line are gone (Req 1.6, 26.2, 26.13).
  it.each(ALL_KEYS)("opens %s with its title and the right chrome (Req 4.1, 4.6, 4.8)", (key) => {
    const router = openApp(ROUTE_PATH[key]);

    expect(router.getPathname()).toBe(ROUTE_PATH[key]);
    const isTab = (TAB_KEYS as readonly string[]).includes(key);
    expect(tabBarTabs()).toHaveLength(isTab ? TAB_KEYS.length : 0);

    if (key === "home") {
      // Home shows the greeting as its header instead of the route title.
      expect(screen.getAllByRole("header").length).toBeGreaterThan(0);
    } else {
      // `SCREEN_HEADER_NAME`, not `ROUTE_TITLE`: five screens draw a heading of their own.
      expect(screen.getByRole("header", { name: SCREEN_HEADER_NAME[key] })).toBeOnTheScreen();
    }
  });

  it.each(SETUP_KEYS)("%s sends back to /home from a deep link (Req 3.5)", (key) => {
    const router = openApp(ROUTE_PATH[key]);

    fireEvent.press(screen.getByRole("button", { name: "Back" }));

    expect(router.getPathname()).toBe(ROUTE_PATH.home);
  });

  it("opens /child-profile from a Family child card (Req 15.6)", () => {
    const router = openApp(ROUTE_PATH.family);

    fireEvent.press(screen.getByRole("button", { name: MOCK_IDENTITY.child }));

    expect(router.getPathname()).toBe(ROUTE_PATH["child-profile"]);
  });

  it("opens /reports from Grow's reports row (Req 11.5)", () => {
    const router = openApp(ROUTE_PATH.grow);

    fireEvent.press(screen.getByRole("button", { name: GROW_STRINGS.reportsRow.title }));

    expect(router.getPathname()).toBe(ROUTE_PATH.reports);
  });

  it("opens /grandma-mode from Family's Grandma row (Req 15.5)", () => {
    const router = openApp(ROUTE_PATH.family);

    fireEvent.press(screen.getByRole("button", { name: MOCK_IDENTITY.grandparent }));

    expect(router.getPathname()).toBe(ROUTE_PATH["grandma-mode"]);
  });

  // Req 18.5: each of the five route rows opens its own route; the other four open nothing.
  it.each(SETTINGS_ROUTE_ROWS)("opens %s from the Settings list", (title, path) => {
    const router = openApp(ROUTE_PATH.settings);

    fireEvent.press(screen.getByRole("button", { name: title }));

    expect(router.getPathname()).toBe(path);
  });

  // The other half of Req 18.5, which the sentence above only claimed: an inert row is no
  // button at all, and it says so in its trailing text (D20).
  it.each(SETTINGS_INERT_ROWS)("leaves %s inert in the Settings list", (title) => {
    const router = openApp(ROUTE_PATH.settings);

    expect(screen.queryByRole("button", { name: title })).toBeNull();
    expect(screen.getByText(title)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(ROUTE_PATH.settings);
  });

  it("marks every inert Settings row as a later phase", () => {
    openApp(ROUTE_PATH.settings);

    expect(screen.getAllByText(SETTINGS_STRINGS.laterPhase)).toHaveLength(
      SETTINGS_INERT_ROWS.length,
    );
  });

  it("sends back to /home from a Stack_Route opened directly (Req 4.7)", () => {
    const router = openApp(ROUTE_PATH.privacy);
    expect(router.getPathname()).toBe(ROUTE_PATH.privacy);

    fireEvent.press(screen.getByRole("button", { name: "Back" }));

    expect(router.getPathname()).toBe(ROUTE_PATH.home);
  });
});

// Property 10: each Home control reaches its route (Req 6.4–6.6).
describe("Home controls", () => {
  const CASES: [string, string][] = [
    ["Xelulu, Online, Battery 78%. Open device", ROUTE_PATH.device],
    ["Play", ROUTE_PATH.play],
    ["Routines", ROUTE_PATH.routines],
    ["Voice Call", ROUTE_PATH["voice-call"]],
  ];

  it.each(CASES)("pressing %s opens %s", (name, path) => {
    const router = openApp(ROUTE_PATH.home);

    fireEvent.press(screen.getByRole("button", { name }));

    expect(router.getPathname()).toBe(path);
  });

  it.each([0, 1])("pressing settings control %i opens /settings", (index) => {
    const router = openApp(ROUTE_PATH.home);

    const controls = screen.getAllByRole("button", { name: "Settings" });
    expect(controls).toHaveLength(2);
    const control = controls[index];
    expect(control).toBeDefined();
    if (control !== undefined) fireEvent.press(control);

    expect(router.getPathname()).toBe(ROUTE_PATH.settings);
  });
});
