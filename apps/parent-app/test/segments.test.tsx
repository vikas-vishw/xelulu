// The segmented screens of Phase 2.2: screens 8 Play, 9 Grow and 15 Reports, screen 12 Family,
// screen 14 Privacy & Memory and screen 16a Notifications (Req 26.7, 26.8). Smoke and
// key-interaction only, example-based, no fast-check (Req 26.1).
//
// Property 10: a segmented control filters or swaps. Property 4: state is never colour alone.
//
// Every "exactly one option selected" assertion is scoped inside the screen's own `tablist`:
// the Tab_Bar's selected tab carries the same `tab` role, so a whole-screen count is false on
// `/play` and `/grow`.

import { describe, expect, it } from "@jest/globals";
import { within } from "@testing-library/react-native";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { join } from "node:path";
import type { ReactNode } from "react";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { memberCardTestId } from "../src/features/family/family-screen";
import { MOCK_FAMILY, type FamilyMember } from "../src/features/family/mock-family";
import { childLine, FAMILY_STRINGS } from "../src/features/family/strings";
import { GROW_STRINGS } from "../src/features/grow/strings";
import { PlayScreen } from "../src/features/play/play-screen";
import { PLAY_STRINGS } from "../src/features/play/strings";
import { MOCK_NOTIFICATIONS } from "../src/features/notifications/mock-notifications";
import { NotificationsScreen } from "../src/features/notifications/notifications-screen";
import { NOTIFICATION_STRINGS } from "../src/features/notifications/strings";
import { MOCK_PRIVACY } from "../src/features/privacy/mock-privacy";
import { PRIVACY_STRINGS } from "../src/features/privacy/strings";
import { MOCK_REPORTS } from "../src/features/reports/mock-reports";
import { REPORTS_STRINGS } from "../src/features/reports/strings";
import { SEGMENT_STATE } from "../src/components/segmented-tabs";
import { ROUTE_PATH } from "../src/features/shell/routes";
import { MOCK_IDENTITY } from "../src/lib/mock-identity";

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

/**
 * One selected option inside the screen's own segmented control, never two, and that option is
 * the only filled one (Phase 2 cleanup, fix 1).
 *
 * The scope is resolved by the feature's `segmentsLabel`, which is the `tablist` container's
 * accessibility label. It is resolved with `getByLabelText` rather than
 * `getByRole("tablist", { name })`, because RNTL's role query matches only elements whose
 * `accessible` prop is set, and `segmented-tabs.tsx` deliberately leaves the container's unset
 * so each option stays an accessibility element of its own. The scoping intent is identical
 * either way: the Tab_Bar's selected tab shares the `tab` role, so a whole-screen count would
 * be false on `/play` and `/grow`.
 */
function expectOneSelectedSegment(segmentsLabel: string): void {
  const list = within(screen.getByLabelText(segmentsLabel, { exact: true }));
  const selected = list.getAllByRole("tab", { selected: true });
  expect(selected).toHaveLength(1);

  const fill = `bg-${SEGMENT_STATE.selected.bgToken}`;
  const filled = list
    .getAllByRole("tab")
    .filter((option) => String(option.props.className).includes(fill));
  expect(filled).toHaveLength(1);
  expect(filled[0]).toBe(selected[0]);
}

const pressSegment = (label: string): void => {
  fireEvent.press(screen.getByRole("tab", { name: label }));
};

describe("screen 8, Play & Adventure", () => {
  const ITEMS = PLAY_STRINGS.items;

  it("shows the Reference's four cards under All (Req 10.1, 10.2)", () => {
    openApp(ROUTE_PATH.play);

    expect(screen.getByRole("header", { name: "Play with Xelulu" })).toBeOnTheScreen();
    for (const item of [ITEMS.animalAdventure, ITEMS.treasureHunt, ITEMS.dance, ITEMS.storyTime]) {
      expect(screen.getByText(item.title)).toBeOnTheScreen();
      expect(screen.getByText(item.subtitle)).toBeOnTheScreen();
    }
    expectOneSelectedSegment(PLAY_STRINGS.segmentsLabel);
  });

  // Property 10: selecting a segment filters the list to that category.
  it.each([
    [PLAY_STRINGS.segments.games, ITEMS.animalAdventure.title, ITEMS.storyTime.title],
    [PLAY_STRINGS.segments.stories, ITEMS.storyTime.title, ITEMS.animalAdventure.title],
    [PLAY_STRINGS.segments.learning, ITEMS.countingFun.title, ITEMS.animalAdventure.title],
  ])("shows only the %s cards (Req 10.3)", (segment, shown, hidden) => {
    openApp(ROUTE_PATH.play);

    pressSegment(segment);

    expect(screen.getByText(shown)).toBeOnTheScreen();
    expect(screen.queryByText(hidden)).toBeNull();
    expectOneSelectedSegment(PLAY_STRINGS.segmentsLabel);
  });

  it("shows every card again under All (Req 10.3)", () => {
    openApp(ROUTE_PATH.play);

    pressSegment(PLAY_STRINGS.segments.stories);
    pressSegment(PLAY_STRINGS.segments.all);

    expect(screen.getByText(ITEMS.animalAdventure.title)).toBeOnTheScreen();
    expect(screen.getByText(ITEMS.countingFun.title)).toBeOnTheScreen();
  });

  it("shows the later-phase line on a card press, and navigates nowhere (Req 10.5)", () => {
    const router = openApp(ROUTE_PATH.play);

    expect(screen.queryByText(PLAY_STRINGS.startsFromRobot)).toBeNull();

    fireEvent.press(
      screen.getByRole("button", {
        name: `${ITEMS.animalAdventure.title}, ${ITEMS.animalAdventure.subtitle}`,
      }),
    );

    expect(screen.getByText(PLAY_STRINGS.startsFromRobot)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(ROUTE_PATH.play);
  });

  it("shows the empty line when the injected module holds no card (Req 10.4)", () => {
    renderRouter(
      { play: () => <PlayScreen data={{ items: [] }} /> },
      { initialUrl: ROUTE_PATH.play, wrapper: Wrapper },
    );

    expect(screen.getByText(PLAY_STRINGS.nothingHere)).toBeOnTheScreen();
  });
});

describe("screen 9, Grow / Learning Insights", () => {
  const METRIC = GROW_STRINGS.metrics;

  it("shows the Overview panel and the current interests (Req 11.1, 11.2)", () => {
    openApp(ROUTE_PATH.grow);

    expect(screen.getByRole("header", { name: "Growing Together" })).toBeOnTheScreen();
    expect(screen.getByText(GROW_STRINGS.subheader)).toBeOnTheScreen();
    for (const metric of [METRIC.language, METRIC.reading, METRIC.curiosity, METRIC.physicalPlay]) {
      expect(
        screen.getByLabelText(`${metric.value} ${metric.title}`, { exact: true }),
      ).toBeOnTheScreen();
    }
    expect(screen.getByRole("header", { name: GROW_STRINGS.currentInterests })).toBeOnTheScreen();
    expect(screen.getByText(GROW_STRINGS.interests.dinosaurs.label)).toBeOnTheScreen();
    expectOneSelectedSegment(GROW_STRINGS.segmentsLabel);
  });

  // Property 10: selecting a segment swaps the panel.
  it("swaps to the Interests panel with its detail lines (Req 11.3, 11.4)", () => {
    openApp(ROUTE_PATH.grow);

    pressSegment(GROW_STRINGS.segments.interests);

    expect(screen.getByText(GROW_STRINGS.interests.dinosaurs.detail)).toBeOnTheScreen();
    expect(screen.queryByText(METRIC.language.subtitle)).toBeNull();
    expectOneSelectedSegment(GROW_STRINGS.segmentsLabel);
  });

  it("swaps to the Milestones panel with its times (Req 11.3, 11.4)", () => {
    openApp(ROUTE_PATH.grow);

    pressSegment(GROW_STRINGS.segments.milestones);

    expect(screen.getByText(GROW_STRINGS.milestones.firstSentence.title)).toBeOnTheScreen();
    expect(screen.getByText(GROW_STRINGS.milestones.firstSentence.timeLabel)).toBeOnTheScreen();
    expect(screen.queryByText(GROW_STRINGS.interests.dinosaurs.detail)).toBeNull();
    expectOneSelectedSegment(GROW_STRINGS.segmentsLabel);
  });

  it("keeps the reports row on every segment (Req 11.5)", () => {
    openApp(ROUTE_PATH.grow);

    for (const segment of [
      GROW_STRINGS.segments.interests,
      GROW_STRINGS.segments.milestones,
      GROW_STRINGS.segments.overview,
    ]) {
      pressSegment(segment);
      expect(screen.getByRole("button", { name: GROW_STRINGS.reportsRow.title })).toBeOnTheScreen();
    }
  });
});

describe("screen 15, Reports", () => {
  const tileLabel = (index: number, period: "week" | "month"): string => {
    const tile = MOCK_REPORTS[period].tiles[index];
    if (tile === undefined) throw new Error(`no mock tile at index ${index}`);
    return `${tile.value} ${tile.label}`;
  };

  it("shows the week values and the purpose note (Req 12.1, 12.3)", () => {
    openApp(ROUTE_PATH.reports);

    expect(screen.getByRole("header", { name: "This Week with Xelulu" })).toBeOnTheScreen();
    expect(screen.getByText(REPORTS_STRINGS.subheader)).toBeOnTheScreen();
    for (let index = 0; index < MOCK_REPORTS.week.tiles.length; index += 1) {
      expect(screen.getByLabelText(tileLabel(index, "week"), { exact: true })).toBeOnTheScreen();
    }
    expect(
      screen.getByText(REPORTS_STRINGS.interestsHeading(MOCK_IDENTITY.child)),
    ).toBeOnTheScreen();
    expect(screen.getByText(MOCK_REPORTS.week.interests_label)).toBeOnTheScreen();
    expect(screen.getByText(REPORTS_STRINGS.purposeNote)).toBeOnTheScreen();
    expectOneSelectedSegment(REPORTS_STRINGS.segmentsLabel);
  });

  // Property 10: the segment swaps the Mock_Module behind all four tiles.
  it("swaps all four numbers between Month and Week (Req 12.2)", () => {
    openApp(ROUTE_PATH.reports);

    pressSegment(REPORTS_STRINGS.segments.month);

    for (let index = 0; index < MOCK_REPORTS.month.tiles.length; index += 1) {
      expect(screen.getByLabelText(tileLabel(index, "month"), { exact: true })).toBeOnTheScreen();
      expect(screen.queryByLabelText(tileLabel(index, "week"), { exact: true })).toBeNull();
    }
    expectOneSelectedSegment(REPORTS_STRINGS.segmentsLabel);

    pressSegment(REPORTS_STRINGS.segments.week);

    expect(screen.getByLabelText(tileLabel(0, "week"), { exact: true })).toBeOnTheScreen();
  });
});

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
