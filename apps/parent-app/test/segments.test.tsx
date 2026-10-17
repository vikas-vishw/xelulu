// The segmented screens that still run on a Mock_Module: screen 12 Family, screen 14 Privacy &
// Memory and screen 16a Notifications (Req 26.7, 26.8). Smoke and key-interaction only,
// example-based, no fast-check (Req 26.1).
//
// Screens 8 Play, 9 Grow and 15 Reports moved to `play-screen.test.tsx`, `grow-screen.test.tsx`
// and `reports-screen.test.tsx` with Phase 4: they run on an In_App_Store now, and each suite
// injects one.
//
// Property 10: a segmented control filters or swaps. Property 4: state is never colour alone.
//
// Every "exactly one option selected" assertion is scoped inside the screen's own `tablist`
// through the shared `expectOneSelectedSegment` helper: the Tab_Bar's selected tab carries the
// same `tab` role, so a whole-screen count is false on `/play` and `/grow`.

import { describe, expect, it } from "@jest/globals";
import { within } from "@testing-library/react-native";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { memberCardTestId } from "../src/features/family/family-screen";
import { MOCK_FAMILY, type FamilyMember } from "../src/features/family/mock-family";
import { childLine, FAMILY_STRINGS } from "../src/features/family/strings";
import { MOCK_NOTIFICATIONS } from "../src/features/notifications/mock-notifications";
import { NotificationsScreen } from "../src/features/notifications/notifications-screen";
import { NOTIFICATION_STRINGS } from "../src/features/notifications/strings";
import { MOCK_PRIVACY } from "../src/features/privacy/mock-privacy";
import { PRIVACY_STRINGS } from "../src/features/privacy/strings";
import { ROUTE_PATH } from "../src/features/shell/routes";

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

describe("screen 12, Family", () => {
  /** The mock member at `index`, so the assertions name Dad and Meera, not array slots. */
  function caregiver(index: number): FamilyMember {
    const member = MOCK_FAMILY.caregivers[index];
    if (member === undefined) throw new Error(`no mock caregiver at index ${index}`);
    return member;
  }

  const grandma = (): FamilyMember => {
    const member = MOCK_FAMILY.grandparents[0];
    if (member === undefined) throw new Error("no mock grandparent");
    return member;
  };

  it("shows the Children panel as the Reference draws it (Req 15.1, 15.2)", () => {
    openApp(ROUTE_PATH.family);

    expect(screen.getByRole("header", { name: "Our Family" })).toBeOnTheScreen();
    expect(screen.getByText(FAMILY_STRINGS.subheader)).toBeOnTheScreen();
    for (const child of MOCK_FAMILY.children) {
      expect(screen.getByRole("button", { name: child.display_name })).toBeOnTheScreen();
      expect(screen.getByText(childLine(child.age_label, child.languages_label))).toBeOnTheScreen();
    }
    expect(screen.getByRole("button", { name: FAMILY_STRINGS.addChild })).toBeOnTheScreen();
    expect(
      screen.getByRole("header", { name: FAMILY_STRINGS.grandparentsAndCaregivers }),
    ).toBeOnTheScreen();
    expect(screen.getByText(grandma().display_name)).toBeOnTheScreen();
    expect(screen.getByText(FAMILY_STRINGS.roles.storyteller)).toBeOnTheScreen();
    expect(screen.getByText(caregiver(0).display_name)).toBeOnTheScreen();
    expect(screen.getByText(FAMILY_STRINGS.roles.parent)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: FAMILY_STRINGS.inviteCaregiver })).toBeOnTheScreen();

    // The Dad row leads nowhere in this phase (D24b); the Grandma row opens `/grandma-mode`,
    // which `navigation.test.tsx` follows (Req 15.5).
    expect(screen.queryByRole("button", { name: caregiver(0).display_name })).toBeNull();
    expect(screen.getByRole("button", { name: grandma().display_name })).toBeOnTheScreen();
    expectOneSelectedSegment(FAMILY_STRINGS.segmentsLabel);
  });

  // Property 10: the segment swaps the panel. Req 15.3: each card carries its own line.
  it("gives every member its own permission line on the Caregivers panel (Req 15.3)", () => {
    openApp(ROUTE_PATH.family);

    pressSegment(FAMILY_STRINGS.segments.caregivers);

    for (const member of MOCK_FAMILY.caregivers) {
      const card = within(screen.getByTestId(memberCardTestId(member.user_id)));
      expect(card.getByText(member.display_name)).toBeOnTheScreen();
      expect(card.getByText(member.role_label)).toBeOnTheScreen();
      expect(card.getByText(member.permission_line)).toBeOnTheScreen();
    }
    expect(caregiver(0).permission_line).not.toBe(caregiver(1).permission_line);
    expectOneSelectedSegment(FAMILY_STRINGS.segmentsLabel);
  });

  it("swaps to the Grandparents panel with its note (Req 15.4)", () => {
    openApp(ROUTE_PATH.family);

    pressSegment(FAMILY_STRINGS.segments.grandparents);

    expect(screen.getByText(grandma().display_name)).toBeOnTheScreen();
    expect(screen.getByText(FAMILY_STRINGS.roles.storyteller)).toBeOnTheScreen();
    expect(screen.getByText(grandma().permission_line)).toBeOnTheScreen();
    expect(screen.queryByText(FAMILY_STRINGS.roles.parent)).toBeNull();
    expectOneSelectedSegment(FAMILY_STRINGS.segmentsLabel);
  });

  it("appends a typed child card locally (Req 15.7)", () => {
    openApp(ROUTE_PATH.family);

    fireEvent.press(screen.getByRole("button", { name: FAMILY_STRINGS.addChild }));
    fireEvent.changeText(screen.getByLabelText(FAMILY_STRINGS.childName), "Kabir");
    fireEvent.press(screen.getByRole("button", { name: FAMILY_STRINGS.confirmAddChild }));

    expect(screen.getByRole("button", { name: "Kabir" })).toBeOnTheScreen();
    expect(
      screen.getByText(childLine(FAMILY_STRINGS.ageNotSet, FAMILY_STRINGS.languagesNotSet)),
    ).toBeOnTheScreen();
  });

  it("appends a typed caregiver row locally (Req 15.7)", () => {
    openApp(ROUTE_PATH.family);

    fireEvent.press(screen.getByRole("button", { name: FAMILY_STRINGS.inviteCaregiver }));
    fireEvent.changeText(screen.getByLabelText(FAMILY_STRINGS.caregiverName), "Asha");
    fireEvent.press(screen.getByRole("button", { name: FAMILY_STRINGS.confirmInvite }));

    expect(screen.getByText("Asha")).toBeOnTheScreen();
    expect(screen.getByText(FAMILY_STRINGS.roles.caregiver)).toBeOnTheScreen();
  });
});

describe("screen 14, Privacy & Memory", () => {
  /** The mock memory at `index`, so an assertion names the line and not an array slot. */
  function memoryLabel(index: number): string {
    const memory = MOCK_PRIVACY.memories[index];
    if (memory === undefined) throw new Error(`no mock memory at index ${index}`);
    return memory.label;
  }

  const consentStatement = (index: number): string => {
    const recording = MOCK_PRIVACY.recordings[index];
    if (recording === undefined) throw new Error(`no mock recording at index ${index}`);
    return recording.consent_statement;
  };

  it("shows the Memory panel as the Reference draws it (Req 17.1, 17.2)", () => {
    openApp(ROUTE_PATH.privacy);

    expect(screen.getByRole("header", { name: "Privacy & Memory" })).toBeOnTheScreen();
    expect(screen.getByText(PRIVACY_STRINGS.subheader)).toBeOnTheScreen();
    expect(screen.getByText(PRIVACY_STRINGS.remembersTitle)).toBeOnTheScreen();
    expect(
      screen.getByText(PRIVACY_STRINGS.remembersRow(MOCK_PRIVACY.memories.length)),
    ).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: PRIVACY_STRINGS.recentMemories })).toBeOnTheScreen();
    for (let index = 0; index < MOCK_PRIVACY.recent_count; index += 1) {
      expect(screen.getByText(memoryLabel(index))).toBeOnTheScreen();
    }
    expect(screen.getByRole("button", { name: PRIVACY_STRINGS.viewAll })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: PRIVACY_STRINGS.deleteOrExport })).toBeOnTheScreen();
    expectOneSelectedSegment(PRIVACY_STRINGS.segmentsLabel);
  });

  // Property 10: selecting a segment swaps the panel.
  it("swaps to the Recordings panel with its consent statements (Req 17.4)", () => {
    openApp(ROUTE_PATH.privacy);

    pressSegment(PRIVACY_STRINGS.segments.recordings);

    expect(screen.getByText(consentStatement(0))).toBeOnTheScreen();
    expect(screen.getByText(PRIVACY_STRINGS.noChildAudio)).toBeOnTheScreen();
    expect(screen.queryByText(memoryLabel(0))).toBeNull();
    expectOneSelectedSegment(PRIVACY_STRINGS.segmentsLabel);
  });

  it("swaps to the Settings panel with its toggles and its lines (Req 17.5, 17.10)", () => {
    openApp(ROUTE_PATH.privacy);

    pressSegment(PRIVACY_STRINGS.segments.settings);

    for (const row of MOCK_PRIVACY.toggles) {
      expect(screen.getByRole("switch", { name: row.title })).toBeOnTheScreen();
    }
    expect(screen.getByText(PRIVACY_STRINGS.retentionLine)).toBeOnTheScreen();
    expect(screen.getByText(PRIVACY_STRINGS.withdrawalLine)).toBeOnTheScreen();
    expect(screen.queryByText(memoryLabel(0))).toBeNull();
    expectOneSelectedSegment(PRIVACY_STRINGS.segmentsLabel);
  });

  it("keeps the delete-or-export row on every segment (Req 17.1)", () => {
    openApp(ROUTE_PATH.privacy);

    for (const segment of [
      PRIVACY_STRINGS.segments.recordings,
      PRIVACY_STRINGS.segments.settings,
      PRIVACY_STRINGS.segments.memory,
    ]) {
      pressSegment(segment);
      expect(
        screen.getByRole("button", { name: PRIVACY_STRINGS.deleteOrExport }),
      ).toBeOnTheScreen();
    }
  });
});

describe("screen 16a, Notifications", () => {
  const ROWS = NOTIFICATION_STRINGS.rows;

  it("shows the Reference's five rows under All (Req 18.1, 18.2)", () => {
    openApp(ROUTE_PATH.notifications);

    expect(screen.getByRole("header", { name: "Notifications" })).toBeOnTheScreen();
    for (const row of MOCK_NOTIFICATIONS.rows) {
      expect(screen.getByText(row.title)).toBeOnTheScreen();
      expect(screen.getByText(row.detail)).toBeOnTheScreen();
      expect(screen.getByText(row.time_label)).toBeOnTheScreen();
    }
    expectOneSelectedSegment(NOTIFICATION_STRINGS.segmentsLabel);
  });

  // Property 10: selecting a segment filters the list to that kind.
  it.each([
    [NOTIFICATION_STRINGS.segments.device, ROWS.charging.title, ROWS.playTime.title],
    [NOTIFICATION_STRINGS.segments.activity, ROWS.playTime.title, ROWS.charging.title],
  ])("shows only the %s rows (Req 18.3)", (segment, shown, hidden) => {
    openApp(ROUTE_PATH.notifications);

    pressSegment(segment);

    expect(screen.getByText(shown)).toBeOnTheScreen();
    expect(screen.queryByText(hidden)).toBeNull();
    expectOneSelectedSegment(NOTIFICATION_STRINGS.segmentsLabel);
  });

  it("shows every row again under All (Req 18.3)", () => {
    openApp(ROUTE_PATH.notifications);

    pressSegment(NOTIFICATION_STRINGS.segments.device);
    pressSegment(NOTIFICATION_STRINGS.segments.all);

    expect(screen.getByText(ROWS.charging.title)).toBeOnTheScreen();
    expect(screen.getByText(ROWS.playTime.title)).toBeOnTheScreen();
  });

  it("shows the empty line when the injected module holds no row", () => {
    renderRouter(
      { notifications: () => <NotificationsScreen data={{ rows: [] }} /> },
      { initialUrl: ROUTE_PATH.notifications, wrapper: Wrapper },
    );

    expect(screen.getByText(NOTIFICATION_STRINGS.nothingHere)).toBeOnTheScreen();
  });
});
