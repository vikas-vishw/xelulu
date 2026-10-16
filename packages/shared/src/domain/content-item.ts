import type { AgeStage } from "./age-stage.js";
import type { IsoDateTime } from "./common.js";

export type ContentKind = "story" | "song" | "rhyme" | "lullaby" | "game";

/** Fields shared by both content row classes (ruling 6). */
export interface ContentItemBase {
  content_id: string;
  kind: ContentKind;
  title: string;
  languages: string[];
  age_stages: AgeStage[];
  categories: string[];
  licence_note: string;
  created_at: IsoDateTime;
}

/**
 * Household-scoped content row. Protected by RLS by `household_id` and role; written by the
 * household's parents.
 */
export interface HouseholdContentItem extends ContentItemBase {
  household_id: string;
}

/**
 * Global curated content row. A read-only reference for every household; written only by admins
 * (service role or the admin console).
 */
export interface GlobalContentItem extends ContentItemBase {
  household_id: null;
}

/** A content row of either class. */
export type ContentItem = HouseholdContentItem | GlobalContentItem;

/** `household`: RLS by household and role, parent-written. `global`: read-only to all, admin-written. */
export type ContentRowClass = "household" | "global";

/** Returns the row class of a content item. Pure; never throws. */
export function contentRowClass(item: ContentItem): ContentRowClass {
  return item.household_id === null ? "global" : "household";
}
