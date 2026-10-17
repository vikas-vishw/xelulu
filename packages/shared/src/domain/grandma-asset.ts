import type { IsoDateTime } from "./common.js";

/** Frozen runtime list with the union derived from it (Phase 4 C36), so the list cannot drift. */
export const GRANDMA_ASSET_KINDS = Object.freeze(["story", "rhyme", "lullaby", "message"] as const);
export type GrandmaAssetKind = (typeof GRANDMA_ASSET_KINDS)[number];

/** Adult-provided content, stored only with a consent statement on file (safety.md §1). */
export interface GrandmaAsset {
  asset_id: string;
  household_id: string;
  recorded_by_user_id: string;
  kind: GrandmaAssetKind;
  title: string;
  lang: string;
  /** The only reference to the stored file. */
  recording_storage_path: string;
  /** Required, never null. */
  consent_record_id: string;
  created_at: IsoDateTime;
}
