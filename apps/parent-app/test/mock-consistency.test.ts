// Property 16: the mock world is one world (Req 19.6, 26.1). Example-based, no fast-check.
//
// Every screen in this phase runs on a Mock_Module, and the same parent, child, second child,
// grandparent, caregiver, device and room have to appear with the same names everywhere, or the
// app reads as seven unrelated demos. `src/lib/mock-identity.ts` is the single source of those
// names; this file is what stops a screen from hard-coding one of its own.
//
// It also pins the three counts a rendered line asserts out loud: Privacy's "15 items", every
// Play segment having something to show, and `SCREEN_HEADER_NAME` covering every route that
// needs a header.

import { describe, expect, it } from "@jest/globals";

import { MOCK_DEVICE } from "../src/features/device/mock-device";
import { MOCK_FAMILY } from "../src/features/family/mock-family";
import { MOCK_HOME } from "../src/features/home/mock-home";
import { MOCK_NOTIFICATIONS } from "../src/features/notifications/mock-notifications";
import { MOCK_PLAY, type PlayCategory } from "../src/features/play/mock-play";
import { MOCK_PRIVACY } from "../src/features/privacy/mock-privacy";
import { MOCK_CHILD_DRAFT } from "../src/features/setup/mock-setup";
import { STACK_KEYS, TAB_KEYS, type ShellRouteKey } from "../src/features/shell/routes";
import { SCREEN_HEADER_NAME } from "../src/features/shell/strings";
import { MOCK_IDENTITY } from "../src/lib/mock-identity";

/** The three filterable Play categories; the "All" segment is not a category. */
const PLAY_CATEGORIES: readonly PlayCategory[] = ["games", "stories", "learning"];

describe("the mock world is one world", () => {
  describe("names resolve to MOCK_IDENTITY", () => {
    it("Home shows the shared parent, child and device names and ids", () => {
      expect(MOCK_HOME.parent.display_name).toBe(MOCK_IDENTITY.parent);
      expect(MOCK_HOME.child.display_name).toBe(MOCK_IDENTITY.child);
      expect(MOCK_HOME.child.child_id).toBe(MOCK_IDENTITY.childId);
      expect(MOCK_HOME.device.display_name).toBe(MOCK_IDENTITY.device);
      expect(MOCK_HOME.device.device_id).toBe(MOCK_IDENTITY.deviceId);
    });

    it("the Device page shows the same device, id and room", () => {
      expect(MOCK_DEVICE.display_name).toBe(MOCK_IDENTITY.device);
      expect(MOCK_DEVICE.device_id).toBe(MOCK_IDENTITY.deviceId);
      expect(MOCK_DEVICE.room_label).toBe(MOCK_IDENTITY.room);
    });

    it("Family shows both children, by the shared names and ids", () => {
      expect(MOCK_FAMILY.children.map((child) => child.display_name)).toEqual([
        MOCK_IDENTITY.child,
        MOCK_IDENTITY.secondChild,
      ]);
      expect(MOCK_FAMILY.children.map((child) => child.child_id)).toEqual([
        MOCK_IDENTITY.childId,
        MOCK_IDENTITY.secondChildId,
      ]);
    });

    it("Family's grandparents panel shows the shared grandparent", () => {
      expect(MOCK_FAMILY.grandparents.map((member) => member.display_name)).toEqual([
        MOCK_IDENTITY.grandparent,
      ]);
    });

    it("the child draft opens with the shared child name", () => {
      expect(MOCK_CHILD_DRAFT.display_name).toBe(MOCK_IDENTITY.child);
      expect(MOCK_CHILD_DRAFT.language_labels).toContain(MOCK_CHILD_DRAFT.primary_language);
    });

    it("the notification detail lines name the shared child", () => {
      const details = MOCK_NOTIFICATIONS.rows.map((row) => row.detail).join(" ");
      expect(details).toContain(MOCK_IDENTITY.child);
    });

    it("the memory labels name the shared child, second child and device", () => {
      const labels = MOCK_PRIVACY.memories.map((memory) => memory.label).join(" ");
      for (const name of [MOCK_IDENTITY.child, MOCK_IDENTITY.secondChild, MOCK_IDENTITY.device]) {
        expect(labels).toContain(name);
      }
    });

    it("the recordings name the shared grandparent and consenting parent", () => {
      expect(MOCK_PRIVACY.recordings.length).toBeGreaterThan(0);
      for (const recording of MOCK_PRIVACY.recordings) {
        expect(recording.recorded_label).toContain(MOCK_IDENTITY.grandparent);
        expect(recording.consent_statement).toContain(MOCK_IDENTITY.parent);
      }
    });

    // Round-4 finding 3: every MOCK_IDENTITY name has to be rendered somewhere, or the shared
    // module grows entries nothing keeps true. `caregiver` is the one with a single renderer.
    it("Family's caregivers panel holds the other parent and the caregiver, with distinct lines", () => {
      expect(MOCK_FAMILY.caregivers).toHaveLength(2);
      const [otherParent, caregiver] = MOCK_FAMILY.caregivers;
      expect(otherParent?.display_name).toBe(MOCK_IDENTITY.otherParent);
      expect(otherParent?.role).toBe("parent");
      expect(caregiver?.display_name).toBe(MOCK_IDENTITY.caregiver);
      expect(caregiver?.role).toBe("caregiver");
      for (const member of MOCK_FAMILY.caregivers) {
        expect(member.permission_line.trim().length).toBeGreaterThan(0);
      }
      expect(otherParent?.permission_line).not.toBe(caregiver?.permission_line);
    });
  });

  describe("the counts a rendered line claims", () => {
    // The Memory row's "15 items" line and the "View All Memories" expansion both depend on this.
    it("Privacy holds exactly fifteen memories, more than it shows at rest", () => {
      expect(MOCK_PRIVACY.memories).toHaveLength(15);
      expect(MOCK_PRIVACY.recent_count).toBeLessThan(MOCK_PRIVACY.memories.length);
      expect(new Set(MOCK_PRIVACY.memories.map((memory) => memory.memory_id)).size).toBe(15);
    });

    // Jest's `expect` takes one argument, so the category is named by the case title instead of
    // a message: every segment of screen 8 has something to show.
    it.each(PLAY_CATEGORIES)("the %s segment holds at least one item", (category) => {
      expect(MOCK_PLAY.items.filter((item) => item.category === category).length).toBeGreaterThan(
        0,
      );
    });

    it("SCREEN_HEADER_NAME has a non-empty entry for every route but Home", () => {
      const keys: readonly ShellRouteKey[] = [...TAB_KEYS, ...STACK_KEYS];
      const expected = keys.filter((key) => key !== "home").sort();
      expect(Object.keys(SCREEN_HEADER_NAME).sort()).toEqual([...expected]);
      const blank = Object.entries(SCREEN_HEADER_NAME)
        .filter(([, name]) => name.trim().length === 0)
        .map(([key]) => key);
      expect(blank).toEqual([]);
    });
  });
});
