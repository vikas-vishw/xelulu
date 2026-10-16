// The Turn_Pipeline end to end (Req 4, 5, 6, 9, 11): STT → Input_Guard → LLM via the
// Tool_Router → Output_Guard → the text to speak.
//
// The guards and the router here are the REAL ones; only the providers are stubs, so the test is
// about the ordering and the decisions rather than about a mock's rule table. The four paths that
// carry the safety argument each have their own block: a plain turn, a deferral, a refusal, and
// the bound on how many tool requests a model may issue.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import { createContentLibrary } from "../src/brain/tools/content-library.js";
import { createRoutines } from "../src/brain/tools/routines.js";
import { createDeviceActions } from "../src/brain/tools/device-action.js";
import { createToolRouter } from "../src/brain/tools/tool-router.js";
import { createMemoryStore } from "../src/brain/state/memory-store.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
} from "../src/brain/state/child-context.js";
import {
  MAX_TOOL_ATTEMPTS_PER_TURN,
  decideTurn,
  resolveLang,
  type TurnDecision,
} from "../src/brain/turn-pipeline.js";
import { COMFORT_REPLY, DEFERRAL_REPLY, SAFE_REDIRECT } from "../src/brain/safety/safe-text.js";
import type { LlmProvider, ToolRequest } from "../src/brain/providers/llm-provider.js";
import type { SttSession } from "../src/brain/providers/stt-provider.js";
import { NO_RETENTION_NO_TRAINING } from "../src/brain/providers/provider-declaration.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import {
  brainHarness,
  createFakeTarget,
  runTurn,
  // Aliased: this file has its own session-level `sttSaying`, and the harness's is a provider.
  sttSaying as sttProviderSaying,
} from "./support/brain-harness.js";

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
const TURN_ID = "t_pipeline";

/** A session that transcribes a fixed text, so the test controls the child's words exactly. */
function sttSaying(text: string, lang = "en-IN"): SttSession {
  return {
    turnId: TURN_ID,
    pushFrame: () => undefined,
    release: () => undefined,
    bytesHeld: () => 0,
    finish: () => Promise.resolve({ ok: true, transcript: { text, lang } }),
  };
}

/** A session whose STT failed, for the provider-failure path. */
function sttFailing(): SttSession {
  return {
    turnId: TURN_ID,
    pushFrame: () => undefined,
    release: () => undefined,
    bytesHeld: () => 0,
    finish: () => Promise.resolve({ ok: false, reason: "provider_error" }),
  };
}

/** An LLM that answers with a fixed text, and optionally asks for tools on its first call. */
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

function contextOf(over: Partial<ChildContext> = {}): ChildContext {
  return {
    ...MOST_RESTRICTIVE_CONTEXT,
    ageStage: "little",
    langs: ["en-IN", "hi-IN"],
    allowedCategories: ["stories", "animals"],
    policy: { quietHours: null, playLimitMinutes: null, movementOn: true },
    ...over,
  };
}

function harness(context: ChildContext = contextOf()) {
  const clock = createTestClock(0);
  const log = createGatewayLog(clock, createCaptureSink());
  const table: ChildContextTable = {
    setActiveChild: () => undefined,
    forDevice: () => context,
    childKeyFor: () => "child:test",
  };
  const routines = createRoutines(undefined, { [DEVICE]: 0 });
  const sent: unknown[] = [];
  const tools = createToolRouter({
    log,
    content: createContentLibrary(),
    routines,
    memory: createMemoryStore(),
    context: table,
    device: createDeviceActions({
      sendCommand: (request) => {
        sent.push(request);
        return { ok: true, cmd_id: "cmd_1" };
      },
      context: table,
      routines,
      nowMinutes: () => 12 * 60,
    }),
  });
  return { clock, log, tools, context, sent };
}

/** Narrows a pipeline outcome to a decision, failing the test if it failed. */
function decided(outcome: TurnDecision | { failed: string }): TurnDecision {
  if ("failed" in outcome) throw new Error(`pipeline failed: ${outcome.failed}`);
  return outcome;
}

describe("a plain turn", () => {
  it("transcribes, allows, asks the model, and speaks a guard-approved reply", async () => {
    const h = harness();
    const result = decided(
      await decideTurn(
        { llm: llmSaying("Lions live in the grassland."), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("tell me about lions"),
          context: h.context,
        },
      ),
    );
    expect(result.input).toEqual({ decision: "allow", rule: "none", topic: null });
    expect(result.output).toEqual({ decision: "allow", rule: "none", topic: null });
    expect(result.speak).toBe("Lions live in the grassland.");
    expect(result.lang).toBe("en-IN");
    expect(result.transcript).toBe("tell me about lions");
  });

  it("runs an allow-listed tool and keeps the model's reply", async () => {
    const h = harness();
    const result = decided(
      await decideTurn(
        {
          llm: llmSaying("Here is a story.", [
            { name: "content_lookup", args: { category: "stories" } },
          ]),
          tools: h.tools,
        },
        { deviceId: DEVICE, turnId: TURN_ID, stt: sttSaying("a story please"), context: h.context },
      ),
    );
    expect(result.tools).toEqual([{ tool: "content_lookup", outcome: "ok" }]);
    expect(result.speak).toBe("Here is a story.");
  });
});

describe("the deferral path", () => {
  it("defers a built-in topic with the gentle answer, and never asks the model", async () => {
    const h = harness();
    const llm = llmSaying("this should never be spoken");
    const spy = vi.spyOn(llm, "reply");
    const result = decided(
      await decideTurn(
        { llm, tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("where did grandpa go when he died"),
          context: h.context,
        },
      ),
    );
    expect(result.input).toEqual({ decision: "defer", rule: "defer_topic", topic: "death" });
    expect(result.speak).toBe(DEFERRAL_REPLY["en-IN"].little);
    expect(result.speak).toContain("ask");
    // The model is never asked: a deferral short-circuits the pipeline (safety.md §4).
    expect(spy).not.toHaveBeenCalled();
    expect(result.output).toBeNull();
  });

  it("defers a parent-added topic under the parent_added code", async () => {
    const h = harness(contextOf({ deferTopics: ["thunderstorm"] }));
    const result = decided(
      await decideTurn(
        { llm: llmSaying("x"), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("i am asking about the thunderstorm"),
          context: h.context,
        },
      ),
    );
    expect(result.input.topic).toBe("parent_added");
    expect(result.speak).toBe(DEFERRAL_REPLY["en-IN"].little);
  });

  it("comforts distress with the comfort reply, and never asks the model", async () => {
    const h = harness();
    const llm = llmSaying("never spoken");
    const spy = vi.spyOn(llm, "reply");
    const result = decided(
      await decideTurn(
        { llm, tools: h.tools },
        { deviceId: DEVICE, turnId: TURN_ID, stt: sttSaying("i am very sad"), context: h.context },
      ),
    );
    expect(result.input).toEqual({ decision: "comfort", rule: "distress", topic: null });
    expect(result.speak).toBe(COMFORT_REPLY["en-IN"].little);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the refusal path", () => {
  it("replaces an unsafe model reply with the Safe_Redirect, whole", async () => {
    const h = harness();
    const result = decided(
      await decideTurn(
        { llm: llmSaying("Visit youtube.com for more."), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("tell me about lions"),
          context: h.context,
        },
      ),
    );
    expect(result.output?.decision).toBe("refuse");
    expect(result.speak).toBe(SAFE_REDIRECT["en-IN"].little);
    // Nothing of the refused reply survives: no redaction, no fragment (C19).
    expect(result.speak).not.toContain("youtube");
    expect(result.speak).not.toContain(".com");
  });

  it.each([
    ["a phone number", "Call 9876543210 now."],
    ["a price", "It costs 200 rupees."],
    ["a brand", "Ask Alexa on Amazon."],
    ["frightening content", "A monster will kill you."],
    ["medical content", "Take this medicine for your fever."],
  ])("refuses %s and speaks the redirect instead", async (_label, reply) => {
    const h = harness();
    const result = decided(
      await decideTurn(
        { llm: llmSaying(reply), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("tell me about lions"),
          context: h.context,
        },
      ),
    );
    expect(result.output?.decision).toBe("refuse");
    expect(result.speak).toBe(SAFE_REDIRECT["en-IN"].little);
  });

  it("refuses a reply that is too long for the stage", async () => {
    const h = harness(contextOf({ ageStage: "tiny" }));
    const long = "One. Two. Three. Four.";
    const result = decided(
      await decideTurn(
        { llm: llmSaying(long), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("tell me about lions"),
          context: h.context,
        },
      ),
    );
    expect(result.output).toEqual({ decision: "refuse", rule: "length", topic: null });
    expect(result.speak).toBe(SAFE_REDIRECT["en-IN"].tiny);
  });

  it("reports a provider failure as a cause rather than throwing", async () => {
    const h = harness();
    const outcome = await decideTurn(
      { llm: llmSaying("x"), tools: h.tools },
      { deviceId: DEVICE, turnId: TURN_ID, stt: sttFailing(), context: h.context },
    );
    expect(outcome).toEqual({ failed: "stt_failed" });
  });
});

describe("the turn-wide tool bound", () => {
  it("stops a model that keeps issuing unknown names (Omar's ruling)", async () => {
    const h = harness();
    // Twenty bad names in one reply: the router charges none of them to its executed-call
    // budget, so the turn-wide attempt cap is the only thing that can stop the loop.
    const requests: ToolRequest[] = Array.from({ length: 20 }, (_, i) => ({
      name: `zzunknown${String(i)}`,
      args: {},
    }));
    const result = decided(
      await decideTurn(
        { llm: llmSaying("Let us play instead.", requests), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("tell me about lions"),
          context: h.context,
        },
      ),
    );
    expect(result.tools).toHaveLength(MAX_TOOL_ATTEMPTS_PER_TURN);
    expect(result.tools.every((call) => call.tool === null)).toBe(true);
    expect(result.tools.every((call) => call.outcome === "denied")).toBe(true);
    // The turn still answers rather than hanging.
    expect(result.speak).toBe("Let us play instead.");
  });
});

describe("the multilingual round-trip", () => {
  it("carries hi-IN through the guard, the model and the spoken text", async () => {
    const h = harness();
    const result = decided(
      await decideTurn(
        { llm: llmSaying("शेर घास के मैदान में रहते हैं।"), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("मुझे शेर के बारे में बताओ", "hi-IN"),
          context: h.context,
        },
      ),
    );
    expect(result.lang).toBe("hi-IN");
    expect(result.output?.decision).toBe("allow");
    expect(result.speak).toBe("शेर घास के मैदान में रहते हैं।");
  });

  it("decides a Hindi deferral in Hindi, and a Hindi refusal in Hindi", async () => {
    const h = harness();
    const defer = decided(
      await decideTurn(
        { llm: llmSaying("x"), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("भगवान कहाँ रहते हैं", "hi-IN"),
          context: h.context,
        },
      ),
    );
    expect(defer.input.topic).toBe("religion");
    expect(defer.speak).toBe(DEFERRAL_REPLY["hi-IN"].little);

    const refuse = decided(
      await decideTurn(
        { llm: llmSaying("यूट्यूब पर देखो।"), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          stt: sttSaying("मुझे शेर के बारे में बताओ", "hi-IN"),
          context: h.context,
        },
      ),
    );
    expect(refuse.output?.decision).toBe("refuse");
    expect(refuse.speak).toBe(SAFE_REDIRECT["hi-IN"].little);
  });

  it("handles a code-mixed utterance under the child's first language", async () => {
    const h = harness();
    const result = decided(
      await decideTurn(
        { llm: llmSaying("Lions are strong."), tools: h.tools },
        {
          deviceId: DEVICE,
          turnId: TURN_ID,
          // Code-mixed, labelled en-IN by the STT.
          stt: sttSaying("mujhe lions ke baare mein batao", "en-IN"),
          context: h.context,
        },
      ),
    );
    expect(result.lang).toBe("en-IN");
    expect(result.speak).toBe("Lions are strong.");
  });

  it("falls back to the child's first language for an unsupported tag", () => {
    expect(resolveLang("fr-FR", contextOf())).toBe("en-IN");
    expect(resolveLang("hi-IN", contextOf())).toBe("hi-IN");
    expect(resolveLang("", contextOf({ langs: ["hi-IN"] }))).toBe("hi-IN");
  });
});

// The blocks above stop at the decision. These two run the whole Voice_Brain, because the half of
// Req 7 and Req 8 that matters to a parent — the Deferred_Question and the Parent_Alert — is
// raised by the brain after the pipeline has decided, not by the pipeline itself.
describe("the grown-up is told", () => {
  it("records a Deferred_Question and its parent alert on a deferral", async () => {
    const h = brainHarness({ stt: sttProviderSaying("where did grandpa go when he died") });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    const questions = h.alerts.deferredQuestions();
    expect(questions.map((q) => [q.turn_id, q.topic])).toEqual([[target.turnId, "death"]]);
    expect(questions[0]?.question_id).toMatch(/^defer_/);
    // The parent hears about it as an alert too, carrying the topic code and no text (Req 7.3).
    expect(
      h
        .entries()
        .flatMap((e) => (e.kind === "parent_alert" ? [[e.alert, e.topic, e.turn_id]] : [])),
    ).toEqual([["deferred_question", "death", target.turnId]]);
    // And the child hears the gentle answer, not the model's.
    expect(h.transcripts.textFor(target.turnId).at(-1)?.text).toBe(DEFERRAL_REPLY["en-IN"].little);
    expect(target.finished()).toBe(true);
  });

  it("raises a distress alert and speaks the comfort reply", async () => {
    const h = brainHarness({ stt: sttProviderSaying("i am very sad") });
    const target = createFakeTarget(h);
    await runTurn(h, target);

    expect(h.alerts.deferredQuestions()).toEqual([]);
    const alerts = h.entries().flatMap((e) => (e.kind === "parent_alert" ? [e] : []));
    expect(alerts.map((e) => [e.alert, e.topic, e.confidence, e.duration_s])).toEqual([
      ["distress", null, null, null],
    ]);
    expect(h.transcripts.textFor(target.turnId).at(-1)?.text).toBe(COMFORT_REPLY["en-IN"].little);
  });
});
