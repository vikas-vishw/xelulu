// The Word_Of_The_Day (XL-G07, Req 5): one family word a day, the same for every child, with no
// per-child history, preference or progress value of any kind (C10, safety.md §2).
//
// Two things live here, and both are shared rather than reimplemented elsewhere: the one notion
// of a LOCAL day that the scheduler and the day's word agree on, and the narration templates the
// turn path and the morning routine both speak.
import { type AgeStage, type SupportedLang, type WordEntry } from "@xelulu/shared";

const DAY_MS = 86_400_000;

/**
 * Exactly `Date.prototype.getTimezoneOffset`, in milliseconds: POSITIVE west of UTC and negative
 * east of it, so IST (UTC+05:30) gives -19,800,000.
 *
 * The sign is pinned here because a silent flip moves every day boundary by twice the offset.
 * Worked IST example: at 01:00 IST on 24 October, `nowMs` is 2026-10-23T19:30:00Z; subtracting a
 * negative offset ADDS five and a half hours, and the result divided as if it were UTC lands on
 * 24 October — the local day — rather than on the 23rd the UTC date would give.
 */
function localOffsetMs(nowMs: number): number {
  return new Date(nowMs).getTimezoneOffset() * 60_000;
}

/** Whole LOCAL days since the Unix epoch, from a Clock time and the host's offset (Req 5.2). */
export function localDayIndex(nowMs: number): number {
  return Math.floor((nowMs - localOffsetMs(nowMs)) / DAY_MS);
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * The local `YYYY-MM-DD` for a Clock time: the once-per-day key every scheduled thing is keyed
 * on. Read from the same `new Date(nowMs)` local getters the gateway's `nowMinutes` uses, so
 * quiet hours, the day key and the day index share one notion of "local".
 */
export function localDayKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Local minutes past midnight for a Clock time: what a schedule's `HH:MM` is compared against,
 * and what the Device_Policy_Gate's quiet-hours window is read in. Here beside the day key and
 * the day index so there is ONE notion of "local" in the Gateway and not three.
 */
export function localMinutes(nowMs: number): number {
  const d = new Date(nowMs);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The day's entry for one language, or null (Req 5.5). The day's INDEX is the same for every
 * child and every language; the walk forward from it — wrapping once — finds the first entry that
 * carries `lang`, because a `WordEntry` holds one language and a Hindi word of the day is not the
 * English one translated (C10).
 */
export function wordForDay(
  words: readonly WordEntry[],
  nowMs: number,
  lang: SupportedLang,
): WordEntry | null {
  if (words.length === 0) return null;
  const size = words.length;
  const start = ((localDayIndex(nowMs) % size) + size) % size;
  for (let step = 0; step < size; step += 1) {
    const entry = words[(start + step) % size];
    if (entry !== undefined && entry.lang === lang) return entry;
  }
  return null;
}

/** Drops one trailing sentence terminator, so a template can join two lines into one sentence. */
function withoutTerminator(text: string): string {
  return text.replace(/[.!?\u0964\u2026]+\s*$/u, "");
}

/** Lowercases only the first character, so a joined clause reads as a clause and a name survives. */
function lowerFirst(text: string): string {
  const first = [...text][0];
  return first === undefined ? text : first.toLowerCase() + text.slice(first.length);
}

/**
 * The narration, per language and per Age_Stage (Req 5.4a). The stage is a parameter rather than a
 * detail because one string cannot be inside `tiny`'s one sentence of eight words and still be
 * useful at `maker`, and Property 1 measures every one of these with `checkOutput` at the stage it
 * was written for.
 *
 * `maker`'s is THREE sentences, not four: `AGE_SENTENCE_LIMITS.maker` is 3, so the obvious
 * four-sentence form would be refused `length` at the stage it was written for. The meaning and
 * the example are joined with "and" instead, which keeps the invitation inside the limit.
 */
export function wordNarration(entry: WordEntry, lang: SupportedLang, stage: AgeStage): string {
  const example = withoutTerminator(entry.example);
  if (lang === "hi-IN") {
    switch (stage) {
      case "tiny":
        return `आज का शब्द ${entry.word} है।`;
      case "little":
        return `आज का शब्द ${entry.word} है। इसका अर्थ ${entry.meaning} है।`;
      case "explorer":
        return `आज का शब्द ${entry.word} है। इसका अर्थ ${entry.meaning} है। ${entry.example}`;
      case "maker":
        return `आज का शब्द ${entry.word} है। इसका अर्थ ${entry.meaning} है और ${example}। क्या तुम इसे आज कहोगे?`;
    }
  }
  switch (stage) {
    case "tiny":
      return `Today's word is ${entry.word}.`;
    case "little":
      return `Today's word is ${entry.word}. It means ${entry.meaning}.`;
    case "explorer":
      return `Today's word is ${entry.word}. It means ${entry.meaning}. ${entry.example}`;
    case "maker":
      return `Today's word is ${entry.word}. It means ${entry.meaning}, and ${lowerFirst(example)}. Can you use it today?`;
  }
}

/**
 * The plain morning greeting (Req 5.4b): what the morning routine says INSTEAD of a word, when no
 * entry carries the Child_Context's first language or when the parent has not opened the `world`
 * category (C38). A template constant like the narrations, and Property 1 measures it the same
 * way.
 */
export const MORNING_GREETING: Readonly<Record<SupportedLang, Readonly<Record<AgeStage, string>>>> =
  Object.freeze({
    "en-IN": Object.freeze({
      tiny: "Good morning!",
      little: "Good morning! Let us start the day.",
      explorer: "Good morning! Let us start the day. What shall we do first?",
      maker: "Good morning! Let us start the day together. What shall we try first today?",
    }),
    "hi-IN": Object.freeze({
      tiny: "सुप्रभात!",
      little: "सुप्रभात! दिन शुरू करें।",
      explorer: "सुप्रभात! दिन शुरू करें। आज क्या करेंगे?",
      maker: "सुप्रभात! चलो दिन साथ शुरू करें। आज पहले क्या करेंगे?",
    }),
  });

/** The greeting for one cell. Every language and stage has one, so this never answers blank. */
export function morningGreeting(lang: SupportedLang, stage: AgeStage): string {
  return MORNING_GREETING[lang][stage];
}
