// The Turn_Pipeline (Req 4, 5, 6, 9, 11): STT → Input_Guard → LLM with the Tool_Router →
// Output_Guard → the text to speak. It decides WHAT Xelulu says; the Voice_Brain does the
// speaking, so nothing here touches a socket, a frame or a command.
//
// The order is the safety argument and it is not negotiable (safety.md §4): the guard runs on the
// child's words before any model sees them, and on the model's words before any audio is
// synthesised. A guard decision short-circuits the model entirely — a distressed child is
// comforted without a round-trip, and a refused turn never reaches a provider at all.
//
// Two bounds live here rather than in the Tool_Router, because they are about the turn and not
// about one request:
//
//  - `MAX_LLM_ROUNDS`: how many times the model may be asked, so a model that keeps requesting
//    tools cannot hold a turn open.
//  - `MAX_TOOL_ATTEMPTS_PER_TURN`: every tool request the model issues, INCLUDING names the
//    router refuses. The router deliberately does not charge a rejected name to its executed-call
//    budget (so bad names cannot starve a legitimate call), which means the only place a loop of
//    bad names can be stopped is here (Omar's ruling, group 7 review).
import {
  type AgeStage,
  type AllowListedTool,
  type BrainTurnCause,
  type SupportedLang,
  type ToolOutcome,
} from "@xelulu/shared";

import type { LlmProvider, ToolRequest } from "./providers/llm-provider.js";
import type { SttSession } from "./providers/stt-provider.js";
import { ALLOW_LISTED_TOOLS_FOR_PROMPT } from "./tools/tool-catalogue.js";
import type { ToolRouter } from "./tools/tool-router.js";
import { checkInput, type GuardContext, type SafetyVerdict } from "./safety/input-guard.js";
import { checkOutput } from "./safety/output-guard.js";
import { COMFORT_REPLY, DEFERRAL_REPLY, SAFE_REDIRECT } from "./safety/safe-text.js";
import type { ChildContext } from "./state/child-context.js";

/** How many times the model may be asked on one turn. */
export const MAX_LLM_ROUNDS = 2;

/**
 * Every tool request a model issues on one turn, refused names included. Larger than the
 * router's executed-call budget so a turn can still spend all three legitimate calls after a
 * couple of mistakes, and small enough that a loop of bad names ends immediately.
 */
export const MAX_TOOL_ATTEMPTS_PER_TURN = 6;

export type ToolCallSummary = Readonly<{ tool: AllowListedTool | null; outcome: ToolOutcome }>;

/** What the pipeline decided. `speak` is already guard-approved text. */
export type TurnDecision = Readonly<{
  speak: string;
  lang: SupportedLang;
  ageStage: AgeStage;
  input: SafetyVerdict;
  /** null when the Input_Guard decided the turn and the model was never asked. */
  output: SafetyVerdict | null;
  tools: readonly ToolCallSummary[];
  /** The child's words, for the Transcript_Store only. Never logged (Omar ruling 1). */
  transcript: string;
}>;

export type TurnFailure = Readonly<{ failed: BrainTurnCause }>;

export type PipelineDeps = Readonly<{
  llm: LlmProvider;
  tools: ToolRouter;
}>;

export type PipelineTurn = Readonly<{
  deviceId: string;
  turnId: string;
  stt: SttSession;
  context: ChildContext;
}>;

/** The language the turn runs in: the detected tag when it is supported, else the child's first. */
export function resolveLang(detected: string, context: ChildContext): SupportedLang {
  const supported = context.langs.find((lang) => lang === detected);
  return supported ?? context.langs[0] ?? "en-IN";
}

function guardContext(context: ChildContext, lang: SupportedLang): GuardContext {
  return {
    ageStage: context.ageStage,
    lang,
    allowedCategories: context.allowedCategories,
    deferTopics: context.deferTopics,
  };
}

/** The spoken constant a guard decision calls for, shaped for the stage and language. */
export function spokenFor(verdict: SafetyVerdict, lang: SupportedLang, stage: AgeStage): string {
  switch (verdict.decision) {
    case "comfort":
      return COMFORT_REPLY[lang][stage];
    case "defer":
      return DEFERRAL_REPLY[lang][stage];
    case "refuse":
      return SAFE_REDIRECT[lang][stage];
    case "allow":
      return "";
  }
}

/**
 * Runs one turn's decision. Returns the text to speak, or the cause it failed with. Never
 * throws: a provider that throws is a `*_failed` cause, and the Voice_Brain speaks the
 * Safe_Redirect (Req 4.6).
 */
export async function decideTurn(
  deps: PipelineDeps,
  turn: PipelineTurn,
): Promise<TurnDecision | TurnFailure> {
  // 1. Speech to text.
  let transcript = "";
  let detected = "";
  try {
    const result = await turn.stt.finish();
    if (!result.ok) return { failed: "stt_failed" };
    transcript = result.transcript.text;
    detected = result.transcript.lang;
  } catch {
    return { failed: "stt_failed" };
  }

  const lang = resolveLang(detected, turn.context);
  const stage = turn.context.ageStage;
  const ctx = guardContext(turn.context, lang);

  // 2. The Input_Guard, before any model sees the child's words.
  const input = checkInput(transcript, ctx);
  if (input.decision !== "allow") {
    return {
      speak: spokenFor(input, lang, stage),
      lang,
      ageStage: stage,
      input,
      output: null,
      tools: [],
      transcript,
    };
  }

  // 3. The model, with the allow-listed catalogue and a bounded tool loop.
  const tools: ToolCallSummary[] = [];
  const toolResults: { name: string; text: string }[] = [];
  let attempts = 0;
  let replyText = "";

  for (let round = 0; round < MAX_LLM_ROUNDS; round += 1) {
    let reply;
    try {
      reply = await deps.llm.reply({
        deviceId: turn.deviceId,
        turnId: turn.turnId,
        transcript,
        lang,
        ageStage: stage,
        allowedCategories: turn.context.allowedCategories,
        deferTopics: turn.context.deferTopics,
        tools: ALLOW_LISTED_TOOLS_FOR_PROMPT,
        toolResults: [...toolResults],
      });
    } catch {
      return { failed: "llm_failed" };
    }
    if (!reply.ok)
      return { failed: reply.reason === "refused" ? "provider_refused" : "llm_failed" };

    replyText = reply.text;
    if (reply.toolRequests.length === 0) break;

    let ranOne = false;
    for (const request of reply.toolRequests as readonly ToolRequest[]) {
      // The turn-wide attempt cap, counting refused names too.
      if (attempts >= MAX_TOOL_ATTEMPTS_PER_TURN) break;
      attempts += 1;
      // The turn's resolved language travels with the turn, so the Tool_Router never has to
      // re-derive one (Phase 4 Req 3.2d).
      const result = deps.tools.run(
        { deviceId: turn.deviceId, turnId: turn.turnId, lang },
        request,
      );
      tools.push({ tool: result.tool, outcome: result.ok ? "ok" : result.outcome });
      if (result.ok) {
        toolResults.push({ name: result.tool, text: result.text });
        ranOne = true;
      }
    }
    // Nothing usable came back and the budget is spent: answer with what the model already said
    // rather than looping.
    if (!ranOne && attempts >= MAX_TOOL_ATTEMPTS_PER_TURN) break;
  }

  // 4. The Output_Guard, before any audio exists.
  const output = checkOutput(replyText, ctx);
  const speak = output.decision === "allow" ? replyText : SAFE_REDIRECT[lang][stage];

  return { speak, lang, ageStage: stage, input, output, tools, transcript };
}
