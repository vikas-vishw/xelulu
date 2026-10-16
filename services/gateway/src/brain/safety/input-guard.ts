// The Input_Guard (Req 5, 7.5, 10.3): ours, pure, synchronous, and run on every Transcript
// before any LLM call (safety.md §4). It cannot be talked out of a decision, because there is no
// model in the loop: the classification is keyword and pattern based over the word lists fixed in
// this source file and in `forbidden-spans.ts`.
//
// One text and one Child_Context give exactly one Safety_Decision with exactly one Safety_Rule,
// in this precedence, highest first (Property 5):
//
//   1. harm_disclosure  -> comfort   the child says they were hurt, by anyone or themselves
//   2. distress         -> comfort   the child says they feel bad
//   3. defer_topic      -> defer     a Defer_Topic, built-in or parent-added
//   4. blocked_category -> refuse    a topic outside the parent's allowed categories
//   5. too_long         -> refuse    more text than a turn should carry
//   6. uncertain        -> refuse    text the guard cannot read, so it will not guess
//   7. none             -> allow
//
// Comfort and deferral outrank the category and length rules on purpose: a distressed child is
// answered, not refused on a technicality. If the guard is unsure it refuses (safety.md §4), and
// the Turn_Pipeline speaks a Safe_Redirect.
//
// The two comfort classes are read in two shapes, because a child does not say a phrase the way
// a word list writes it. A phrase list covers the entries whose frame matters (`hurt me`,
// `i feel bad`), matched with up to `MAX_INSERTED_TOKENS` words between its words; and a
// first-person anchor crossed with a feeling or injury word covers the rest, so `i am sad`,
// `i feel sad`, `i am very sad` and `मैं बहुत उदास हूँ` are one rule rather than four list
// entries. The other lists — Defer_Topics, content categories — are matched word-for-word.
//
// `uncertain` means text the guard cannot *read*, not text it cannot place. A readable utterance
// matching none of the five Defer_Topics and none of the eight content categories is allowed
// through to the model, because the alternative — refusing every topic no word list names —
// would refuse ordinary chat and make the `none -> allow` step dead. The line that holds
// regardless is the Output_Guard: whatever the model answers, every reply runs the twelve-rule
// `checkOutput` before a single frame is synthesised, so an unrecognised topic still cannot
// produce an unsafe spoken reply. (Group-5 review finding 2; design.md's `uncertain` sentence
// should be amended to say "unreadable" and to name this consequence.)
//
// Nothing here returns, keeps or logs any part of the Transcript. The verdict is three closed
// enum values, which is all the `safety_decision` Log_Entry may ever carry (Omar ruling 1).
import {
  type AgeStage,
  type DeferralTopic,
  type SafetyDecisionName,
  type SafetyRule,
  type SupportedLang,
} from "@xelulu/shared";

import {
  containsAnchoredTerm,
  containsTerm,
  containsTermNear,
  isUnreadable,
} from "./forbidden-spans.js";

export type SafetyVerdict = Readonly<{
  decision: SafetyDecisionName;
  rule: SafetyRule;
  topic: DeferralTopic | null;
}>;

/**
 * The parts of the Child_Context a guard reads. Never the child's id and never a name. One shape
 * serves both guards, so not every guard reads every field:
 *
 *  - `ageStage` is read by `checkOutput`, for the sentence and word limits;
 *  - `lang` is read by neither. Every word list in the Safety_Layer carries both supported
 *    languages, so a guard classifies a turn the same way whichever language it is in, and a
 *    mislabelled turn cannot slip a rule. It is carried because the caller passes one context to
 *    both guards and then on to the spoken-text tables, which are indexed by language.
 *  - `allowedCategories` and `deferTopics` are read by `checkInput` only. The parent's content
 *    categories gate what the child may ask about; the Output_Guard's job is the twelve rules it
 *    applies to every reply whatever the topic.
 */
export type GuardContext = Readonly<{
  ageStage: AgeStage;
  lang: SupportedLang;
  allowedCategories: readonly string[];
  deferTopics: readonly string[];
}>;

/**
 * The most text one child turn may carry. A transcript longer than this is not shaped like
 * speech, so it is refused with `too_long` rather than sent to a provider. Code points, not
 * bytes, so Hindi and English are measured the same way.
 */
export const INPUT_MAX_CODE_POINTS = 400;

/**
 * How many words may sit between two words of a harm or distress entry for it still to match.
 * Two, because the word a child inserts is the one that says how bad it is — `i am very sad`,
 * `i am a bit sad`, `मैं बहुत उदास हूँ` — and a literal match drops every one of those to
 * `allow`, with no Comfort_Response and no Parent_Alert (group-5 review pass 3, findings 2
 * and 3). It applies to the two comfort classes only — the harm and distress phrase lists, and
 * the gap between a first-person anchor and the feeling or injury word it qualifies. The
 * Defer_Topics, the content categories, the brands and the money words are matched
 * word-for-word, where a gap would buy nothing and cost false positives.
 *
 * A false positive here costs a comfort reply and a Parent_Alert on a turn that did not need
 * one. That is the direction safety.md §8 asks for, and it is the reason the gap is bounded at
 * two rather than left open.
 */
export const MAX_INSERTED_TOKENS = 2;

/**
 * Disclosure of harm (Req 5.4, 8.2). The highest-precedence class: a child telling Xelulu that
 * they were hurt — by someone else or by themselves — is answered with comfort and a
 * Parent_Alert, whatever else the text says.
 *
 * SCOPE, and a decision to be ruled on: every entry is first-person. Harm *to the child* is
 * detected; a disclosure that one third party hurt another (`daddy hurt mummy`,
 * `my brother hit my sister`, `मम्मी को मारा`) is not, and reaches the model as an ordinary
 * turn. That is deliberate rather than an oversight. A generic "X hurt Y" rule would also fire
 * on a retold story — `the lion hurt the deer` is an allowed `animals` turn in many households —
 * so comfort plus a Parent_Alert on every fable is its own failure mode, and the narrow scope is
 * the one that does not cry wolf. safety.md §4's "disclosure of harm" reads wider than this
 * list, so the gap is written down here for Omar to rule on rather than inherited silently
 * (group-5 review pass 3, finding 4).
 *
 * The self-harm and hopelessness senses are listed here and not under `death`, and that placement
 * is the whole point of the precedence order. "I want to die" names a `death` Defer_Topic term as
 * well, so without an entry here the turn would be deferred and the child would hear "that is a
 * big question, let us ask Amma together" instead of comfort and the encouragement to tell a
 * trusted grown-up (Req 8.1). `harm_disclosure` sits above `defer_topic` so that a phrase in both
 * classes is comforted; the list has to carry the phrase for the ordering to engage.
 *
 * Every contraction is written with the straight ASCII apostrophe only: `forbidden-spans.ts`
 * folds U+2018, U+2019 and U+02BC onto U+0027, so one entry covers every spelling.
 *
 * F3: the comfort wording and the escalation this triggers need expert sign-off before launch.
 * Detection is not gated by F3 — Req 5.4 asks for it flatly — so the lists are live now.
 */
export const HARM_DISCLOSURE_PHRASES: readonly string[] = Object.freeze([
  // Harm by someone else.
  "hurt me",
  "hurts me",
  "hit me",
  "hits me",
  "beat me",
  "beats me",
  "slapped me",
  "touched me",
  "wants to hurt me",
  // Harm to themselves.
  "hurt myself",
  "hurt my self",
  "kill myself",
  "kill my self",
  "cut myself",
  "cut my self",
  "want to die",
  "wanna die",
  "wish i was dead",
  "wish i were dead",
  "do not want to live",
  "don't want to live",
  "dont want to live",
  // Hopelessness, which Req 8.1 answers the same way.
  "hate myself",
  "hate my self",
  "nobody loves me",
  "no one loves me",
  // The same senses in Hindi.
  "मुझे मारा",
  "मुझे मारता",
  "मुझे मारती",
  "मुझे चोट",
  "खुद को चोट",
  "खुद को मार",
  "मरना चाहता",
  "मरना चाहती",
  "मर जाऊँ",
  "मर जाऊं",
  "जीना नहीं चाहता",
  "जीना नहीं चाहती",
  "खुद से नफरत",
  "खुद से नफ़रत",
  "कोई मुझे प्यार नहीं",
  "मुझे कोई प्यार नहीं",
]);

/**
 * How a child says the feeling is theirs: the anchor that turns a feeling word into a
 * disclosure. `the lonely lion walked home` names a feeling and discloses nothing, so an
 * unanchored feeling word is not distress.
 *
 * Contractions are written with the straight ASCII apostrophe only — the folder unifies the
 * three spellings — and `im` is here because an STT writes the contraction without one.
 */
export const FIRST_PERSON_ANCHORS: readonly string[] = Object.freeze([
  "i am",
  "i'm",
  "im",
  "i was",
  "i feel",
  "i felt",
  "i get",
  "i keep",
  "i want to",
  "मैं",
  "मुझे",
  "मेरा",
  "मेरी",
]);

/**
 * The anchors the injury cross product uses: every first-person anchor, plus the possessives a
 * child uses to report an injury to a body part — `my leg hurts`, `my arm is bleeding`,
 * `मेरे पैर में चोट है` (group-5 review pass 4, finding 1). `my X hurts` is the canonical way a
 * young child says they are hurt, and without these two spellings the English half of Req 5.4
 * reached only copular framing (`i am hurt`) and the Hindi half carried the two less likely
 * possessives while missing `मेरे`, the oblique form that occurs before a postposition.
 *
 * Deliberately NOT shared with the distress cross product. A possessive qualifies a body part
 * for an injury, but it qualifies a *person* for a feeling, so `my friend is scared of the dark`
 * is someone else's feeling and must stay `allow` — reusing one anchor list for both classes
 * would comfort on it. The feeling grid keeps `FIRST_PERSON_ANCHORS` unchanged.
 *
 * Two consequences, both recorded under the Safety Hardening gate in safety.md rather than
 * guessed at here:
 *  - `my brother hurt the deer` now comforts. That widens the first-person-only scope of
 *    `HARM_DISCLOSURE_PHRASES` as a side effect, in the conservative direction (safety.md §8).
 *  - `it hurts` and `that hurts` are still `allow`: an unanchored `it` would comfort on a
 *    retold fable's `it hurt the deer`, so those two spellings await a ruling.
 */
export const HARM_ANCHORS: readonly string[] = Object.freeze([
  ...FIRST_PERSON_ANCHORS,
  "my",
  "मेरे",
]);

/**
 * The feeling words that make a first-person sentence distress (Req 5.4, 8.2). Crossed with
 * `FIRST_PERSON_ANCHORS` rather than written out cell by cell, so `i am sad`, `i'm sad`,
 * `i feel sad`, `i was sad`, `i keep feeling sad` and `मैं उदास हूँ` are all covered by one
 * entry, and so is the inserted intensifier (`i am very sad`) that a hand-filled grid cannot
 * reach (group-5 review pass 3, findings 2 and 3).
 *
 * Words whose first-person sense depends on the frame — `bad` is `i feel bad` but also `i am bad
 * at football` — are not here. They stay in `DISTRESS_PHRASES`, where the frame is part of the
 * entry.
 */
export const DISTRESS_FEELING_TERMS: readonly string[] = Object.freeze([
  "sad",
  "unhappy",
  "not happy",
  "scared",
  "afraid",
  "frightened",
  "crying",
  "cry",
  "upset",
  "alone",
  "lonely",
  "worried",
  "उदास",
  "डर",
  "डरती",
  "अकेला",
  "अकेली",
  "अकेले",
  "रो",
  "रोता",
  "रोती",
  "दुखी",
  "परेशान",
]);

/**
 * Injury to the child, read the same way as a feeling: anchored and crossed, so `i am bleeding`,
 * `i am hurt` and `मुझे चोट लगी` are disclosures of harm rather than distress, and outrank it.
 */
export const HARM_INJURY_TERMS: readonly string[] = Object.freeze([
  "bleeding",
  "bleed",
  "hurt",
  "hurting",
  "burnt",
  "burned",
  "चोट",
  "खून",
]);

/**
 * Distress (Req 5.4, 8.2) whose frame is part of the entry: either the feeling word needs its
 * frame to be about the child (`i feel bad`), or the sentence has no first-person anchor at all
 * (`nobody likes me`). Everything shaped as "first person plus a feeling word" is covered by
 * `FIRST_PERSON_ANCHORS` crossed with `DISTRESS_FEELING_TERMS` instead of being listed here.
 *
 * Matched with up to `MAX_INSERTED_TOKENS` words between the entry's words, so `i feel very bad`
 * and `nobody really likes me` match too.
 */
export const DISTRESS_PHRASES: readonly string[] = Object.freeze([
  "i feel bad",
  // `felt` is irregular, so the inflection rule in `forbidden-spans.ts` cannot reach it from
  // `feel`; the past tense is listed rather than left to a matcher that only removes suffixes
  // (group-5 review pass 4, finding 2).
  "i felt bad",
  "i feel awful",
  "i feel terrible",
  "nobody likes me",
  "no one likes me",
  "nobody plays with me",
  "no one plays with me",
  "मुझे अच्छा नहीं लग",
  "कोई मुझे पसंद नहीं",
]);

/**
 * The built-in Defer_Topics of safety.md §4, each with the terms that name it. `parent_added` has
 * no list here: it comes from the Child_Context and is reported under that one code, so no
 * parent-authored text is ever logged (Req 7.5).
 */
export const DEFER_TOPIC_TERMS: Readonly<
  Record<Exclude<DeferralTopic, "parent_added">, readonly string[]>
> = Object.freeze({
  death: Object.freeze([
    "died",
    "die",
    "dies",
    "dead",
    "death",
    "heaven",
    "funeral",
    "मर गया",
    "मर गई",
    "मौत",
    "मरना",
  ]),
  body: Object.freeze([
    "where do babies come from",
    "private parts",
    "naked",
    "pregnant",
    "breast",
    "बच्चे कहाँ से",
    "शरीर के अंग",
  ]),
  violence: Object.freeze(["war", "gun", "guns", "shoot", "bomb", "stabbed", "जंग", "बंदूक", "बम"]),
  religion: Object.freeze([
    "god",
    "allah",
    "jesus",
    "temple",
    "church",
    "mosque",
    "prayer",
    "भगवान",
    "मंदिर",
    "मस्जिद",
    "गिरजाघर",
    "पूजा",
  ]),
  family_conflict: Object.freeze([
    "divorce",
    "parents fight",
    "mummy and daddy fight",
    "papa shouts",
    "mummy shouts",
    "तलाक",
    "मम्मी पापा लड़",
  ]),
});

/** The order the topics are tested in, so one text always gives one topic code. */
const DEFER_TOPIC_ORDER: readonly Exclude<DeferralTopic, "parent_added">[] = Object.freeze([
  "death",
  "body",
  "violence",
  "religion",
  "family_conflict",
]);

/**
 * The content categories this phase can recognise in a child's words, each with its terms
 * (Req 5.2). A category is "gated": when a term of it appears and the parent has not allowed that
 * category, the turn is refused with `blocked_category`.
 *
 * Ordinary chat matches no category and so is allowed: the rule refuses a topic the parent has
 * not opened, not every sentence. A text matching two categories is refused when either of them
 * is unallowed, which is the conservative direction (safety.md §8).
 */
export const CONTENT_CATEGORY_TERMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  stories: Object.freeze(["story", "stories", "tale", "कहानी", "कहानियाँ"]),
  songs: Object.freeze(["song", "songs", "rhyme", "lullaby", "गाना", "गीत", "लोरी"]),
  animals: Object.freeze([
    "animal",
    "animals",
    "lion",
    "tiger",
    "elephant",
    "जानवर",
    "शेर",
    "हाथी",
  ]),
  maths: Object.freeze(["maths", "math", "number", "numbers", "count to", "गिनती", "गणित"]),
  world: Object.freeze(["planet", "planets", "ocean", "volcano", "country", "ग्रह", "समुद्र"]),
  feelings: Object.freeze(["feeling", "feelings", "breathing", "भावना", "भावनाएँ"]),
  manners: Object.freeze(["manners", "please and thank you", "शिष्टाचार"]),
  games: Object.freeze(["game", "games", "dance", "treasure hunt", "खेल", "नाच"]),
});

/** The gated category codes, in the order `checkInput` tests them. */
export const GATED_CONTENT_CATEGORIES: readonly string[] = Object.freeze(
  Object.keys(CONTENT_CATEGORY_TERMS),
);

function allows(allowed: readonly string[], category: string): boolean {
  return allowed.some((entry) => entry.trim().toLowerCase() === category);
}

/** The first gated category the text names that the Child_Context does not allow, or null. */
function blockedCategory(text: string, allowed: readonly string[]): string | null {
  for (const category of GATED_CONTENT_CATEGORIES) {
    const terms = CONTENT_CATEGORY_TERMS[category] ?? [];
    if (!terms.some((term) => containsTerm(text, term))) continue;
    if (!allows(allowed, category)) return category;
  }
  return null;
}

/** The Defer_Topic the text names, built-in topics first, then the parent-added list. */
function deferTopic(text: string, parentTopics: readonly string[]): DeferralTopic | null {
  for (const topic of DEFER_TOPIC_ORDER) {
    const terms = DEFER_TOPIC_TERMS[topic];
    if (terms.some((term) => containsTerm(text, term))) return topic;
  }
  for (const term of parentTopics) {
    if (containsTerm(text, term)) return "parent_added";
  }
  return null;
}

/**
 * True when the child says they were hurt: a phrase from the list, or a first-person anchor
 * followed by an injury word. Both tolerate up to `MAX_INSERTED_TOKENS` inserted words.
 */
function disclosesHarm(text: string): boolean {
  if (HARM_DISCLOSURE_PHRASES.some((phrase) => containsTermNear(text, phrase, MAX_INSERTED_TOKENS)))
    return true;
  return containsAnchoredTerm(text, HARM_ANCHORS, HARM_INJURY_TERMS, MAX_INSERTED_TOKENS);
}

/** True when the child says they feel bad, frightened or alone, by either shape of the rule. */
function isDistressed(text: string): boolean {
  if (DISTRESS_PHRASES.some((phrase) => containsTermNear(text, phrase, MAX_INSERTED_TOKENS)))
    return true;
  return containsAnchoredTerm(
    text,
    FIRST_PERSON_ANCHORS,
    DISTRESS_FEELING_TERMS,
    MAX_INSERTED_TOKENS,
  );
}

/** Code points, so a surrogate pair counts once and both scripts are measured the same way. */
function codePointCount(text: string): number {
  return [...text].length;
}

function verdict(
  decision: SafetyDecisionName,
  rule: SafetyRule,
  topic: DeferralTopic | null = null,
): SafetyVerdict {
  return { decision, rule, topic };
}

/**
 * Exactly one verdict for any text (Property 5). Precedence, highest first: harm disclosure,
 * distress, Defer_Topic, blocked category, over-long, uncertain, allow.
 */
export function checkInput(text: string, ctx: GuardContext): SafetyVerdict {
  if (disclosesHarm(text)) return verdict("comfort", "harm_disclosure");
  if (isDistressed(text)) return verdict("comfort", "distress");
  const topic = deferTopic(text, ctx.deferTopics);
  if (topic !== null) return verdict("defer", "defer_topic", topic);
  if (blockedCategory(text, ctx.allowedCategories) !== null) {
    return verdict("refuse", "blocked_category");
  }
  if (codePointCount(text) > INPUT_MAX_CODE_POINTS) return verdict("refuse", "too_long");
  if (isUnreadable(text)) return verdict("refuse", "uncertain");
  return verdict("allow", "none");
}
