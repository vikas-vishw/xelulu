// Jataka retellings (Req 1.4). Original prose written for Xelulu; `source` names the tradition
// only (C5).
//
// The first is one short sentence per step and is therefore tagged `tiny` and `little`; the
// second runs to two sentences a step and is tagged `explorer` and `maker`. That split is the age
// shape rather than a preference: eight words is what `tiny` has room for, and a twelve-year-old
// should not be handed toddler prose. Both carry Hindi, so every stage has a Hindi Jataka tale.
import type { AgeStage } from "../domain/age-stage.js";
import type { StarterItemSpec } from "./index.js";

const RETELLING = "Original retelling written for Xelulu.";
/** A one-sentence-per-step retelling is written for the two narrowest stages (C6, C39). */
const SHORT_STAGES: readonly AgeStage[] = Object.freeze(["tiny", "little"] as const);
const WIDE_STAGES: readonly AgeStage[] = Object.freeze(["explorer", "maker"] as const);

export const JATAKA_SPECS: readonly StarterItemSpec[] = Object.freeze([
  Object.freeze({
    content_id: "story_jataka_bird",
    kind: "story",
    title: "The Elephant and the Little Bird",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: SHORT_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "jataka",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "A little bird built a nest.",
          "hi-IN": "एक छोटी चिड़िया ने घोंसला बनाया।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "A big elephant walked that way.",
          "hi-IN": "एक बड़ा हाथी उस रास्ते आया।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "The bird asked him to turn aside.",
          "hi-IN": "चिड़िया ने हाथी से रास्ता बदलने कहा।",
        }),
        next_step_id: "s4",
      }),
      Object.freeze({
        step_id: "s4",
        text: Object.freeze({
          "en-IN": "The elephant stepped around the nest.",
          "hi-IN": "हाथी घोंसले के पास से घूमा।",
        }),
        next_step_id: "s5",
      }),
      Object.freeze({
        step_id: "s5",
        text: Object.freeze({
          "en-IN": "Later the bird warned him of danger.",
          "hi-IN": "बाद में चिड़िया ने उसे चेताया।",
        }),
        next_step_id: "s6",
      }),
      Object.freeze({
        step_id: "s6",
        text: Object.freeze({
          "en-IN": "Small friends help big friends.",
          "hi-IN": "छोटे दोस्त बड़ों के काम आते हैं।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "story_jataka_mangoes",
    kind: "story",
    title: "The Deer Who Shared the Mangoes",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: WIDE_STAGES,
    categories: Object.freeze(["stories"] as const),
    source: "jataka",
    licence_note: RETELLING,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN":
            "A deer found a tree full of sweet mangoes. She called her friends into the shade.",
          "hi-IN": "एक हिरनी को मीठे आमों का पेड़ मिला। उसने दोस्तों को छाँव में बुलाया।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN":
            "A slow turtle came last and found one mango left. The deer gave him hers without a word.",
          "hi-IN": "एक धीमा कछुआ देर से आया और एक ही आम बचा था। हिरनी ने अपना आम उसे दे दिया।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN":
            "Kindness grows faster than any tree. The friends shared every season after that.",
          "hi-IN": "दया पेड़ से भी तेज़ बढ़ती है। दोस्तों ने हर मौसम साथ बाँटा।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
] as const);
