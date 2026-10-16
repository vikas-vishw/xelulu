// Every user-facing string of screen 10, Routines (Req 22.8). English only; `src/lib/i18n`
// replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.routines`.

export const ROUTINES_STRINGS = {
  subheader: "Set a routine, Xelulu makes it special.",
  /** The Reference's leading "+" is the `add` glyph, so the name is the words alone. */
  addRoutine: "Add Routine",
  /** The inline add form (Req 13.4, 13.5). */
  routineName: "Routine name",
  time: "Time",
  confirmAdd: "Add",
  cancel: "Cancel",
  /** The time text of an appended row whose Time field was left empty. */
  timeNotSet: "Not set",
  /** `RoutineRow.subtitle` is required, and an appended row has no Reference subtitle of its
   *  own, so every locally added row carries this one. */
  newRoutineSubtitle: "Your new routine",
  /** The six rows the Reference draws, in its order. */
  rows: {
    morning: { title: "Morning", subtitle: "Wake up and greet", timeLabel: "7:00 AM" },
    brushing: { title: "Brushing", subtitle: "Make it fun", timeLabel: "8:00 AM" },
    meals: { title: "Meals", subtitle: "Gentle reminders", timeLabel: "12:30 PM" },
    playTime: { title: "Play Time", subtitle: "Games & exploration", timeLabel: "5:00 PM" },
    windDown: { title: "Wind Down", subtitle: "Calm activities", timeLabel: "8:00 PM" },
    bedtime: { title: "Bedtime", subtitle: "Stories & good night", timeLabel: "8:30 PM" },
  },
} as const;
