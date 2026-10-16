// Every user-facing string of screen 16a, Notifications (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.notifications`.

export const NOTIFICATION_STRINGS = {
  /** The `tablist`'s accessible name, and the scope every segment assertion resolves against. */
  segmentsLabel: "Notification kinds",
  segments: {
    all: "All",
    device: "Device",
    activity: "Activity",
  },
  /** The five rows the Reference draws, in its order. */
  rows: {
    charging: { title: "Xelulu is charging", detail: "Battery at 20%", timeLabel: "10 min ago" },
    playTime: {
      title: "Play time completed",
      detail: "Today's play time reached",
      timeLabel: "1 hour ago",
    },
    memory: {
      /** The detail names the child, so the name comes from `MOCK_IDENTITY` (Req 19.6). */
      title: "New memory saved",
      detail: (childName: string): string => `${childName} loves space`,
      timeLabel: "2 hours ago",
    },
    bedtime: {
      title: "Bedtime routine starting",
      detail: "Story time in 10 minutes",
      timeLabel: "Today, 8:20 PM",
    },
    software: {
      title: "Software update available",
      detail: "New features for Xelulu",
      timeLabel: "1 day ago",
    },
  },
  /** Shown when a filter matches no row. */
  nothingHere: "Nothing here yet.",
} as const;
