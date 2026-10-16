import type { IsoDateTime } from "./common.js";

/** A family account. Every household-scoped row points back here by `household_id`. */
export interface Household {
  household_id: string;
  name: string;
  created_at: IsoDateTime;
}
