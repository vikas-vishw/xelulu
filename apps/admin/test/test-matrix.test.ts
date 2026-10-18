// The Test_Matrix is the contract (Phase 6 Req 4.1–4.3, 4.6; Property 4).
//
// Nothing here restates a Document B list: the expectations are built from the same imports
// `buildMatrix` uses, so a test that passed while the matrix was hand-listed is impossible.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CMD_ACTIONS, EVENT_KINDS, TOUCH_ZONES } from "@xelulu/shared";

import {
  buildMatrix,
  CONTRACT_LISTS,
  DRIVABLE_ACTIONS,
  FIXED_ROWS,
  fixedRowId,
  isDrivable,
} from "../src/matrix/test-matrix";

/** The row ids a set of lists must produce, in the order `buildMatrix` promises. */
function expectedIds(
  cmdActions: readonly string[],
  eventKinds: readonly string[],
  touchZones: readonly string[],
): string[] {
  return [
    ...cmdActions.map((action) => `cmd:${action}`),
    ...eventKinds.map((kind) => `event:${kind}`),
    ...touchZones.map((zone) => `zone:${zone}`),
    ...FIXED_ROWS.map((name) => fixedRowId(name)),
  ];
}

describe("buildMatrix over the contract lists", () => {
  it("defaults to the three Document B lists plus the two fixed rows", () => {
    const rows = buildMatrix();
    expect(rows.map((row) => row.id)).toEqual(expectedIds(CMD_ACTIONS, EVENT_KINDS, TOUCH_ZONES));
    expect(rows).toHaveLength(
      CMD_ACTIONS.length + EVENT_KINDS.length + TOUCH_ZONES.length + FIXED_ROWS.length,
    );
    expect(CONTRACT_LISTS.cmdActions).toBe(CMD_ACTIONS);
    expect(CONTRACT_LISTS.eventKinds).toBe(EVENT_KINDS);
    expect(CONTRACT_LISTS.touchZones).toBe(TOUCH_ZONES);
  });

  it("covers every touch zone and every event kind as an observed row", () => {
    const rows = buildMatrix();
    for (const zone of TOUCH_ZONES) {
      const row = rows.find((candidate) => candidate.id === `zone:${zone}`);
      expect(row?.direction).toBe("observed");
      expect(row?.group).toBe("zone");
      expect(row?.member).toBe(zone);
      expect(row?.expectRefusal).toBe(false);
    }
    for (const kind of EVENT_KINDS) {
      const row = rows.find((candidate) => candidate.id === `event:${kind}`);
      expect(row?.direction).toBe("observed");
      expect(row?.member).toBe(kind);
    }
  });

  it("makes every command action a driven row, with the five allow-listed ones expected to send", () => {
    const rows = buildMatrix();
    for (const action of CMD_ACTIONS) {
      const row = rows.find((candidate) => candidate.id === `cmd:${action}`);
      expect(row?.direction).toBe("driven");
      expect(row?.group).toBe("cmd");
      expect(row?.expectRefusal).toBe(!isDrivable(action));
    }
    // Derived from the contract list and the console's decision table, never written out here.
    expect(DRIVABLE_ACTIONS).toEqual(CMD_ACTIONS.filter((action) => isDrivable(action)));
    expect(DRIVABLE_ACTIONS).toHaveLength(5);
    // Movement is excluded from every console path (safety.md §5).
    expect(DRIVABLE_ACTIONS).not.toContain("move");
  });

  it("marks the two fixed rows observed and gives them no contract member", () => {
    const rows = buildMatrix();
    for (const name of FIXED_ROWS) {
      const row = rows.find((candidate) => candidate.id === fixedRowId(name));
      expect(row?.direction).toBe("observed");
      expect(row?.group).toBe("fixed");
      expect(row?.member).toBeNull();
    }
  });

  it("gains exactly one row when a substituted list gains one action", () => {
    const base = buildMatrix();
    const grown = buildMatrix({ cmdActions: [...CMD_ACTIONS, "sparkle"] });
    expect(grown).toHaveLength(base.length + 1);

    const added = grown.filter((row) => !base.some((old) => old.id === row.id));
    expect(added.map((row) => row.id)).toEqual(["cmd:sparkle"]);
    // An action the console has no decision for is not drivable, so its row expects a refusal.
    expect(added[0]?.expectRefusal).toBe(true);
    expect(isDrivable("sparkle")).toBe(false);
  });

  it("gains exactly one row when a substituted list gains one zone or one event kind", () => {
    const base = buildMatrix();
    expect(buildMatrix({ touchZones: [...TOUCH_ZONES, "tail"] })).toHaveLength(base.length + 1);
    expect(buildMatrix({ eventKinds: [...EVENT_KINDS, "sneeze"] })).toHaveLength(base.length + 1);
  });
});

const member = fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/);
const memberList = fc
  .uniqueArray(member, { maxLength: 8 })
  .map((list) => Object.freeze([...list]) as readonly string[]);

describe("Test_Matrix properties", () => {
  // Feature: phase-6-integration-cockpit, Property 4: The matrix is the contract
  // Validates: Requirements 4.1, 4.2, 4.3
  it("produces exactly one row per substituted member plus the two fixed rows, in order", () => {
    fc.assert(
      fc.property(memberList, memberList, memberList, (cmdActions, eventKinds, touchZones) => {
        const rows = buildMatrix({ cmdActions, eventKinds, touchZones });
        expect(rows.map((row) => row.id)).toEqual(expectedIds(cmdActions, eventKinds, touchZones));
        expect(rows).toHaveLength(
          cmdActions.length + eventKinds.length + touchZones.length + FIXED_ROWS.length,
        );
        // Direction follows the group, always: cmd rows are driven, every other row observed.
        for (const row of rows) {
          expect(row.direction).toBe(row.group === "cmd" ? "driven" : "observed");
          expect(row.expectRefusal).toBe(row.group === "cmd" && !isDrivable(row.member ?? ""));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("leaves a list it was not given at the contract's own value", () => {
    fc.assert(
      fc.property(memberList, (cmdActions) => {
        const rows = buildMatrix({ cmdActions });
        expect(rows.filter((row) => row.group === "zone")).toHaveLength(TOUCH_ZONES.length);
        expect(rows.filter((row) => row.group === "event")).toHaveLength(EVENT_KINDS.length);
      }),
      { numRuns: 100 },
    );
  });
});
