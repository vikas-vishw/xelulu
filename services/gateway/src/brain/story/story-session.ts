// Story_Sessions (XL-G01, XL-G02, Req 3.2, 3.7, 3.8, 4): where a device is inside a curated item,
// and which curated utterance a turn has waiting for it.
//
// Two safety rules shape the whole module:
//
//  - NO CHILD ANSWER ESCAPES (Req 4.7, C9). A transcript arrives, is folded by the same
//    `containsTerm` the guards use, and is compared against the current step's match terms. What
//    is kept is the resolved `choice_id` and `step_id` and nothing else: no answer text reaches a
//    Log_Entry, an Activity_Record, a store or this module's own state.
//  - A SESSION STAYS INSIDE ITS ITEM (Req 3.2, Property 3). A session holds a `content_id` and a
//    `step_id`, every move resolves through the Content_Store, and a step id that is not in the
//    item ends the session instead of guessing.
//
// There is at most one session per device, sessions are lost on restart, and a session idle past
// `STORY_SESSION_IDLE_MS` is ended by the sweep the pipeline calls each turn (Req 3.8).
import {
  type ContentItemBase,
  type ContentStep,
  type StoryStepOutcome,
  type SupportedLang,
} from "@xelulu/shared";

import type { Clock } from "../../clock.js";
import type { GatewayLog } from "../../log/gateway-log.js";
import type { ContentStore } from "../../content/content-store.js";
import { stepSpeech } from "../../content/content-gate.js";
import { containsTerm } from "../safety/forbidden-spans.js";

/** Half an hour of silence ends a story, so a forgotten session cannot outlive the play. */
export const STORY_SESSION_IDLE_MS = 30 * 60_000;

/** Unresolved answers in a row before the story closes rather than asking a third time. */
export const STORY_MAX_UNRESOLVED = 2;

/**
 * The words that end a story when a child says them (Req 4.6, 4.9). Tested BEFORE the choice
 * match terms, so "stop" always ends the story and can never be captured by a branch; a test
 * over every seeded choice asserts no match term collides with this list.
 *
 * One known cost, accepted rather than hidden: `बस` also means "bus" and "just", so a child
 * answering a story about a bus ends it. Ending a story early is recoverable in one turn, and
 * dropping the most natural Hindi word for "enough" would leave a child with no plain way out.
 * Nothing about it is unsafe. Revisit when real transcripts exist (F8).
 */
export const STORY_STOP_WORDS: Readonly<Record<SupportedLang, readonly string[]>> = Object.freeze({
  "en-IN": Object.freeze(["stop", "no more", "finished", "done", "enough"]),
  "hi-IN": Object.freeze(["बस", "रुको", "बंद करो", "नहीं चाहिए"]),
});

/** The closing line a stop word draws. One short sentence, so it passes even at `tiny`. */
export const STORY_CLOSING_LINE: Readonly<Record<SupportedLang, string>> = Object.freeze({
  "en-IN": "That was a lovely story.",
  "hi-IN": "कहानी अच्छी थी।",
});

/**
 * A curated utterance held for one turn, which the Turn_Pipeline takes by `turn_id` and speaks
 * verbatim (C8). Two shapes in one type, because both arrive by the same route — a
 * `content_lookup` that started a story, or one that asked for the day's word — and the pipeline
 * treats them identically: curated text in, Output_Guard, out.
 */
export type PendingSpeech = Readonly<{
  speak: string;
  /** Set for a story step; null for a Word_Of_The_Day narration. */
  story: Readonly<{ contentId: string; stepId: string }> | null;
  /** Set for a Word_Of_The_Day; null for a story step. */
  wordId: string | null;
}>;

/** At most one pending per turn, and at most this many turns held: oldest dropped (defensive). */
export const PENDING_SPEECH_MAX_TURNS = 64;

/**
 * What one allowed transcript did to the session. Every variant carries the `contentId` as well
 * as the `stepId`, because the Turn_Pipeline's `TurnDecision.story` — and so the `story_step`
 * Log_Entry the Voice_Brain writes from it — names both, and the session is the only thing that
 * knows which item the device was inside (Req 3.5).
 */
export type StoryAdvance =
  | {
      readonly kind: "step";
      readonly contentId: string;
      readonly stepId: string;
      readonly choiceId: string | null;
      readonly speak: string;
    }
  | {
      readonly kind: "repeat";
      readonly contentId: string;
      readonly stepId: string;
      readonly speak: string;
    }
  | {
      readonly kind: "ended";
      readonly contentId: string;
      readonly stepId: string;
      readonly speak: string;
      readonly outcome: StoryStepOutcome;
    };

export interface StorySessions {
  /**
   * Opens a session on the item's first step, replacing any session that device had (Req 3.2),
   * AND registers the turn's PendingSpeech for `takePending(turnId)`. One call does both, so a
   * caller cannot do half of it. Called only by the Tool_Router (C40). Answers null — and opens
   * nothing — when the item has no speakable first step in `lang`.
   */
  start(
    args: Readonly<{
      deviceId: string;
      turnId: string;
      item: ContentItemBase;
      lang: SupportedLang;
    }>,
  ): PendingSpeech | null;
  inProgress(deviceId: string): boolean;
  /** Resolves an allowed transcript against the current step's choices (C9). */
  advance(deviceId: string, transcript: string, lang: SupportedLang): StoryAdvance | null;
  /**
   * The one other door into the pending map, for a curated utterance that is not a story step.
   * Today it has exactly one caller and one use: the Word_Of_The_Day narration (Req 5.3).
   */
  putPending(turnId: string, pending: PendingSpeech): void;
  /** The curated utterance this turn's tool call registered, if any (C8). Deletes it. */
  takePending(turnId: string): PendingSpeech | null;
  end(deviceId: string, outcome: StoryStepOutcome): void;
  /** Called from the pipeline on each turn; ends sessions idle past STORY_SESSION_IDLE_MS. */
  sweep(nowMs: number): void;
}

type OpenSession = {
  contentId: string;
  stepId: string;
  lang: SupportedLang;
  unresolved: number;
  lastAtMs: number;
};

/** The step of `item` with this id, or null. A miss ends the session rather than guessing. */
function stepOf(item: ContentItemBase, stepId: string): ContentStep | null {
  return item.steps.find((step) => step.step_id === stepId) ?? null;
}

/** True when the transcript carries a stop word of this language, as a whole word run. */
function isStopWord(transcript: string, lang: SupportedLang): boolean {
  return STORY_STOP_WORDS[lang].some((word) => containsTerm(transcript, word));
}

export function createStorySessions(
  deps: Readonly<{ clock: Clock; log: Pick<GatewayLog, "add">; content: ContentStore }>,
): StorySessions {
  const sessions = new Map<string, OpenSession>();
  /** Insertion-ordered, so the oldest turn is the first key when the bound is reached. */
  const pending = new Map<string, PendingSpeech>();

  function remember(turnId: string, speech: PendingSpeech): void {
    pending.delete(turnId);
    while (pending.size >= PENDING_SPEECH_MAX_TURNS) {
      const oldest = pending.keys().next();
      if (oldest.done === true) break;
      pending.delete(oldest.value);
    }
    pending.set(turnId, speech);
  }

  return {
    start({ deviceId, turnId, item, lang }) {
      const first = item.steps[0];
      if (first === undefined) return null;
      const speak = stepSpeech(first, lang);
      // No speakable first step in this language: open nothing, so the session's language and the
      // pipeline's can never disagree from the second turn on.
      if (speak.trim().length === 0) return null;
      sessions.set(deviceId, {
        contentId: item.content_id,
        stepId: first.step_id,
        lang,
        unresolved: 0,
        lastAtMs: deps.clock.now(),
      });
      const speech: PendingSpeech = {
        speak,
        story: { contentId: item.content_id, stepId: first.step_id },
        wordId: null,
      };
      remember(turnId, speech);
      return speech;
    },

    inProgress: (deviceId) => sessions.has(deviceId),

    advance(deviceId, transcript, lang) {
      const session = sessions.get(deviceId);
      if (session === undefined) return null;
      const item = deps.content.get(session.contentId);
      const current = item === null ? null : stepOf(item, session.stepId);
      if (item === null || current === null) {
        // The item is gone from under the session: end it rather than inventing a step.
        sessions.delete(deviceId);
        return null;
      }
      session.lastAtMs = deps.clock.now();

      // (1) The stop words, first and always (Req 4.9).
      if (isStopWord(transcript, lang)) {
        sessions.delete(deviceId);
        return {
          kind: "ended",
          contentId: session.contentId,
          stepId: current.step_id,
          speak: STORY_CLOSING_LINE[lang],
          outcome: "ended",
        };
      }

      // (2) A linear step moves on any allowed transcript.
      if (current.choices.length === 0) {
        const nextId = current.next_step_id;
        const next = nextId === null ? null : stepOf(item, nextId);
        if (next === null) {
          sessions.delete(deviceId);
          return {
            kind: "ended",
            contentId: session.contentId,
            stepId: current.step_id,
            speak: STORY_CLOSING_LINE[lang],
            outcome: "ended",
          };
        }
        const speak = stepSpeech(next, lang);
        if (speak.trim().length === 0) {
          sessions.delete(deviceId);
          return {
            kind: "ended",
            contentId: session.contentId,
            stepId: current.step_id,
            speak: STORY_CLOSING_LINE[lang],
            outcome: "ended",
          };
        }
        session.stepId = next.step_id;
        session.unresolved = 0;
        return {
          kind: "step",
          contentId: session.contentId,
          stepId: next.step_id,
          choiceId: null,
          speak,
        };
      }

      // (3) A branching step: the choices in declaration order, first match wins. Only the
      // resolved choice id leaves this block (Req 4.7).
      for (const choice of current.choices) {
        const terms = choice.match_terms[lang] ?? [];
        if (!terms.some((term) => containsTerm(transcript, term))) continue;
        const next = stepOf(item, choice.next_step_id);
        const speak = next === null ? "" : stepSpeech(next, lang);
        if (next === null || speak.trim().length === 0) {
          sessions.delete(deviceId);
          return {
            kind: "ended",
            contentId: session.contentId,
            stepId: current.step_id,
            speak: STORY_CLOSING_LINE[lang],
            outcome: "ended",
          };
        }
        session.stepId = next.step_id;
        session.unresolved = 0;
        return {
          kind: "step",
          contentId: session.contentId,
          stepId: next.step_id,
          choiceId: choice.choice_id,
          speak,
        };
      }

      // (4) Nothing matched: repeat once, then close (Req 4.4).
      session.unresolved += 1;
      if (session.unresolved >= STORY_MAX_UNRESOLVED) {
        sessions.delete(deviceId);
        return {
          kind: "ended",
          contentId: session.contentId,
          stepId: current.step_id,
          speak: STORY_CLOSING_LINE[lang],
          outcome: "unresolved",
        };
      }
      return {
        kind: "repeat",
        contentId: session.contentId,
        stepId: current.step_id,
        speak: stepSpeech(current, lang),
      };
    },

    putPending(turnId, speech) {
      remember(turnId, speech);
    },

    takePending(turnId) {
      const speech = pending.get(turnId);
      if (speech === undefined) return null;
      pending.delete(turnId);
      return speech;
    },

    /**
     * Ends a device's session. It writes NO Log_Entry on purpose: every caller of `end` is inside
     * a turn and the Voice_Brain, which holds the `turn_id`, writes that turn's `story_step`
     * entry. `sweep` is the one path with no turn behind it, so it is the one path that logs here.
     * The `outcome` is taken so the signature stays the one the pipeline reads for its own entry.
     */
    end(deviceId, outcome) {
      void outcome;
      sessions.delete(deviceId);
    },

    sweep(nowMs) {
      for (const [deviceId, session] of [...sessions.entries()]) {
        if (nowMs - session.lastAtMs < STORY_SESSION_IDLE_MS) continue;
        sessions.delete(deviceId);
        deps.log.add({
          kind: "story_step",
          device_id: deviceId,
          turn_id: null,
          content_id: session.contentId,
          step_id: session.stepId,
          choice_id: null,
          outcome: "ended",
        });
      }
    },
  };
}
