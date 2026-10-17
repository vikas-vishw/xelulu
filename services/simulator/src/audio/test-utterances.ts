// The Test_Utterances (Req 19.4, 19.5): the named utterances the panel offers beside the
// audio-turn button, so one whole turn can be driven by hand and in CI.
//
// Text constants only. Nothing here reads a microphone, an audio device or an audio file
// (Req 19.4), and nothing here is a wire value: the names travel in the Control_Surface's
// `choices`, and the text travels only inside the turn's Utterance_Frames, built by the
// Mock_Audio_Codec at request time.
//
// The table is the Simulator's own. The Gateway gets no copy, because a real STT would receive
// arbitrary speech, and because the Simulator stays a wire-level peer of the robot.
//
// Each text is chosen to drive one path of the Gateway's brain, one per Mock_Llm rule, so a
// watcher can see every path of the pipeline from the panel:
//
//   hello                    a plain English question           -> allow, a plain reply
//   story                    a story request that needs a tool  -> allow, a curated first step
//   where-did-grandpa-go     a Defer_Topic question (`death`)   -> defer
//   scary-request            an unsafe-sounding request about   -> allow: the Input_Guard has no
//                            a volcano and a cat                   frightening-content rule, and
//                                                                  `world` is open to the fixture
//                                                                  child, so this refuses for no
//                                                                  child the local stack runs
//                                                                  under (Phase 4 Req 22.1b)
//   closed-category-request  a request in a category the parent -> refuse, a Safe_Redirect
//                            has not opened (`maths`)
//   sad                      a distress disclosure              -> comfort, a Parent_Alert
//   hindi-hello              a Hindi utterance                  -> allow, a curated Hindi step
//   mixed-hindi-english      a code-mixed utterance             -> allow, answered in Hindi
//   slow-thinker             a reply slower than the Filler     -> the "let me think" Filler
//   story-answer-en          a branch answer in English         -> allow, the story moves on
//   story-answer-hi          a branch answer in Hindi           -> allow, the story moves on
//   story-answer-unmatched   an answer matching no branch       -> allow, the prompts repeat
//   story-stop               a stop word                        -> allow, the story ends
//
// The decision an utterance actually draws also depends on the active child's Child_Context (the
// parent's content categories above all), so the right-hand column is the intent, not a promise.
// The Gateway pins that intent in a test of its own, because the decision is the Gateway's and
// this file holds only the text (Phase 4 Req 22.6).
import { type SupportedLang } from "@xelulu/shared";

export type TestUtterance = Readonly<{ name: string; lang: SupportedLang; text: string }>;

/** The thirteen named utterances, in the order the panel lists them. */
export const TEST_UTTERANCES: readonly TestUtterance[] = Object.freeze([
  Object.freeze({ name: "hello", lang: "en-IN", text: "hello lulu, why is the sky blue" }),
  Object.freeze({ name: "story", lang: "en-IN", text: "tell me a story" }),
  Object.freeze({
    name: "where-did-grandpa-go",
    lang: "en-IN",
    text: "where did grandpa go when he died",
  }),
  Object.freeze({ name: "scary-request", lang: "en-IN", text: "will the volcano hurt the cat" }),
  // The stack's input-refusal demonstration: `maths` is the one category the fixture child every
  // Compose criterion runs under still has closed (Phase 4 Req 22.1c).
  Object.freeze({
    name: "closed-category-request",
    lang: "en-IN",
    text: "can you count to ten with me",
  }),
  Object.freeze({ name: "sad", lang: "en-IN", text: "i am scared of the dark" }),
  Object.freeze({ name: "hindi-hello", lang: "hi-IN", text: "नमस्ते लुलु, मुझे कहानी सुनाओ" }),
  Object.freeze({ name: "mixed-hindi-english", lang: "hi-IN", text: "mujhe ek story sunao" }),
  Object.freeze({ name: "slow-thinker", lang: "en-IN", text: "let me think hard" }),
  // The four story answers. Their text is not decorative: each either matches a seeded
  // Content_Choice's match terms in its language, matches none of them, or matches a stop word,
  // so the branch paths can be driven by hand and in CI (Phase 4 Req 22.4).
  Object.freeze({ name: "story-answer-en", lang: "en-IN", text: "drop the pebbles in" }),
  Object.freeze({ name: "story-answer-hi", lang: "hi-IN", text: "पहेली पूछो" }),
  Object.freeze({
    name: "story-answer-unmatched",
    lang: "en-IN",
    text: "maybe something else happens",
  }),
  Object.freeze({ name: "story-stop", lang: "en-IN", text: "stop the story now" }),
]);

/** The names, for the Control_Surface's `choices` and the panel's select. */
export const TEST_UTTERANCE_NAMES: readonly string[] = Object.freeze(
  TEST_UTTERANCES.map((utterance) => utterance.name),
);

/** The named utterance, or null when no entry carries that name. */
export function findTestUtterance(name: string): TestUtterance | null {
  return TEST_UTTERANCES.find((utterance) => utterance.name === name) ?? null;
}
