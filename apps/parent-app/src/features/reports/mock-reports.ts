// Screen 15's mock summaries (Req 19.1, 19.5). Static counts and labels only: nothing here or
// on the screen computes, infers, scores or ranks (Req 12.4, D14). No advertising, no
// third-party content and no behavioural inference.

import type { ReportPeriod } from "@xelulu/shared";

import type { IconName } from "../../components/icon";
import type { IconTileTone } from "../../components/icon-tile";

import { REPORTS_STRINGS } from "./strings";

/** The screen's two segments. Not the shared `ReportPeriod`. */
export type ReportPeriodKey = "week" | "month";

export type ReportTile = Readonly<{
  key: string;
  icon: IconName;
  /** The tile's colour, as the Reference draws screen 15's four summaries. */
  icon_tone: IconTileTone;
  /** Already-formatted display value. Never computed. */
  value: string;
  label: string;
}>;

export type ReportSet = Readonly<{
  /** `daily | weekly`. `"weekly"` for both sets: the union has no monthly member, so the Month
   *  segment is a mock aggregate of weekly summaries. Not rendered, and never cast. */
  period: ReportPeriod;
  tiles: readonly ReportTile[];
  interests_label: string;
}>;

export type ReportsData = Readonly<Record<ReportPeriodKey, ReportSet>>;

const TILES = REPORTS_STRINGS.tiles;

/** The four tiles, in the Reference's order, with one set's four values. */
function tilesFor(
  storiesHeard: string,
  newWords: string,
  questionsAsked: string,
  playSessions: string,
): readonly ReportTile[] {
  return [
    {
      key: "stories-heard",
      icon: "book-outline",
      icon_tone: "rose",
      value: storiesHeard,
      label: TILES.storiesHeard,
    },
    {
      key: "new-words",
      icon: "chatbubble-ellipses-outline",
      icon_tone: "mint",
      value: newWords,
      label: TILES.newWords,
    },
    {
      key: "questions-asked",
      icon: "help-circle-outline",
      icon_tone: "rose",
      value: questionsAsked,
      label: TILES.questionsAsked,
    },
    {
      key: "play-sessions",
      icon: "game-controller-outline",
      icon_tone: "amber",
      value: playSessions,
      label: TILES.playSessions,
    },
  ];
}

const INTERESTS_LABEL = "Dinosaurs, Space, Animals";

export const MOCK_REPORTS: ReportsData = {
  /** The Reference's four numbers. */
  week: {
    period: "weekly",
    tiles: tilesFor("5", "12", "8", "6"),
    interests_label: INTERESTS_LABEL,
  },
  month: {
    period: "weekly",
    tiles: tilesFor("18", "44", "31", "22"),
    interests_label: INTERESTS_LABEL,
  },
};
