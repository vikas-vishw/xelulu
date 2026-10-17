// Screen 8's presentation map (Phase 4 Req 19.3). The card list itself is gone: it comes from
// the content In_App_Store over the shared Starter_Content now (`src/lib/stores/content-store.ts`).
// What stays here is what a Content_Item cannot carry — the segment's illustration — plus the two
// types the screen renders. Display labels and enum values only: no network call, no environment
// read, no media file and no URL (Req 19.2).

import type { ContentKind } from "@xelulu/shared";

import type { IllustrationName } from "../../illustrations/illustration";

/** The three filterable categories; the "All" segment is not a category. */
export type PlayCategory = "games" | "stories" | "learning";

export type PlayItem = Readonly<{
  item_id: string;
  title: string;
  subtitle: string;
  category: PlayCategory;
  /** The Content_Item's own kind. Carried for a later phase and never rendered. */
  kind: ContentKind;
  illustration: IllustrationName;
}>;

/**
 * One illustration per segment, all three already in the app (Req 19.3). A Content_Item carries
 * no picture, and the app invents none per item: the segment decides.
 */
export const PLAY_ILLUSTRATION: Readonly<Record<PlayCategory, IllustrationName>> = Object.freeze({
  games: "play-scene",
  stories: "story-scene",
  learning: "space-scene",
});
