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
  /** The eight mock cards, in the Reference's order with its four first (Req 10.2). */
  items: {
    animalAdventure: { title: "Animal Adventure", subtitle: "Go on a quest" },
    treasureHunt: { title: "Treasure Hunt", subtitle: "Find, explore, learn" },
    dance: { title: "Dance with Xelulu", subtitle: "Move and groove" },
    storyTime: { title: "Story Time", subtitle: "Bedtime tales together" },
    rhymeTime: { title: "Rhyme Time", subtitle: "Songs and rhymes" },
    countingFun: { title: "Counting Fun", subtitle: "Numbers and shapes" },
    ourWorld: { title: "Our World", subtitle: "Places and people" },
    feelings: { title: "Feelings & Breathing", subtitle: "Calm together" },
  },
} as const;
