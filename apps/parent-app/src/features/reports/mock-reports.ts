// Screen 15's presentation map (Phase 4 Req 19.4). The four numbers are gone from here: they are
// counts out of the shared `summariseActivity`, read through the reports In_App_Store
// (`src/lib/stores/report-store.ts`). What stays is the tile's icon, tone and label.
//
// A report is a summary a parent asked for (safety.md §2): nothing here or on the screen profiles
// a child, infers, scores or ranks, and nothing is used for advertising.

import type { IconName } from "../../components/icon";
import type { IconTileTone } from "../../components/icon-tile";

import { REPORTS_STRINGS } from "./strings";

/** The screen's two segments. Not the shared `ReportPeriod`, which has no monthly member. */
export type ReportPeriodKey = "week" | "month";

/** The four tiles, in the Reference's order. The store counts one value per key. */
export const REPORT_TILE_KEYS = Object.freeze([
  "stories-heard",
  "new-words",
  "questions-asked",
  "play-sessions",
] as const);
export type ReportTileKey = (typeof REPORT_TILE_KEYS)[number];

export type ReportTile = Readonly<{
  key: ReportTileKey;
  icon: IconName;
  /** The tile's colour, as the Reference draws screen 15's four summaries. */
  icon_tone: IconTileTone;
  /** Already-formatted display value, counted by the store. */
  value: string;
  label: string;
}>;

const TILES = REPORTS_STRINGS.tiles;

export type ReportTilePresentation = Readonly<{
  key: ReportTileKey;
  icon: IconName;
  icon_tone: IconTileTone;
  label: string;
}>;

export const REPORT_TILE_PRESENTATION: readonly ReportTilePresentation[] = Object.freeze([
  { key: "stories-heard", icon: "book-outline", icon_tone: "rose", label: TILES.storiesHeard },
  {
    key: "new-words",
    icon: "chatbubble-ellipses-outline",
    icon_tone: "mint",
    label: TILES.newWords,
  },
  {
    key: "questions-asked",
    icon: "help-circle-outline",
    icon_tone: "rose",
    label: TILES.questionsAsked,
  },
  {
    key: "play-sessions",
    icon: "game-controller-outline",
    icon_tone: "amber",
    label: TILES.playSessions,
  },
]);
