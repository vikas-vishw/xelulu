// The `content_lookup` tool's source (Req 9.4). safety.md §3 is categorical: stories, songs and
// media come only from the curated library, so this is the only place a title can come from. The
// library is an in-process fixture in this phase (C10) with no I/O of any kind — no file read, no
// network, no database — and the real curated library arrives with the backend.
//
// A lookup answers with a short sentence naming at most MAX_RESULTS items. It never returns a
// URL, a price or a brand (safety.md §3), and every reply it produces still runs the Output_Guard
// before a frame is synthesised, so this fixture is not trusted to police itself either.
import { type SupportedLang } from "@xelulu/shared";

/** Items named in one answer. Three keeps the reply inside even `tiny`'s word limit. */
export const MAX_RESULTS = 3;

export type ContentFixtureItem = Readonly<{
  /** Matches a Child_Context allowed category, so an unopened category returns nothing. */
  category: string;
  lang: SupportedLang;
  title: string;
}>;

export const CONTENT_FIXTURE: readonly ContentFixtureItem[] = Object.freeze([
  { category: "stories", lang: "en-IN", title: "The Brave Elephant" },
  { category: "stories", lang: "en-IN", title: "The Clever Crow" },
  { category: "stories", lang: "en-IN", title: "The Kind Mouse" },
  { category: "stories", lang: "hi-IN", title: "बहादुर हाथी" },
  { category: "stories", lang: "hi-IN", title: "चतुर कौआ" },
  { category: "songs", lang: "en-IN", title: "Rain on the Roof" },
  { category: "songs", lang: "hi-IN", title: "बारिश की धुन" },
  { category: "animals", lang: "en-IN", title: "Lions of the Grassland" },
  { category: "animals", lang: "hi-IN", title: "घास के मैदान के शेर" },
  { category: "games", lang: "en-IN", title: "Freeze Dance" },
  { category: "maths", lang: "en-IN", title: "Counting to Ten" },
  { category: "world", lang: "en-IN", title: "Our Blue Planet" },
  { category: "feelings", lang: "en-IN", title: "Breathing Like a Balloon" },
  { category: "manners", lang: "en-IN", title: "Please and Thank You" },
]);

export type ContentQuery = Readonly<{
  category: string;
  lang: SupportedLang;
  /** The categories the parent has opened. A category outside this list returns nothing. */
  allowedCategories: readonly string[];
}>;

export type ContentLookup =
  | { readonly ok: true; readonly titles: readonly string[] }
  | { readonly ok: false; readonly reason: "unknown_category" | "not_allowed" | "no_items" };

export interface ContentLibrary {
  lookup(query: ContentQuery): ContentLookup;
  categories(): readonly string[];
}

export function createContentLibrary(
  items: readonly ContentFixtureItem[] = CONTENT_FIXTURE,
): ContentLibrary {
  const known = new Set(items.map((item) => item.category));

  return {
    lookup(query) {
      if (!known.has(query.category)) return { ok: false, reason: "unknown_category" };
      // The parent's categories gate the library as well as the Input_Guard, so a tool call
      // cannot reach content the parent has not opened even if a model asks for it directly.
      if (!query.allowedCategories.includes(query.category)) {
        return { ok: false, reason: "not_allowed" };
      }
      const titles = items
        .filter((item) => item.category === query.category && item.lang === query.lang)
        .slice(0, MAX_RESULTS)
        .map((item) => item.title);
      return titles.length === 0 ? { ok: false, reason: "no_items" } : { ok: true, titles };
    },

    categories: () => [...known],
  };
}
