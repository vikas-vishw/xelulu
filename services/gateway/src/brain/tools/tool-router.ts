// The Tool_Router (Req 9, C18, safety.md §3): the ONLY path from a provider's tool request to
// anything that happens in the house.
//
// safety.md §3 is the whole reason this module exists: "The LLM gets no browsing, search, URL
// fetching or code execution. It can only call allow-listed internal tools." So the router is
// built as a gate rather than a dispatcher:
//
//  1. The requested name is resolved against `ALLOW_LISTED_TOOLS` by EXACT match, before any
//     handler is reached and before the per-turn budget is consulted. A name that is not on the
//     list touches no handler, and it is never written anywhere: the `tool_call` entry carries
//     `tool: null`, because the requested string is a provider's text and this layer does not put
//     provider text into the log (Omar ruling 1, Req 9.8).
//  2. A turn may make at most `MAX_TOOL_CALLS_PER_TURN` tool calls, so a model cannot loop.
//  3. Only then does a handler run, and every handler's arguments are read narrowly: a wrong
//     shape is an error, never a coercion, and no argument value is ever logged or echoed.
//
// Nothing here fetches, browses, reads a file or opens a socket. The five handlers are in-process
// fixtures (`content-library.ts`, `routines.ts`, `memory-store.ts`) and the one gate that can
// reach the wire (`device-action.ts`), which checks quiet hours, the play limit and the movement
// toggle before it sends (safety.md §5).
import {
  ALLOW_LISTED_TOOLS,
  type AllowListedTool,
  type SupportedLang,
  type ToolDeniedReason,
} from "@xelulu/shared";

import type { GatewayLog } from "../../log/gateway-log.js";
import type { ChildContextTable } from "../state/child-context.js";
import type { MemoryStore } from "../state/memory-store.js";
import type { StorySessions } from "../story/story-session.js";
import { wordNarration } from "../story/word-of-the-day.js";
import type { ContentLibrary, ContentQuery } from "./content-library.js";
import type { DeviceActions } from "./device-action.js";
import type { Routines } from "./routines.js";

/** What a provider asked for. `name` is a plain string on purpose: the router is what refuses it. */
export type ToolRequest = Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>;

export type ToolResult =
  | { readonly ok: true; readonly tool: AllowListedTool; readonly text: string }
  | {
      readonly ok: false;
      /** null only when the requested name was not allow-listed. */
      readonly tool: AllowListedTool | null;
      readonly outcome: "denied" | "error";
      readonly reason: ToolDeniedReason | null;
    };

/** Three is enough for a child's turn and bounds the work a model can ask for. */
export const MAX_TOOL_CALLS_PER_TURN = 3;

/**
 * One turn, as the router sees it. `lang` is the turn's RESOLVED language and is carried here
 * rather than re-derived from `ctx.langs[0]` (Req 3.2d): in Phase 3 a lookup returned a joined
 * title list and the difference was inert, but in Phase 4 the language decides which items are
 * eligible, WHICH CURATED TEXT IS SPOKEN, the Word_Of_The_Day entry and its narration, and the
 * language a Story_Session is opened with. A bilingual child's Hindi turn would otherwise open
 * its session on the English first step while the pipeline's later `advance(...)` passed `hi-IN`.
 */
export type ToolTurn = Readonly<{ deviceId: string; turnId: string; lang: SupportedLang }>;

/** What a started story tells the model. A FIXED constant, never curated prose (Req 3.2b, C8). */
export const STORY_START_TOOL_TEXT = "starting a story";

/** What a resolved Word_Of_The_Day tells the model. Also fixed, for the same reason. */
export const WORD_OF_THE_DAY_TOOL_TEXT = "word of the day ready";

export interface ToolRouter {
  /** Runs allow-listed names only; everything else is denied `not_allow_listed`. */
  run(turn: ToolTurn, request: ToolRequest): ToolResult;
  /** Calls already made for a turn, so the pipeline can see the budget. */
  callCount(turnId: string): number;
  /** Frees a finished turn's counter. */
  endTurn(turnId: string): void;
}

/** The allow-list as a Set, built once. Exact match only: no trimming, no case folding. */
const ALLOWED: ReadonlySet<string> = new Set<string>(ALLOW_LISTED_TOOLS);

/** A string argument, or null. Never coerces a number or an object into text. */
function stringArg(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function createToolRouter(
  deps: Readonly<{
    log: Pick<GatewayLog, "add">;
    content: ContentLibrary;
    /**
     * The Story_Sessions. This dependency is here, and not inside the Content_Library, because
     * the router is the only module holding both the resolved item and the turn (C40).
     */
    stories: StorySessions;
    routines: Routines;
    memory: MemoryStore;
    device: DeviceActions;
    context: ChildContextTable;
  }>,
): ToolRouter {
  const calls = new Map<string, number>();

  /** Every outcome is logged here, so no handler can log a tool call its own way. */
  function record(turn: ToolTurn, result: ToolResult): ToolResult {
    deps.log.add({
      kind: "tool_call",
      device_id: turn.deviceId,
      turn_id: turn.turnId,
      tool: result.tool,
      outcome: result.ok ? "ok" : result.outcome,
      denied_reason: result.ok ? null : result.reason,
    });
    return result;
  }

  /**
   * The `content_lookup` handler. The three Phase 4 arguments are read narrowly and NONE of them
   * is logged or echoed: `start` and `word_of_the_day` only on a literal boolean `true`, and
   * `content_id` through the existing string-only `stringArg` (Req 3.2c).
   */
  function contentLookup(turn: ToolTurn, args: Readonly<Record<string, unknown>>): ToolResult {
    const ctx = deps.context.forDevice(turn.deviceId);
    const lang = turn.lang; // the turn's resolved language, never ctx.langs[0] (Req 3.2d)
    const base = { lang, ageStage: ctx.ageStage, allowedCategories: ctx.allowedCategories };
    const query: ContentQuery =
      args["word_of_the_day"] === true
        ? { wordOfTheDay: true, ...base }
        : {
            // A missing or non-string category stays `unknown_category`, exactly as before.
            category: stringArg(args, "category") ?? "",
            ...base,
            start: args["start"] === true,
            contentId: stringArg(args, "content_id") ?? undefined,
          };

    const found = deps.content.lookup(query);
    if (!found.ok) {
      // `not_allowed` is a policy refusal; the other two are a miss in the library.
      const denied = found.reason === "not_allowed";
      return {
        ok: false,
        tool: "content_lookup",
        outcome: denied ? "denied" : "error",
        reason: denied ? "policy" : null,
      };
    }

    if ("item" in found) {
      // One call both opens the session and registers the turn's curated utterance, so the story
      // path cannot register half of itself (C40).
      const pending = deps.stories.start({
        deviceId: turn.deviceId,
        turnId: turn.turnId,
        item: found.item,
        lang,
      });
      // A null pending means the item had no speakable first step for this language: an error,
      // never a silent allow, so the model answers in its own words under the Output_Guard.
      return pending === null
        ? { ok: false, tool: "content_lookup", outcome: "error", reason: null }
        : { ok: true, tool: "content_lookup", text: STORY_START_TOOL_TEXT };
    }
    if ("word" in found) {
      deps.stories.putPending(turn.turnId, {
        speak: wordNarration(found.word, lang, ctx.ageStage),
        story: null,
        wordId: found.word.word_id,
      });
      return { ok: true, tool: "content_lookup", text: WORD_OF_THE_DAY_TOOL_TEXT };
    }
    return { ok: true, tool: "content_lookup", text: found.titles.join(", ") };
  }

  function routineLookup(args: Readonly<Record<string, unknown>>): ToolResult {
    const name = stringArg(args, "name");
    if (name === null) {
      return { ok: false, tool: "routine_lookup", outcome: "error", reason: null };
    }
    const found = deps.routines.lookup(name);
    if (!found.ok) {
      return { ok: false, tool: "routine_lookup", outcome: "error", reason: null };
    }
    return { ok: true, tool: "routine_lookup", text: `${found.name} at ${found.at}` };
  }

  function memoryRead(turn: ToolTurn): ToolResult {
    // Keyed by the opaque child key, so one child cannot read another's facts (C9, C12).
    const facts = deps.memory.read(deps.context.childKeyFor(turn.deviceId));
    return { ok: true, tool: "memory_read", text: facts.join("; ") };
  }

  function memoryWrite(turn: ToolTurn, args: Readonly<Record<string, unknown>>): ToolResult {
    const fact = stringArg(args, "fact");
    if (fact === null) {
      return { ok: false, tool: "memory_write", outcome: "error", reason: null };
    }
    const outcome = deps.memory.write(deps.context.childKeyFor(turn.deviceId), fact);
    if (outcome === "stored") return { ok: true, tool: "memory_write", text: "remembered" };
    // A cap is a policy refusal; a blank fact is a malformed request.
    const denied = outcome === "full" || outcome === "too_long";
    return {
      ok: false,
      tool: "memory_write",
      outcome: denied ? "denied" : "error",
      reason: denied ? "policy" : null,
    };
  }

  function deviceAction(turn: ToolTurn, args: Readonly<Record<string, unknown>>): ToolResult {
    const action = stringArg(args, "action");
    if (action === null) {
      return { ok: false, tool: "device_action", outcome: "error", reason: null };
    }
    const data = args["data"];
    const payload: Record<string, unknown> =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? { ...(data as Record<string, unknown>) }
        : {};
    // The action string is checked inside the gate against DEVICE_ACTION_ALLOWED, so an action
    // outside the five is denied there and never reaches the command sender.
    return deps.device.request(turn.deviceId, {
      action: action as Parameters<DeviceActions["request"]>[1]["action"],
      data: payload,
    });
  }

  return {
    run(turn, request) {
      // (1) The allow-list, by exact match, before anything else happens.
      if (!ALLOWED.has(request.name)) {
        return record(turn, {
          ok: false,
          tool: null,
          outcome: "denied",
          reason: "not_allow_listed",
        });
      }
      const tool = request.name as AllowListedTool;

      // (2) The per-turn budget. An unknown name never reaches here, so a refused name cannot
      // spend a legitimate call's budget.
      const made = calls.get(turn.turnId) ?? 0;
      if (made >= MAX_TOOL_CALLS_PER_TURN) {
        return record(turn, { ok: false, tool, outcome: "denied", reason: "too_many" });
      }
      calls.set(turn.turnId, made + 1);

      // (3) Only now a handler.
      switch (tool) {
        case "content_lookup":
          return record(turn, contentLookup(turn, request.args));
        case "routine_lookup":
          return record(turn, routineLookup(request.args));
        case "memory_read":
          return record(turn, memoryRead(turn));
        case "memory_write":
          return record(turn, memoryWrite(turn, request.args));
        case "device_action":
          return record(turn, deviceAction(turn, request.args));
      }
    },

    callCount: (turnId) => calls.get(turnId) ?? 0,

    endTurn(turnId) {
      calls.delete(turnId);
    },
  };
}
