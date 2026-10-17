// Tenali Raman retellings (Req 1.4). Original prose written for Xelulu; `source` names the
// tradition only (C5).
//
// One wording note that is a safety rule rather than a style choice: a king hears his people in
// his HALL (`दरबार`), never in a court. `court` is on the Output_Guard's legal list, so a
// retelling that used the usual English word would be refused at every Age_Stage and could never
// be made active.
import type { AgeStage } from "../domain/age-stage.js";
import type { StarterItemSpec } from "./index.js";

const RETELLING = "Original retelling written for Xelulu.";
/** A one-sentence-per-step retelling is written for the two narrowest stages (C6, C39). */
const SHORT_STAGES: readonly AgeStage[] = Object.freeze(["tiny", "little"] as const);
const WIDE_STAGES: readonly AgeStage[] = Object.freeze(["explorer", "maker"] as const);

export const TENALI_RAMAN_SPECS: readonly StarterItemSpec[] = Object.freeze([
  Object.freeze({
    content_id: "story_tenali_wall",
    kind: "story",
    title: "Tenali and the Garden Wall",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: SHORT_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "tenali_raman",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Tenali walked into the king's hall.",
          "hi-IN": "तेनाली राजा के दरबार में आया।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "The king wanted a very long wall.",
          "hi-IN": "राजा को बहुत लंबी दीवार चाहिए थी।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Tenali measured the garden with his steps.",
          "hi-IN": "तेनाली ने बगीचा कदमों से नापा।",
        }),
        next_step_id: "s4",
      }),
      Object.freeze({
        step_id: "s4",
        text: Object.freeze({
          "en-IN": "He drew the wall on soft sand.",
          "hi-IN": "उसने दीवार रेत पर बना दी।",
        }),
        next_step_id: "s5",
      }),
      Object.freeze({
        step_id: "s5",
        text: Object.freeze({
          "en-IN": "The king laughed and clapped loudly.",
          "hi-IN": "राजा हँसा और जोर से ताली बजाई।",
        }),
        next_step_id: "s6",
      }),
      Object.freeze({
        step_id: "s6",
        text: Object.freeze({
          "en-IN": "A clever idea needs no gold.",
          "hi-IN": "अच्छी सोच को सोना नहीं चाहिए।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "story_tenali_riddle",
    kind: "story",
    title: "Tenali and the Sleepy Gatekeeper",
    languages: Object.freeze(["en-IN"] as const),
    age_stages: WIDE_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "tenali_raman",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "The palace gate stayed open all night, and the gatekeeper kept yawning.",
        }),
        choices: Object.freeze([
          Object.freeze({
            choice_id: "soup",
            prompt: Object.freeze({ "en-IN": "Should Tenali bring him warm soup?" }),
            match_terms: Object.freeze({
              "en-IN": Object.freeze(["soup", "warm", "food", "bring"]),
            }),
            next_step_id: "s2a",
          }),
          Object.freeze({
            choice_id: "riddle",
            prompt: Object.freeze({ "en-IN": "Should Tenali ask him a riddle?" }),
            match_terms: Object.freeze({
              "en-IN": Object.freeze(["riddle", "puzzle", "question", "ask"]),
            }),
            next_step_id: "s2b",
          }),
        ]),
        next_step_id: null,
      }),
      Object.freeze({
        step_id: "s2a",
        text: Object.freeze({
          "en-IN": "The warm soup woke him up, and he stood tall again.",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s2b",
        text: Object.freeze({
          "en-IN": "The riddle kept him thinking happily until sunrise.",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Tenali solved the problem with kindness and wit.",
        }),
        next_step_id: null,
      }),
    ]),
  }),
] as const);
