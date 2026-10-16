// The Mock_Llm (Req 2.2, 2.4, 2.5, 2.6): the deterministic language-model provider this phase
// runs on. Its reply comes from a rule table fixed in this source file, matched against the
// transcript's lowercased text and the turn's language, so the same transcript, the same
// Child_Context and the same seed give the same reply, the same tool requests and the same delay
// on every run and in every process.
//
// It reads no environment variable, opens no socket, calls no vendor API and needs no key. Every
// delay it simulates is scheduled on the gateway's Deadlines, never on a real sleep, so a test
// drives it with fake timers (Req 2.4).
//
// No rule's reply contains a URL, a phone-like number, a price or a brand, and every reply is one
// short sentence so it fits the strictest Age_Stage. The Output_Guard still checks every one: the
// guard is ours and runs whatever the provider says (safety.md §4).
import { type ProviderId, type SupportedLang } from "@xelulu/shared";

import type { Clock } from "../../clock.js";
import type { Deadlines } from "../../deadlines.js";
import type { LlmProvider, LlmReply, LlmTurnInput, ToolRequest } from "./llm-provider.js";
import { NO_RETENTION_NO_TRAINING } from "./provider-declaration.js";

/** The closed-list id every Mock_Llm Log_Entry carries. */
export const MOCK_LLM_PROVIDER_ID: ProviderId = "mock";

export type MockLlmRule = Readonly<{
  /** Lowercase substrings; all must appear in the transcript. */
  match: readonly string[];
  lang: SupportedLang;
  reply: string;
  toolRequests: readonly ToolRequest[];
  /** Scheduled on Deadlines, never a real sleep (Req 2.4). */
  delayMs: number;
}>;

/** The delay of a transcript no rule matches. */
export const MOCK_LLM_DEFAULT_DELAY_MS = 150;

/**
 * The rule table (Req 2.5). It covers a plain question, a question on a Defer_Topic, an unsafe
 * request, a distress disclosure, a request that needs `content_lookup`, a Hindi utterance, a
 * code-mixed utterance, and one rule whose delay is above the 600 ms Filler_Deadline.
 *
 * The deferral, unsafe and distress rules exist for completeness: the Input_Guard answers those
 * turns before the provider is ever called, and these replies are what a provider that was asked
 * anyway would say.
 */
export const MOCK_LLM_RULES: readonly MockLlmRule[] = Object.freeze([
  // A plain question.
  Object.freeze({
    match: Object.freeze(["sky", "blue"]),
    lang: "en-IN",
    reply: "Sunlight bounces, so the sky looks blue.",
    toolRequests: Object.freeze([]),
    delayMs: 120,
  }),
  // A question on a Defer_Topic (`death`).
  Object.freeze({
    match: Object.freeze(["grandpa"]),
    lang: "en-IN",
    reply: "Grandpa is far away now.",
    toolRequests: Object.freeze([]),
    delayMs: 150,
  }),
  // An unsafe request.
  Object.freeze({
    match: Object.freeze(["hurt", "cat"]),
    lang: "en-IN",
    reply: "Let us be gentle with animals.",
    toolRequests: Object.freeze([]),
    delayMs: 150,
  }),
  // A distress disclosure.
  Object.freeze({
    match: Object.freeze(["scared", "dark"]),
    lang: "en-IN",
    reply: "You are safe here with me.",
    toolRequests: Object.freeze([]),
    delayMs: 150,
  }),
  // A request that needs `content_lookup`. The category is the Content_Library's own code
  // (`stories`, plural), which is also the Child_Context category a parent opens: a request for
  // anything else answers `unknown_category`, which the Tool_Router reports as `error`.
  Object.freeze({
    match: Object.freeze(["story"]),
    lang: "en-IN",
    reply: "Here is a little story for you.",
    toolRequests: Object.freeze([
      Object.freeze({ name: "content_lookup", args: Object.freeze({ category: "stories" }) }),
    ]),
    delayMs: 200,
  }),
  // The slow path: above the Filler_Deadline, so the Filler is spoken first (Req 12.2).
  Object.freeze({
    match: Object.freeze(["think", "hard"]),
    lang: "en-IN",
    reply: "I thought hard about your question.",
    toolRequests: Object.freeze([]),
    delayMs: 1_200,
  }),
  // A Hindi utterance.
  Object.freeze({
    match: Object.freeze(["कहानी"]),
    lang: "hi-IN",
    reply: "सुनो, एक छोटी कहानी।",
    toolRequests: Object.freeze([
      Object.freeze({ name: "content_lookup", args: Object.freeze({ category: "stories" }) }),
    ]),
    delayMs: 200,
  }),
  // A code-mixed utterance: Hindi in Latin script, answered in Hindi.
  Object.freeze({
    match: Object.freeze(["story", "sunao"]),
    lang: "hi-IN",
    reply: "अच्छा, एक छोटी कहानी सुनो।",
    toolRequests: Object.freeze([]),
    delayMs: 220,
  }),
]);

export const MOCK_LLM_DEFAULT_SEED = 1;

/** What a matching rule says this turn. */
type Chosen = Readonly<{ reply: string; toolRequests: readonly ToolRequest[]; delayMs: number }>;

/**
 * The replies for a transcript no rule matches, one per supported language. Exported so a test
 * can hold every one of them to the Output_Guard's rules, not just the ones a seed happens to
 * reach.
 */
export const DEFAULT_REPLIES: Readonly<Record<SupportedLang, readonly string[]>> = Object.freeze({
  "en-IN": Object.freeze([
    "Tell me more about that.",
    "That sounds fun, what next?",
    "I like talking with you.",
  ]),
  "hi-IN": Object.freeze([
    "और बताओ ना।",
    "यह मजेदार है, आगे बताओ।",
    "मुझे तुमसे बात करना अच्छा लगा।",
  ]),
});

/** FNV-1a over UTF-16 code units: a small, stable, process-independent mix. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The first rule for this language whose every match substring appears in the transcript. */
function ruleFor(transcript: string, lang: SupportedLang): MockLlmRule | null {
  const text = transcript.toLowerCase();
  for (const rule of MOCK_LLM_RULES) {
    if (rule.lang !== lang) continue;
    if (rule.match.every((needle) => text.includes(needle))) return rule;
  }
  return null;
}

/**
 * The reply, tool requests and delay for one call. A pure function of the rule table, the
 * transcript, the parts of the Child_Context the provider is given, and the seed.
 */
function choose(input: LlmTurnInput, seed: number): Chosen {
  const rule = ruleFor(input.transcript, input.lang);
  // A second call in the same turn already has its tool results, so it asks for no further tool
  // and the turn's tool loop always terminates.
  const answered = input.toolResults.length > 0;
  if (rule !== null) {
    return {
      reply: rule.reply,
      toolRequests: answered ? [] : rule.toolRequests,
      delayMs: rule.delayMs,
    };
  }
  const replies = DEFAULT_REPLIES[input.lang];
  const pick = hash(`${seed}\u0000${input.lang}\u0000${input.ageStage}\u0000${input.transcript}`);
  return {
    reply: replies[pick % replies.length] ?? "Tell me more about that.",
    toolRequests: [],
    delayMs: MOCK_LLM_DEFAULT_DELAY_MS,
  };
}

export type MockLlmDeps = Readonly<{ clock: Clock; deadlines: Deadlines; seed?: number }>;

/** The Mock_Llm provider. Offline, seeded, and delayed only through the Deadlines. */
export function createMockLlm(deps: MockLlmDeps): LlmProvider {
  const seed = deps.seed ?? MOCK_LLM_DEFAULT_SEED;
  let calls = 0;

  return {
    id: MOCK_LLM_PROVIDER_ID,
    dataHandling: NO_RETENTION_NO_TRAINING,

    reply(input): Promise<LlmReply> {
      const chosen = choose(input, seed);
      calls += 1;
      const key = `mock-llm:${calls}`;
      return new Promise<LlmReply>((resolve) => {
        deps.deadlines.schedule(key, deps.clock.now() + chosen.delayMs, () => {
          resolve({ ok: true, text: chosen.reply, toolRequests: chosen.toolRequests });
        });
      });
    },
  };
}
