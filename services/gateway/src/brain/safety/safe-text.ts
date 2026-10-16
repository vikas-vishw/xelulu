// Everything Xelulu says that does not come from a provider (Req 6.7, 7.1, 8.1, 8.3, 11.6,
// 12.4). Four constants, each written out per supported language and per Age_Stage, because a
// sentence for a two-year-old is not a sentence for a nine-year-old (safety.md §4):
//
//  - SAFE_REDIRECT: what is spoken when a guard refuses, replacing the whole reply (C19);
//  - DEFERRAL_REPLY: a short gentle answer, then the invitation to ask a grown-up together;
//  - COMFORT_REPLY: comfort, and the encouragement to tell a trusted grown-up;
//  - FILLER_TEXT: the "let me think" line on the slow path, short enough for every stage.
//
// Rules every string here obeys, enforced by Property 4 rather than by review:
//  - it is within its stage's sentence and word limits (`withinAgeShape`);
//  - `checkOutput` returns `allow` for it, so the Safe_Redirect cannot itself be refused;
//  - it names no emergency number, no URL and no service (Req 8.3), so a distressed child is
//    pointed at a grown-up in the room, never at a phone number Xelulu read out.
//
// FLAG (F3): the comfort wording and the escalation it belongs to need expert sign-off before
// launch. The mechanism is built; no clinical adequacy is claimed by these strings.
import { type AgeStage, type SupportedLang } from "@xelulu/shared";

/** One string per Age_Stage, for one language. */
export type StageText = Readonly<Record<AgeStage, string>>;
/** One table per supported language. */
export type SpokenText = Readonly<Record<SupportedLang, StageText>>;

/** Spoken whenever a guard refuses: the reply is dropped whole and this is said instead (C19). */
export const SAFE_REDIRECT: SpokenText = Object.freeze({
  "en-IN": Object.freeze({
    tiny: "Let us play something else.",
    little: "Let us talk about something else. Shall we sing a song together?",
    explorer:
      "I would rather not talk about that one. Let us pick something else together. Shall we find a story?",
    maker:
      "That one is not for me to answer. Let us pick something else we both like. Shall we try a puzzle instead?",
  }),
  "hi-IN": Object.freeze({
    tiny: "चलो कुछ और करें।",
    little: "चलो कुछ और बात करें। क्या हम मिलकर गाना गाएँ?",
    explorer: "इस बारे में मैं बात नहीं करूँगा। चलो कुछ और चुनें। क्या हम कोई कहानी ढूँढें?",
    maker:
      "इस बारे में बात करना मेरे लिए ठीक नहीं है। चलो कुछ और चुनें जो हम दोनों को पसंद हो। क्या हम कोई पहेली सुलझाएँ?",
  }),
});

/**
 * Spoken when the Input_Guard defers (Req 7.1): a short gentle answer, then the invitation to ask
 * a grown-up together. Product principle 6 keeps the grown-ups in the loop, so the invitation is
 * part of the sentence even at `tiny`, where there is only one sentence to spend.
 */
export const DEFERRAL_REPLY: SpokenText = Object.freeze({
  "en-IN": Object.freeze({
    tiny: "Big question, let us ask Amma together.",
    little: "That is a big question. Let us ask Amma or Appa together.",
    explorer:
      "That is a big question, and I have only a small answer. Grown-ups know this one best. Let us ask Amma or Appa together.",
    maker:
      "That is a big question, and the honest answer is that I only have a small part of it. The grown-ups in your family know this one best. Let us ask Amma or Appa together.",
  }),
  "hi-IN": Object.freeze({
    tiny: "बड़ा सवाल, चलो अम्मा से पूछें।",
    little: "यह बड़ा सवाल है। चलो अम्मा या अप्पा से मिलकर पूछें।",
    explorer:
      "यह बड़ा सवाल है, और मेरे पास छोटा सा जवाब है। बड़े इसे बेहतर जानते हैं। चलो अम्मा या अप्पा से मिलकर पूछें।",
    maker:
      "यह बड़ा सवाल है, और सच यह है कि मेरे पास इसका छोटा सा हिस्सा ही है। तुम्हारे घर के बड़े इसे सबसे बेहतर जानते हैं। चलो अम्मा या अप्पा से मिलकर पूछें।",
  }),
});

/**
 * Spoken when the Input_Guard asks for comfort (Req 8.1, 8.3): the child is comforted and
 * encouraged to tell a trusted grown-up. No number, no URL, no service is named.
 */
export const COMFORT_REPLY: SpokenText = Object.freeze({
  "en-IN": Object.freeze({
    tiny: "I am here, let us tell Amma.",
    little: "I am right here with you. Let us tell a grown-up you trust.",
    explorer:
      "I am here with you, and you are not on your own. Big feelings get lighter when we share them. Let us tell a grown-up you trust.",
    maker:
      "I am here with you, and what you feel matters. Talking about it with someone who cares for you makes it lighter. Let us tell a grown-up you trust.",
  }),
  "hi-IN": Object.freeze({
    tiny: "मैं यहाँ हूँ, चलो अम्मा को बताएँ।",
    little: "मैं तुम्हारे साथ यहाँ हूँ। चलो किसी भरोसेमंद बड़े को बताएँ।",
    explorer:
      "मैं तुम्हारे साथ हूँ, तुम अकेले नहीं हो। बात करने से मन हल्का हो जाता है। चलो किसी भरोसेमंद बड़े को बताएँ।",
    maker:
      "मैं तुम्हारे साथ हूँ, और तुम जो महसूस करते हो वह मायने रखता है। किसी अपने से बात करने पर मन हल्का हो जाता है। चलो किसी भरोसेमंद बड़े को बताएँ।",
  }),
});

/**
 * The "let me think" line of Req 12.4. One per language and not per stage: it is short enough for
 * `tiny`, which is the strictest stage, so it fits every stage.
 */
export const FILLER_TEXT: Readonly<Record<SupportedLang, string>> = Object.freeze({
  "en-IN": "Let me think.",
  "hi-IN": "ज़रा सोचने दो।",
});
