// The `content_lookup` tool's source (Req 3.1, 3.6, 5.3). safety.md §3 is categorical: stories,
// songs and media come only from the curated library, so this is the only place a title, a step or
// the day's word can come from.
//
// The module keeps its name, its interface and its place in the Tool_Router's deps; what changed
// in Phase 4 is what sits behind it — the Content_Store rather than a fixture array — and what a
// lookup can answer: a list of titles, a RESOLVED item for telling, or the day's Word_Of_The_Day.
//
// It RESOLVES and nothing more. It opens no Story_Session, because it holds no `device_id` and no
// `turn_id` and so could not; the Tool_Router does that in one call (C40). It performs no I/O of
// any kind — no file read, no network, no database.
//
// Every answer it produces still runs the Output_Guard before a frame is synthesised, and every
// item it can reach has already passed the Content_Gate at the stage and language being asked
// for, so neither layer trusts the other to be the only one.
import {
  CONTENT_CATEGORIES,
  type AgeStage,
  type SupportedLang,
  type WordEntry,
} from "@xelulu/shared";

import type { Clock } from "../../clock.js";
import type { ContentItemBase } from "@xelulu/shared";
import type { ContentStore } from "../../content/content-store.js";
import { wordForDay } from "../story/word-of-the-day.js";

/** Items named in one answer. Three keeps the reply inside even `tiny`'s word limit. */
export const MAX_RESULTS = 3;

/**
 * The category a Word_Of_The_Day is gated on, on BOTH paths (Req 5.3a, C38): a Child_Context that
 * does not open `world` is refused `not_allowed`, exactly as any other category is, and the
 * morning routine omits the word for the same child.
 */
export const WORD_OF_THE_DAY_CATEGORY = "world";

/**
 * A lookup request. A discriminated union, because a word-of-the-day request has no `category` to
 * carry while a library request must have one.
 */
export type ContentQuery =
  | Readonly<{
      wordOfTheDay: true;
      lang: SupportedLang;
      ageStage: AgeStage;
      /** `world` is still gated: a closed `world` answers `not_allowed` (Req 5.3a). */
      allowedCategories: readonly string[];
    }>
  | Readonly<{
      wordOfTheDay?: false;
      category: string;
      lang: SupportedLang;
      ageStage: AgeStage;
      allowedCategories: readonly string[];
      /** Resolve the first matching item for telling, rather than listing titles (Req 3.2). */
      start?: boolean;
      /** Resolve this item, when the model names one it was already offered. */
      contentId?: string;
    }>;

export type ContentLookup =
  /** A plain list request: the titles, which the Content_Gate has checked (Req 2.2a). */
  | { readonly ok: true; readonly titles: readonly string[] }
  /** A start request: the RESOLVED item. The library opens no session (C40). */
  | { readonly ok: true; readonly item: ContentItemBase }
  | { readonly ok: true; readonly word: WordEntry }
  | { readonly ok: false; readonly reason: "unknown_category" | "not_allowed" | "no_items" };

export interface ContentLibrary {
  lookup(query: ContentQuery): ContentLookup;
  categories(): readonly string[];
}

export function createContentLibrary(
  deps: Readonly<{
    content: Pick<ContentStore, "list" | "get">;
    words: readonly WordEntry[];
    clock: Clock;
  }>,
): ContentLibrary {
  /**
   * The frozen eight, NOT the store's contents. A category with no matching item answers
   * `no_items` — the honest answer — rather than `unknown_category`, and the eight codes this tool
   * knows stay exactly the eight the Input_Guard gates (C4).
   */
  const known: ReadonlySet<string> = new Set<string>(CONTENT_CATEGORIES);

  return {
    lookup(query) {
      const category = query.wordOfTheDay === true ? WORD_OF_THE_DAY_CATEGORY : query.category;
      if (!known.has(category)) return { ok: false, reason: "unknown_category" };
      // The parent's categories gate the library as well as the Input_Guard, so a tool call
      // cannot reach content the parent has not opened even if a model asks for it directly.
      if (!query.allowedCategories.includes(category)) {
        return { ok: false, reason: "not_allowed" };
      }

      if (query.wordOfTheDay === true) {
        const word = wordForDay(deps.words, deps.clock.now(), query.lang);
        return word === null ? { ok: false, reason: "no_items" } : { ok: true, word };
      }

      // Only `active` items, and only those declaring the turn's language and the active child's
      // Age_Stage: a `tiny` child is never offered a `maker` story, even by id (Req 3.1).
      const eligible = deps.content.list({
        category,
        status: "active",
        lang: query.lang,
        ageStage: query.ageStage,
      });

      if (query.contentId !== undefined && query.contentId !== "") {
        const named = eligible.find((item) => item.content_id === query.contentId);
        return named === undefined ? { ok: false, reason: "no_items" } : { ok: true, item: named };
      }
      if (query.start === true) {
        const first = eligible[0];
        return first === undefined ? { ok: false, reason: "no_items" } : { ok: true, item: first };
      }
      const titles = eligible.slice(0, MAX_RESULTS).map((item) => item.title);
      return titles.length === 0 ? { ok: false, reason: "no_items" } : { ok: true, titles };
    },

    categories: () => [...CONTENT_CATEGORIES],
  };
}
