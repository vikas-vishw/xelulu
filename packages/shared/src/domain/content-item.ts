import type { AgeStage } from "./age-stage.js";
import type { IsoDateTime } from "./common.js";

/**
 * The content kinds (Phase 4 C2). `learning` arrives with Phase 4: Phase 2.2's Play mock recorded
 * the workaround it removes ("the union has no learning member, so the three learning cards take
 * `game`"). Additive to the domain model, which is not the frozen contract.
 */
export const CONTENT_KINDS = Object.freeze([
  "story",
  "song",
  "rhyme",
  "lullaby",
  "game",
  "learning",
] as const);
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** The editorial state of a content row. Only the Content_Gate reaches `active` (C7). */
export const CONTENT_STATUSES = Object.freeze(["draft", "active"] as const);
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * The eight categories the whole system shares (C4). These are exactly the keys of the Phase 3
 * Input_Guard's CONTENT_CATEGORY_TERMS and the categories of the Child_Context fixture: a ninth
 * would be a tool call no household's `allowedCategories` can satisfy.
 */
export const CONTENT_CATEGORIES = Object.freeze([
  "stories",
  "songs",
  "animals",
  "maths",
  "world",
  "feelings",
  "manners",
  "games",
] as const);
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

/** The tradition a retelling comes from. Never a translation, an edition or an author (C5). */
export const CONTENT_SOURCES = Object.freeze([
  "panchatantra",
  "jataka",
  "tenali_raman",
  "akbar_birbal",
  "folk",
  "original",
] as const);
export type ContentSource = (typeof CONTENT_SOURCES)[number];

/** Spoken text per language. A declared language must have a non-empty entry. */
export type LocalisedText = { [lang: string]: string };

export interface ContentChoice {
  choice_id: string;
  /** What Xelulu offers, per language. Counts toward the step's age shape. */
  prompt: LocalisedText;
  /** Words that select this branch, per language. Matched case-folded; no model involved (C9). */
  match_terms: { [lang: string]: string[] };
  next_step_id: string;
}

export interface ContentStep {
  step_id: string;
  /** 1–3 sentences per language, inside the limits of every Age_Stage the item declares (C6). */
  text: LocalisedText;
  /** Empty for a linear step. */
  choices: ContentChoice[];
  /** null ends the item; ignored when `choices` is non-empty. */
  next_step_id: string | null;
}

/** Fields shared by both content row classes (ruling 6; Phase 4 C3 adds the last four). */
export interface ContentItemBase {
  content_id: string;
  kind: ContentKind;
  title: string;
  languages: string[];
  age_stages: AgeStage[];
  categories: string[];
  /** Phase 4 (C3): the spoken content, the editorial state and the provenance. */
  steps: ContentStep[];
  status: ContentStatus;
  licence_note: string;
  source: ContentSource;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
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
