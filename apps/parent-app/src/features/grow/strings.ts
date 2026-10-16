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
  /** Static labels only. Nothing computes, scores, infers or ranks (Req 11.6, D14). */
  metrics: {
    language: { title: "Language", subtitle: "New words this week", value: "+12" },
    reading: { title: "Reading", subtitle: "Stories together", value: "4" },
    curiosity: { title: "Curiosity", subtitle: "Questions & exploration", value: "8" },
    physicalPlay: { title: "Physical Play", subtitle: "Movement & activity", value: "5" },
  },
  /** The interest label is the card's heading; the detail line sits under it. */
  interests: {
    dinosaurs: { label: "Dinosaurs", detail: "6 stories, 12 questions this week" },
    animals: { label: "Animals", detail: "4 stories, 9 questions this week" },
    space: { label: "Space", detail: "3 stories, 7 questions this week" },
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
