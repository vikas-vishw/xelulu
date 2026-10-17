// The Word_Of_The_Day (Phase 4 Req 5, 21.6): one family word a day, the same index for every
// child, no per-child history of any kind.
//
// Three things are measured here, and each exists because getting it wrong is silent:
//
//   - THE LOCAL DAY. `localDayIndex` and `localDayKey` share one notion of "local" with the
//     gateway's quiet-hours arithmetic, and the offset's SIGN is pinned: a silent flip moves
//     every day boundary by twice the offset, which nothing else in the system would notice.
//     The assertions are written against local midnight computed from the Date constructor, so
//     they hold in any host zone rather than only in the one this machine runs in.
//   - THE WALK FORWARD. The day's index is shared; the entry is the first one from that index
//     carrying the turn's language, wrapping once (C10).
//   - THE NARRATIONS. Every template, at every Age_Stage and in every language, passes the
//     Output_Guard — including the Requirement 5.4b morning greeting, which is what the morning
//     routine says when there is no word to say.
import { describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  SUPPORTED_LANGS,
  createStarterWords,
  type AgeStage,
  type SupportedLang,
  type WordEntry,
} from "@xelulu/shared";

import { checkOutput } from "../src/brain/safety/output-guard.js";
import {
  MORNING_GREETING,
  localDayIndex,
  localDayKey,
  morningGreeting,
  wordForDay,
  wordNarration,
} from "../src/brain/story/word-of-the-day.js";

const DAY_MS = 86_400_000;

/** Local midnight of the local day containing `at`, from the local Date getters. */
function localMidnight(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function guardCtx(ageStage: AgeStage, lang: SupportedLang) {
  return { ageStage, lang, allowedCategories: [], deferTopics: [] };
}

describe("the local day (Req 5.2)", () => {
  const samples = [
    Date.UTC(2026, 9, 23, 19, 30),
    Date.UTC(2026, 0, 1, 0, 0),
    Date.UTC(2026, 5, 15, 12, 0),
    Date.UTC(2027, 2, 2, 23, 59),
  ];

  it("is constant across a local day and increments at local midnight", () => {
    for (const sample of samples) {
      const midnight = localMidnight(sample);
      const index = localDayIndex(midnight);
      expect(localDayIndex(midnight + DAY_MS - 1)).toBe(index);
      expect(localDayIndex(midnight + DAY_MS)).toBe(index + 1);
      expect(localDayIndex(midnight - 1)).toBe(index - 1);
    }
  });

  it("agrees with the local calendar date, and the key agrees with the index", () => {
    for (const sample of samples) {
      const d = new Date(sample);
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const key = `${String(d.getFullYear())}-${month < 10 ? "0" : ""}${String(month)}-${
        day < 10 ? "0" : ""
      }${String(day)}`;
      expect(localDayKey(sample)).toBe(key);
      // Two instants in the same local day share both the key and the index.
      const midnight = localMidnight(sample);
      expect(localDayKey(midnight)).toBe(localDayKey(midnight + DAY_MS - 1));
      expect(localDayIndex(midnight)).toBe(localDayIndex(midnight + DAY_MS - 1));
      // And the next local day differs in both.
      expect(localDayKey(midnight + DAY_MS)).not.toBe(localDayKey(midnight));
    }
  });

  it("matches the design's worked IST example where the host runs in IST", () => {
    // 01:00 IST on 24 October 2026 is 2026-10-23T19:30:00Z: the LOCAL day is the 24th, so the
    // index must be the one local midnight on the 24th gives — not the 23rd's, which a flipped
    // offset sign would produce. Asserted only in IST, because the claim is about IST.
    const at = Date.UTC(2026, 9, 23, 19, 30);
    if (new Date(at).getTimezoneOffset() !== -330) return;
    expect(localDayKey(at)).toBe("2026-10-24");
    expect(localDayIndex(at)).toBe(localDayIndex(new Date(2026, 9, 24, 0, 0).getTime()));
    expect(localDayIndex(at)).toBe(localDayIndex(new Date(2026, 9, 23, 23, 59).getTime()) + 1);
  });
});

describe("the day's entry (Req 5.2, 5.5, 21.6)", () => {
  const words = createStarterWords();

  it("gives the same entry all day and a different index tomorrow", () => {
    const midnight = localMidnight(Date.UTC(2026, 9, 23, 19, 30));
    for (const lang of SUPPORTED_LANGS) {
      const morning = wordForDay(words, midnight, lang);
      const night = wordForDay(words, midnight + DAY_MS - 1, lang);
      expect(morning?.word_id).toBe(night?.word_id);
      expect(localDayIndex(midnight + DAY_MS)).toBe(localDayIndex(midnight) + 1);
    }
  });

  it("walks forward from the day's index to the first entry in the turn's language", () => {
    // Walked over a whole cycle of days, so every starting index is exercised.
    const base = localMidnight(Date.UTC(2026, 0, 1, 6, 0));
    for (let day = 0; day < words.length + 2; day += 1) {
      const at = base + day * DAY_MS;
      const start = ((localDayIndex(at) % words.length) + words.length) % words.length;
      for (const lang of SUPPORTED_LANGS) {
        const entry = wordForDay(words, at, lang);
        expect(entry, `${String(day)}/${lang}`).not.toBeNull();
        expect(entry?.lang).toBe(lang);
        // It is the FIRST entry from the day's index carrying that language, wrapping once.
        let expected: WordEntry | null = null;
        for (let step = 0; step < words.length && expected === null; step += 1) {
          const candidate = words[(start + step) % words.length];
          if (candidate !== undefined && candidate.lang === lang) expected = candidate;
        }
        expect(entry?.word_id).toBe(expected?.word_id);
      }
    }
  });

  it("gives every child the same entry for the same day and language, with no other input", () => {
    const at = Date.UTC(2026, 3, 7, 9, 0);
    const first = wordForDay(words, at, "en-IN");
    for (let i = 0; i < 5; i += 1) {
      expect(wordForDay(words, at, "en-IN")?.word_id).toBe(first?.word_id);
    }
  });

  it("answers null for an empty list and for a language no entry carries", () => {
    expect(wordForDay([], Date.now(), "en-IN")).toBeNull();
    const englishOnly = words.filter((entry) => entry.lang === "en-IN");
    expect(wordForDay(englishOnly, Date.now(), "hi-IN")).toBeNull();
    expect(wordForDay(englishOnly, Date.now(), "en-IN")).not.toBeNull();
  });
});

describe("the narrations pass the Output_Guard at every stage they are written for", () => {
  const words = createStarterWords();

  it("holds every seeded entry's narration, per stage and per language", () => {
    for (const entry of words) {
      for (const stage of AGE_STAGES) {
        const narration = wordNarration(entry, entry.lang, stage);
        const verdict = checkOutput(narration, guardCtx(stage, entry.lang));
        expect(verdict.decision, `${entry.word_id} @${stage}/${entry.lang}`).toBe("allow");
        expect(narration).toContain(entry.word);
      }
    }
  });

  it("holds the Requirement 5.4b morning greeting at every cell", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const stage of AGE_STAGES) {
        const greeting = morningGreeting(lang, stage);
        expect(greeting).toBe(MORNING_GREETING[lang][stage]);
        expect(greeting.trim().length, `${stage}/${lang}`).toBeGreaterThan(0);
        expect(checkOutput(greeting, guardCtx(stage, lang)).decision, `${stage}/${lang}`).toBe(
          "allow",
        );
      }
    }
  });

  it("says the word alone at `tiny` and adds the meaning and example as the stage widens", () => {
    const entry = words.find((candidate) => candidate.lang === "en-IN");
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const tiny = wordNarration(entry, "en-IN", "tiny");
    expect(tiny).not.toContain(entry.meaning);
    expect(wordNarration(entry, "en-IN", "little")).toContain(entry.meaning);
    const maker = wordNarration(entry, "en-IN", "maker");
    expect(maker).toContain(entry.meaning);
    // `maker` is THREE sentences and not four: `AGE_SENTENCE_LIMITS.maker` is 3, so the obvious
    // four-sentence form would be refused `length` at the stage it was written for.
    expect(maker.split(/[.!?]\s+|[.!?]$/u).filter((part) => part.trim().length > 0)).toHaveLength(
      3,
    );
  });
});
