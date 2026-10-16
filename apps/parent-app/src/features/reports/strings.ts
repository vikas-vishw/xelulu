// Every user-facing string of screen 15, Reports (Req 22.8). English only; `src/lib/i18n`
// replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.reports`.

export const REPORTS_STRINGS = {
  subheader: "Beautiful moments together.",
  /** The `tablist`'s accessible name, and the scope every segment assertion resolves against. */
  segmentsLabel: "Report period",
  segments: {
    week: "Week",
    month: "Month",
  },
  /** "Aarav's Interests" — the child's display name comes from `MOCK_IDENTITY`. */
  interestsHeading: (childName: string): string => `${childName}'s Interests`,
  /** Req 12.3: the screen says outright what a report is and is not. */
  purposeNote:
    "Reports are summaries you ask for. Xelulu does not profile your child, and nothing here is used for advertising.",
  tiles: {
    storiesHeard: "Stories heard",
    newWords: "New words",
    questionsAsked: "Questions asked",
    playSessions: "Play sessions",
  },
} as const;
