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
  type StoryStepOutcome,
  type SupportedLang,
  type ToolOutcome,
} from "@xelulu/shared";

import type { Clock } from "../clock.js";
import type { LlmProvider, ToolRequest } from "./providers/llm-provider.js";
import type { SttSession } from "./providers/stt-provider.js";
import type { StorySessions } from "./story/story-session.js";
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

/**
 * Which curated step this turn spoke, and what became of it (Req 3.2, 3.4, 3.5, 3.7). Ids and a
 * closed enum only: the step's text, the choice prompts and the child's answer are not here and
 * reach no Log_Entry (safety.md §7).
 *
 * `outcome` is carried rather than re-derived because it cannot be: `started`, `spoken`, `ended`
 * and `unresolved` are distinguishable only to the Story_Session that produced them, and
 * `refused` only to the Output_Guard step below.
 */
export type TurnStoryRef = Readonly<{
  content_id: string;
  step_id: string;
  choice_id: string | null;
  outcome: StoryStepOutcome;
}>;

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
  /** True when the spoken text is curated prose and the model's wording was discarded (C8). */
  curated: boolean;
  /** The curated step this turn spoke, or null. */
  story: TurnStoryRef | null;
  /** The Word_Of_The_Day entry this turn spoke, or null (Req 5.7). */
  word_id: string | null;
}>;

export type TurnFailure = Readonly<{ failed: BrainTurnCause }>;

export type PipelineDeps = Readonly<{
  llm: LlmProvider;
  tools: ToolRouter;
  /** Where the device is inside a curated item, and what curated text this turn has waiting. */
  stories: StorySessions;
  /** Read once per turn, for the idle sweep. */
  clock: Clock;
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
  // 0. A session nobody came back to is ended before this turn decides anything (Req 3.8). It
  // runs here rather than on a timer because a forgotten session costs nothing until a turn
  // arrives, and a turn is the only moment the answer can matter.
  deps.stories.sweep(deps.clock.now());

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

  // 2. The Input_Guard, before any model sees the child's words. A story in progress changes
  // nothing about this: the guard runs first, and its decision leaves the session's step exactly
  // where it was, with no unresolved answer counted (Req 4.5).
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
      curated: false,
      story: null,
      word_id: null,
    };
  }

  const tools: ToolCallSummary[] = [];
  /** The text to speak once it is known: curated prose, or the model's reply. */
  let spokenText: string | null = null;
  let storyRef: TurnStoryRef | null = null;
  let wordRef: string | null = null;
  let curated = false;

  // 2a. A story in progress answers the turn itself: no LLM call and no tool call (Req 4.2).
  if (deps.stories.inProgress(turn.deviceId)) {
    const advance = deps.stories.advance(turn.deviceId, transcript, lang);
    if (advance !== null) {
      // Curated text, which still falls through to the Output_Guard at step 4.
      spokenText = advance.speak;
      curated = true;
      storyRef = {
        content_id: advance.contentId,
        step_id: advance.stepId,
        choice_id: advance.kind === "step" ? advance.choiceId : null,
        // A repeated step is a spoken step; only the session can tell `ended` from `unresolved`.
        outcome: advance.kind === "ended" ? advance.outcome : "spoken",
      };
    }
  }

  // 3. The model, with the allow-listed catalogue and a bounded tool loop.
  const toolResults: { name: string; text: string }[] = [];
  let attempts = 0;
  let replyText = "";

  for (let round = 0; spokenText === null && round < MAX_LLM_ROUNDS; round += 1) {
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

  // 3a. A tool call that registered curated text wins over the model's wording (C8): a started
  // story's first step, or the day's word narration. Both arrive the same way and are treated
  // the same way, and the model's reply text is discarded.
  if (spokenText === null) {
    const pending = deps.stories.takePending(turn.turnId);
    if (pending === null) {
      spokenText = replyText;
    } else {
      spokenText = pending.speak;
      curated = true;
      wordRef = pending.wordId;
      if (pending.story !== null) {
        storyRef = {
          content_id: pending.story.contentId,
          step_id: pending.story.stepId,
          choice_id: null,
          outcome: "started",
        };
      }
    }
  }

  // 4. The Output_Guard, before any audio exists. ONE call site, reached by every branch above,
  // because curated text is not trusted to police itself either (Req 3.3, C8).
  const output = checkOutput(spokenText, ctx);
  if (output.decision === "allow") {
    return {
      speak: spokenText,
      lang,
      ageStage: stage,
      input,
      output,
      tools,
      transcript,
      curated,
      story: storyRef,
      word_id: wordRef,
    };
  }

  // A refused curated step takes the same path as any other refusal, and ends the session: a
  // story the guard will not speak is not one to stay inside (Req 3.4).
  if (storyRef !== null) {
    deps.stories.end(turn.deviceId, "refused");
    storyRef = { ...storyRef, outcome: "refused" };
  }
  return {
    speak: SAFE_REDIRECT[lang][stage],
    lang,
    ageStage: stage,
    input,
    output,
    tools,
    transcript,
    curated,
    story: storyRef,
    word_id: wordRef,
  };
}
