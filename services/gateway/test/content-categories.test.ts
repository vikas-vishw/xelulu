// The eight content categories, and the one rule that keeps them one list (Phase 4 Req 1.3, 3.1).
//
// `CONTENT_CATEGORIES` and the Input_Guard's `GATED_CONTENT_CATEGORIES` are two lists in two
// packages that have to be the same list. They were not, once: every Mock_Llm rule asked for
// `story` while the library's code was `stories`, and the headline story turn ran its tool twice,
// got `unknown_category` both times and reported `error` — silently, because the model's own text
// still passed the Output_Guard. Only a live turn showed it. This is where that cannot recur.
import { describe, expect, it } from "vitest";

import { CONTENT_CATEGORIES, createStarterContent, createStarterWords } from "@xelulu/shared";

import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import { GATED_CONTENT_CATEGORIES } from "../src/brain/safety/input-guard.js";
import { createContentLibrary } from "../src/brain/tools/content-library.js";
import { createContentStore } from "../src/content/content-store.js";

function libraryOver(seed: ReturnType<typeof createStarterContent>) {
  const clock = createTestClock(1_760_000_000_000);
  const log = createGatewayLog(clock, createCaptureSink());
  const content = createContentStore({ clock, log, seed });
  return createContentLibrary({ content, words: createStarterWords(), clock });
}

describe("one list of categories (Req 1.3)", () => {
  it("is exactly the Input_Guard's gated list, in the same order", () => {
    expect([...CONTENT_CATEGORIES]).toEqual([...GATED_CONTENT_CATEGORIES]);
  });

  it("covers every category the Starter_Content uses", () => {
    const used = new Set(createStarterContent().flatMap((item) => item.categories));
    for (const category of used) expect(CONTENT_CATEGORIES).toContain(category);
    // Every category is seeded, so the whole gated surface has content behind it.
    expect([...used].sort()).toEqual([...CONTENT_CATEGORIES].sort());
  });
});

describe("the library answers from the frozen list, not from its contents (Req 3.1)", () => {
  it("names the eight categories even when the store is empty", () => {
    const library = libraryOver([]);
    expect([...library.categories()]).toEqual([...CONTENT_CATEGORIES]);
  });

  it("answers `no_items` rather than `unknown_category` for an empty store", () => {
    const library = libraryOver([]);
    expect(
      library.lookup({
        category: "stories",
        lang: "en-IN",
        ageStage: "little",
        allowedCategories: ["stories"],
      }),
    ).toEqual({ ok: false, reason: "no_items" });
  });

  it("keeps the refusal order unknown_category -> not_allowed -> no_items", () => {
    const library = libraryOver(createStarterContent());
    // An unknown code is unknown even when the parent allows it.
    expect(
      library.lookup({
        category: "dinosaurs",
        lang: "en-IN",
        ageStage: "little",
        allowedCategories: ["dinosaurs"],
      }),
    ).toEqual({ ok: false, reason: "unknown_category" });
    // A known code the parent has not opened is a policy refusal.
    expect(
      library.lookup({
        category: "stories",
        lang: "en-IN",
        ageStage: "little",
        allowedCategories: ["songs"],
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    // Allowed and known, but nothing matches this stage and language.
    expect(
      library.lookup({
        category: "songs",
        lang: "hi-IN",
        ageStage: "maker",
        allowedCategories: ["songs"],
      }).ok,
    ).toBe(true);
  });

  it("offers only items declaring the turn's language and the child's Age_Stage", () => {
    const library = libraryOver(createStarterContent());
    const found = library.lookup({
      category: "stories",
      lang: "hi-IN",
      ageStage: "tiny",
      allowedCategories: ["stories"],
      start: true,
    });
    expect(found.ok).toBe(true);
    if (!found.ok || !("item" in found)) return;
    expect(found.item.languages).toContain("hi-IN");
    expect(found.item.age_stages).toContain("tiny");
    expect(found.item.status).toBe("active");
  });

  it("gates a word-of-the-day on `world`, on the same rule as any other category (Req 5.3a)", () => {
    const library = libraryOver(createStarterContent());
    expect(
      library.lookup({
        wordOfTheDay: true,
        lang: "en-IN",
        ageStage: "little",
        allowedCategories: ["stories"],
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
    const found = library.lookup({
      wordOfTheDay: true,
      lang: "en-IN",
      ageStage: "little",
      allowedCategories: ["world"],
    });
    expect(found.ok).toBe(true);
    if (!found.ok || !("word" in found)) return;
    expect(found.word.lang).toBe("en-IN");
  });

  it("names at most MAX_RESULTS titles for a list request", () => {
    const library = libraryOver(createStarterContent());
    const found = library.lookup({
      category: "stories",
      lang: "en-IN",
      ageStage: "little",
      allowedCategories: ["stories"],
    });
    expect(found.ok).toBe(true);
    if (!found.ok || !("titles" in found)) return;
    expect(found.titles.length).toBeGreaterThan(0);
    expect(found.titles.length).toBeLessThanOrEqual(3);
  });
});
