// Screen 13's mock content (Req 19.1, 19.5). Row labels, glyph names, a time label and the
// `GrandmaAssetKind` enum values only: no recording, no file reference and no raw value
// appears anywhere (D13).

import type { GrandmaAssetKind } from "@xelulu/shared";

import type { IconName } from "../../components/icon";

import { GRANDMA_STRINGS } from "./strings";

/** The four row keys, so the screen wires each row without matching on its title. */
export const GRANDMA_ROW_KEYS = ["call", "stories", "festival", "schedule"] as const;
export type GrandmaRowKey = (typeof GRANDMA_ROW_KEYS)[number];

export type GrandmaRow = Readonly<{
  key: GrandmaRowKey;
  icon: IconName;
  title: string;
  subtitle: string;
}>;

export type GrandmaData = Readonly<{
  rows: readonly GrandmaRow[];
  /** The time the schedule panel's field opens with. */
  default_story_time: string;
  /** The kinds a grandparent may record, from the shared domain enum. Not rendered. */
  story_kinds: readonly GrandmaAssetKind[];
}>;

const ROWS = GRANDMA_STRINGS.rows;

export const MOCK_GRANDMA: GrandmaData = {
  rows: [
    { key: "call", icon: "call-outline", title: ROWS.call.title, subtitle: ROWS.call.subtitle },
    {
      key: "stories",
      icon: "book-outline",
      title: ROWS.stories.title,
      subtitle: ROWS.stories.subtitle,
    },
    {
      key: "festival",
      icon: "sparkles-outline",
      title: ROWS.festival.title,
      subtitle: ROWS.festival.subtitle,
    },
    {
      key: "schedule",
      icon: "time-outline",
      title: ROWS.schedule.title,
      subtitle: ROWS.schedule.subtitle,
    },
  ],
  default_story_time: "7:30 PM",
  story_kinds: ["story", "rhyme", "lullaby"],
};
