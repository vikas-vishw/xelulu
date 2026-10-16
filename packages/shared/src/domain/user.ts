import type { IsoDateTime } from "./common.js";

/** Parent: full access. Caregiver: no reports or controls. Grandma: own content and calls only. */
export type UserRole = "parent" | "caregiver" | "grandma";

export interface User {
  /** Supabase user id. */
  user_id: string;
  household_id: string;
  role: UserRole;
  display_name: string;
  created_at: IsoDateTime;
}
