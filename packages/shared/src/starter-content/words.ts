// The Word_Of_The_Day entries (Req 5.1): eight original entries, four in each Supported_Lang —
// comfortably over the floor of seven entries with at least two per language, which is what keeps
// `wordForDay` from answering null on an ordinary day in either language.
//
// One entry carries ONE language, because XL-G07 is a mother-tongue word rather than a word list
// with translations (C10): on a day whose index lands on a Hindi entry, an English turn walks
// forward to the next English one and the index stays the same for every child.
//
// `meaning` and `example` are a few words each, and that is a constraint rather than a style
// note: the Gateway assembles them into one narration per Age_Stage, and `little`'s is two
// sentences of twenty words with the word's own sentence already spent.
import { AGE_STAGES, type AgeStage } from "../domain/age-stage.js";
import type { WordEntry } from "./index.js";

const ALL_STAGES: readonly AgeStage[] = AGE_STAGES;

export const WORD_SPECS: readonly WordEntry[] = Object.freeze([
  Object.freeze({
    word_id: "word_paani",
    lang: "hi-IN",
    word: "पानी",
    meaning: "पीने का जल",
    example: "अम्मा पानी देती हैं।",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_rain",
    lang: "en-IN",
    word: "rain",
    meaning: "water from clouds",
    example: "Rain taps the window.",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_chidiya",
    lang: "hi-IN",
    word: "चिड़िया",
    meaning: "छोटा पक्षी",
    example: "चिड़िया गाना गाती है।",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_moon",
    lang: "en-IN",
    word: "moon",
    meaning: "the night light",
    example: "The moon glows softly.",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_dost",
    lang: "hi-IN",
    word: "दोस्त",
    meaning: "अच्छा साथी",
    example: "मेरा दोस्त हँसता है।",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_kind",
    lang: "en-IN",
    word: "kind",
    meaning: "gentle and caring",
    example: "Kind hands help others.",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_mitti",
    lang: "hi-IN",
    word: "मिट्टी",
    meaning: "धरती की धूल",
    example: "मिट्टी से खुशबू आती है।",
    age_stages: ALL_STAGES,
  }),
  Object.freeze({
    word_id: "word_river",
    lang: "en-IN",
    word: "river",
    meaning: "flowing water",
    example: "The river runs fast.",
    age_stages: ALL_STAGES,
  }),
] as const);
