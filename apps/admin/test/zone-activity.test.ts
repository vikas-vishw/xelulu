// Touch-zone activity (Phase 6 Req 3.3). The seven zones and their order come from the contract's
// `TOUCH_ZONES`, so the rows are the contract's list; the newest held touch per zone wins and
// everything else is ignored.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TOUCH_ZONES } from "@xelulu/shared";
import type { GatewayLogEntry, TouchZone } from "@xelulu/shared";

import { zoneActivity } from "../src/devices/zone-activity";

import { DEVICE_ID, atFor, sayAckDone, touchAccepted } from "./support/entries";

/** `ConsoleState` keeps entries in ascending seq; these fixtures do the same. */
function ascending(entries: readonly GatewayLogEntry[]): readonly GatewayLogEntry[] {
  return [...entries].sort((a, b) => a.seq - b.seq);
}

describe("zoneActivity", () => {
  it("holds one row per contract zone, in contract order, with no touch held", () => {
    const rows = zoneActivity([], DEVICE_ID);
    expect(rows.map((r) => r.zone)).toEqual([...TOUCH_ZONES]);
    expect(rows.every((r) => r.last_at === null)).toBe(true);
  });

  it("reports the newest accepted touch per zone", () => {
    const entries = ascending([
      touchAccepted(1, "head"),
      touchAccepted(2, "belly"),
      touchAccepted(3, "head"),
    ]);
    const byZone = new Map(zoneActivity(entries, DEVICE_ID).map((r) => [r.zone, r.last_at]));
    expect(byZone.get("head")).toBe(atFor(3));
    expect(byZone.get("belly")).toBe(atFor(2));
    expect(byZone.get("back")).toBeNull();
  });

  it("ignores another device's touches and every non-touch entry", () => {
    const other: GatewayLogEntry = { ...touchAccepted(1, "head"), device_id: "xlu_999999" };
    const rows = zoneActivity(ascending([other, sayAckDone(2)]), DEVICE_ID);
    expect(rows.every((r) => r.last_at === null)).toBe(true);
  });

  it("Property: the rows are the contract list and each time is that zone's newest touch", () => {
    const touch = fc.record({
      seq: fc.integer({ min: 1, max: 40 }),
      zone: fc.constantFrom(...TOUCH_ZONES),
    });
    fc.assert(
      fc.property(fc.array(touch, { maxLength: 20 }), (touches) => {
        // One entry per seq, as the Live_Log window holds it (seq is unique and ascending).
        const bySeq = new Map(touches.map((t) => [t.seq, t.zone]));
        const entries = ascending(
          [...bySeq].map(([seq, zone]) => touchAccepted(seq, zone as TouchZone)),
        );
        const rows = zoneActivity(entries, DEVICE_ID);

        expect(rows.map((r) => r.zone)).toEqual([...TOUCH_ZONES]);
        for (const row of rows) {
          const seqs = [...bySeq].filter(([, zone]) => zone === row.zone).map(([seq]) => seq);
          expect(row.last_at).toBe(seqs.length === 0 ? null : atFor(Math.max(...seqs)));
        }
      }),
    );
  });
});
