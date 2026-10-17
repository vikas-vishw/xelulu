// The Starter_Content (Phase 4 C28, Req 1.4–1.10): the curated library every reader of the
// system shares — the Gateway's Content_Store, the Admin_Console's Content page and the parent
// app's Play and Grow screens.
//
// Every word of it is ORIGINAL prose written for Xelulu. The four traditions are old, but modern
// translations and retellings are copyrighted, so nothing here is copied, quoted or lightly
// edited from any edition: each item carries a `licence_note` saying so and a `source` naming the
// tradition only, never a translation, an edition or an author (C5).
//
// Two rules shape how the prose is written, and both are enforced by the Gateway's Content_Gate
// rather than by good intentions (C6, C39):
//
//   - Every step's text, every choice prompt and the assembled utterance the child actually hears
//     fit the NARROWEST Age_Stage the item declares: `tiny` is one sentence of eight words,
//     `little` two of twenty, `explorer` and `maker` three of forty and sixty.
//   - A branching item therefore declares `explorer` and `maker` only, and a spoken branching
//     step carries at most two choices: the step's own sentence plus two prompts is three
//     sentences, which `tiny` and `little` have no room for.
//
// No item names a URL, a phone-like number, a price, a brand or a child, and no step uses a word
// on the Output_Guard's romantic, frightening, medical, legal or financial lists — so a jackal
// outwits a lion and nothing dies, a king hears a case in his hall rather than a court, and a
// clever idea is worth no money at all.
//
// Nothing here reads a clock, a file, an environment variable or a network. The three factories
// are pure and return a FRESH array per call (Req 1.9), so the Gateway's store and the parent
// app's store can never mutate each other's copy.
import type { AgeStage } from "../domain/age-stage.js";
import type {
  ContentCategory,
  ContentKind,
  ContentSource,
  ContentStep,
  GlobalContentItem,
} from "../domain/content-item.js";
import type { SupportedLang } from "../domain/language.js";
import { AKBAR_BIRBAL_SPECS } from "./stories-akbar-birbal.js";
import { JATAKA_SPECS } from "./stories-jataka.js";
import { PANCHATANTRA_SPECS } from "./stories-panchatantra.js";
import { TENALI_RAMAN_SPECS } from "./stories-tenali-raman.js";
import { LEARNING_SPECS } from "./learning.js";
import { SONG_SPECS } from "./songs.js";
import { STARTER_ROUTINE_SPECS } from "./routines.js";
import { WORD_SPECS } from "./words.js";

/** One choice of a branching step, as the seed writes it. */
export type StarterChoiceSpec = Readonly<{
  choice_id: string;
  /** One short sentence per declared language. Counts toward the step's age shape. */
  prompt: Readonly<Record<string, string>>;
  /** The words that pick this branch, per declared language. Never a stop word (Req 4.8). */
  match_terms: Readonly<Record<string, readonly string[]>>;
  next_step_id: string;
}>;

/** One step, as the seed writes it. `choices` and `next_step_id` default to none and null. */
export type StarterStepSpec = Readonly<{
  step_id: string;
  /** The spoken text per declared language. Every declared language carries an entry (Req 1.5). */
  text: Readonly<Record<string, string>>;
  choices?: readonly StarterChoiceSpec[];
  next_step_id?: string | null;
}>;

/** One item, as the seed writes it: everything but the fields the store owns. */
export type StarterItemSpec = Readonly<{
  content_id: string;
  kind: ContentKind;
  title: string;
  languages: readonly SupportedLang[];
  age_stages: readonly AgeStage[];
  categories: readonly ContentCategory[];
  source: ContentSource;
  licence_note: string;
  steps: readonly StarterStepSpec[];
}>;

/** A routine template: what to do and when, with no presentation in it at all (Req 19.5). */
export type RoutineTemplate = Readonly<{
  routine_id: string;
  /** What `routine_lookup` matches and a child hears: lowercase, spaces allowed. */
  name: string;
  /** `HH:MM` in the device's local day, the shape the contract uses for quiet hours. */
  at: string;
  enabled: boolean;
  /**
   * The Routine_Behaviour to fire. A plain string here rather than the Gateway's
   * `RoutineBehaviourId`, because `packages/shared` may not import from a service: the Gateway's
   * Routine_Store narrows it against its own closed list and ignores a template it cannot place.
   */
  behaviour: string;
}>;

/** One Word_Of_The_Day entry. One language per entry: a mother-tongue word, not a translation. */
export type WordEntry = Readonly<{
  word_id: string;
  lang: SupportedLang;
  word: string;
  /** A few words, so the narration fits even `little`'s two sentences of twenty words. */
  meaning: string;
  example: string;
  age_stages: readonly AgeStage[];
}>;

/**
 * The seed's time base. A fixed instant rather than a clock reading, so two processes seeding the
 * same library get byte-identical rows and the Content_Store's `created_at` ordering is stable.
 */
const SEED_BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/** One minute apart per item, so `created_at` alone is already a total order (Req 2.7). */
function seedTime(index: number): string {
  return new Date(SEED_BASE_MS + index * 60_000).toISOString();
}

/** A fresh, mutable copy of one step. */
function copyStep(step: StarterStepSpec): ContentStep {
  return {
    step_id: step.step_id,
    text: { ...step.text },
    choices: (step.choices ?? []).map((choice) => ({
      choice_id: choice.choice_id,
      prompt: { ...choice.prompt },
      match_terms: Object.fromEntries(
        Object.entries(choice.match_terms).map(([lang, terms]) => [lang, [...terms]]),
      ),
      next_step_id: choice.next_step_id,
    })),
    next_step_id: step.next_step_id ?? null,
  };
}

/**
 * A fresh, mutable Content_Item per spec. `status` is `active` here only as the seed's advice:
 * the Content_Store runs the Content_Gate over every seeded item and holds a refused one `draft`
 * with its verdict (Req 2.5), so nothing reaches a child on this file's word alone.
 */
function copyItem(spec: StarterItemSpec, index: number): GlobalContentItem {
  const at = seedTime(index);
  return {
    content_id: spec.content_id,
    household_id: null,
    kind: spec.kind,
    title: spec.title,
    languages: [...spec.languages],
    age_stages: [...spec.age_stages],
    categories: [...spec.categories],
    steps: spec.steps.map(copyStep),
    status: "active",
    licence_note: spec.licence_note,
    source: spec.source,
    created_at: at,
    updated_at: at,
  };
}

/** Every seeded spec, in the order the library lists them. */
const ITEM_SPECS: readonly StarterItemSpec[] = [
  ...PANCHATANTRA_SPECS,
  ...JATAKA_SPECS,
  ...TENALI_RAMAN_SPECS,
  ...AKBAR_BIRBAL_SPECS,
  ...SONG_SPECS,
  ...LEARNING_SPECS,
];

/** The curated library. A fresh array of fresh items per call (Req 1.9). */
export function createStarterContent(): GlobalContentItem[] {
  return ITEM_SPECS.map((spec, index) => copyItem(spec, index));
}

/** The six routine templates. A fresh array per call (Req 1.9). */
export function createStarterRoutines(): RoutineTemplate[] {
  return STARTER_ROUTINE_SPECS.map((routine) => ({ ...routine }));
}

/** The Word_Of_The_Day entries. A fresh array per call (Req 1.9). */
export function createStarterWords(): WordEntry[] {
  return WORD_SPECS.map((entry) => ({ ...entry, age_stages: [...entry.age_stages] }));
}
