// The navigation shell's route table (C10). The one place a route href is written, because
// Expo Router's typed routes stay off.

export const TAB_KEYS = ["home", "play", "grow", "routines", "family"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const STACK_KEYS = [
  "onboarding",
  "auth",
  "pair-device",
  "child-profile",
  "settings",
  "device",
  "privacy",
  "notifications",
  "voice-call",
  "reports",
  "grandma-mode",
] as const;
export type StackKey = (typeof STACK_KEYS)[number];

export type ShellRouteKey = TabKey | StackKey;

/** URL path per route key. */
export const ROUTE_PATH: Readonly<Record<ShellRouteKey, `/${string}`>> = {
  home: "/home",
  play: "/play",
  grow: "/grow",
  routines: "/routines",
  family: "/family",
  onboarding: "/onboarding",
  auth: "/auth",
  "pair-device": "/pair-device",
  "child-profile": "/child-profile",
  settings: "/settings",
  device: "/device",
  privacy: "/privacy",
  notifications: "/notifications",
  "voice-call": "/voice-call",
  reports: "/reports",
  "grandma-mode": "/grandma-mode",
};

const STACK_KEY_SET: ReadonlySet<string> = new Set<string>(STACK_KEYS);

/** True for a Stack_Route: it is shown without the Tab_Bar and carries a back control. */
export function isStackRoute(key: ShellRouteKey): key is StackKey {
  return STACK_KEY_SET.has(key);
}
