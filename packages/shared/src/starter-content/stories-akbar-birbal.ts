// Akbar-Birbal retellings (Req 1.4). Original prose written for Xelulu; `source` names the
// tradition only (C5). As in the Tenali module, the king hears his people in his hall: `court` is
// on the Output_Guard's legal list and could never pass the Content_Gate.
import type { AgeStage } from "../domain/age-stage.js";
import type { StarterItemSpec } from "./index.js";

const RETELLING = "Original retelling written for Xelulu.";
/** A one-sentence-per-step retelling is written for the two narrowest stages (C6, C39). */
const SHORT_STAGES: readonly AgeStage[] = Object.freeze(["tiny", "little"] as const);
const WIDE_STAGES: readonly AgeStage[] = Object.freeze(["explorer", "maker"] as const);

export const AKBAR_BIRBAL_SPECS: readonly StarterItemSpec[] = Object.freeze([
  Object.freeze({
    content_id: "story_akbar_birbal_line",
    kind: "story",
    title: "Birbal and the Long Line",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: SHORT_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "akbar_birbal",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Akbar drew a line on paper.",
          "hi-IN": "अकबर ने कागज़ पर रेखा खींची।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "He asked Birbal to make it shorter.",
          "hi-IN": "उसने बीरबल से छोटी करने कहा।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Birbal did not rub the line.",
          "hi-IN": "बीरबल ने रेखा मिटाई नहीं।",
        }),
        next_step_id: "s4",
      }),
      Object.freeze({
        step_id: "s4",
        text: Object.freeze({
          "en-IN": "He drew a longer line near it.",
          "hi-IN": "उसने पास लंबी रेखा खींच दी।",
        }),
        next_step_id: "s5",
      }),
      Object.freeze({
        step_id: "s5",
        text: Object.freeze({
          "en-IN": "Now the first line looked small.",
          "hi-IN": "अब पहली रेखा छोटी लगने लगी।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "story_akbar_birbal_pot",
    kind: "story",
    title: "Birbal and the Pot of Rice",
    languages: Object.freeze(["en-IN"] as const),
    age_stages: WIDE_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "akbar_birbal",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN":
            "Akbar hid a ring inside a tall pot of rice. He asked who could find it without peeping.",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN":
            "Birbal tipped the pot slowly and listened to the gentle rattle. The ring slid up to the rim.",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Patience hears what hurried hands miss. Akbar smiled and gave him the ring.",
        }),
        next_step_id: null,
      }),
    ]),
  }),
] as const);
