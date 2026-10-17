// The Content_Store and the Content_Gate (Phase 4 Req 2, 21.1, 21.2).
//
// Two properties carry the whole safety argument of the curated library, and they are the first
// two blocks below:
//
//   Property 1 — EVERYTHING SPEAKABLE PASSES THE OUTPUT GUARD AT EVERY STAGE IT CLAIMS. Titles,
//   step texts, choice prompts and every assembled `stepSpeech`, for every declared Age_Stage and
//   language of every seeded item. This is the assertion that makes "the library is safe" a
//   measured claim rather than a promise about how the prose was written.
//
//   Property 2 — ACTIVE IS REACHABLE ONLY THROUGH THE GATE. `create` and `update` always produce
//   a draft, whatever the verdict; only `setStatus` can produce `active`, and it refuses when the
//   gate does. So the worst a reachable write can do is add a draft that cannot be activated.
import { describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  createStarterContent,
  type AgeStage,
  type ContentItem,
  type GlobalContentItem,
  type SupportedLang,
} from "@xelulu/shared";

import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";
import { createGatewayLog, type GatewayLog } from "../src/log/gateway-log.js";
import { checkOutput } from "../src/brain/safety/output-guard.js";
import { gateItem, stepSpeech } from "../src/content/content-gate.js";
import {
  CONTENT_MAX_ITEMS,
  CONTENT_MAX_TITLE_CODE_POINTS,
  createContentStore,
  type ContentDraft,
  type ContentStore,
} from "../src/content/content-store.js";

type Harness = Readonly<{ store: ContentStore; log: GatewayLog }>;

function harness(seed: readonly ContentItem[] = createStarterContent()): Harness {
  const clock = createTestClock(1_760_000_000_000);
  const log = createGatewayLog(clock, createCaptureSink());
  return { store: createContentStore({ clock, log, seed }), log };
}

/** A minimal valid draft: one language, one stage, one terminal step. */
function draftOf(over: Partial<ContentDraft> = {}): ContentDraft {
  return {
    content_id: "draft_1",
    household_id: null,
    kind: "story",
    title: "A Small Test Story",
    languages: ["en-IN"],
    age_stages: ["little"],
    categories: ["stories"],
    licence_note: "Original retelling written for Xelulu.",
    source: "original",
    steps: [
      { step_id: "s1", text: { "en-IN": "A small bird sang." }, choices: [], next_step_id: null },
    ],
    ...over,
  };
}

function entriesOf(log: GatewayLog, kind: string): readonly Readonly<Record<string, unknown>>[] {
  return log.since(0).filter((entry) => entry.kind === kind) as readonly Readonly<
    Record<string, unknown>
  >[];
}

// ---------------------------------------------------------------------------------------------

describe("Property 1: everything speakable passes the output guard at every stage it claims", () => {
  const items = createStarterContent();

  it("passes every title, step text, choice prompt and assembled utterance", () => {
    for (const item of items) {
      for (const stage of item.age_stages as readonly AgeStage[]) {
        for (const lang of item.languages as readonly SupportedLang[]) {
          const ctx = { ageStage: stage, lang, allowedCategories: [], deferTopics: [] };
          const title = checkOutput(item.title, ctx);
          expect(title.decision, `${item.content_id} title @${stage}/${lang}`).toBe("allow");
          for (const step of item.steps) {
            const text = checkOutput(step.text[lang] ?? "", ctx);
            expect(text.decision, `${item.content_id}/${step.step_id} text @${stage}/${lang}`).toBe(
              "allow",
            );
            for (const choice of step.choices) {
              const prompt = checkOutput(choice.prompt[lang] ?? "", ctx);
              expect(
                prompt.decision,
                `${item.content_id}/${choice.choice_id} prompt @${stage}/${lang}`,
              ).toBe("allow");
            }
            const speech = checkOutput(stepSpeech(step, lang), ctx);
            expect(
              speech.decision,
              `${item.content_id}/${step.step_id} speech @${stage}/${lang}`,
            ).toBe("allow");
          }
        }
      }
    }
  });

  it("holds every seeded item `active`, with a passing verdict and one log entry each", () => {
    const h = harness();
    const seeded = createStarterContent();
    for (const item of seeded) {
      const stored = h.store.get(item.content_id);
      expect(stored?.status, item.content_id).toBe("active");
      expect(h.store.verdict(item.content_id), item.content_id).toEqual({ ok: true });
    }
    const gates = entriesOf(h.log, "content_gate");
    expect(gates).toHaveLength(seeded.length);
    for (const entry of gates) {
      expect(entry["action"]).toBe("seed");
      expect(entry["outcome"]).toBe("passed");
      expect(entry["rule"]).toBeNull();
      expect(entry["age_stage"]).toBeNull();
      expect(entry["lang"]).toBeNull();
    }
  });

  it("is not a vacuous check: the gate refuses a term on the Output_Guard's lists", () => {
    const refused = gateItem(
      draftOf({
        content_id: "draft_bad_text",
        steps: [
          {
            step_id: "s1",
            text: { "en-IN": "The doctor gave the lion medicine." },
            choices: [],
            next_step_id: null,
          },
        ],
      }) as GlobalContentItem,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.rule).toBe("medical");
    expect(refused.field).toBe("text");
    expect(refused.step_id).toBe("s1");
  });
});

describe("Property 2: active is reachable only through the gate", () => {
  it("creates a DRAFT even when the gate passes (Req 2.4a, C23)", () => {
    const h = harness([]);
    const result = h.store.create(draftOf());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toEqual({ ok: true });
    // The whole of C23: a reachable write cannot produce something a child hears.
    expect(result.item.status).toBe("draft");
    expect(h.store.get("draft_1")?.status).toBe("draft");
  });

  it("refuses to activate an item the gate refuses, and leaves it draft", () => {
    const h = harness([]);
    const created = h.store.create(
      draftOf({
        content_id: "draft_brand",
        steps: [
          {
            step_id: "s1",
            text: { "en-IN": "We can watch it on youtube." },
            choices: [],
            next_step_id: null,
          },
        ],
      }),
    );
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.refusal.code).toBe("gate_refused");
    expect(created.refusal.verdict?.ok).toBe(false);

    const activated = h.store.setStatus("draft_brand", "active");
    expect(activated.ok).toBe(false);
    if (activated.ok) return;
    expect(activated.refusal.code).toBe("gate_refused");
    expect(h.store.get("draft_brand")?.status).toBe("draft");
    const gates = entriesOf(h.log, "content_gate");
    expect(gates.map((entry) => entry["action"])).toEqual(["create", "activate"]);
    for (const entry of gates) expect(entry["outcome"]).toBe("refused");
  });

  it("activates a passing draft through setStatus, and only through it", () => {
    const h = harness([]);
    h.store.create(draftOf());
    expect(h.store.setStatus("draft_1", "active").ok).toBe(true);
    expect(h.store.get("draft_1")?.status).toBe("active");
    // An edit sends it straight back to draft, whatever it said before (Req 2.4a).
    const updated = h.store.update("draft_1", { title: "Another Small Story" });
    expect(updated.ok).toBe(true);
    expect(h.store.get("draft_1")?.status).toBe("draft");
    // And withdrawing is always allowed.
    h.store.setStatus("draft_1", "active");
    expect(h.store.setStatus("draft_1", "draft").ok).toBe(true);
    expect(h.store.get("draft_1")?.status).toBe("draft");
  });

  it("answers an unknown id rather than creating one", () => {
    const h = harness([]);
    const updated = h.store.update("nope", { title: "x" });
    expect(updated.ok).toBe(false);
    if (!updated.ok) expect(updated.refusal.code).toBe("unknown_content");
    const activated = h.store.setStatus("nope", "active");
    expect(activated.ok).toBe(false);
    if (!activated.ok) expect(activated.refusal.code).toBe("unknown_content");
  });
});

describe("the gate names one field, and the assembled utterance is the last word", () => {
  it("refuses an over-long TITLE with field `title` (Req 2.2a)", () => {
    // Nine words at `tiny`, whose word limit is eight: a title carries no terminator, so the
    // effective bound on a title is the narrowest declared stage's word limit.
    const verdict = gateItem(
      draftOf({
        age_stages: ["tiny"],
        title: "A Very Long And Rather Wordy Little Story Title",
        steps: [
          { step_id: "s1", text: { "en-IN": "A bird sang." }, choices: [], next_step_id: null },
        ],
      }) as GlobalContentItem,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.rule).toBe("length");
    expect(verdict.field).toBe("title");
    expect(verdict.step_id).toBe("");
    expect(verdict.age_stage).toBe("tiny");
  });

  it("refuses a step whose fields each pass but whose assembled speech does not (C39)", () => {
    // `little` allows two sentences. The step text is one and each prompt is one, so all three
    // fields pass on their own and the assembled utterance is three sentences: `length`, reported
    // against `speech`. This is exactly why per-field checking alone cannot satisfy Req 4.1.
    const item = draftOf({
      content_id: "draft_speech",
      age_stages: ["little"],
      title: "Two Paths",
      steps: [
        {
          step_id: "s1",
          text: { "en-IN": "The crow saw a pot." },
          choices: [
            {
              choice_id: "c1",
              prompt: { "en-IN": "Should she drop pebbles in?" },
              match_terms: { "en-IN": ["pebbles"] },
              next_step_id: "s2",
            },
            {
              choice_id: "c2",
              prompt: { "en-IN": "Should she find a stream?" },
              match_terms: { "en-IN": ["stream"] },
              next_step_id: "s2",
            },
          ],
          next_step_id: null,
        },
        { step_id: "s2", text: { "en-IN": "She drank happily." }, choices: [], next_step_id: null },
      ],
    }) as GlobalContentItem;

    const ctx = {
      ageStage: "little" as AgeStage,
      lang: "en-IN" as SupportedLang,
      allowedCategories: [],
      deferTopics: [],
    };
    const step = item.steps[0];
    expect(step).toBeDefined();
    if (step === undefined) return;
    expect(checkOutput(step.text["en-IN"] ?? "", ctx).decision).toBe("allow");
    for (const choice of step.choices) {
      expect(checkOutput(choice.prompt["en-IN"] ?? "", ctx).decision).toBe("allow");
    }

    const verdict = gateItem(item);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.rule).toBe("length");
    expect(verdict.field).toBe("speech");
    expect(verdict.step_id).toBe("s1");
  });

  it("checks every declared stage, not just the widest one", () => {
    const stages = [...AGE_STAGES];
    const verdict = gateItem(
      draftOf({
        age_stages: stages,
        title: "Two Lines",
        steps: [
          {
            step_id: "s1",
            // Two sentences: fine at `little` and above, one sentence too many at `tiny`.
            text: { "en-IN": "A bird sang. The sun rose." },
            choices: [],
            next_step_id: null,
          },
        ],
      }) as GlobalContentItem,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.age_stage).toBe("tiny");
    expect(verdict.rule).toBe("length");
  });
});

describe("validation runs before the gate and names a dotted field path (Req 2.8, 2.10)", () => {
  const cases: readonly (readonly [string, ContentDraft])[] = [
    ["content_id", draftOf({ content_id: "  " })],
    ["title", draftOf({ title: "" })],
    ["title", draftOf({ title: "x".repeat(CONTENT_MAX_TITLE_CODE_POINTS + 1) })],
    ["languages", draftOf({ languages: [] })],
    ["languages", draftOf({ languages: ["fr-FR"] })],
    ["age_stages", draftOf({ age_stages: [] })],
    ["age_stages", draftOf({ age_stages: ["toddler" as AgeStage] })],
    ["categories", draftOf({ categories: [] })],
    ["categories", draftOf({ categories: ["nonsense"] })],
    ["source", draftOf({ source: "wikipedia" as ContentDraft["source"] })],
    ["licence_note", draftOf({ licence_note: " " })],
    ["steps", draftOf({ steps: [] })],
    [
      "steps.0.text.en-IN",
      draftOf({ steps: [{ step_id: "s1", text: {}, choices: [], next_step_id: null }] }),
    ],
    [
      "steps.0.text.hi-IN",
      draftOf({
        languages: ["en-IN", "hi-IN"],
        steps: [
          { step_id: "s1", text: { "en-IN": "A bird sang." }, choices: [], next_step_id: null },
        ],
      }),
    ],
    [
      "steps.0.next_step_id",
      draftOf({
        steps: [
          { step_id: "s1", text: { "en-IN": "A bird sang." }, choices: [], next_step_id: "nope" },
        ],
      }),
    ],
    [
      "steps.0.choices.0.match_terms.en-IN",
      draftOf({
        steps: [
          {
            step_id: "s1",
            text: { "en-IN": "A bird sang." },
            choices: [
              {
                choice_id: "c1",
                prompt: { "en-IN": "Shall we go?" },
                match_terms: { "en-IN": [] },
                next_step_id: "s2",
              },
            ],
            next_step_id: null,
          },
          { step_id: "s2", text: { "en-IN": "We went." }, choices: [], next_step_id: null },
        ],
      }),
    ],
  ];

  it.each(cases.map(([field, draft], index) => [index, field, draft] as const))(
    "case %i refuses `invalid_field` naming %s",
    (_index, field, draft) => {
      const h = harness([]);
      const result = h.store.create(draft);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.refusal.code).toBe("invalid_field");
      expect(result.refusal.field).toBe(field);
      // Nothing was stored, and the gate never ran, so no `content_gate` entry exists.
      expect(entriesOf(h.log, "content_gate")).toEqual([]);
    },
  );

  it("refuses a duplicate content_id without replacing the first", () => {
    const h = harness([]);
    expect(h.store.create(draftOf()).ok).toBe(true);
    const again = h.store.create(draftOf({ title: "A Different Story" }));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.refusal.field).toBe("content_id");
    expect(h.store.get("draft_1")?.title).toBe("A Small Test Story");
  });

  it("refuses an unreachable step and a graph with no ending", () => {
    const h = harness([]);
    const orphan = h.store.create(
      draftOf({
        steps: [
          { step_id: "s1", text: { "en-IN": "A bird sang." }, choices: [], next_step_id: null },
          { step_id: "s2", text: { "en-IN": "Nobody hears me." }, choices: [], next_step_id: null },
        ],
      }),
    );
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.refusal.field).toBe("steps");

    const loop = h.store.create(
      draftOf({
        content_id: "draft_loop",
        steps: [
          { step_id: "s1", text: { "en-IN": "A bird sang." }, choices: [], next_step_id: "s2" },
          { step_id: "s2", text: { "en-IN": "The sun rose." }, choices: [], next_step_id: "s1" },
        ],
      }),
    );
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.refusal.field).toBe("steps");
  });
});

describe("the store's capacity and its order", () => {
  it("refuses a create past capacity rather than dropping an item (Req 2.9)", () => {
    const h = harness([]);
    for (let i = 0; i < CONTENT_MAX_ITEMS; i += 1) {
      const result = h.store.create(draftOf({ content_id: `draft_${String(i)}` }));
      expect(result.ok, `create ${String(i)}`).toBe(true);
    }
    const over = h.store.create(draftOf({ content_id: "draft_over" }));
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.refusal.code).toBe("at_capacity");
    expect(h.store.list()).toHaveLength(CONTENT_MAX_ITEMS);
    expect(h.store.get("draft_0")).not.toBeNull();
  });

  it("lists in a total order that two calls agree on, and filters (Req 2.7)", () => {
    const h = harness();
    const once = h.store.list().map((item) => item.content_id);
    const twice = h.store.list().map((item) => item.content_id);
    expect(twice).toEqual(once);
    const sorted = [...h.store.list()].sort((a, b) =>
      a.created_at === b.created_at
        ? a.content_id.localeCompare(b.content_id)
        : a.created_at.localeCompare(b.created_at),
    );
    expect(sorted.map((item) => item.content_id)).toEqual(once);

    for (const item of h.store.list({ category: "songs" })) {
      expect(item.categories).toContain("songs");
    }
    for (const item of h.store.list({ lang: "hi-IN" })) {
      expect(item.languages).toContain("hi-IN");
    }
    for (const item of h.store.list({ ageStage: "tiny" })) {
      expect(item.age_stages).toContain("tiny");
    }
    expect(h.store.list({ status: "draft" })).toEqual([]);
  });

  it("holds nothing but memory: a stored item cannot be changed from outside", () => {
    const h = harness();
    const first = h.store.list()[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(() => {
      (first as { title: string }).title = "tampered";
    }).toThrow();
    expect(h.store.get(first.content_id)?.title).not.toBe("tampered");
  });
});
