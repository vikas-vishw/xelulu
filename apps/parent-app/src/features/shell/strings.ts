// Every user-facing string of the navigation shell (Req 8.7). English only; `src/lib/i18n`
// replaces this module later.

import { KIT_STRINGS } from "../../components/strings";

import type { ShellRouteKey, TabKey } from "./routes";

/** Screen titles, exactly as C10 lists them. */
export const ROUTE_TITLE: Readonly<Record<ShellRouteKey, string>> = {
  home: "Home",
  play: "Play",
  grow: "Grow",
  routines: "Routines",
  family: "Family",
  onboarding: "Welcome",
  auth: "Create account",
  "pair-device": "Pair Xelulu",
  "child-profile": "Child profile",
  settings: "Settings",
  device: "Xelulu device",
  privacy: "Privacy & Memory",
  notifications: "Notifications",
  "voice-call": "Live with Xelulu",
  reports: "Reports",
  "grandma-mode": "Grandma Mode",
};

/** Tab_Bar labels. */
export const TAB_LABEL: Readonly<Record<TabKey, string>> = {
  home: "Home",
  play: "Play",
  grow: "Grow",
  routines: "Routines",
  family: "Family",
};

/**
 * The accessible `header`-role name per route (Req 3.4, 21.6), and the single place a header
 * literal is written where the visible title equals the accessible name. Home is excluded:
 * its header is the greeting line.
 *
 * Seeded with each key's `ROUTE_TITLE`. The entries whose Reference header text differs are
 * each owned by the task that builds that screen.
 */
export const SCREEN_HEADER_NAME: Readonly<Record<Exclude<ShellRouteKey, "home">, string>> = {
  /** Screen 8's header text, which the Reference draws instead of the tab label "Play". */
  play: "Play with Xelulu",
  /** Screen 9's header text, which the Reference draws instead of the tab label "Grow". */
  grow: "Growing Together",
  /** Screen 10's header text, which the Reference draws instead of the tab label "Routines". */
  routines: "Daily Routines",
  /** Screen 12's header text, which the Reference draws instead of the tab label "Family". */
  family: "Our Family",
  onboarding: ROUTE_TITLE.onboarding,
  auth: ROUTE_TITLE.auth,
  "pair-device": ROUTE_TITLE["pair-device"],
  "child-profile": ROUTE_TITLE["child-profile"],
  settings: ROUTE_TITLE.settings,
  device: ROUTE_TITLE.device,
  privacy: ROUTE_TITLE.privacy,
  notifications: ROUTE_TITLE.notifications,
  "voice-call": ROUTE_TITLE["voice-call"],
  /** Screen 15's header text, which the Reference draws instead of the route title "Reports". */
  reports: "This Week with Xelulu",
  "grandma-mode": ROUTE_TITLE["grandma-mode"],
};

/** The shell's own screen strings: the Splash / Brand screen (screen 1). */
export const SHELL_STRINGS = {
  wordmark: "Xelulu",
  /** Two centred lines, as the Reference breaks them. */
  tagline: ["A little companion", "for a brighter childhood."],
  /**
   * The footer row. Decision, not a traced reading: the separator is U+2022 BULLET with single
   * spaces, not U+00B7 MIDDLE DOT. The Reference asset cannot settle a 2-3 px glyph, and the two
   * characters are hard to tell apart in a diff, so the codepoint is named here.
   */
  footer: "Play • Learn • Grow • Together",
} as const;

/** The back control's accessibility label, shared with the component kit. */
export const BACK_LABEL = KIT_STRINGS.back;
