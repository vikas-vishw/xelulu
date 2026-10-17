// Every user-facing string of screen 8, Play & Adventure (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.play`.

export const PLAY_STRINGS = {
  /** The `tablist`'s accessible name, and the scope every segment assertion resolves against. */
  segmentsLabel: "Play categories",
  segments: {
    all: "All",
    games: "Games",
    stories: "Stories",
    learning: "Learning",
  },
  /** The one muted notice line, set when a card is pressed (Req 10.5). */
  startsFromRobot: "Xelulu starts this on the robot. Starting it from the app comes later.",
  /** The one muted line when a segment holds no card (Req 10.4). */
  nothingHere: "Nothing here yet.",
  /**
   * One subtitle per segment (Phase 4 Req 19.3). A Content_Item carries a title and no subtitle,
   * and the app invents no per-item text, so every card in a segment carries that segment's line.
   */
  cardSubtitles: {
    games: "Play and move together",
    stories: "Listen together",
    learning: "Learn together",
  },
} as const;
