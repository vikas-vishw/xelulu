// The content In_App_Store (Phase 4 Req 19.1, 19.3, 19.7). The Play screen depends on this
// interface and on nothing else, so Phase 5's Supabase implementation replaces this file and no
// screen changes.
//
// This is one of the four app files allowed to import a runtime value from `@xelulu/shared`
// (Req 19.7, C27). Every other file in the app keeps `import type`. The specifier is the package
// root, so `pnpm build` must run before `pnpm start:app`: the package resolves through `dist`
// and `start:app` does not build (Req 19.7a, recorded in the README).
//
// No network call, no environment read and no fetch: the library is the shared Starter_Content,
// read in memory (Req 19.2).

import { CONTENT_CATEGORIES, createStarterContent } from "@xelulu/shared";
import type { ContentItem } from "@xelulu/shared";

import { PLAY_ILLUSTRATION, type PlayCategory, type PlayItem } from "../../features/play/mock-play";
import { PLAY_STRINGS } from "../../features/play/strings";

/**
 * Content_Category → Play segment (Req 19.3). The segment is taken from the item's FIRST category
 * in `CONTENT_CATEGORIES` order, which is deterministic: two items with the same category set
 * always land in the same segment. `games` is last in that order, which is why the seeding rule
 * gives a `games` item `games` as its only category rather than this map having a second rule.
 */
const SEGMENT_OF: Readonly<Record<string, PlayCategory>> = Object.freeze({
  stories: "stories",
  songs: "stories",
  animals: "learning",
  maths: "learning",
  world: "learning",
  feelings: "learning",
  manners: "learning",
  games: "games",
});

/** The item's segment, or null when it carries no category this app can place. */
function segmentOf(categories: readonly string[]): PlayCategory | null {
  const held: ReadonlySet<string> = new Set(categories);
  for (const category of CONTENT_CATEGORIES) {
    if (!held.has(category)) continue;
    return SEGMENT_OF[category] ?? null;
  }
  return null;
}

/**
 * One card from one Content_Item. The title is rendered exactly as the item holds it —
 * `ContentItemBase.title` is one string, so a Phase 4 title is `en-IN` in either app language
 * (Req 19.3, a README limit). The subtitle is the segment's line and the illustration the
 * segment's picture: a Content_Item carries neither, and the app invents no item text.
 */
function toPlayItem(item: ContentItem): PlayItem[] {
  const category = segmentOf(item.categories);
  if (category === null) return [];
  return [
    {
      item_id: item.content_id,
      title: item.title,
      subtitle: PLAY_STRINGS.cardSubtitles[category],
      category,
      kind: item.kind,
      illustration: PLAY_ILLUSTRATION[category],
    },
  ];
}

export interface AppContentStore {
  /** The `active` items as Play cards, in the library's order. A draft is never offered. */
  playItems(): readonly PlayItem[];
}

export function createAppContentStore(
  items: readonly ContentItem[] = createStarterContent(),
): AppContentStore {
  const rows: readonly PlayItem[] = Object.freeze(
    items.filter((item) => item.status === "active").flatMap(toPlayItem),
  );
  return { playItems: () => rows };
}

/** The app's one store instance, built from the Starter_Content at import time. */
export const APP_CONTENT_STORE: AppContentStore = createAppContentStore();
