// Charge reminders (XL-C05, Phase 4 Req 11): one armed flag per device per threshold, and a
// crossing rule.
//
// State only. No clock, no log, no device: this module decides WHICH thresholds became due on a
// reading, and the Routine_Scheduler fires their behaviours through the unchanged
// Device_Policy_Gate. The armed flags are in process and are lost on restart (Req 11.7).
//
// THE INITIAL STATE IS THE SUBTLE PART (Req 11.9). A device has no flags until its first accepted
// `status`, and that first status ARMS rather than fires: a threshold is armed only if the reading
// is at or above `threshold + CHARGE_HYSTERESIS_PCT`, or `charging` is true. So a gateway that
// restarts while the robot sits at 18 % says nothing, because it has not seen a crossing. Firing
// on a first low reading would nag once per gateway restart instead.
import { CHARGE_THRESHOLDS } from "@xelulu/shared";

/** How far the battery must rise above a threshold before that threshold re-arms. */
export const CHARGE_HYSTERESIS_PCT = 5;

export interface ChargeReminders {
  /** The thresholds that became due on this status, in `CHARGE_THRESHOLDS` order (C17). */
  onStatus(deviceId: string, batteryPct: number, charging: boolean): readonly number[];
}

/** A reading the component will act on at all: a finite percentage inside 0–100 (Req 11.10). */
function readable(batteryPct: number): boolean {
  return Number.isFinite(batteryPct) && batteryPct >= 0 && batteryPct <= 100;
}

export function createChargeReminders(): ChargeReminders {
  /** `device_id` -> threshold -> armed. A device absent from the map has not been seen at all. */
  const armed = new Map<string, Map<number, boolean>>();

  return {
    onStatus(deviceId, batteryPct, charging) {
      // Absent or out of range: no flag changes and nothing fires. A DEFENSIVE branch, not a
      // reachable wire case — `status.ts` makes `battery_pct` and `charging` required, so an
      // accepted `status` always carries both in range. The branch exists because `onStatus` is a
      // plain function a composition root, a test or a later reader can call with anything, and a
      // total function is cheaper than an argument nobody re-validates (Req 11.10).
      if (!readable(batteryPct)) return Object.freeze([]);

      let flags = armed.get(deviceId);
      const firstStatus = flags === undefined;
      if (flags === undefined) {
        flags = new Map<number, boolean>();
        armed.set(deviceId, flags);
      }

      const due: number[] = [];
      for (const threshold of CHARGE_THRESHOLDS) {
        // Re-armed by a charge, or by rising clear of the threshold by the hysteresis margin
        // (Req 11.4). Either way this reading is above the threshold, so it cannot also fire it.
        if (charging || batteryPct >= threshold + CHARGE_HYSTERESIS_PCT) {
          flags.set(threshold, true);
          continue;
        }
        if (firstStatus) {
          // A first reading is not a crossing (Req 11.9).
          flags.set(threshold, false);
          continue;
        }
        if ((flags.get(threshold) ?? false) && batteryPct <= threshold) {
          // Fired once, and left fired while the battery stays down, so quiet hours do not queue
          // a reminder for later (Req 11.3, 11.6).
          flags.set(threshold, false);
          due.push(threshold);
        }
      }
      return Object.freeze(due);
    },
  };
}
