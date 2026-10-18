// Touch-zone activity for the Devices page (Phase 6 C7, Req 3.3). Pure: Log_Entries in, one row
// per Touch_Zone out. Nothing is added to the Gateway for this — an `event_accepted` touch entry
// already carries its `zone`, so the console derives the activity itself.
//
// The zone list comes from `TOUCH_ZONES` in the Shared_Package, so the seven zones and their order
// are the contract's, never a list written here.
import { TOUCH_ZONES } from "@xelulu/shared";
import type { GatewayLogEntry, TouchZone } from "@xelulu/shared";

/** One zone and when it was last touched. A time and a closed-enum zone; no text. */
export type ZoneActivity = Readonly<{
  zone: TouchZone;
  /** The `at` of the newest accepted touch on this zone, or null when none is held. */
  last_at: string | null;
}>;

/**
 * One row per `TOUCH_ZONES` member, in contract order, for one device. `entries` is the held
 * Live_Log window in ascending `seq` (as `ConsoleState` keeps it), so the last matching entry per
 * zone is the newest one; a zone with no held touch reads null.
 */
export function zoneActivity(
  entries: readonly GatewayLogEntry[],
  deviceId: string,
): readonly ZoneActivity[] {
  const lastAt = new Map<TouchZone, string>();
  for (const entry of entries) {
    if (entry.kind !== "event_accepted") continue;
    if (entry.event !== "touch" || entry.device_id !== deviceId) continue;
    lastAt.set(entry.data.zone, entry.at);
  }
  return Object.freeze(
    TOUCH_ZONES.map((zone) => Object.freeze({ zone, last_at: lastAt.get(zone) ?? null })),
  );
}
