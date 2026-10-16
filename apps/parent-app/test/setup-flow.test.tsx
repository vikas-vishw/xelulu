// The Setup_Flow screens: 2 Onboarding, 3 Parent Account, 4 Pair Xelulu and 5 Child Profile
// (Req 26.4-26.6). Smoke and key-interaction only, example-based, no fast-check (Req 26.1).
//
// Property 8: the Setup_Flow chain reaches Home. Property 11: a local change touches exactly
// one row.

import { describe, expect, it } from "@jest/globals";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { Dimensions } from "react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { ChildProfileScreen } from "../src/features/setup/child-profile-screen";
import { MOCK_CHILD_DRAFT, MOCK_PAIR_STEPS } from "../src/features/setup/mock-setup";
import { CAROUSEL_TEST_ID } from "../src/features/setup/onboarding-screen";
import { SETUP_STRINGS } from "../src/features/setup/strings";
import { ROUTE_PATH } from "../src/features/shell/routes";
import { tokens } from "../src/theme/theme";

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

const ONBOARDING = SETUP_STRINGS.onboarding;
const ACCOUNT = SETUP_STRINGS.account;
const PAIR = SETUP_STRINGS.pair;
const CHILD = SETUP_STRINGS.childProfile;

/** 12 October 2026, so the mock's 15 March 2020 is six completed years: `explorer`. */
const FIXED_NOW = (): Date => new Date(2026, 9, 12);

/** Screen 5 with an injected clock, mounted at its own path so the router is real. */
function openChildProfile(): { getPathname: () => string } {
  return renderRouter(
    {
      home: () => null,
      "child-profile": () => <ChildProfileScreen now={FIXED_NOW} />,
    },
    { initialUrl: ROUTE_PATH["child-profile"], wrapper: Wrapper },
  );
}

const pressButton = (name: string): void => {
  fireEvent.press(screen.getByRole("button", { name }));
};

describe("screen 2, Onboarding", () => {
  it("mounts all three value pages (Req 5.1, 5.2)", () => {
    openApp(ROUTE_PATH.onboarding);

    expect(screen.getByText(ONBOARDING.heading)).toBeOnTheScreen();
    expect(screen.getByText(ONBOARDING.values.plays)).toBeOnTheScreen();
    expect(screen.getByText(ONBOARDING.values.talks)).toBeOnTheScreen();
    expect(screen.getByText(ONBOARDING.values.teaches)).toBeOnTheScreen();
  });

  it("marks the pressed dot current (Req 5.3)", () => {
    openApp(ROUTE_PATH.onboarding);

    expect(screen.getByRole("tab", { name: "Page 1 of 3" })).toBeSelected();

    fireEvent.press(screen.getByRole("tab", { name: "Page 3 of 3" }));

    expect(screen.getByRole("tab", { name: "Page 3 of 3" })).toBeSelected();
    expect(screen.getByRole("tab", { name: "Page 1 of 3" })).not.toBeSelected();
  });

  it("marks the paged-to dot current when the carousel settles (Req 5.3)", () => {
    openApp(ROUTE_PATH.onboarding);
    const carousel = screen.getByTestId(CAROUSEL_TEST_ID);
    // The same number the screen derives: the window less the Screen's horizontal padding.
    const pageWidth = Dimensions.get("window").width - 2 * (tokens.spacing["5"] ?? 0);

    fireEvent(carousel, "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: pageWidth * 2, y: 0 } },
    });

    expect(screen.getByRole("tab", { name: "Page 3 of 3" })).toBeSelected();
  });

  it("opens /auth from Get Started (Req 5.4)", () => {
    const router = openApp(ROUTE_PATH.onboarding);

    pressButton(ONBOARDING.getStarted);

    expect(router.getPathname()).toBe(ROUTE_PATH.auth);
  });
});

describe("screen 3, Parent Account", () => {
  const fillAll = (): void => {
    fireEvent.changeText(screen.getByLabelText(ACCOUNT.parentName), "Mom");
    fireEvent.changeText(screen.getByLabelText(ACCOUNT.emailAddress), "mom@example.test");
    fireEvent.changeText(screen.getByLabelText(ACCOUNT.password), "hunter-two");
  };

  it("disables Create Account and asks for the missing details while a field is blank (Req 6.3)", () => {
    openApp(ROUTE_PATH.auth);

    expect(screen.getByText(ACCOUNT.fillAllFields)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ACCOUNT.createAccount })).toBeDisabled();
  });

  it("enables Create Account and drops the notice once all three fields hold text (Req 6.5)", () => {
    openApp(ROUTE_PATH.auth);

    fillAll();

    expect(screen.queryByText(ACCOUNT.fillAllFields)).toBeNull();
    expect(screen.getByRole("button", { name: ACCOUNT.createAccount })).toBeEnabled();
  });

  it("opens /pair-device from Create Account (Req 6.4)", () => {
    const router = openApp(ROUTE_PATH.auth);

    fillAll();
    pressButton(ACCOUNT.createAccount);

    expect(router.getPathname()).toBe(ROUTE_PATH["pair-device"]);
  });

  // Req 6.5: one notice slot, with the provider line taking precedence until a field changes.
  it.each([ACCOUNT.google, ACCOUNT.apple])(
    "shows only the %s not-available line, and navigates nowhere",
    (provider) => {
      const router = openApp(ROUTE_PATH.auth);

      pressButton(ACCOUNT.providerA11y(provider));

      expect(screen.getByText(ACCOUNT.providerUnavailable(provider))).toBeOnTheScreen();
      expect(screen.queryByText(ACCOUNT.fillAllFields)).toBeNull();
      expect(router.getPathname()).toBe(ROUTE_PATH.auth);
    },
  );

  it("brings the fill-in line back when a field changes after a provider press (Req 6.5)", () => {
    openApp(ROUTE_PATH.auth);

    pressButton(ACCOUNT.providerA11y(ACCOUNT.google));
    fireEvent.changeText(screen.getByLabelText(ACCOUNT.parentName), "Mom");

    expect(screen.queryByText(ACCOUNT.providerUnavailable(ACCOUNT.google))).toBeNull();
    expect(screen.getByText(ACCOUNT.fillAllFields)).toBeOnTheScreen();
  });

  it("shows the static terms lines with no control (Req 6.7)", () => {
    openApp(ROUTE_PATH.auth);

    for (const line of ACCOUNT.terms) {
      expect(screen.getByText(line)).toBeOnTheScreen();
      expect(screen.queryByRole("link", { name: line })).toBeNull();
      expect(screen.queryByRole("button", { name: line })).toBeNull();
    }
  });
});

describe("screen 4, Pair Xelulu", () => {
  const stateLabel = (title: string, state: string): string => `${title}, ${state}`;

  it("starts with step 1 done and step 2 current (Req 7.2)", () => {
    openApp(ROUTE_PATH["pair-device"]);

    expect(screen.getByLabelText(stateLabel(PAIR.steps.power, "done"))).toBeOnTheScreen();
    expect(
      screen.getByLabelText(stateLabel(PAIR.steps.bluetooth, "current step")),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(stateLabel(PAIR.steps.complete, "not started"))).toBeOnTheScreen();
  });

  it("advances one step per press (Req 7.3)", () => {
    openApp(ROUTE_PATH["pair-device"]);

    pressButton(PAIR.startPairing);

    expect(screen.getByLabelText(stateLabel(PAIR.steps.bluetooth, "done"))).toBeOnTheScreen();
    expect(screen.getByLabelText(stateLabel(PAIR.steps.wifi, "current step"))).toBeOnTheScreen();
  });

  it("opens /child-profile from the last step (Req 7.4)", () => {
    const router = openApp(ROUTE_PATH["pair-device"]);

    // Step 2 is current, so two presses reach the last step and the third leaves.
    for (let press = 0; press < MOCK_PAIR_STEPS.length - 1; press += 1) {
      pressButton(PAIR.startPairing);
    }

    expect(router.getPathname()).toBe(ROUTE_PATH["child-profile"]);
  });
});

describe("screen 5, Child Profile", () => {
  it("shows the mock draft and the derived age stage (Req 8.1, 8.6)", () => {
    openChildProfile();

    expect(screen.getByText(CHILD.heading)).toBeOnTheScreen();
    expect(screen.getByLabelText(CHILD.childName).props.value).toBe(MOCK_CHILD_DRAFT.display_name);
    expect(screen.getByLabelText(CHILD.dateOfBirth).props.value).toBe(
      MOCK_CHILD_DRAFT.date_of_birth,
    );
    expect(screen.getByText(CHILD.ageStageLine("explorer"))).toBeOnTheScreen();
  });

  it("asks for YYYY-MM-DD and disables Continue on an unusable date (Req 8.7, 8.10)", () => {
    openChildProfile();

    fireEvent.changeText(screen.getByLabelText(CHILD.dateOfBirth), "2020-13-01");

    expect(screen.getByText(CHILD.dobFormat)).toBeOnTheScreen();
    expect(screen.queryByText(CHILD.ageStageLine("explorer"))).toBeNull();
    expect(screen.getByRole("button", { name: CHILD.continueLabel })).toBeDisabled();
  });

  it("disables Continue while the name is blank (Req 8.10)", () => {
    openChildProfile();

    fireEvent.changeText(screen.getByLabelText(CHILD.childName), "   ");

    expect(screen.getByRole("button", { name: CHILD.continueLabel })).toBeDisabled();
  });

  it("selects exactly one gender chip (Req 8.3)", () => {
    openChildProfile();
    const [boy, girl] = CHILD.genderOptions;

    expect(screen.getByRole("button", { name: boy })).toBeSelected();

    fireEvent.press(screen.getByRole("button", { name: girl }));

    expect(screen.getByRole("button", { name: girl })).toBeSelected();
    expect(screen.getByRole("button", { name: boy })).not.toBeSelected();
  });

  // Property 11: adding or removing a chip touches that chip's row and nothing else.
  it("appends a language chip and leaves the interests alone (Req 8.4)", () => {
    openChildProfile();

    fireEvent.press(screen.getByRole("button", { name: CHILD.addChip }));
    fireEvent.changeText(screen.getByLabelText(CHILD.newLanguage), "Tamil");
    fireEvent.press(screen.getByRole("button", { name: CHILD.confirmAddLanguage }));

    expect(screen.getByRole("button", { name: "Remove Tamil" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Remove Animals" })).toBeOnTheScreen();
    expect(screen.queryByLabelText(CHILD.newLanguage)).toBeNull();
  });

  it("keeps the confirm control disabled while the typed chip is blank (Req 8.4)", () => {
    openChildProfile();

    fireEvent.press(screen.getByRole("button", { name: CHILD.addMoreChip }));

    expect(screen.getByRole("button", { name: CHILD.confirmAddInterest })).toBeDisabled();
  });

  it("removes the chip whose remove control is pressed, and moves the filled language", () => {
    openChildProfile();
    const primary = MOCK_CHILD_DRAFT.primary_language;
    const second = MOCK_CHILD_DRAFT.language_labels.filter((label) => label !== primary).join("");

    fireEvent.press(screen.getByRole("button", { name: `Remove ${primary}` }));

    expect(screen.queryByRole("button", { name: `Remove ${primary}` })).toBeNull();
    expect(screen.getByRole("button", { name: `Remove ${second}` })).toBeSelected();
  });

  it("says a photo cannot be added, and opens nothing (Req 8.2)", () => {
    openChildProfile();

    fireEvent.press(screen.getByRole("button", { name: CHILD.addPhotoA11y }));

    expect(screen.getByText(CHILD.photoUnavailable)).toBeOnTheScreen();
  });

  it("opens /home from Continue (Req 8.11)", () => {
    const router = openChildProfile();

    pressButton(CHILD.continueLabel);

    expect(router.getPathname()).toBe(ROUTE_PATH.home);
  });
});

// Property 8: the Setup_Flow chain reaches Home.
describe("the Setup_Flow chain", () => {
  it("walks /onboarding to /auth to /pair-device to /child-profile to /home", () => {
    const router = openApp(ROUTE_PATH.onboarding);

    pressButton(ONBOARDING.getStarted);
    expect(router.getPathname()).toBe(ROUTE_PATH.auth);

    fireEvent.changeText(screen.getByLabelText(ACCOUNT.parentName), "Mom");
    fireEvent.changeText(screen.getByLabelText(ACCOUNT.emailAddress), "mom@example.test");
    fireEvent.changeText(screen.getByLabelText(ACCOUNT.password), "hunter-two");
    pressButton(ACCOUNT.createAccount);
    expect(router.getPathname()).toBe(ROUTE_PATH["pair-device"]);

    for (let press = 0; press < MOCK_PAIR_STEPS.length - 1; press += 1) {
      pressButton(PAIR.startPairing);
    }
    expect(router.getPathname()).toBe(ROUTE_PATH["child-profile"]);

    pressButton(CHILD.continueLabel);
    expect(router.getPathname()).toBe(ROUTE_PATH.home);
  });
});
