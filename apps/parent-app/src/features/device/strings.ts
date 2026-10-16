// Every user-facing string of screen 11, the Device page (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// This is one of the two files allowed to hold the word for the lens v1 does not have (D3,
// Req 25.2): the row below is static text saying the model has none, and it is not a control.
//
// The visible heading is the device's display name, which comes from the Mock_Module, so the
// accessible header name lives once in `SCREEN_HEADER_NAME.device`.

export const DEVICE_STRINGS = {
  online: "Online",
  offline: "Offline",
  /** "Battery 78%" — the percentage is always in the text, never tone alone (Req 14.7, 21.3). */
  batteryLabel: (batteryPct: number): string => `Battery ${batteryPct}%`,
  movement: {
    title: "Movement",
    enabled: "Enabled",
    disabled: "Disabled",
  },
  volume: {
    title: "Volume",
    /** "60%" */
    value: (volumePct: number): string => `${volumePct}%`,
  },
  quietHours: { title: "Quiet Hours" },
  /** D3: v1 has no lens at all, so this row states the fact and carries no control (Req 14.4). */
  cameraRow: {
    title: "Camera",
    subtitle: "Not included on this model",
  },
  sleepWake: {
    title: "Sleep / Wake",
    subtitle: "Put Xelulu to sleep",
  },
  software: { title: "Software & Health" },
  /** The one inline detail panel's dismiss control. */
  closePanel: "Close",
  /** The mock values the Reference prints on the rows. */
  quietHoursLabel: "10:00 PM - 7:00 AM",
  softwareLabel: "Up to date • All good",
  /** The inline detail panels. Mock lines only: this screen sends no command (Req 14.9). */
  panels: {
    quietHours: [
      "Quiet hours run from 10:00 PM to 7:00 AM.",
      "Xelulu stays quiet and still until morning, and the robot enforces this itself.",
      "Changing the schedule arrives with the real device connection.",
    ],
    sleepWake: [
      "Xelulu is awake.",
      "A sleeping Xelulu dims its face and does not move.",
      "Sleep and wake arrive with the real device connection.",
    ],
    software: [
      "The firmware is up to date.",
      "Every sensor reported healthy at the last check.",
      "Xelulu installs its own updates, never this screen.",
    ],
  },
} as const;
