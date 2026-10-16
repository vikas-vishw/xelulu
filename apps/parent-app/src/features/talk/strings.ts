// Every user-facing string of screen 7, Live View & Voice Call (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME["voice-call"]`.

export const TALK_STRINGS = {
  /** The trailing gear control in the header. */
  settings: "Settings",
  mute: "Mute",
  endCall: "End Call",
  /** D4: the Reference's third control is "Rotate", a lens control. v1 has no lens. */
  speaker: "Speaker",
  /** The state words, so Mute and Speaker never report state by colour alone (Req 9.4, 21.3). */
  micOn: "Mic on",
  micOff: "Mic off",
  speakerOn: "Speaker on",
  speakerOff: "Speaker off",
} as const;
