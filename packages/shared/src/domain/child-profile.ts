import type { AgeStage } from "./age-stage.js";
import type { IsoDate, IsoDateTime } from "./common.js";

export interface ChildProfile {
  child_id: string;
  household_id: string;
  display_name: string;
  /** V06: a text pronunciation hint only. */
  name_pronunciation: string | null;
  date_of_birth: IsoDate;
  /** Derived with `deriveAgeStage` at write time. */
  age_stage: AgeStage;
  /** BCP-47-like language tags. */
  languages: string[];
  /** Content categories the parent allows. */
  content_categories: string[];
  /** Parent-added deferral topics. */
  defer_topics: string[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}
