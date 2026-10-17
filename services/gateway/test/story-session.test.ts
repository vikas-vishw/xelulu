// The Story_Sessions, the story-start seam and the curated-text rule (Phase 4 Req 3, 4, 21.5,
// 21.5a, 21.6).
//
// Two properties carry the safety argument of the branching storyteller, and they are the first
// two blocks below:
//
//   Property 3 — A STORY SESSION STAYS INSIDE ITS ITEM. Whatever a child says, every step a
//   session moves to is a step of the item it was opened on, and every spoken line is that
//   item's own curated text or the fixed closing line. A session never invents a step and never
//   wanders into another item.
//
//   Property 4 — NO CHILD ANSWER ESCAPES. A transcript is folded, compared against the current
//   step's match terms and dropped. What is kept is the resolved `choice_id` and `step_id`: no
//   part of the answer reaches a Log_Entry, the session's own state or anything the pipeline
//   returns.
//
// The guards, the Content_Store, the Content_Library and the Tool_Router here are the REAL ones,
// seeded from the Starter_Content, so what these tests measure is the shipped path rather than a
// mock's idea of it.
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStarterContent,
  createStarterWords,
  type ContentItem,
  type SupportedLang,
} from "@xelulu/shared";

import {
  brainHarness,
  createFakeTarget,
  runTurn,
  // Aliased: this file's own `sttSaying` is a session, the harness's is a provider.
  sttSaying as sttProviderSaying,
} from "./support/brain-harness.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createContentStack, type ContentStack } from "./support/content-stack.js";
import { createTestClock, type TestClock } from "./support/test-clock.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import { createGatewayLog, type GatewayLog } from "../src/log/gateway-log.js";
import { createMemoryStore } from "../src/brain/state/memory-store.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
} from "../src/brain/state/child-context.js";
import { createRoutines } from "../src/brain/tools/routines.js";
import { createDeviceActions } from "../src/brain/tools/device-action.js";
import {
  STORY_START_TOOL_TEXT,
  WORD_OF_THE_DAY_TOOL_TEXT,
  createToolRouter,
  type ToolRouter,
} from "../src/brain/tools/tool-router.js";
import {
  PENDING_SPEECH_MAX_TURNS,
  STORY_CLOSING_LINE,
  STORY_MAX_UNRESOLVED,
  STORY_SESSION_IDLE_MS,
  STORY_STOP_WORDS,
} from "../src/brain/story/story-session.js";
import { wordForDay, wordNarration } from "../src/brain/story/word-of-the-day.js";
import { stepSpeech } from "../src/content/content-gate.js";
import { decideTurn, type TurnDecision } from "../src/brain/turn-pipeline.js";
import { SAFE_REDIRECT } from "../src/brain/safety/safe-text.js";
import {
  DISTRESS_FEELING_TERMS,
  DISTRESS_PHRASES,
  HARM_ANCHORS,
  HARM_DISCLOSURE_PHRASES,
  HARM_INJURY_TERMS,
} from "../src/brain/safety/input-guard.js";
import { NO_RETENTION_NO_TRAINING } from "../src/brain/providers/provider-declaration.js";
import type { LlmProvider, ToolRequest } from "../src/brain/providers/llm-provider.js";
import type { SttSession } from "../src/brain/providers/stt-provider.js";

let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

const DEVICE = "xlu_000123";
const TURN_ID = "t_story";
const T0 = 1_760_000_000_000;

/** The seeded items, read once: the test's oracle for "inside its item". */
const SEEDED: readonly ContentItem[] = createStarterContent();

/** A seeded item by id, or a failure rather than a silent `undefined`. */
function seeded(contentId: string): ContentItem {
  const item = SEEDED.find((entry) => entry.content_id === contentId);
  if (item === undefined) throw new Error(`no seeded item ${contentId}`);
  return item;
}

/** The one bilingual branching retelling: two choices, `explorer` and `maker`, en-IN and hi-IN. */
const BRANCHING = "story_tenali_riddle";
/** A linear retelling for the two narrow stages, in both languages. */
const LINEAR = "story_panchatantra_drum";

type Harness = Readonly<{
  clock: TestClock;
  log: GatewayLog;
  stack: ContentStack;
  router: ToolRouter;
  context: ChildContext;
  entries: () => readonly Readonly<Record<string, unknown>>[];
}>;

function contextOf(over: Partial<ChildContext> = {}): ChildContext {
  return {
    ...MOST_RESTRICTIVE_CONTEXT,
    ageStage: "little",
    langs: ["en-IN", "hi-IN"],
    allowedCategories: ["stories", "songs", "animals", "world", "games", "feelings", "manners"],
    policy: { quietHours: null, playLimitMinutes: null, movementOn: true },
    ...over,
  };
}

function harness(over: Partial<ChildContext> = {}): Harness {
  const clock = createTestClock(T0);
  const log = createGatewayLog(clock, createCaptureSink());
  const context = contextOf(over);
  const table: ChildContextTable = {
    setActiveChild: () => undefined,
    forDevice: () => context,
    childKeyFor: () => "child:test",
  };
  const routines = createRoutines(undefined, { [DEVICE]: 0 });
  const stack = createContentStack({ clock, log });
  const router = createToolRouter({
    log,
    content: stack.library,
    stories: stack.stories,
    routines,
    memory: createMemoryStore(),
    context: table,
    device: createDeviceActions({
      sendCommand: () => ({ ok: true, cmd_id: "cmd_1" }),
      context: table,
      routines,
      nowMinutes: () => 12 * 60,
    }),
  });
  return {
    clock,
    log,
    stack,
    router,
    context,
    entries: () => log.since(0) as readonly Readonly<Record<string, unknown>>[],
  };
}

/** An STT session transcribing one fixed text, so the test controls the child's words exactly. */
function sttSaying(text: string, lang: SupportedLang = "en-IN"): SttSession {
  return {
    turnId: TURN_ID,
    pushFrame: () => undefined,
    release: () => undefined,
    bytesHeld: () => 0,
    finish: () => Promise.resolve({ ok: true, transcript: { text, lang } }),
  };
}

/** An LLM that answers with a fixed text and asks for tools on its first call only. */
function llmSaying(text: string, toolRequests: readonly ToolRequest[] = []): LlmProvider {
  let first = true;
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    reply: () => {
      const requests = first ? toolRequests : [];
      first = false;
      return Promise.resolve({ ok: true, text, toolRequests: requests });
    },
  };
}

/** One turn through the real pipeline. */
async function turn(
  h: Harness,
  opts: Readonly<{
    text: string;
    lang?: SupportedLang;
    reply?: string;
    tools?: readonly ToolRequest[];
    turnId?: string;
  }>,
): Promise<TurnDecision> {
  const outcome = await decideTurn(
    {
      llm: llmSaying(opts.reply ?? "A model sentence.", opts.tools ?? []),
      tools: h.router,
      stories: h.stack.stories,
      clock: h.clock,
    },
    {
      deviceId: DEVICE,
      turnId: opts.turnId ?? TURN_ID,
      stt: sttSaying(opts.text, opts.lang ?? "en-IN"),
      context: h.context,
    },
  );
  if ("failed" in outcome) throw new Error(`pipeline failed: ${outcome.failed}`);
  return outcome;
}

/** The lines an item can legitimately speak in one language: its steps, plus the closing line. */
function speakableOf(item: ContentItem, lang: SupportedLang): readonly string[] {
  return [...item.steps.map((step) => stepSpeech(step, lang)), STORY_CLOSING_LINE[lang]];
}

// ---------------------------------------------------------------------------------------------

describe("Property 3: a story session stays inside its item", () => {
  it("only ever moves to a step of the item it was opened on, whatever the child says", () => {
    const item = seeded(BRANCHING);
    const stepIds = new Set(item.steps.map((step) => step.step_id));
    const lines = new Set(speakableOf(item, "en-IN"));
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 40 }), { minLength: 1, maxLength: 6 }),
        (answers) => {
          const h = harness({ ageStage: "explorer" });
          const opened = h.stack.stories.start({
            deviceId: DEVICE,
            turnId: TURN_ID,
            item,
            lang: "en-IN",
          });
          expect(opened).not.toBeNull();
          for (const answer of answers) {
            const advance = h.stack.stories.advance(DEVICE, answer, "en-IN");
            if (advance === null) continue;
            expect(advance.contentId).toBe(item.content_id);
            expect(stepIds.has(advance.stepId)).toBe(true);
            expect(lines.has(advance.speak)).toBe(true);
            if (advance.kind === "step" && advance.choiceId !== null) {
              const ids = item.steps.flatMap((s) => s.choices.map((c) => c.choice_id));
              expect(ids).toContain(advance.choiceId);
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe("Property 4: no child answer escapes", () => {
  it("keeps the resolved ids and nothing of the answer, in the log or the decision", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A marker word no seeded item, prompt, template or safe text contains.
        fc.stringMatching(/^zq[a-z]{4}$/u),
        async (marker) => {
          const h = harness({ ageStage: "explorer" });
          h.stack.stories.start({
            deviceId: DEVICE,
            turnId: "t_open",
            item: seeded(BRANCHING),
            lang: "en-IN",
          });
          const answer = `maybe ${marker} then`;
          const decision = await turn(h, { text: answer });
          // The answer survives in exactly one place, the Transcript_Store's field.
          expect(decision.transcript).toBe(answer);
          expect(decision.speak).not.toContain(marker);
          expect(JSON.stringify(decision.story)).not.toContain(marker);
          expect(JSON.stringify(h.entries())).not.toContain(marker);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The story-start seam (Req 3.2, 3.2a–3.2d, C40)

describe("the Tool_Router opens the session and the library only resolves", () => {
  it("starts a session on a resolved item and tells the model a fixed constant", () => {
    const h = harness();
    const result = h.router.run(
      { deviceId: DEVICE, turnId: TURN_ID, lang: "en-IN" },
      { name: "content_lookup", args: { category: "stories", start: true } },
    );
    expect(result).toEqual({ ok: true, tool: "content_lookup", text: STORY_START_TOOL_TEXT });
    // The model is told nothing of the prose: the tool text is a constant (Req 3.2b, C8).
    expect(STORY_START_TOOL_TEXT).not.toContain("monkey");
    expect(h.stack.stories.inProgress(DEVICE)).toBe(true);
    const pending = h.stack.stories.takePending(TURN_ID);
    expect(pending?.story?.contentId).toBe(
      h.stack.content.list({ category: "stories" })[0]?.content_id,
    );
    expect(pending?.wordId).toBeNull();
  });

  it("resolves the day's word, registers its narration and tells the model a constant", () => {
    const h = harness();
    const result = h.router.run(
      { deviceId: DEVICE, turnId: TURN_ID, lang: "en-IN" },
      { name: "content_lookup", args: { word_of_the_day: true } },
    );
    expect(result).toEqual({
      ok: true,
      tool: "content_lookup",
      text: WORD_OF_THE_DAY_TOOL_TEXT,
    });
    const pending = h.stack.stories.takePending(TURN_ID);
    expect(pending?.story).toBeNull();
    expect(pending?.wordId).not.toBeNull();
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
  });

  it("refuses a word-of-the-day when the parent has not opened `world` (Req 5.3a)", () => {
    const h = harness({ allowedCategories: ["stories"] });
    const result = h.router.run(
      { deviceId: DEVICE, turnId: TURN_ID, lang: "en-IN" },
      { name: "content_lookup", args: { word_of_the_day: true } },
    );
    expect(result).toEqual({
      ok: false,
      tool: "content_lookup",
      outcome: "denied",
      reason: "policy",
    });
    expect(h.stack.stories.takePending(TURN_ID)).toBeNull();
  });

  it("answers `error` when a resolved item has no speakable first step, never a silent allow", () => {
    const h = harness();
    const clock = createTestClock(T0);
    const log = createGatewayLog(clock, createCaptureSink());
    const context: ChildContextTable = {
      setActiveChild: () => undefined,
      forDevice: () => h.context,
      childKeyFor: () => "child:test",
    };
    const routines = createRoutines(undefined, { [DEVICE]: 0 });
    const empty: ContentItem = {
      ...seeded(LINEAR),
      content_id: "story_empty_first_step",
      steps: [{ step_id: "s1", text: {}, choices: [], next_step_id: null }],
    };
    const router = createToolRouter({
      log,
      // A library that resolves an item the Story_Session cannot open.
      content: { lookup: () => ({ ok: true, item: empty }), categories: () => ["stories"] },
      stories: h.stack.stories,
      routines,
      memory: createMemoryStore(),
      context,
      device: createDeviceActions({
        sendCommand: () => ({ ok: true, cmd_id: "cmd_1" }),
        context,
        routines,
        nowMinutes: () => 12 * 60,
      }),
    });
    const result = router.run(
      { deviceId: DEVICE, turnId: TURN_ID, lang: "en-IN" },
      { name: "content_lookup", args: { category: "stories", start: true } },
    );
    expect(result).toEqual({
      ok: false,
      tool: "content_lookup",
      outcome: "error",
      reason: null,
    });
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
  });

  it("logs the tool call with no argument value of any kind", () => {
    const h = harness();
    h.router.run(
      { deviceId: DEVICE, turnId: TURN_ID, lang: "en-IN" },
      { name: "content_lookup", args: { category: "stories", start: true, content_id: LINEAR } },
    );
    const calls = h.entries().filter((entry) => entry["kind"] === "tool_call");
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0] ?? {})).not.toContain("category");
    expect(JSON.stringify(calls[0])).not.toContain(LINEAR);
  });
});

// ---------------------------------------------------------------------------------------------
// The curated-text rule and the whole branching story (Req 3.3, 4.1–4.4)

describe("a whole two-choice story", () => {
  it("speaks the curated steps, resolves a choice and ends at the terminal step", async () => {
    const h = harness({ ageStage: "explorer" });
    const item = seeded(BRANCHING);

    // Turn 1: the model asks for a story and the curated first step is spoken, not its reply.
    const first = await turn(h, {
      text: "tell me a story",
      reply: "The model's own wording, which must be discarded.",
      tools: [{ name: "content_lookup", args: { category: "stories", start: true } }],
    });
    const resolved = h.stack.content.list({
      category: "stories",
      status: "active",
      lang: "en-IN",
      ageStage: "explorer",
    })[0];
    expect(first.curated).toBe(true);
    expect(first.speak).toBe(stepSpeech(resolved!.steps[0]!, "en-IN"));
    expect(first.speak).not.toContain("model");
    expect(first.story?.outcome).toBe("started");

    // Open the branching item explicitly: which item a category resolves to is the store's
    // order, and this test is about the branch rather than about that order.
    h.stack.stories.start({ deviceId: DEVICE, turnId: "t_open", item, lang: "en-IN" });
    h.stack.stories.takePending("t_open");

    // Turn 2: a branch answer that matches the second choice's match terms.
    const second = await turn(h, { text: "ask him a riddle", turnId: "t2" });
    expect(second.curated).toBe(true);
    expect(second.story).toEqual({
      content_id: item.content_id,
      step_id: "s2b",
      choice_id: "riddle",
      outcome: "spoken",
    });
    expect(second.speak).toBe(stepSpeech(item.steps[2]!, "en-IN"));
    // No tool call and no model reply took part in it (Req 4.2).
    expect(second.tools).toEqual([]);

    // Turn 3: the next linear step.
    const third = await turn(h, { text: "and then", turnId: "t3" });
    expect(third.story?.step_id).toBe("s3");
    expect(third.story?.outcome).toBe("spoken");

    // Turn 4: the terminal step has no next step, so the session ends.
    const fourth = await turn(h, { text: "and then", turnId: "t4" });
    expect(fourth.story?.outcome).toBe("ended");
    expect(fourth.speak).toBe(STORY_CLOSING_LINE["en-IN"]);
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
  });

  it("asks the model nothing at all while a session is in progress (Req 4.2)", async () => {
    const h = harness({ ageStage: "explorer" });
    h.stack.stories.start({
      deviceId: DEVICE,
      turnId: "t_open",
      item: seeded(BRANCHING),
      lang: "en-IN",
    });
    h.stack.stories.takePending("t_open");
    let asked = 0;
    const outcome = await decideTurn(
      {
        llm: {
          id: "mock",
          dataHandling: NO_RETENTION_NO_TRAINING,
          reply: () => {
            asked += 1;
            return Promise.resolve({ ok: true, text: "never spoken", toolRequests: [] });
          },
        },
        tools: h.router,
        stories: h.stack.stories,
        clock: h.clock,
      },
      { deviceId: DEVICE, turnId: "t2", stt: sttSaying("soup please"), context: h.context },
    );
    expect(asked).toBe(0);
    expect("failed" in outcome).toBe(false);
  });

  it("repeats an unmatched answer once, then ends the session `unresolved` (Req 4.4)", async () => {
    const h = harness({ ageStage: "explorer" });
    h.stack.stories.start({
      deviceId: DEVICE,
      turnId: "t_open",
      item: seeded(BRANCHING),
      lang: "en-IN",
    });
    h.stack.stories.takePending("t_open");
    const firstMiss = await turn(h, { text: "maybe something else happens", turnId: "t2" });
    expect(firstMiss.story?.step_id).toBe("s1");
    expect(firstMiss.story?.outcome).toBe("spoken");
    expect(h.stack.stories.inProgress(DEVICE)).toBe(true);
    const secondMiss = await turn(h, { text: "maybe something else happens", turnId: "t3" });
    expect(secondMiss.story?.outcome).toBe("unresolved");
    expect(STORY_MAX_UNRESOLVED).toBe(2);
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
  });

  it("ends the story on a stop word, before any choice can capture it (Req 4.6, 4.9)", async () => {
    const h = harness({ ageStage: "explorer" });
    h.stack.stories.start({
      deviceId: DEVICE,
      turnId: "t_open",
      item: seeded(BRANCHING),
      lang: "en-IN",
    });
    h.stack.stories.takePending("t_open");
    // The text carries a match term AND a stop word: the stop word decides.
    const decision = await turn(h, { text: "stop, ask him a riddle", turnId: "t2" });
    expect(decision.speak).toBe(STORY_CLOSING_LINE["en-IN"]);
    expect(decision.story?.outcome).toBe("ended");
    expect(decision.story?.choice_id).toBeNull();
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
  });

  it("holds no match term that is also a stop word, a distress or a harm term (Req 4.8)", () => {
    const banned = new Set(
      [
        ...HARM_DISCLOSURE_PHRASES,
        ...HARM_ANCHORS,
        ...HARM_INJURY_TERMS,
        ...DISTRESS_FEELING_TERMS,
        ...DISTRESS_PHRASES,
      ].map((term) => term.toLowerCase()),
    );
    for (const item of SEEDED) {
      for (const step of item.steps) {
        for (const choice of step.choices) {
          for (const [lang, terms] of Object.entries(choice.match_terms)) {
            const stops = STORY_STOP_WORDS[lang as SupportedLang] ?? [];
            for (const term of terms) {
              const folded = term.toLowerCase();
              expect(banned.has(folded), `${choice.choice_id}/${lang}: ${term}`).toBe(false);
              expect(stops, `${choice.choice_id}/${lang}: ${term}`).not.toContain(folded);
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The turn's language, not the child's first (Req 3.2d, 21.5a)

describe("a Hindi turn for a bilingual child", () => {
  it("opens the session in hi-IN and speaks the item's Hindi first step", async () => {
    // `child_mock_1`'s shape: bilingual with `en-IN` FIRST, which is the whole point — a
    // re-derived `ctx.langs[0]` would open this session on the English step.
    const h = harness();
    const decision = await turn(h, {
      text: "मुझे कहानी सुनाओ",
      lang: "hi-IN",
      reply: "मॉडल का अपना वाक्य।",
      tools: [{ name: "content_lookup", args: { category: "stories", start: true } }],
    });
    const opened = h.stack.content.list({
      category: "stories",
      status: "active",
      lang: "hi-IN",
      ageStage: "little",
    })[0];
    expect(decision.lang).toBe("hi-IN");
    expect(decision.story?.content_id).toBe(opened?.content_id);
    expect(decision.speak).toBe(stepSpeech(opened!.steps[0]!, "hi-IN"));
  });

  it("resolves a Hindi match term on the seeded bilingual branching item", async () => {
    // `explorer`, because a branching item declares `explorer` and `maker` only (C39).
    const h = harness({ ageStage: "explorer" });
    const item = seeded(BRANCHING);
    h.stack.stories.start({ deviceId: DEVICE, turnId: "t_open", item, lang: "hi-IN" });
    h.stack.stories.takePending("t_open");
    const decision = await turn(h, { text: "पहेली पूछो", lang: "hi-IN", turnId: "t2" });
    expect(decision.story).toEqual({
      content_id: item.content_id,
      step_id: "s2b",
      choice_id: "riddle",
      outcome: "spoken",
    });
    expect(decision.speak).toBe(stepSpeech(item.steps[2]!, "hi-IN"));
  });
});

// ---------------------------------------------------------------------------------------------
// The Output_Guard over curated text, the idle sweep and the pending bound

describe("a curated step the Output_Guard refuses (Req 3.4)", () => {
  it("speaks the Safe_Redirect, ends the session and reports the step `refused`", async () => {
    // A `tiny` context with an `explorer` item open: the branch step this answer reaches is
    // eleven words, and `tiny`'s limit is eight, so the guard refuses the CURATED text — which
    // is the one case the single `checkOutput` call site exists for.
    const h = harness({ ageStage: "tiny" });
    const item = seeded(BRANCHING);
    h.stack.stories.start({ deviceId: DEVICE, turnId: "t_open", item, lang: "en-IN" });
    h.stack.stories.takePending("t_open");
    const refused = stepSpeech(item.steps[1]!, "en-IN");
    const decision = await turn(h, { text: "bring him warm soup", turnId: "t2" });
    expect(decision.output).toEqual({ decision: "refuse", rule: "length", topic: null });
    expect(decision.speak).toBe(SAFE_REDIRECT["en-IN"].tiny);
    expect(decision.story).toEqual({
      content_id: item.content_id,
      step_id: "s2a",
      choice_id: "soup",
      outcome: "refused",
    });
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
    // Nothing of the curated step survives in the spoken text.
    expect(refused).toContain("soup");
    expect(decision.speak).not.toContain("soup");
  });
});

describe("the idle sweep (Req 3.8)", () => {
  it("ends a session idle past the timeout on the next turn, with one `ended` entry", async () => {
    const h = harness({ ageStage: "explorer" });
    h.stack.stories.start({
      deviceId: DEVICE,
      turnId: "t_open",
      item: seeded(BRANCHING),
      lang: "en-IN",
    });
    h.stack.stories.takePending("t_open");
    h.clock.set(T0 + STORY_SESSION_IDLE_MS + 1);
    // The next turn sweeps first, so this turn is an ordinary one and not a story answer.
    const decision = await turn(h, { text: "hello lulu", reply: "Hello to you.", turnId: "t2" });
    expect(decision.story).toBeNull();
    expect(decision.curated).toBe(false);
    expect(decision.speak).toBe("Hello to you.");
    const steps = h.entries().filter((entry) => entry["kind"] === "story_step");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      outcome: "ended",
      turn_id: null,
      content_id: BRANCHING,
      choice_id: null,
    });
  });

  it("keeps a session that has not been idle long enough", async () => {
    const h = harness({ ageStage: "explorer" });
    h.stack.stories.start({
      deviceId: DEVICE,
      turnId: "t_open",
      item: seeded(BRANCHING),
      lang: "en-IN",
    });
    h.stack.stories.takePending("t_open");
    h.clock.set(T0 + STORY_SESSION_IDLE_MS - 1);
    const decision = await turn(h, { text: "ask him a riddle", turnId: "t2" });
    expect(decision.curated).toBe(true);
    expect(decision.story?.step_id).toBe("s2b");
  });
});

describe("the pending map is bounded", () => {
  it("holds one entry per turn and drops the oldest past the bound", () => {
    const h = harness();
    const speech = { speak: "Today's word is paani.", story: null, wordId: "word_1" };
    for (let i = 0; i < PENDING_SPEECH_MAX_TURNS + 3; i += 1) {
      h.stack.stories.putPending(`t_${String(i)}`, speech);
    }
    expect(h.stack.stories.takePending("t_0")).toBeNull();
    expect(h.stack.stories.takePending("t_2")).toBeNull();
    expect(h.stack.stories.takePending(`t_${String(PENDING_SPEECH_MAX_TURNS + 2)}`)).toEqual(
      speech,
    );
  });

  it("deletes a taken pending, so a turn cannot speak it twice", () => {
    const h = harness();
    h.stack.stories.putPending("t_1", { speak: "A word.", story: null, wordId: "word_1" });
    expect(h.stack.stories.takePending("t_1")).not.toBeNull();
    expect(h.stack.stories.takePending("t_1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The Voice_Brain writes the turn's `story_step` entry (Req 3.5)

describe("the story_step Log_Entry", () => {
  it("carries ids and a closed enum, and no step text at all", async () => {
    const h = brainHarness({
      stt: sttProviderSaying("tell me a story"),
      llm: {
        id: "mock",
        dataHandling: NO_RETENTION_NO_TRAINING,
        reply: ({ toolResults }) =>
          Promise.resolve({
            ok: true,
            text: "The model's own wording.",
            toolRequests:
              toolResults.length > 0
                ? []
                : [{ name: "content_lookup", args: { category: "stories", start: true } }],
          }),
      },
    });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    const entries = h.entries() as readonly Readonly<Record<string, unknown>>[];
    const steps = entries.filter((entry) => entry["kind"] === "story_step");
    expect(steps).toHaveLength(1);
    const step = steps[0] ?? {};
    expect(step).toMatchObject({
      device_id: "xlu_000123",
      turn_id: "t_brain",
      content_id: LINEAR,
      step_id: "s1",
      choice_id: null,
      outcome: "started",
    });
    // The entry's own fields are the whole of it: no text field, and no curated prose anywhere
    // in the log (safety.md §7).
    expect(Object.keys(step).sort()).toEqual(
      [
        "at",
        "choice_id",
        "content_id",
        "device_id",
        "kind",
        "log_ver",
        "outcome",
        "seq",
        "step_id",
        "turn_id",
      ].sort(),
    );
    const spoken = stepSpeech(seeded(LINEAR).steps[0]!, "en-IN");
    expect(JSON.stringify(entries)).not.toContain(spoken);
  });
});

describe("the Word_Of_The_Day on the turn path (Req 5.3, 5.7)", () => {
  it("speaks the curated narration for the turn's stage and reports the entry id", async () => {
    const h = harness();
    const entry = wordForDay(createStarterWords(), T0, "en-IN");
    expect(entry).not.toBeNull();
    const decision = await turn(h, {
      text: "what is the word for today",
      reply: "The model's own wording.",
      tools: [{ name: "content_lookup", args: { word_of_the_day: true } }],
    });
    expect(decision.curated).toBe(true);
    expect(decision.story).toBeNull();
    expect(decision.word_id).toBe(entry?.word_id);
    expect(decision.output?.decision).toBe("allow");
    expect(decision.speak).toBe(wordNarration(entry!, "en-IN", "little"));
    expect(decision.speak).not.toContain("model");
  });
});
