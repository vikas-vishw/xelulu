import type { IsoDateTime } from "./common.js";

export type GrandmaAssetKind = "story" | "rhyme" | "lullaby" | "message";

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
