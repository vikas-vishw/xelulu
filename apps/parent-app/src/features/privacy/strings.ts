// Every user-facing string of screen 14, Privacy & Memory (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.privacy`.
//
// This is the DPDP erasure and export surface (`safety.md` §2). Nothing on it deletes, exports
// or sends anything in this phase, and no line claims otherwise (Req 17.8, 17.9).

import type { GrandmaAssetKind } from "@xelulu/shared";

export const PRIVACY_STRINGS = {
  subheader: "You are in control.",
  /** The `tablist`'s accessible name, and the scope every segment assertion resolves against. */
  segmentsLabel: "Privacy sections",
  segments: {
    memory: "Memory",
    recordings: "Recordings",
    settings: "Settings",
  },
  remembersTitle: "What Xelulu Remembers",
  /** "15 items • View and manage" */
  remembersRow: (count: number): string => `${count} items • View and manage`,
  recentMemories: "Recent Memories",
  viewAll: "View All Memories",
  showLess: "Show Less",
  /**
   * The fifteen memory lines. Short parent-facing summaries only: never a transcript, never an
   * audio reference and never a raw value (Req 17.9, D13). The first three are the Reference's
   * and keep its order and age labels (Req 17.2).
   */
  memories: {
    dinosaurs: {
      label: (childName: string): string => `${childName} loves dinosaurs`,
      ageLabel: "2 days ago",
    },
    hindiStories: { label: "Prefers Hindi bedtime stories", ageLabel: "3 days ago" },
    space: { label: "Gets excited about space", ageLabel: "5 days ago" },
    counting: { label: "Counts to twenty", ageLabel: "1 week ago" },
    braveElephant: { label: "Favourite story: the brave elephant", ageLabel: "1 week ago" },
    greeting: { label: "Likes the morning greeting", ageLabel: "1 week ago" },
    moon: { label: "Asks about the moon", ageLabel: "2 weeks ago" },
    nickname: {
      label: (deviceName: string): string => `Calls ${deviceName} 'Lulu'`,
      ageLabel: "2 weeks ago",
    },
    freezeDance: { label: "Enjoys freeze dance", ageLabel: "2 weeks ago" },
    sharing: {
      label: (siblingName: string): string => `Shares toys with ${siblingName}`,
      ageLabel: "3 weeks ago",
    },
    animalNames: { label: "Knows five animal names", ageLabel: "3 weeks ago" },
    hindiRhymes: { label: "Likes rhymes in Hindi", ageLabel: "3 weeks ago" },
    brushing: { label: "Brushing goes better with a song", ageLabel: "4 weeks ago" },
    bedtimeWave: { label: "Waves goodbye at bedtime", ageLabel: "4 weeks ago" },
    rain: { label: "Curious about rain", ageLabel: "5 weeks ago" },
  },
  /** Req 17.4: the Recordings panel holds adult-provided grandparent content only. */
  recordingsHeading: "Grandparent Recordings",
  /** "Story • Hindi" — the kind and the language, as text. */
  recordingLine: (kindLabel: string, languageLabel: string): string =>
    `${kindLabel} • ${languageLabel}`,
  /** "Recorded by Grandma, 12 Jan 2026" */
  recordedBy: (name: string, dateLabel: string): string => `Recorded by ${name}, ${dateLabel}`,
  /** "Consent recorded by Mom, 12 Jan 2026, notice v1" */
  consentStatement: (name: string, dateLabel: string, noticeVersion: string): string =>
    `Consent recorded by ${name}, ${dateLabel}, notice ${noticeVersion}`,
  /** `safety.md` §1, stated on the screen and not only in a comment. */
  noChildAudio: "No child audio is ever stored.",
  /** The four mock toggles of the Settings panel (Req 17.5). */
  toggles: {
    /** Titled "Transcripts": they are text only, and they are never the child's voice. */
    textRecords: { title: "Transcripts", subtitle: "Text only, never a recording" },
    cryAlerts: { title: "Cry alerts", subtitle: "Tell me when Xelulu hears crying" },
    weeklyReports: { title: "Weekly reports", subtitle: "A summary I ask for, nothing more" },
    memory: { title: "Memory", subtitle: "Let Xelulu remember what your child likes" },
  },
  /** Req 17.5, `safety.md` §1. */
  retentionLine: "Transcripts are text only and are deleted after 30 days by default.",
  /** Req 17.10, `safety.md` §2. */
  withdrawalLine:
    "Withdrawing consent is as easy as giving it. In the shipped product, withdrawal deletes the data it covered.",
  deleteOrExport: "Delete or Export Data",
  /** The Confirm_Dialog. Nothing it offers changes anything in this phase (Req 17.6-17.9). */
  dialog: {
    title: "Delete or export your data",
    body: "This build is a mock. Nothing is deleted, exported or sent anywhere.",
    cancel: "Cancel",
    deleteEverything: "Delete everything",
    exportData: "Export data",
  },
  /** The one line either action leaves behind. It claims nothing (Req 17.8, 17.9). */
  mockLine: "This build is a mock. Nothing was deleted, exported or sent.",
} as const;

/** Display label per recording kind, so the screen never prints the raw enum value. */
export const RECORDING_KIND_LABEL: Readonly<Record<GrandmaAssetKind, string>> = {
  story: "Story",
  rhyme: "Rhyme",
  lullaby: "Lullaby",
  message: "Message",
};

/**
 * Display label for a BCP-47-like language tag. `GrandmaAsset.lang` is a tag, not a label, so
 * the two languages this phase shows are mapped here and an unknown tag renders as itself.
 * Phase 3 replaces this with the real language table.
 */
export function languageLabel(tag: string): string {
  if (tag === "hi") return "Hindi";
  if (tag === "en") return "English";
  return tag;
}
