import type { IsoDateTime } from "./common.js";

/** A provisioned robot, bound to exactly one household. Holds no credential of any kind. */
export interface Device {
  device_id: string;
  household_id: string;
  display_name: string;
  fw_ver: string | null;
  last_seen_at: IsoDateTime | null;
  provisioned_at: IsoDateTime;
}
