// The Content_Gate (Phase 4 C7, Req 2.2, 2.2a, 2.3): the one place a Content_Item is measured
// against the Output_Guard before anything it holds can be spoken.
//
// The rule it enforces is the whole safety argument of the curated library: an item promises
// every Age_Stage and every language it declares, so every spoken field is checked at every cell
// of that cross product. An item tagged `tiny` and `explorer` is held to `tiny`'s one sentence of
// eight words as well as `explorer`'s three of forty, and an item tagged `hi-IN` is measured in
// Hindi as well as in English.
//
// Within one cell the order is fixed, and it is fixed for a reason:
//
//   1. the item's `title`                     -> field `title`    (Req 2.2a)
//   2. each step's `text[lang]`               -> field `text`
//   3. each choice's `prompt[lang]`           -> field `prompt`
//   4. `stepSpeech(step, lang)` per step      -> field `speech`
//
// The fields come first so a verdict names ONE offending field and step, which is what the
// console needs to point an operator at the thing to fix. The assembled utterance comes last
// because it is the string Req 4.1 actually bounds: three short fields that each pass can still
// assemble into a step over the stage's sentence limit, and that refusal has to be reported
// against something, so it is reported against `speech`.
//
// Nothing here returns, logs or copies any part of the text it measured: a verdict is a closed
// enum, a stage, a language, a step id and a field name (Omar ruling 1, safety.md §7).
import {
  type AgeStage,
  type ContentItemBase,
  type ContentStep,
  type SafetyRule,
  type SupportedLang,
} from "@xelulu/shared";

import type { GuardContext, SafetyVerdict } from "../brain/safety/input-guard.js";
import { checkOutput } from "../brain/safety/output-guard.js";

/** Which spoken field refused. `title` carries no step, so its `step_id` is `""`. */
export type GateField = "title" | "text" | "prompt" | "speech";

export type GateVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly rule: SafetyRule;
      readonly age_stage: AgeStage;
      readonly lang: SupportedLang;
      readonly step_id: string;
      readonly field: GateField;
    };

/**
 * The single string a child hears for one step: its text, then that step's choice prompts, joined
 * by one space. THIS is the assembler the Story_Session speaks and the gate measures as `speech`,
 * so what was bounded and what is heard are byte-identical strings from one call (Req 2.2, 4.1).
 *
 * A language the step has no text for gives `""`, which the Story_Session reads as "no speakable
 * step" and the gate's `uncertain` rule refuses. Neither guesses at a translation.
 */
export function stepSpeech(step: ContentStep, lang: SupportedLang): string {
  const parts: string[] = [];
  const text = step.text[lang] ?? "";
  if (text.trim().length > 0) parts.push(text);
  for (const choice of step.choices) {
    const prompt = choice.prompt[lang] ?? "";
    if (prompt.trim().length > 0) parts.push(prompt);
  }
  return parts.join(" ");
}

/**
 * The GuardContext the gate measures with. `checkOutput` requires all four fields and reads only
 * `ageStage` today; the two lists are deliberately EMPTY, because an item is gated for every
 * household and passing one household's parent settings would make an item's activability depend
 * on whoever happened to be active when an operator pressed the button. Per-household filtering
 * is `content_lookup`'s job at turn time (Req 3.1).
 */
function gateContext(ageStage: AgeStage, lang: SupportedLang): GuardContext {
  return { ageStage, lang, allowedCategories: [], deferTopics: [] };
}

function refusal(
  rule: SafetyRule,
  ageStage: AgeStage,
  lang: SupportedLang,
  stepId: string,
  field: GateField,
): GateVerdict {
  return { ok: false, rule, age_stage: ageStage, lang, step_id: stepId, field };
}

/**
 * How many (stage, language, text) verdicts are remembered. Bounded, and the oldest goes first.
 */
export const GATE_CACHE_MAX_ENTRIES = 4_096;

/**
 * Verdicts already measured, keyed by the WHOLE input `checkOutput` is given: the Age_Stage, the
 * language and the exact text. Nothing else takes part in a verdict, so a hit is the same answer
 * the guard would give, and a key that differs in any of the three is a miss.
 *
 * It is here, and worth the lines, because the guard re-folds and re-tokenises its text on every
 * one of its ~60 term scans (safety.md §9 item 6), and the gate asks it the same question twice
 * for every linear step: a step with no choices assembles to exactly its own text, so `text` and
 * `speech` are byte-identical strings. Seeding the Starter_Content asked ~1,700 questions and
 * took 2.4 seconds without this; the cache halves the questions and makes a second store in the
 * same process free, which is what keeps gateway start-up and the test suite honest.
 *
 * What it holds is CURATED CONTENT ONLY. `gateItem` is called with Content_Items — seeded prose
 * and operator-submitted drafts — and never with a child's words or a provider's reply, so no
 * transcript or model text can reach this map. It is memory only: no file, no log, no response.
 *
 * ONE STANDING DEPENDENCY, recorded rather than assumed: the key is complete only while
 * `checkOutput` reads nothing from its `GuardContext` but `ageStage`. safety.md §9 item 5
 * schedules Output_Guard hardening, and a guard that began reading `allowedCategories` or
 * `deferTopics` would make this cache answer from a stale key — so whoever widens the guard's
 * inputs must key this map on the whole `GuardContext` in the same change.
 */
const verdictCache = new Map<string, SafetyVerdict>();

/** `checkOutput` with its answers remembered. Identical in behaviour, cheaper when asked twice. */
function guard(text: string, ageStage: AgeStage, lang: SupportedLang): SafetyVerdict {
  const key = `${ageStage}\u0000${lang}\u0000${text}`;
  const hit = verdictCache.get(key);
  if (hit !== undefined) return hit;
  const verdict = checkOutput(text, gateContext(ageStage, lang));
  while (verdictCache.size >= GATE_CACHE_MAX_ENTRIES) {
    const oldest = verdictCache.keys().next();
    if (oldest.done === true) break;
    verdictCache.delete(oldest.value);
  }
  verdictCache.set(key, verdict);
  return verdict;
}

/** The first refusal of one (stage, language) cell, or null when the whole cell passes. */
function gateCell(
  item: ContentItemBase,
  ageStage: AgeStage,
  lang: SupportedLang,
): GateVerdict | null {
  // (1) The title. It is listed in the console and returned to a provider as tool-result text, so
  // nothing else in the system bounds or scans it (Req 2.2a).
  const title = guard(item.title, ageStage, lang);
  if (title.decision !== "allow") return refusal(title.rule, ageStage, lang, "", "title");

  // (2) Each step's own text.
  for (const step of item.steps) {
    const verdict = guard(step.text[lang] ?? "", ageStage, lang);
    if (verdict.decision !== "allow") {
      return refusal(verdict.rule, ageStage, lang, step.step_id, "text");
    }
  }

  // (3) Each choice prompt.
  for (const step of item.steps) {
    for (const choice of step.choices) {
      const verdict = guard(choice.prompt[lang] ?? "", ageStage, lang);
      if (verdict.decision !== "allow") {
        return refusal(verdict.rule, ageStage, lang, step.step_id, "prompt");
      }
    }
  }

  // (4) The assembled utterance, last, because that is what the child hears whole.
  for (const step of item.steps) {
    const verdict = guard(stepSpeech(step, lang), ageStage, lang);
    if (verdict.decision !== "allow") {
      return refusal(verdict.rule, ageStage, lang, step.step_id, "speech");
    }
  }

  return null;
}

/**
 * Runs the Output_Guard over every spoken field of `item` at every Age_Stage and language it
 * declares, and answers the FIRST refusal. Pure, synchronous, and never throws.
 *
 * An item declaring no stage or no language is refused rather than passed by default: an empty
 * cross product would otherwise mean "checked nothing, so allowed", which is the one reading the
 * gate must never have. The Content_Store's validation rejects both cases before the gate, so
 * this is a second floor rather than the only one (safety.md §8).
 */
export function gateItem(item: ContentItemBase): GateVerdict {
  const stages = item.age_stages;
  const langs = item.languages as readonly SupportedLang[];
  if (stages.length === 0 || langs.length === 0) {
    return refusal("uncertain", stages[0] ?? "tiny", langs[0] ?? "en-IN", "", "title");
  }
  for (const ageStage of stages) {
    for (const lang of langs) {
      const verdict = gateCell(item, ageStage, lang);
      if (verdict !== null) return verdict;
    }
  }
  return { ok: true };
}
