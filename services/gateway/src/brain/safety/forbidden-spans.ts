// Lexical scanners over transcript and reply text (Req 6.2, 6.5, C19). Three jobs live here,
// because they are the same shape: read text, answer with a code, never hand back the text.
//
//  - the forbidden-span detectors: a URL, a contact detail, a price or a brand name;
//  - the word-boundary term matcher both guards use over their word lists;
//  - the readability predicate behind the guards' `uncertain` rule.
//
// Nothing here returns, logs or keeps any part of the text it scanned. A caller gets a
// closed-enum kind and, at most, a position, so no forbidden substring can reach a Log_Entry, a
// Conversation_Turn_View or a return value (Omar ruling 1, safety.md §7). A refusal replaces the
// whole reply, so nothing is ever redacted and no half of a forbidden thing is ever spoken (C19).
//
// Every rule here is enforced in both supported scripts (Req 11.2): a digit run counts Devanagari
// numerals as well as ASCII ones, the money words and the brand names carry their Hindi
// spellings, and the readability predicate treats a Devanagari digit, a danda and a bare
// combining mark as not-a-letter, so a text made only of those is `uncertain` rather than guessed
// at. Hindi terms are written as literals, not escapes, so the lists can be read.
//
// The word lists are fixed in this source file. There is no model in the loop, so the detectors
// cannot be talked out of a match, and a false positive costs a Safe_Redirect, which is the side
// to err on (safety.md §8).
//
// GATE (the real-provider phase): the detectors are lexical, so three lexical evasions are not
// matched —
//
//   - a span written apart:        `y o u t u b e`
//   - a span spelled out in words: `nine eight seven six five`
//   - a span split by a joiner:    `you\u200dtube` (ZWJ or ZWNJ inside a Latin word)
//
// The third is the price of the second: ZWJ and ZWNJ are accepted as word characters because
// Hindi words need them, so an injected joiner splits a Latin brand without making the text
// unreadable. Nothing in this phase can reach any of the three — every reply Xelulu speaks comes
// from a constant in `safe-text.ts` or from the Mock_Llm's in-source table — and closing them
// needs more than a longer word list, so they are recorded here as a gate for the phase that
// wires a real LlmProvider.

/** The four things that may never be spoken to a child (safety.md §3). */
export type ForbiddenKind = "url" | "contact_detail" | "price" | "brand";

/**
 * The order `checkOutput` applies, highest first. `firstForbidden` answers with the first kind in
 * this order that matches, not the leftmost span, so one text always gives one stable rule.
 */
export const FORBIDDEN_KIND_PRECEDENCE: readonly ForbiddenKind[] = Object.freeze([
  "url",
  "contact_detail",
  "price",
  "brand",
]);

/**
 * A matched span, named by kind and located by its UTF-16 index. Deliberately carries no text and
 * no length: a caller that wants to report a span can report where it was, never what it said.
 */
export type ForbiddenSpanRef = Readonly<{ kind: ForbiddenKind; at: number }>;

// ---------------------------------------------------------------------------------------------
// Characters
//
// The Devanagari block is split into its letters, its digits and its combining marks, because
// the three play different parts. A digit spells a phone number in either script, a mark belongs
// to the word it sits on, and only a letter makes a text readable.

/** Devanagari letters: the independent vowels and consonants, OM, and the additional letters. */
function isDevanagariLetter(code: number): boolean {
  if (code >= 0x0904 && code <= 0x0939) return true; // ऄ to ह
  if (code === 0x0950) return true; // ॐ
  if (code >= 0x0958 && code <= 0x0961) return true; // क़ to ॡ
  return code >= 0x0972 && code <= 0x097f; // the additional letters
}

/** Devanagari combining marks, the virama and the avagraha: part of a word, never a word. */
function isDevanagariMark(code: number): boolean {
  if (code >= 0x0900 && code <= 0x0903) return true;
  if (code >= 0x093a && code <= 0x094f) return true;
  if (code >= 0x0951 && code <= 0x0957) return true;
  return code >= 0x0962 && code <= 0x0963;
}

/** A digit of either supported script: `0`-`9` and the Devanagari numerals `०`-`९`. */
function isDigit(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) return true; // 0-9
  return code >= 0x0966 && code <= 0x096f; // ० to ९
}

/** Letters and digits of the two scripts this phase supports, plus the joiners Hindi needs. */
function isWordChar(code: number): boolean {
  if (isDigit(code)) return true;
  if (code >= 0x61 && code <= 0x7a) return true; // a-z
  if (code >= 0x41 && code <= 0x5a) return true; // A-Z
  if (isDevanagariLetter(code) || isDevanagariMark(code)) return true;
  if (code === 0x200c || code === 0x200d) return true; // ZWNJ and ZWJ, inside Hindi words
  return false;
}

/**
 * True when a letter of either supported script sits at this code unit. A digit, a danda and a
 * bare combining mark are not letters in either script, so a text made only of those is
 * unreadable and the guards refuse it rather than guess at it.
 */
function isLetter(code: number): boolean {
  if (code >= 0x61 && code <= 0x7a) return true;
  if (code >= 0x41 && code <= 0x5a) return true;
  return isDevanagariLetter(code);
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\u00a0";
}

/**
 * The punctuation a spoken text may carry. Anything outside this set, the two scripts' letters,
 * the digits, the Devanagari marks and whitespace is text the guards cannot read, so it is
 * `uncertain` rather than guessed at. The Devanagari danda `।` and double danda `॥` are here
 * because they punctuate a Hindi sentence; they are punctuation, not word characters, so a Hindi
 * term is matched with a danda against it (`मौत।`). All three apostrophe forms the folder knows
 * about are here too, so a contraction reads the same way whichever one a provider emits.
 */
const READABLE_PUNCTUATION: ReadonlySet<string> = new Set([
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
  "'",
  "\u2018",
  "\u2019",
  "\u02bc",
  "-",
  "\u2013",
  "\u2014",
  "(",
  ")",
  "\u0964", // ।
  "\u0965", // ॥
  "\u0970", // ॰, the Devanagari abbreviation sign
  "\u2026", // …
]);

/**
 * True when the guards cannot read this text, which is the `uncertain` rule's whole definition
 * (safety.md §4): it is blank, it carries no letter of either supported script, or it carries a
 * character outside the readable set. Readability says nothing about meaning, and nothing about
 * length: an over-long but readable text is the `length` or `too_long` rule's business.
 */
export function isUnreadable(text: string): boolean {
  if (text.trim().length === 0) return true;
  let sawLetter = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isLetter(code)) {
      sawLetter = true;
      continue;
    }
    if (isWordChar(code) || isWhitespace(ch) || READABLE_PUNCTUATION.has(ch)) continue;
    return true;
  }
  return !sawLetter;
}

// ---------------------------------------------------------------------------------------------
// Folding
//
// Every scan reads a folded copy of the text: each code point canonically decomposed,
// lowercased, and — for the apostrophe — reduced to one spelling. Decomposition matters because
// Devanagari writes a nukta letter two ways — `ज़` is either U+095B or `ज` followed by the nukta
// U+093C — and the two are canonically equivalent, so a reply that says a brand with a
// precomposed nukta is the same reply. The apostrophe matters because a contraction has three
// common spellings and only one of them is the straight ASCII quote: STT output and most text
// normalisation produce the typographic U+2019, so a phrase list written with U+0027 would be
// live for the less likely spelling. Folding means one list entry covers every spelling instead
// of the list having to enumerate them.
//
// Folded per code point rather than per string, so one folded code unit always belongs to one
// code point of the original and a folded position maps back to it. The one thing a per-string
// NFD would add is canonical reordering of a run of combining marks, which only differs for
// marks already written out of order.
//
// Whitespace is folded too: any run of spaces, tabs, newlines and no-break spaces becomes one
// ASCII space. Without that, every multi-word entry in the layer would be live for exactly one
// spelling of the gap between its words, and a reply that wrapped a brand name across two lines
// — or a transcript that put two spaces inside `hurt me` — would walk straight past the list
// (group-5 review pass 3, finding 1). A run folds to one code unit, so one folded code unit
// still belongs to one code point of the original: the run's first one.

/**
 * The apostrophe spellings folded to the straight ASCII quote: the left and right single
 * quotation marks and the modifier-letter apostrophe. None has a canonical decomposition to
 * U+0027, so NFD does not do this and it has to be written out. Each folds to exactly one code
 * unit, so a folded position still maps back to one code point of the original.
 */
const APOSTROPHE_FORMS: ReadonlySet<string> = new Set(["\u2018", "\u2019", "\u02bc"]);

/** One code point folded for matching: apostrophes unified, then decomposed and lowercased. */
function foldCodePoint(ch: string): string {
  if (APOSTROPHE_FORMS.has(ch)) return "'";
  return ch.normalize("NFD").toLowerCase();
}

/** `text` folded for matching. Idempotent: a folded text folds to itself. */
function fold(text: string): string {
  let folded = "";
  let inSpaceRun = false;
  for (const ch of text) {
    if (isWhitespace(ch)) {
      if (!inSpaceRun) folded += " ";
      inSpaceRun = true;
      continue;
    }
    folded += foldCodePoint(ch);
    inSpaceRun = false;
  }
  return folded;
}

/**
 * `text` folded for matching, with the index in `text` that each folded code unit came from.
 * Folding can change a code point's length, so the detectors read the folded copy and report a
 * position in the original. A folded whitespace run reports the index of its first code point.
 */
function foldWithOrigin(text: string): Readonly<{ folded: string; origin: readonly number[] }> {
  let folded = "";
  const origin: number[] = [];
  let inSpaceRun = false;
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    if (isWhitespace(ch)) {
      if (!inSpaceRun) {
        folded += " ";
        origin.push(i);
      }
      inSpaceRun = true;
      i += ch.length;
      continue;
    }
    const part = foldCodePoint(ch);
    for (let k = 0; k < part.length; k += 1) origin.push(i);
    folded += part;
    inSpaceRun = false;
    i += ch.length;
  }
  return { folded, origin };
}

// ---------------------------------------------------------------------------------------------
// Term matching
//
// A term is matched as a run of whole words over the folded text's word tokens, never as a loose
// substring, so `die` does not match `soldier` and `god` does not match `good`. Tokens rather
// than `indexOf` for one reason: a phrase's words have to be matchable across whatever sits
// between them. Two things sit between words —
//
//   - whitespace and punctuation, which the tokeniser drops, so `coca  cola`, `coca\ncola` and
//     `coca, cola` all match the entry `coca cola`;
//   - other words, which only the lists that ask for it tolerate: `maxGap` is the number of word
//     tokens allowed between two words of the term, and it is 0 for every list except the
//     Input_Guard's harm and distress lists, where an inserted intensifier is the common case
//     and is exactly the word that marks how bad it is (group-5 review pass 3, findings 1-3).
//
// Nothing here hands back a matched word: a caller gets a boolean or a position.

/** A word token of a folded text: the token itself and where it starts in the folded copy. */
type FoldedToken = Readonly<{ text: string; at: number }>;

/** The word tokens of an already-folded text, in order. Punctuation and whitespace separate. */
function tokensOf(folded: string): readonly FoldedToken[] {
  const tokens: FoldedToken[] = [];
  let start = -1;
  for (let i = 0; i <= folded.length; i += 1) {
    const isWord = i < folded.length && isWordChar(folded.charCodeAt(i));
    if (isWord) {
      if (start === -1) start = i;
      continue;
    }
    if (start !== -1) {
      tokens.push({ text: folded.slice(start, i), at: start });
      start = -1;
    }
  }
  return tokens;
}

/** `term`'s word tokens, folded. A blank or wordless term gives none, so it matches nothing. */
function needleOf(term: string): readonly string[] {
  return tokensOf(fold(term)).map((token) => token.text);
}

// ---------------------------------------------------------------------------------------------
// Inflection
//
// A word list matches word forms, so a list carrying `hurt` but not `hurts` was live for
// whichever spelling someone happened to type: `i am hurt` comforted while `my leg hurts` did
// not, and `He gave her a kiss.` refused while `He kissed her.` did not (group-5 review pass 4,
// finding 2). Rather than lengthen every list and still miss a form, a Latin word is compared by
// a small set of inflection candidates: the word itself, plus the bases left by removing one
// common English suffix. Two words match when their candidate sets share a member, so the rule
// works whichever side carries the longer form and no list has to guess which forms to carry.
//
// Latin only, on purpose. Devanagari inflection is morphologically richer than suffix removal
// can reach, and half-solving it would read as coverage it does not have, so it stays in the
// GATE above.
//
// A base is never shorter than `MIN_STEM`, so the rule cannot collapse two unrelated short
// words, and a trailing `e` is never removed on its own: that is what keeps `car` from meeting
// `care`. The `e` is only ever reached through the `ed` and `ing` forms, where `liked` and
// `liking` both have to meet `like`.

/** The shortest base an inflection rule may leave, so two short unrelated words cannot collide. */
const MIN_STEM = 3;

/** True when every code unit is a folded ASCII letter, the only script these rules fit. */
function isLatinWord(word: string): boolean {
  if (word.length === 0) return false;
  for (let i = 0; i < word.length; i += 1) {
    const code = word.charCodeAt(i);
    if (code < 0x61 || code > 0x7a) return false;
  }
  return true;
}

/** A base with a doubled final consonant reduced, so `hitt` from `hitting` meets `hit`. */
function undouble(base: string): string | null {
  const n = base.length;
  if (n < 2 || n - 1 < MIN_STEM) return null;
  const last = base[n - 1] ?? "";
  if (last !== base[n - 2] || "aeiou".includes(last)) return null;
  return base.slice(0, n - 1);
}

/**
 * `word` plus the bases left by removing one common English suffix. A folded Latin word longer
 * than `MIN_STEM` only; anything else is its own single candidate, so Devanagari and short words
 * are matched exactly as before.
 */
function inflectionCandidates(word: string): readonly string[] {
  if (!isLatinWord(word) || word.length <= MIN_STEM) return [word];
  const out = new Set<string>([word]);
  const add = (base: string): void => {
    if (base.length >= MIN_STEM) out.add(base);
  };
  if (word.endsWith("ing")) {
    const base = word.slice(0, -3);
    add(base);
    add(`${base}e`);
    const single = undouble(base);
    if (single !== null) add(single);
  } else if (word.endsWith("ed")) {
    const base = word.slice(0, -2);
    add(base);
    add(word.slice(0, -1));
    const single = undouble(base);
    if (single !== null) add(single);
  } else if (word.endsWith("es")) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
  } else if (word.endsWith("s") && !word.endsWith("ss")) {
    add(word.slice(0, -1));
  }
  return [...out];
}

/**
 * True when a text's word token and a term's word are the same word, allowing one common English
 * inflection on either side. Identity is checked first, so the common case costs nothing.
 */
function wordsMatch(token: string, needleWord: string): boolean {
  if (token === needleWord) return true;
  const mine = inflectionCandidates(token);
  const theirs = new Set(inflectionCandidates(needleWord));
  return mine.some((candidate) => theirs.has(candidate));
}

/**
 * The index of the last token of `needle` when it starts at `start`, or null. Up to `maxGap`
 * word tokens may sit between two consecutive words of the needle.
 */
function matchFrom(
  tokens: readonly FoldedToken[],
  needle: readonly string[],
  start: number,
  maxGap: number,
): number | null {
  if (needle.length === 0) return null;
  const head = tokens[start]?.text;
  if (head === undefined || !wordsMatch(head, needle[0] ?? "")) return null;
  let at = start;
  for (let word = 1; word < needle.length; word += 1) {
    let found = -1;
    for (let gap = 0; gap <= maxGap; gap += 1) {
      const next = at + 1 + gap;
      if (next >= tokens.length) break;
      const candidate = tokens[next]?.text;
      if (candidate !== undefined && wordsMatch(candidate, needle[word] ?? "")) {
        found = next;
        break;
      }
    }
    if (found === -1) return null;
    at = found;
  }
  return at;
}

/** The first run of `tokens` from `from` that matches `needle`, or null. */
function findRun(
  tokens: readonly FoldedToken[],
  needle: readonly string[],
  maxGap: number,
  from = 0,
): Readonly<{ start: number; end: number }> | null {
  if (needle.length === 0) return null;
  for (let start = from; start < tokens.length; start += 1) {
    const end = matchFrom(tokens, needle, start, maxGap);
    if (end !== null) return { start, end };
  }
  return null;
}

/**
 * Where `term` appears in `haystack` as a run of whole words, or -1. A blank term matches
 * nothing, which is what keeps a blank parent-added Defer_Topic from refusing every turn.
 *
 * The index is into the folded haystack. `firstForbiddenSpan` is the only caller that reports a
 * position, and it folds the text itself so it can map the index back; folding is idempotent, so
 * folding an already-folded haystack here leaves the index where that caller expects it.
 */
export function termIndex(haystack: string, term: string): number {
  const tokens = tokensOf(fold(haystack));
  const run = findRun(tokens, needleOf(term), 0);
  return run === null ? -1 : (tokens[run.start]?.at ?? -1);
}

/** True when `term` appears in `haystack` as a run of whole words, with nothing between them. */
export function containsTerm(haystack: string, term: string): boolean {
  return termIndex(haystack, term) !== -1;
}

/**
 * True when `term` appears in `haystack` as a run of whole words with at most `maxGap` word
 * tokens between any two of them, so `hurt me` still matches `hurt poor me` and `i feel bad`
 * still matches `i feel very bad` (Req 5.4).
 */
export function containsTermNear(haystack: string, term: string, maxGap: number): boolean {
  return findRun(tokensOf(fold(haystack)), needleOf(term), maxGap) !== null;
}

/**
 * True when one of `anchors` appears in `haystack` and one of `terms` begins within `maxGap` word
 * tokens after it, in that order. This is how the Input_Guard reads a feeling: the feeling word
 * carries the class and the first-person anchor qualifies it, so the whole cross product of
 * "i am / i'm / i feel / मैं / मुझे" against "sad / scared / alone / उदास" is covered — including
 * the inserted intensifier (`i am very sad`, `मैं बहुत उदास हूँ`) that no list length survives
 * (group-5 review pass 3, findings 2 and 3). An anchor's own words must be adjacent; a blank
 * anchor or term is ignored.
 */
export function containsAnchoredTerm(
  haystack: string,
  anchors: readonly string[],
  terms: readonly string[],
  maxGap: number,
): boolean {
  const tokens = tokensOf(fold(haystack));
  if (tokens.length === 0) return false;
  const needles = terms.map(needleOf).filter((needle) => needle.length > 0);
  if (needles.length === 0) return false;
  for (const anchor of anchors) {
    const anchorNeedle = needleOf(anchor);
    if (anchorNeedle.length === 0) continue;
    let from = 0;
    for (;;) {
      const run = findRun(tokens, anchorNeedle, 0, from);
      if (run === null) break;
      for (const needle of needles) {
        for (let gap = 0; gap <= maxGap; gap += 1) {
          const start = run.end + 1 + gap;
          if (start >= tokens.length) break;
          if (matchFrom(tokens, needle, start, maxGap) !== null) return true;
        }
      }
      from = run.start + 1;
    }
  }
  return false;
}

// There is deliberately no `firstTerm(text, terms): string` here. A matcher that hands back the
// term it matched would be the one way a caller could put list text into a Log_Entry, and one of
// the lists in the layer — `GuardContext.deferTopics` — is parent-authored text that Req 7.5
// forbids logging. Callers ask `containsTerm` (a boolean) or `earliestTermAt` (a position), and
// name the class themselves from a closed enum (Omar ruling 1, safety.md §7).

/** The earliest whole-word position any term of `terms` holds in `text`, or null. */
function earliestTermAt(text: string, terms: readonly string[]): number | null {
  let earliest: number | null = null;
  for (const term of terms) {
    const at = termIndex(text, term);
    if (at !== -1 && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest;
}

// ---------------------------------------------------------------------------------------------
// URL

/** A scheme and authority: `https://`, `ws://`, `ftp://` and anything else shaped like one. */
const URL_SCHEME_RE = /[a-z][a-z0-9+.-]*:\/\//;

/** A host that was written without a scheme: `www.anything` or `label.tld`. */
const URL_BARE_HOST_RE =
  /www\.[a-z0-9-]+|[a-z0-9][a-z0-9-]*\.(?:com|net|org|in|co|io|me|tv|app|info|biz|xyz|gov|edu|uk|us|ai|dev|site|online|link)\b/;

function urlAt(folded: string): number | null {
  const scheme = URL_SCHEME_RE.exec(folded);
  const bare = URL_BARE_HOST_RE.exec(folded);
  const indexes = [scheme?.index, bare?.index].filter((i): i is number => i !== undefined);
  return indexes.length === 0 ? null : Math.min(...indexes);
}

// ---------------------------------------------------------------------------------------------
// Contact detail

/** Digits in one run, counting the separators a written number carries. */
const MIN_CONTACT_DIGITS = 7;
const CONTACT_SEPARATORS: ReadonlySet<string> = new Set([" ", "-", ".", "(", ")", "+", "\u00a0"]);

/** An `@`-address shape, which covers an email and anything written like one. */
const CONTACT_ADDRESS_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+/;

/**
 * The start of the first digit run holding at least `MIN_CONTACT_DIGITS` digits, counting the
 * Devanagari numerals too: `९८७६५४३२१०` is as much a phone number as `9876543210` is.
 */
function digitRunAt(folded: string): number | null {
  let start = -1;
  let digits = 0;
  for (let i = 0; i < folded.length; i += 1) {
    const ch = folded[i] ?? "";
    if (isDigit(ch.codePointAt(0) ?? 0)) {
      if (start === -1) start = i;
      digits += 1;
      if (digits >= MIN_CONTACT_DIGITS) return start;
      continue;
    }
    if (start !== -1 && CONTACT_SEPARATORS.has(ch)) continue;
    start = -1;
    digits = 0;
  }
  return null;
}

function contactAt(folded: string): number | null {
  const address = CONTACT_ADDRESS_RE.exec(folded);
  const run = digitRunAt(folded);
  const indexes = [address?.index, run].filter((i): i is number => i !== null && i !== undefined);
  return indexes.length === 0 ? null : Math.min(...indexes);
}

// ---------------------------------------------------------------------------------------------
// Price

/** A currency symbol or code beside digits of either script, in either order. */
const PRICE_SYMBOL_RE =
  /(?:\u20b9|\$|\u20ac|\u00a3|\brs\.?|\binr\b|\busd\b|\beur\b|\bgbp\b)\s*[0-9\u0966-\u096f]|[0-9\u0966-\u096f]\s*(?:\u20b9|\$|\u20ac|\u00a3|\brs\.?|\binr\b|\busd\b)/;

/** The words for money and for buying, in both supported languages (safety.md §3). */
export const PRICE_TERMS: readonly string[] = Object.freeze([
  "price",
  "prices",
  "cost",
  "costs",
  "rupee",
  "rupees",
  "paisa",
  "paise",
  "dollar",
  "dollars",
  "discount",
  "buy",
  "buys",
  "purchase",
  "order now",
  "कीमत",
  "दाम",
  "रुपया",
  "रुपये",
  "पैसे",
  "खरीद",
]);

function priceAt(folded: string): number | null {
  const symbol = PRICE_SYMBOL_RE.exec(folded);
  const term = earliestTermAt(folded, PRICE_TERMS);
  const indexes = [symbol?.index, term].filter((i): i is number => i !== null && i !== undefined);
  return indexes.length === 0 ? null : Math.min(...indexes);
}

// ---------------------------------------------------------------------------------------------
// Brand

/**
 * The blocked brand list. A starter set of the names a child is most likely to have heard, so
 * that Xelulu never points at a shop, an app or a show it cannot vouch for (safety.md §3). It is
 * a word list, not a contract: adding a name needs no `proto_ver` bump and no schema change.
 *
 * A name here also blocks its innocent sense, so a reply about the Amazon rainforest is refused
 * and a Safe_Redirect is spoken instead. That is the conservative direction and it is deliberate.
 *
 * Each name is listed in both scripts, because a brand said in Hindi is the same brand (Req
 * 11.2). An entry needs only one spelling of a nukta letter, because the matcher folds both
 * forms of `ज़` together; it does need a second entry where the common spellings use genuinely
 * different letters, as `अमेजन` does against `अमेज़न`.
 */
export const BLOCKED_BRANDS: readonly string[] = Object.freeze([
  "youtube",
  "netflix",
  "amazon",
  "flipkart",
  "instagram",
  "whatsapp",
  "tiktok",
  "facebook",
  "snapchat",
  "google",
  "chatgpt",
  "disney",
  "roblox",
  "minecraft",
  "fortnite",
  "mcdonald",
  "mcdonalds",
  "coca cola",
  "coca-cola",
  "pepsi",
  "lego",
  "barbie",
  "paytm",
  "zomato",
  "swiggy",
  "myntra",
  // The same names in Devanagari.
  "यूट्यूब", // youtube
  "नेटफ्लिक्स", // netflix
  "अमेज़न", // amazon
  "अमेजन", // amazon, spelled with ज rather than ज़
  "फ्लिपकार्ट", // flipkart
  "इंस्टाग्राम", // instagram
  "व्हाट्सएप", // whatsapp
  "व्हाट्सऐप", // whatsapp, spelled with ऐ
  "वाट्सएप", // whatsapp, spelled without the व्ह cluster
  "वाट्सऐप", // whatsapp, both variants together
  "टिकटॉक", // tiktok
  "फेसबुक", // facebook
  "स्नैपचैट", // snapchat
  "गूगल", // google
  "चैटजीपीटी", // chatgpt
  "डिज़्नी", // disney
  "डिजनी", // disney, spelled with ज rather than ज़
  "रोबलॉक्स", // roblox
  "माइनक्राफ्ट", // minecraft
  "फोर्टनाइट", // fortnite
  "मैकडॉनल्ड", // mcdonald
  "मैकडॉनल्ड्स", // mcdonalds
  "कोका कोला", // coca cola
  "पेप्सी", // pepsi
  "लेगो", // lego
  "बार्बी", // barbie
  "पेटीएम", // paytm
  "ज़ोमैटो", // zomato
  "जोमैटो", // zomato, spelled with ज rather than ज़
  "स्विगी", // swiggy
  "मिंत्रा", // myntra
]);

function brandAt(folded: string): number | null {
  return earliestTermAt(folded, BLOCKED_BRANDS);
}

// ---------------------------------------------------------------------------------------------
// The detector

const DETECTORS: readonly (readonly [ForbiddenKind, (folded: string) => number | null])[] =
  Object.freeze([
    ["url", urlAt],
    ["contact_detail", contactAt],
    ["price", priceAt],
    ["brand", brandAt],
  ] as const);

/**
 * The highest-precedence forbidden span in `text`, as a kind and a position in `text`, or null.
 * The position exists so a caller can say where a span was without ever naming what it was; the
 * text itself is not returned, copied or logged anywhere (Req 6.2, C19).
 */
export function firstForbiddenSpan(text: string): ForbiddenSpanRef | null {
  const { folded, origin } = foldWithOrigin(text);
  for (const [kind, detector] of DETECTORS) {
    const at = detector(folded);
    if (at !== null) return { kind, at: origin[at] ?? 0 };
  }
  return null;
}

/** The first forbidden span's kind, or null. Never returns the span's text (Req 6.2, C19). */
export function firstForbidden(text: string): ForbiddenKind | null {
  return firstForbiddenSpan(text)?.kind ?? null;
}
