// Every user-facing string of screen 9, Grow / Learning Insights (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.grow`.

export const GROW_STRINGS = {
  subheader: "Everyday learning, naturally.",
  /** The `tablist`'s accessible name, and the scope every segment assertion resolves against. */
  segmentsLabel: "Growth sections",
  segments: {
    overview: "Overview",
    interests: "Interests",
    milestones: "Milestones",
  },
  currentInterests: "Current Interests",
  /** The reports entry row, which the Reference does not draw (D24c, Req 11.5). */
  reportsRow: {
    title: "This Week with Xelulu",
    subtitle: "Reports and summaries",
  },
  /**
   * The four metric labels. The value beside each one is a count out of the shared
   * `summariseActivity` (Phase 4 Req 19.4); nothing scores, infers, ranks or predicts.
   */
  metrics: {
    language: { title: "Language", subtitle: "New words this week" },
    reading: { title: "Reading", subtitle: "Stories together" },
    curiosity: { title: "Curiosity", subtitle: "Questions & exploration" },
    physicalPlay: { title: "Physical Play", subtitle: "Movement & activity" },
  },
  /**
   * One label and one line per Content_Category (Phase 4 Req 19.4). The interest cards name the
   * categories the week's activity touched: content metadata, never a trait or a ranking.
   */
  categories: {
    stories: { label: "Stories", detail: "Stories and tales" },
    songs: { label: "Songs", detail: "Songs and rhymes" },
    animals: { label: "Animals", detail: "Animals and birds" },
    maths: { label: "Numbers", detail: "Counting and shapes" },
    world: { label: "Our World", detail: "Places and people" },
    feelings: { label: "Feelings", detail: "Calm and comfort" },
    manners: { label: "Manners", detail: "Please and thank you" },
    games: { label: "Games", detail: "Moving and playing" },
  },
  milestones: {
    firstSentence: { title: "First full sentence", subtitle: "Language", timeLabel: "2 weeks ago" },
    countsToTwenty: { title: "Counts to twenty", subtitle: "Numbers", timeLabel: "last week" },
    pleaseThankYou: {
      title: "Says please and thank you",
      subtitle: "Manners",
      timeLabel: "3 days ago",
    },
  },
} as const;
