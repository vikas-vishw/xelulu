// Charge reminders (Phase 4 Req 11): the crossing rule, the hysteresis, the arming of a first
// status, and the defensive branch for a reading the wire cannot actually produce.
//
// `ChargeReminders` is state and nothing else — no clock, no log, no device — so it is unit
// tested directly, which is where Property 7 lives. What happens to a threshold that becomes due
// (the behaviour, the gate, the entry) belongs to the scheduler and is asserted there.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CHARGE_THRESHOLDS } from "@xelulu/shared";

import { CHARGE_HYSTERESIS_PCT, createChargeReminders } from "../src/routines/charge-reminders.js";

const DEVICE = "xlu_000123";

/** The thresholds, highest first, exactly as the shared constant lists them (Req 11.2). */
const [HIGH, LOW] = CHARGE_THRESHOLDS;

describe("the thresholds", () => {
  it("is exactly the two shared product thresholds", () => {
    expect([...CHARGE_THRESHOLDS]).toEqual([20, 10]);
    expect(HIGH).toBe(20);
    expect(LOW).toBe(10);
  });
});

describe("the crossing rule (Req 11.1, 11.3, 11.4)", () => {
  it("fires nothing before the first status, and arms rather than fires on it", () => {
    const reminders = createChargeReminders();
    // A gateway restart while the robot sits at 18 % says nothing: a first reading is not a
    // crossing (Req 11.9). 18 arms the 10 % threshold (18 >= 15) and leaves 20 % unarmed.
    expect(reminders.onStatus(DEVICE, 18, false)).toEqual([]);
    // Still nothing for 20 %: it was never armed, so it has nothing to cross from.
    expect(reminders.onStatus(DEVICE, 15, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 9, false)).toEqual([LOW]);
  });

  it("fires 20 then 10 as the battery falls, once each", () => {
    const reminders = createChargeReminders();
    // A first reading clear of both thresholds by the margin arms both.
    expect(reminders.onStatus(DEVICE, 100, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 40, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 20, false)).toEqual([HIGH]);
    // Left fired while the battery stays down, so quiet hours do not queue it for later.
    expect(reminders.onStatus(DEVICE, 19, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 12, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 10, false)).toEqual([LOW]);
    expect(reminders.onStatus(DEVICE, 4, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 0, false)).toEqual([]);
  });

  it("reports both thresholds, in order, for a single steep drop", () => {
    const reminders = createChargeReminders();
    reminders.onStatus(DEVICE, 90, false);
    expect(reminders.onStatus(DEVICE, 5, false)).toEqual([HIGH, LOW]);
  });

  it("re-arms on charging and on rising clear by the hysteresis margin", () => {
    const reminders = createChargeReminders();
    reminders.onStatus(DEVICE, 90, false);
    expect(reminders.onStatus(DEVICE, 8, false)).toEqual([HIGH, LOW]);
    // Charging re-arms both without waiting for a reading (Req 11.4).
    expect(reminders.onStatus(DEVICE, 8, true)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 7, false)).toEqual([HIGH, LOW]);
    // A rise that does NOT clear the margin leaves 20 % disarmed.
    expect(reminders.onStatus(DEVICE, HIGH + CHARGE_HYSTERESIS_PCT - 1, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 19, false)).toEqual([]);
    // A rise that clears it re-arms, so the next fall fires again.
    expect(reminders.onStatus(DEVICE, HIGH + CHARGE_HYSTERESIS_PCT, false)).toEqual([]);
    expect(reminders.onStatus(DEVICE, 20, false)).toEqual([HIGH]);
  });

  it("keeps each device's flags to itself", () => {
    const reminders = createChargeReminders();
    reminders.onStatus(DEVICE, 90, false);
    reminders.onStatus("xlu_other", 90, false);
    expect(reminders.onStatus(DEVICE, 18, false)).toEqual([HIGH]);
    // The other device has not fallen, so nothing fired for it.
    expect(reminders.onStatus("xlu_other", 30, false)).toEqual([]);
  });
});

describe("the defensive out-of-range branch (Req 11.10)", () => {
  // NOT a reachable wire case: `gateway-contract/status.ts` makes `battery_pct` and `charging`
  // required, so an accepted `status` always carries both in range. The branch exists because
  // `onStatus` is a plain function a composition root, a test or a later reader can call with
  // anything — which is exactly how it is exercised here, rather than by trying to build an
  // invalid `status` message the contract would reject first.
  it("changes no flag and fires nothing for NaN, -1 or 101", () => {
    const reminders = createChargeReminders();
    reminders.onStatus(DEVICE, 90, false);
    for (const reading of [Number.NaN, -1, 101, Number.POSITIVE_INFINITY]) {
      expect(reminders.onStatus(DEVICE, reading, false)).toEqual([]);
    }
    // The armed flags from the 90 % reading survived every one of them.
    expect(reminders.onStatus(DEVICE, 20, false)).toEqual([HIGH]);
  });

  it("does not even create a device's flags from an unreadable first status", () => {
    const reminders = createChargeReminders();
    expect(reminders.onStatus(DEVICE, Number.NaN, false)).toEqual([]);
    // The next readable status is therefore still the FIRST one, and arms rather than fires.
    expect(reminders.onStatus(DEVICE, 9, false)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property 7: One reminder per crossing

describe("Property 7: one reminder per crossing", () => {
  type Reading = Readonly<{ pct: number; charging: boolean }>;

  /**
   * The model, written independently of the implementation: a threshold is armed by a charge or
   * by a reading at or above `threshold + margin`, and fires when an armed threshold is met from
   * a reading that is not above it. A first reading can only arm.
   */
  function expected(readings: readonly Reading[], threshold: number): number {
    let armed: boolean | null = null;
    let fires = 0;
    for (const reading of readings) {
      if (!Number.isFinite(reading.pct) || reading.pct < 0 || reading.pct > 100) continue;
      if (reading.charging || reading.pct >= threshold + CHARGE_HYSTERESIS_PCT) {
        armed = true;
        continue;
      }
      if (armed === null) {
        armed = false;
        continue;
      }
      if (armed && reading.pct <= threshold) {
        armed = false;
        fires += 1;
      }
    }
    return fires;
  }

  it("fires exactly once per crossing, for any sequence of statuses", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            pct: fc.oneof(
              fc.integer({ min: 0, max: 100 }),
              // Unreadable values, which must change nothing at all (Req 11.10).
              fc.constantFrom(Number.NaN, -1, 101, -50),
            ),
            charging: fc.boolean(),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (readings) => {
          const reminders = createChargeReminders();
          const fired = new Map<number, number>();
          for (const reading of readings) {
            for (const threshold of reminders.onStatus(DEVICE, reading.pct, reading.charging)) {
              fired.set(threshold, (fired.get(threshold) ?? 0) + 1);
            }
          }
          for (const threshold of CHARGE_THRESHOLDS) {
            expect(fired.get(threshold) ?? 0).toBe(expected(readings, threshold));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never fires a threshold twice without an intervening re-arm", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 30 }),
        (percents) => {
          const reminders = createChargeReminders();
          /** Whether each threshold has fired since its last re-arm. */
          const spent = new Map<number, boolean>();
          for (const pct of percents) {
            const due = reminders.onStatus(DEVICE, pct, false);
            for (const threshold of CHARGE_THRESHOLDS) {
              if (pct >= threshold + CHARGE_HYSTERESIS_PCT) spent.set(threshold, false);
            }
            for (const threshold of due) {
              expect(spent.get(threshold) ?? false).toBe(false);
              spent.set(threshold, true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
