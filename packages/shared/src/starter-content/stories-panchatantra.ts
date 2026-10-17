// Panchatantra retellings (Req 1.4). Original prose written for Xelulu: the tradition is old,
// every word here is new, and `source` names the tradition and nothing else (C5).
//
// The first is linear, one sentence of at most eight words per step in both languages, and is
// therefore tagged `tiny` and `little`. The second branches, so it declares `explorer` and
// `maker` only and carries two choices on its one branching step (C39).
import type { AgeStage } from "../domain/age-stage.js";
import type { StarterItemSpec } from "./index.js";

const RETELLING = "Original retelling written for Xelulu.";
/** A one-sentence-per-step retelling is written for the two narrowest stages (C6, C39). */
const SHORT_STAGES: readonly AgeStage[] = Object.freeze(["tiny", "little"] as const);
/** The two stages a branching item may declare: three sentences fit nowhere narrower (C39). */
const WIDE_STAGES: readonly AgeStage[] = Object.freeze(["explorer", "maker"] as const);

export const PANCHATANTRA_SPECS: readonly StarterItemSpec[] = Object.freeze([
  Object.freeze({
    content_id: "story_panchatantra_drum",
    kind: "story",
    title: "The Monkey and the Drum",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: SHORT_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "panchatantra",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({ "en-IN": "A monkey found a drum.", "hi-IN": "एक बंदर को ढोल मिला।" }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "He tapped it with one finger.",
          "hi-IN": "उसने एक उंगली से थपकी दी।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "The drum went dhum dhum dhum.",
          "hi-IN": "ढोल बोला धुम धुम धुम।",
        }),
        next_step_id: "s4",
      }),
      Object.freeze({
        step_id: "s4",
        text: Object.freeze({
          "en-IN": "A jackal heard the happy sound.",
          "hi-IN": "एक सियार ने खुश आवाज़ सुनी।",
        }),
        next_step_id: "s5",
      }),
      Object.freeze({
        step_id: "s5",
        text: Object.freeze({
          "en-IN": "They played the drum together.",
          "hi-IN": "दोनों ने मिलकर ढोल बजाया।",
        }),
        next_step_id: "s6",
      }),
      Object.freeze({
        step_id: "s6",
        text: Object.freeze({
          "en-IN": "Sharing made the music better.",
          "hi-IN": "साथ बजाने से संगीत अच्छा लगा।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "story_panchatantra_crow",
    kind: "story",
    title: "The Thirsty Crow",
    languages: Object.freeze(["en-IN"] as const),
    age_stages: WIDE_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "panchatantra",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "A crow found a tall pot with a little water at the bottom.",
        }),
        choices: Object.freeze([
          Object.freeze({
            choice_id: "pebbles",
            prompt: Object.freeze({ "en-IN": "Should she drop pebbles in?" }),
            match_terms: Object.freeze({
              "en-IN": Object.freeze(["pebbles", "pebble", "stones", "drop"]),
            }),
            next_step_id: "s2a",
          }),
          Object.freeze({
            choice_id: "stream",
            prompt: Object.freeze({ "en-IN": "Should she look for a stream?" }),
            match_terms: Object.freeze({
              "en-IN": Object.freeze(["stream", "river", "look", "fly"]),
            }),
            next_step_id: "s2b",
          }),
        ]),
        next_step_id: null,
      }),
      Object.freeze({
        step_id: "s2a",
        text: Object.freeze({
          "en-IN": "She dropped pebbles in, and the water rose to the top.",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s2b",
        text: Object.freeze({
          "en-IN": "She flew to a stream and found clean water there.",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "The crow drank happily and thanked her clever mind.",
        }),
        next_step_id: null,
      }),
    ]),
  }),
] as const);
