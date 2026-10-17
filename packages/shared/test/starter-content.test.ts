// The Starter_Content's own rules (Phase 4 Req 1.4–1.10, 19.3).
//
// This is the shared-side floor, not the safety gate: the Gateway's Content_Gate runs the real
// Output_Guard over every spoken field at every Age_Stage and language an item declares, and
// `services/gateway/test/content-store.test.ts` is where Property 1 lives. What is asserted here
// is what the seed itself promises — the traditions it covers, the languages it carries, the step
// graphs it can walk, the licence note on every item, a fresh array per call, and the absence of
// the shapes safety.md §3 forbids outright.
import { describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  CONTENT_CATEGORIES,
  CONTENT_KINDS,
  CONTENT_SOURCES,
  SUPPORTED_LANGS,
  createStarterContent,
  createStarterRoutines,
  createStarterWords,
} from "../dist/index.js";
import type { ContentItem, ContentStep } from "../dist/index.js";

const ITEMS = createStarterContent();
const WORDS = createStarterWords();
const ROUTINES = createStarterRoutines();

/** Every string of an item a child could hear, plus its title. */
function spokenStrings(item: ContentItem): string[] {
  const out = [item.title];
  for (const step of item.steps) {
    out.push(...Object.values(step.text));
    for (const choice of step.choices) out.push(...Object.values(choice.prompt));
  }
  return out;
}

function stepById(steps: readonly ContentStep[], id: string): ContentStep | undefined {
  return steps.find((step) => step.step_id === id);
}

describe("the Starter_Content's shape (Req 1.1, 1.7)", () => {
  it("is a non-empty library of well-formed rows", () => {
    expect(ITEMS.length).toBeGreaterThan(0);
    const ids = ITEMS.map((item) => item.content_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ITEMS) {
      expect(item.household_id, item.content_id).toBeNull();
      expect(CONTENT_KINDS).toContain(item.kind);
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.languages.length).toBeGreaterThan(0);
      expect(item.age_stages.length).toBeGreaterThan(0);
      expect(item.categories.length).toBeGreaterThan(0);
      expect(item.steps.length).toBeGreaterThan(0);
      for (const lang of item.languages) expect(SUPPORTED_LANGS).toContain(lang);
      for (const stage of item.age_stages) expect(AGE_STAGES).toContain(stage);
      for (const category of item.categories) expect(CONTENT_CATEGORIES).toContain(category);
      expect(Date.parse(item.created_at)).not.toBeNaN();
      expect(Date.parse(item.updated_at)).not.toBeNaN();
    }
  });

  it("carries an original-retelling licence note and a tradition-only source (Req 1.6)", () => {
    for (const item of ITEMS) {
      expect(CONTENT_SOURCES, item.content_id).toContain(item.source);
      expect(item.licence_note.toLowerCase(), item.content_id).toContain("original");
      expect(item.licence_note.toLowerCase(), item.content_id).toContain("xelulu");
    }
  });
});

describe("what the library has to cover (Req 1.4, 1.5)", () => {
  it("has at least two retellings from each of the four traditions", () => {
    for (const tradition of ["panchatantra", "jataka", "tenali_raman", "akbar_birbal"]) {
      const found = ITEMS.filter((item) => item.source === tradition);
      expect(found.length, tradition).toBeGreaterThanOrEqual(2);
    }
  });

  it("has at least three songs and one learning activity in each named category", () => {
    expect(ITEMS.filter((item) => item.categories.includes("songs")).length).toBeGreaterThanOrEqual(
      3,
    );
    for (const category of ["animals", "maths", "world", "feelings", "manners"]) {
      const found = ITEMS.filter((item) => item.categories.includes(category));
      expect(found.length, category).toBeGreaterThanOrEqual(1);
    }
    expect(ITEMS.filter((item) => item.categories.includes("games")).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("gives a `games` item `games` as its ONLY category (Req 1.4, 19.3)", () => {
    // The Play screen files an item by its FIRST category in CONTENT_CATEGORIES order and `games`
    // is last in that order, so `["games", "animals"]` would land under Learning. The seeding
    // rule is the fix; this is the assertion that keeps it.
    for (const item of ITEMS.filter((i) => i.categories.includes("games"))) {
      expect(item.categories, item.content_id).toEqual(["games"]);
    }
  });

  it("carries Hindi for one item of each tradition and for at least one song", () => {
    for (const tradition of ["panchatantra", "jataka", "tenali_raman", "akbar_birbal"]) {
      const hindi = ITEMS.filter(
        (item) => item.source === tradition && item.languages.includes("hi-IN"),
      );
      expect(hindi.length, tradition).toBeGreaterThanOrEqual(1);
    }
    const hindiSongs = ITEMS.filter(
      (item) => item.categories.includes("songs") && item.languages.includes("hi-IN"),
    );
    expect(hindiSongs.length).toBeGreaterThanOrEqual(1);
  });

  it("carries every declared language's text on every step of that item (Req 1.5)", () => {
    for (const item of ITEMS) {
      for (const lang of item.languages) {
        for (const step of item.steps) {
          expect(step.text[lang], `${item.content_id}/${step.step_id}/${lang}`).toBeTruthy();
          for (const choice of step.choices) {
            expect(
              choice.prompt[lang],
              `${item.content_id}/${choice.choice_id}/${lang}`,
            ).toBeTruthy();
            expect(
              choice.match_terms[lang]?.length ?? 0,
              `${item.content_id}/${choice.choice_id}/${lang}`,
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("declares `explorer` and `maker` only on a branching item (Req 4.1a, C39)", () => {
    // A branching step is at least three sentences — its own plus one per prompt — so `tiny` and
    // `little` have no room for one. This is the seed-side statement of the rule the Content_Gate
    // enforces with a `length` refusal.
    for (const item of ITEMS) {
      if (!item.steps.some((step) => step.choices.length > 0)) continue;
      expect([...item.age_stages].sort(), item.content_id).toEqual(["explorer", "maker"]);
      for (const step of item.steps) {
        expect(step.choices.length, `${item.content_id}/${step.step_id}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("the step graphs are walkable (Req 1.8)", () => {
  it("resolves every next step, reaches every step, and ends somewhere", () => {
    for (const item of ITEMS) {
      const first = item.steps[0];
      expect(first, item.content_id).toBeDefined();
      if (first === undefined) continue;
      const seen = new Set<string>();
      const queue = [first.step_id];
      let terminal = false;
      for (;;) {
        const id = queue.shift();
        if (id === undefined) break;
        if (seen.has(id)) continue;
        seen.add(id);
        const step = stepById(item.steps, id);
        expect(step, `${item.content_id}/${id}`).toBeDefined();
        if (step === undefined) continue;
        if (step.choices.length > 0) {
          for (const choice of step.choices) queue.push(choice.next_step_id);
          continue;
        }
        if (step.next_step_id === null) {
          terminal = true;
          continue;
        }
        queue.push(step.next_step_id);
      }
      expect(terminal, `${item.content_id} has a terminal path`).toBe(true);
      expect(seen.size, `${item.content_id} reaches every step`).toBe(item.steps.length);
    }
  });
});

describe("the factories hand out fresh copies (Req 1.9)", () => {
  it("returns a new array of new items per call, and a mutation stays local", () => {
    const a = createStarterContent();
    const b = createStarterContent();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    const firstA = a[0];
    const firstB = b[0];
    expect(firstA).toBeDefined();
    expect(firstB).toBeDefined();
    if (firstA === undefined || firstB === undefined) return;
    expect(firstA).not.toBe(firstB);
    firstA.title = "changed";
    firstA.steps.length = 0;
    expect(firstB.title).not.toBe("changed");
    expect(firstB.steps.length).toBeGreaterThan(0);
    expect(createStarterWords()).not.toBe(createStarterWords());
    expect(createStarterRoutines()).not.toBe(createStarterRoutines());
  });
});

describe("nothing a child hears reaches outside the house (Req 1.10)", () => {
  // Deliberately simple shapes, and deliberately not a second copy of the Output_Guard: the
  // guard is the gate, and these are the four things safety.md §3 forbids outright.
  const URL_RE = /[a-z]+:\/\/|www\.|\.(?:com|net|org|in|io|co)\b/i;
  const CURRENCY_RE = /(?:[\u20b9$\u20ac\u00a3]\s*\d)|(?:\d\s*[\u20b9$\u20ac\u00a3])/;
  const LONG_DIGIT_RE = /\d[\d\s().+-]{5,}\d/;
  const PRICE_WORDS = ["price", "cost", "buy", "purchase", "rupee", "discount", "दाम", "कीमत"];
  const BRANDS = ["youtube", "amazon", "netflix", "google", "instagram", "whatsapp"];

  it("names no URL, no phone-like number, no price and no brand", () => {
    for (const item of ITEMS) {
      for (const text of spokenStrings(item)) {
        const lower = text.toLowerCase();
        expect(URL_RE.test(text), `${item.content_id}: url`).toBe(false);
        expect(CURRENCY_RE.test(text), `${item.content_id}: currency`).toBe(false);
        expect(LONG_DIGIT_RE.test(text), `${item.content_id}: digits`).toBe(false);
        for (const word of PRICE_WORDS) {
          expect(lower.includes(word), `${item.content_id}: ${word}`).toBe(false);
        }
        for (const brand of BRANDS) {
          expect(lower.includes(brand), `${item.content_id}: ${brand}`).toBe(false);
        }
      }
    }
  });
});

describe("the Word_Of_The_Day entries (Req 5.1)", () => {
  it("has at least seven entries, with at least two in each supported language", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(7);
    expect(new Set(WORDS.map((entry) => entry.word_id)).size).toBe(WORDS.length);
    for (const lang of SUPPORTED_LANGS) {
      const inLang = WORDS.filter((entry) => entry.lang === lang);
      expect(inLang.length, lang).toBeGreaterThanOrEqual(2);
    }
    for (const entry of WORDS) {
      expect(entry.word.trim().length, entry.word_id).toBeGreaterThan(0);
      expect(entry.meaning.trim().length, entry.word_id).toBeGreaterThan(0);
      expect(entry.example.trim().length, entry.word_id).toBeGreaterThan(0);
      expect(entry.age_stages.length, entry.word_id).toBeGreaterThan(0);
    }
  });
});

describe("the routine templates (Req 10.1a)", () => {
  it("names the six routines with their times and nothing presentational", () => {
    expect(ROUTINES.map((routine) => routine.routine_id)).toEqual([
      "morning",
      "brushing",
      "meals",
      "play_time",
      "wind_down",
      "bedtime",
    ]);
    expect(ROUTINES.map((routine) => routine.at)).toEqual([
      "07:00",
      "08:00",
      "12:30",
      "17:00",
      "20:00",
      "20:30",
    ]);
    for (const routine of ROUTINES) {
      expect(Object.keys(routine).sort()).toEqual([
        "at",
        "behaviour",
        "enabled",
        "name",
        "routine_id",
      ]);
      expect(routine.name).toBe(routine.name.toLowerCase());
      expect(routine.enabled).toBe(true);
    }
  });
});
