// Every user-facing string of the Home Dashboard, and the builders that compose them
// (Req 8.7). English only; `src/lib/i18n` replaces this module later.

export const HOME_STRINGS = {
  settingsButton: "Settings",
  todaySection: "Today with Xelulu",
  lastActivitySection: "Last Activity",
  activitiesLabel: "Activities",
  playTimeLabel: "Play time",
  online: "Online",
  offline: "Offline",
  quickActions: {
    play: "Play",
    routines: "Routines",
    voiceCall: "Voice Call",
    settings: "Settings",
  },
} as const;

/** "Good morning, Mom" */
export function greetingLine(greeting: string, parentName: string): string {
  return `${greeting}, ${parentName}`;
}

/** "Aarav is playing with Xelulu" */
export function childLine(childName: string): string {
  return `${childName} is playing with Xelulu`;
}

/** "Battery 78%" */
export function batteryLabel(batteryPct: number): string {
  return `Battery ${batteryPct}%`;
}

/** "25 min" */
export function playTimeValue(minutes: number): string {
  return `${minutes} min`;
}

export function onlineLabel(online: boolean): string {
  return online ? HOME_STRINGS.online : HOME_STRINGS.offline;
}

/** "Xelulu, Online, Battery 78%. Open device" */
export function robotCardLabel(deviceName: string, online: boolean, batteryPct: number): string {
  return `${deviceName}, ${onlineLabel(online)}, ${batteryLabel(batteryPct)}. Open device`;
}
