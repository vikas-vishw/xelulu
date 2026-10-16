// Every user-facing string of screen 13, Grandma Mode (Req 22.8). English only;
// `src/lib/i18n` replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME["grandma-mode"]`.
//
// The first row reads "Voice Call with Xelulu", where the Reference offers a picture instead
// (D5, Req 16.2): v1 has no camera, so a call is audio and status only. No string on this
// screen names a lens or a picture, and no clone-voice control exists (Req 16.7).

export const GRANDMA_STRINGS = {
  subheader: "Stories, calls and special moments.",
  rows: {
    /** D5: the Reference's first row offers a picture; ours is a call with sound only. */
    call: { title: "Voice Call with Xelulu", subtitle: "Talk and listen together" },
    stories: { title: "Grandma's Stories", subtitle: "Cultural stories & rhymes" },
    festival: { title: "Festival Special", subtitle: "Diwali, Eid, Christmas & more" },
    schedule: { title: "Schedule a Story", subtitle: "Set time for a daily story" },
  },
  /** The Festival row's muted trailing text: G08 (festivals) is a P1 feature (`product.md`). */
  laterPhase: "Later phase",
  /** The record panel: one control, and the line its press reveals (Req 16.5). */
  record: "Record",
  recordLater: "Recording arrives with the real audio pipeline in a later phase.",
  /** The schedule panel: the time field's label and its confirm control (Req 16.4). */
  storyTime: "Story time",
  setTime: "Set time",
  /** "The mock set a daily story at 7:30 PM. Nothing was saved." */
  scheduleMock: (time: string): string =>
    `The mock set a daily story at ${time}. Nothing was saved.`,
  /** Req 16.6, `safety.md` §1: a grandparent recording is adult-provided content. */
  consentNote:
    "A grandparent's recording is adult-provided content. It is stored only with a recorded consent statement, and it is never child audio.",
  callGrandmaMode: "Call Grandma Mode",
} as const;
