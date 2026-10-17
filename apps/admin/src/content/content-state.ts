// Pure Content page state: the section filter, what each read returned, and the last write's
// outcome (Req 17.1, 17.2, 17.5, 17.6). No I/O, no DOM, no fetch. The reducer never mutates its
// input and returns new objects.
import type { ContentKind } from "@xelulu/shared";

import type {
  ClientRefusal,
  ContentItemBody,
  ContentListBody,
  ContentSummaryView,
  GrandmaBody,
  ReportsBody,
  RoutinesBody,
} from "./content-client";

/** The five sections of the page's filter (Req 17.1). */
export const CONTENT_SECTIONS = Object.freeze([
  "Stories",
  "Games",
  "Songs",
  "Learning",
  "Grandma",
] as const);

export type ContentSection = (typeof CONTENT_SECTIONS)[number];

/**
 * The five sections cover the six Content_Kinds exhaustively and without overlap, so no item can
 * be invisible on the page (Req 17.1). `Grandma` lists recordings rather than Content_Items and
 * therefore maps onto no kind.
 */
export const SECTION_KINDS: Readonly<
  Record<Exclude<ContentSection, "Grandma">, readonly ContentKind[]>
> = Object.freeze({
  Stories: Object.freeze(["story"] as const),
  Games: Object.freeze(["game"] as const),
  Songs: Object.freeze(["song", "rhyme", "lullaby"] as const),
  Learning: Object.freeze(["learning"] as const),
});

/** The items of one section, in the order the surface returned them. A new array every time. */
export function itemsInSection(
  items: readonly ContentSummaryView[],
  section: ContentSection,
): readonly ContentSummaryView[] {
  if (section === "Grandma") return [];
  const kinds: readonly ContentKind[] = SECTION_KINDS[section];
  return items.filter((item) => kinds.includes(item.kind));
}

export type ContentPageState = Readonly<{
  section: ContentSection;
  /** null until the first `GET /v1/content` of this page answered. */
  items: readonly ContentSummaryView[] | null;
  grandma: GrandmaBody | null;
  routines: RoutinesBody | null;
  reports: ReportsBody | null;
  /** Whether the Gateway runs with the Content_Admin_Argument (Req 17.4, 17.5). */
  writeEnabled: boolean;
  /** The one item the operator opened in the editor, in full, or null. */
  editing: ContentItemBody | null;
  pending: boolean;
  /** The last refusal, shown as text; cleared by the next successful read or write. */
  refusal: ClientRefusal | null;
  /** One line naming what the last successful write did. */
  note: string | null;
}>;

export const INITIAL_CONTENT_STATE: ContentPageState = Object.freeze({
  section: "Stories",
  items: null,
  grandma: null,
  routines: null,
  reports: null,
  writeEnabled: false,
  editing: null,
  pending: false,
  refusal: null,
  note: null,
});

export type ContentPageAction =
  | { type: "section"; section: ContentSection }
  | { type: "pending" }
  | { type: "content"; body: ContentListBody }
  | { type: "grandma"; body: GrandmaBody }
  | { type: "routines"; body: RoutinesBody }
  | { type: "reports"; body: ReportsBody }
  | { type: "editing"; body: ContentItemBody | null }
  | { type: "refused"; refusal: ClientRefusal }
  | { type: "wrote"; note: string };

export function contentReducer(
  state: ContentPageState,
  action: ContentPageAction,
): ContentPageState {
  switch (action.type) {
    case "section":
      // Changing section closes the editor: it holds one item, and that item was in the old one.
      return { ...state, section: action.section, editing: null };
    case "pending":
      return { ...state, pending: true };
    case "content":
      return {
        ...state,
        items: [...action.body.items],
        writeEnabled: action.body.write_enabled,
        pending: false,
        refusal: null,
      };
    case "grandma":
      return {
        ...state,
        grandma: action.body,
        writeEnabled: action.body.write_enabled,
        pending: false,
        refusal: null,
      };
    case "routines":
      return { ...state, routines: action.body, pending: false, refusal: null };
    case "reports":
      return { ...state, reports: action.body, pending: false, refusal: null };
    case "editing":
      return { ...state, editing: action.body, pending: false };
    case "refused":
      // A refusal changes nothing the page holds: the state it shows is still what the surface
      // last reported (Req 16.14, 17.6a).
      return { ...state, refusal: action.refusal, pending: false, note: null };
    case "wrote":
      return { ...state, note: action.note, refusal: null, pending: false };
  }
}

/** A refusal as one line of text: the code, then whichever of the four details it carried. */
export function refusalText(refusal: ClientRefusal): string {
  const parts: string[] = [refusal.code];
  if (refusal.field !== null) parts.push(`field ${refusal.field}`);
  if (refusal.reason !== null) parts.push(refusal.reason);
  const verdict = refusal.verdict;
  if (verdict !== null && !verdict.ok) {
    parts.push(`${verdict.rule} at ${verdict.age_stage} ${verdict.lang} (${verdict.field})`);
  }
  if (refusal.gate !== null) {
    parts.push(`${refusal.gate.rule} at ${refusal.gate.age_stage} ${refusal.gate.lang}`);
  }
  return parts.join(" · ");
}

/** An item's own verdict as text, for a refused draft's row (Req 17.2). */
export function verdictText(verdict: ContentSummaryView["verdict"]): string {
  if (verdict === null) return "Not gated yet";
  if (verdict.ok) return "Passed";
  return `Refused: ${verdict.rule} at ${verdict.age_stage} ${verdict.lang} (${verdict.field})`;
}
