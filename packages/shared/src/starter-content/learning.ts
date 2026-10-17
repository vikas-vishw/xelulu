// The starter learning activities (Req 1.4): one each in `animals`, `maths`, `world`, `feelings`
// and `manners`, plus the one `games` item. Original wording written for Xelulu, `source`
// `original` throughout, and every item declares every Age_Stage — so each line is one sentence
// of at most eight words in each language it declares.
//
// THE `games` ITEM CARRIES `games` AS ITS ONLY CATEGORY (Req 1.4, 19.3). The parent app's Play
// screen files an item by its FIRST category in `CONTENT_CATEGORIES` order, and `games` is last
// in that order, so an item categorised `["games", "animals"]` would land under Learning. The fix
// is this seeding rule, not a second mapping rule keyed on `kind`, and `starter-content.test.ts`
// asserts it over the whole library.
import { AGE_STAGES, type AgeStage } from "../domain/age-stage.js";
import type { StarterItemSpec } from "./index.js";

const ACTIVITY = "Original activity written for Xelulu.";
const ALL_STAGES: readonly AgeStage[] = AGE_STAGES;

export const LEARNING_SPECS: readonly StarterItemSpec[] = Object.freeze([
  Object.freeze({
    content_id: "learning_animals_lions",
    kind: "learning",
    title: "Lions of the Grassland",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["animals"] as const),
    source: "original",
    licence_note: ACTIVITY,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Lions rest in tall golden grass.",
          "hi-IN": "शेर ऊँची घास में आराम करते हैं।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "They talk with a deep roar.",
          "hi-IN": "वे गहरी दहाड़ से बात करते हैं।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Can you roar like a lion?",
          "hi-IN": "क्या तुम शेर जैसी दहाड़ सकते हो?",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "learning_maths_count_five",
    kind: "learning",
    title: "Counting to Five",
    languages: Object.freeze(["en-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["maths"] as const),
    source: "original",
    licence_note: ACTIVITY,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({ "en-IN": "One, two, three, four, five." }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({ "en-IN": "Count five claps with me." }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({ "en-IN": "You counted every clap." }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "learning_world_ocean",
    kind: "learning",
    title: "Our Blue Ocean",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["world"] as const),
    source: "original",
    licence_note: ACTIVITY,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "The ocean holds a lot of water.",
          "hi-IN": "समुद्र में बहुत पानी है।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "Waves roll in and slide back.",
          "hi-IN": "लहरें आती हैं और लौट जाती हैं।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Fish swim in the cool water.",
          "hi-IN": "मछलियाँ ठंडे पानी में तैरती हैं।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "learning_feelings_balloon",
    kind: "learning",
    title: "Breathing Like a Balloon",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["feelings"] as const),
    source: "original",
    licence_note: ACTIVITY,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Breathe in slowly like a balloon.",
          "hi-IN": "गुब्बारे जैसी धीमी सांस लो।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "Now let the air out gently.",
          "hi-IN": "अब हवा धीरे से बाहर छोड़ो।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Your body is calm again.",
          "hi-IN": "तुम्हारा मन शांत हो गया।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "learning_manners_please",
    kind: "learning",
    title: "Please and Thank You",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: ALL_STAGES,
    categories: Object.freeze(["manners"] as const),
    source: "original",
    licence_note: ACTIVITY,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Please opens many doors.",
          "hi-IN": "कृपया कहने से दरवाज़े खुलते हैं।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "Thank you makes hearts warm.",
          "hi-IN": "धन्यवाद से मन खुश होता है।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Try both words today.",
          "hi-IN": "आज दोनों शब्द कहकर देखो।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
  Object.freeze({
    content_id: "game_freeze_dance",
    kind: "game",
    // `games` and nothing else: see the header note and Req 19.3.
    categories: Object.freeze(["games"] as const),
    title: "Freeze Dance",
    languages: Object.freeze(["en-IN", "hi-IN"] as const),
    age_stages: ALL_STAGES,
    source: "original",
    licence_note: ACTIVITY,
    steps: Object.freeze([
      Object.freeze({
        step_id: "s1",
        text: Object.freeze({
          "en-IN": "Dance while the music plays.",
          "hi-IN": "जब संगीत बजे तब नाचो।",
        }),
        next_step_id: "s2",
      }),
      Object.freeze({
        step_id: "s2",
        text: Object.freeze({
          "en-IN": "Freeze when the music stops.",
          "hi-IN": "संगीत रुकने पर जम जाओ।",
        }),
        next_step_id: "s3",
      }),
      Object.freeze({
        step_id: "s3",
        text: Object.freeze({
          "en-IN": "Wiggle your fingers and smile.",
          "hi-IN": "उंगलियाँ हिलाओ और मुस्कुराओ।",
        }),
        next_step_id: null,
      }),
    ]),
  }),
] as const);
