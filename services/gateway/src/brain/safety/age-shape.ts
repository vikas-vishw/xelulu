// Age_Stage shape (Req 6.4, 10.2): how long a spoken reply may be for the active child. Product
// principle 2 is 1 to 3 short sentences, and safety.md §4 ties that to the child's `age_stage`,
// so the limits live here as data and the Output_Guard applies them whatever the LLM returned.
//
// Counting only. Nothing here reads a provider, a log or a store, and nothing here returns a
// piece of the text it measured.
import { type AgeStage } from "@xelulu/shared";

/** At most 1 sentence for `tiny`, 2 for `little`, 3 for `explorer` and `maker` (Req 10.2). */
export const AGE_SENTENCE_LIMITS: Readonly<Record<AgeStage, number>> = Object.freeze({
  tiny: 1,
  little: 2,
  explorer: 3,
  maker: 3,
});

/** The word budget that goes with each stage's sentence budget (Req 10.2). */
export const AGE_WORD_LIMITS: Readonly<Record<AgeStage, number>> = Object.freeze({
  tiny: 8,
  little: 20,
  explorer: 40,
  maker: 60,
});

/** What ends a sentence in either supported language. `।` is the Hindi danda. */
const SENTENCE_TERMINATORS: ReadonlySet<string> = new Set([
  ".",
  "!",
  "?",
  "\u0964", // ।
  "\u2026", // …
]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\u00a0";
}

/** True when this code point is a letter or digit of either supported script. */
function isWordChar(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) return true;
  if (code >= 0x61 && code <= 0x7a) return true;
  if (code >= 0x41 && code <= 0x5a) return true;
  return code >= 0x0900 && code <= 0x097f;
}

/**
 * Sentences in `text`: one per run of terminators that has content before it, plus one for any
 * trailing content that was never terminated. A blank text has none, and a run like `?!` counts
 * once, so `Really?!` is one sentence and not two.
 */
export function sentenceCount(text: string): number {
  let count = 0;
  let pending = false;
  for (const ch of text) {
    if (SENTENCE_TERMINATORS.has(ch)) {
      if (pending) {
        count += 1;
        pending = false;
      }
      continue;
    }
    if (!isWhitespace(ch)) pending = true;
  }
  return pending ? count + 1 : count;
}

/**
 * Words in `text`: whitespace-separated runs that hold at least one letter or digit, so stray
 * punctuation is not counted as a word. Hindi writes its words with spaces too, so one rule
 * serves both languages.
 */
export function wordCount(text: string): number {
  let count = 0;
  for (const token of text.split(/\s+/)) {
    for (const ch of token) {
      if (isWordChar(ch.codePointAt(0) ?? 0)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/**
 * True when `text` is not over this stage's sentence or word limit.
 *
 * Upper bounds only, on purpose: an empty text is not "too long", so it passes here and is caught
 * by the guards' `uncertain` rule instead. That is what keeps the Output_Guard's precedence exact,
 * with `length` above `uncertain` (Req 6.4, 6.5).
 */
export function withinAgeShape(text: string, stage: AgeStage): boolean {
  return (
    sentenceCount(text) <= AGE_SENTENCE_LIMITS[stage] && wordCount(text) <= AGE_WORD_LIMITS[stage]
  );
}
