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
//   hello                 a plain English question              -> allow, a plain reply
//   story                 a story request that needs a tool     -> allow, `content_lookup`
//   where-did-grandpa-go  a Defer_Topic question (`death`)      -> defer
//   scary-request         a frightening request                 -> refuse, a Safe_Redirect
//   sad                   a distress disclosure                 -> comfort, a Parent_Alert
//   hindi-hello           a Hindi utterance                     -> allow, answered in Hindi
//   mixed-hindi-english   a code-mixed utterance                -> allow, answered in Hindi
//   slow-thinker          a reply slower than the Filler        -> the "let me think" Filler
//
// The decision an utterance actually draws also depends on the active child's Child_Context (the
// parent's content categories above all), so the right-hand column is the intent, not a promise.
import { type SupportedLang } from "@xelulu/shared";

export type TestUtterance = Readonly<{ name: string; lang: SupportedLang; text: string }>;

/** The eight named utterances, in the order the panel lists them. */
export const TEST_UTTERANCES: readonly TestUtterance[] = Object.freeze([
  Object.freeze({ name: "hello", lang: "en-IN", text: "hello lulu, why is the sky blue" }),
  Object.freeze({ name: "story", lang: "en-IN", text: "tell me a story" }),
  Object.freeze({
    name: "where-did-grandpa-go",
    lang: "en-IN",
    text: "where did grandpa go when he died",
  }),
  Object.freeze({ name: "scary-request", lang: "en-IN", text: "will the volcano hurt the cat" }),
  Object.freeze({ name: "sad", lang: "en-IN", text: "i am scared of the dark" }),
  Object.freeze({ name: "hindi-hello", lang: "hi-IN", text: "नमस्ते लुलु, मुझे कहानी सुनाओ" }),
  Object.freeze({ name: "mixed-hindi-english", lang: "hi-IN", text: "mujhe ek story sunao" }),
  Object.freeze({ name: "slow-thinker", lang: "en-IN", text: "let me think hard" }),
]);

/** The names, for the Control_Surface's `choices` and the panel's select. */
export const TEST_UTTERANCE_NAMES: readonly string[] = Object.freeze(
  TEST_UTTERANCES.map((utterance) => utterance.name),
);

/** The named utterance, or null when no entry carries that name. */
export function findTestUtterance(name: string): TestUtterance | null {
  return TEST_UTTERANCES.find((utterance) => utterance.name === name) ?? null;
}
