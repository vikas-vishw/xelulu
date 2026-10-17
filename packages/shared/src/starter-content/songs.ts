// The starter songs (Req 1.4, 1.5): three original pieces — a song, a lullaby and a rhyme — one
// of them Hindi only and one bilingual. Original wording written for Xelulu; `source` is `folk`
// for a piece in the shape of a traditional one and `original` for a new idea, and neither names
// an author, an edition or a recording (C5).
//
// All three declare every Age_Stage, so every line is one sentence of at most eight words in each
// language it declares.
import { AGE_STAGES, type AgeStage } from "../domain/age-stage.js";
import type { StarterItemSpec } from "./index.js";

const SONG = "Original song written for Xelulu.";
const ALL_STAGES: readonly AgeStage[] = AGE_STAGES;

export const SONG_SPECS: readonly StarterItemSpec[] = Object.freeze([
  Object.freeze({
    content_id: "song_rain_roof",
    kind: "song",
    title: "Rain on the Roof",
    languages: Object.freeze(["en-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["songs"] as const),
    source: "original",
    licence_note: SONG,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({ "en-IN": "Rain taps on the roof." }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({ "en-IN": "Drip drop, drip drop, hello." }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({ "en-IN": "We clap along with the rain." }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "song_chand_lori",
    kind: "lullaby",
    title: "चाँद की लोरी",
    languages: Object.freeze(["hi-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["songs"] as const),
    source: "folk",
    licence_note: SONG,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({ "hi-IN": "चाँद धीरे धीरे आया।" }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({ "hi-IN": "नींद आँखों में उतर आई।" }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({ "hi-IN": "सो जाओ मेरे नन्हे।" }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "song_clap_count",
    kind: "rhyme",
    title: "Clap and Count",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["songs"] as const),
    source: "original",
    licence_note: SONG,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Clap your hands two times.",
          "hi-IN": "दो बार ताली बजाओ।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "Tap your feet two times.",
          "hi-IN": "दो बार पैर थपथपाओ।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Now hug yourself and smile.",
          "hi-IN": "अब खुद को गले लगाओ।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
] as const);
