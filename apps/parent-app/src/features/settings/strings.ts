// Every user-facing string of screen 16b, Settings (Req 22.8), plus its row table. English
// only; `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.settings`.
//
// The nine rows are navigation, not data, so this screen has no Mock_Module (Req 19.1). No
// secret, token, key name, endpoint or environment value appears anywhere on it (Req 18.7).

import type { IconName } from "../../components/icon";
import type { ShellRouteKey } from "../shell/routes";

/** The five settings rows that open a route. The other four rows carry no `route`. */
export type SettingsRouteKey = Extract<
  ShellRouteKey,
  "child-profile" | "device" | "routines" | "privacy" | "notifications"
>;

export type SettingsRow = Readonly<{
  key: string;
  icon: IconName;
  title: string;
  route?: SettingsRouteKey;
}>;

export const SETTINGS_STRINGS = {
  /** The muted trailing text of the four rows that do nothing yet (D20). */
  laterPhase: "Later phase",
  rows: {
    account: "Account",
    childProfiles: "Child profiles",
    devices: "Devices",
    routines: "Routines",
    privacy: "Privacy",
    notifications: "Notifications",
    language: "Language",
    help: "Help",
    about: "About",
  },
} as const;

/**
 * The nine rows in Req 18.4's order. A row opens a route exactly when it carries one, so the
 * five route rows and the four inert rows are distinguished by that and nothing else.
 */
export const SETTINGS_ROWS: readonly SettingsRow[] = [
  { key: "account", icon: "person-circle-outline", title: SETTINGS_STRINGS.rows.account },
  {
    key: "child-profiles",
    icon: "people-outline",
    title: SETTINGS_STRINGS.rows.childProfiles,
    route: "child-profile",
  },
  {
    key: "devices",
    icon: "hardware-chip-outline",
    title: SETTINGS_STRINGS.rows.devices,
    route: "device",
  },
  {
    key: "routines",
    icon: "calendar-outline",
    title: SETTINGS_STRINGS.rows.routines,
    route: "routines",
  },
  {
    key: "privacy",
    icon: "lock-closed-outline",
    title: SETTINGS_STRINGS.rows.privacy,
    route: "privacy",
  },
  {
    key: "notifications",
    icon: "notifications-outline",
    title: SETTINGS_STRINGS.rows.notifications,
    route: "notifications",
  },
  { key: "language", icon: "language-outline", title: SETTINGS_STRINGS.rows.language },
  { key: "help", icon: "help-circle-outline", title: SETTINGS_STRINGS.rows.help },
  { key: "about", icon: "information-circle-outline", title: SETTINGS_STRINGS.rows.about },
];
