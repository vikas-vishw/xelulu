// The behaviour table (Phase 4 Req 8.2, 8.2a, 9.3, 9.5, 9.6, 12.5): the ordered device actions a
// scheduled or state-driven behaviour asks for, and the narration a `say` among them speaks.
//
// Pure. Nothing here sends anything: every action it returns goes to the wire only through the
// unchanged Phase 3 Device_Policy_Gate in `brain/tools/device-action.ts`, which is the single
// gate quiet hours, the play limit and the movement toggle are checked by (C16, safety.md §5).
//
// Four rules the table encodes, so none of them is a judgement call at a call site:
//
//  - Every `data` object is COMPLETE. Document B's `data` objects are strict with every field
//    required, so a missing, extra or invented key fails at the sender rather than on the device:
//    `say { expression, lang, voice, duration_hint_ms }` and NO text field, because `say` audio is
//    streamed down the audio WebSocket; `animate { expression, eyes, loop }`; `gesture { name }`;
//    `led { target, color, effect, brightness }`.
//  - Every device-facing value is one the contract ALREADY publishes (C42). `expression` from
//    `KNOWN_EXPRESSIONS`, `eyes` from `KNOWN_EYES`, `gesture.name` from `KNOWN_GESTURE_NAMES`. All
//    four are `nonEmpty` free strings in Document B, so an invented value would validate — which
//    is exactly why not inventing one is a decision: they are hardware-facing values the Phase 6
//    firmware must implement, and product.md makes every hardware-facing choice CTO-decided and
//    final. No `KNOWN_*` list is touched and no vocabulary is widened to fit a behaviour.
//  - `led.effect` is `solid` or `pulse` only, and no flash rate is ever requested (safety.md §6,
//    Req 9.8). `rainbow` exists in the contract and is used by nothing.
//  - No behaviour sends `play`: neither `PLAY_SOURCES` value promises audio the Gateway can serve
//    this phase (C30).
//
// Every narration is a template constant per language AND per Age_Stage, because one string
// cannot be inside `tiny`'s one sentence of eight words and still be useful at `maker`. The
// tests measure every one of them with `checkOutput` at the stage it was written for.
//
// WHAT IS HERE AND WHAT IS NOT. This module holds the Grandma playback and the three call
// behaviours, which are what the Grandma wave needs: the playback narration is also the function
// the Grandma_Store's write-time title gate runs (Req 7.7a), so it has to be the same one
// playback speaks. The routine, nap and charge-reminder behaviours join the table with the
// Routine_Scheduler that fires them.
import {
  type AgeStage,
  type CmdAction,
  type PolicyRefusal,
  type SupportedLang,
  type WordEntry,
} from "@xelulu/shared";

import { wordCount } from "../brain/safety/age-shape.js";

/** The behaviours this phase can fire. Extended, never renumbered. */
export const ROUTINE_BEHAVIOUR_IDS = Object.freeze([
  "grandma_play",
  "call_ring",
  "call_announce",
  "call_end",
] as const);
export type RoutineBehaviourId = (typeof ROUTINE_BEHAVIOUR_IDS)[number];

export type BehaviourAction = Readonly<{
  /**
   * The contract's own type, imported — NOT a re-listed union of wire values. `contract-use`'s
   * `wire_value_list` rule flags any union or array of two or more string literals under a
   * service `src` tree whose values all belong to one contract list, and the five actions a
   * behaviour can ask for are five members of `CMD_ACTIONS`. `device-action.ts` goes out of its
   * way to avoid that too, and the check is not relaxed for a new declaration (Req 20.4). The
   * gate narrows this to its five allowed actions at request time.
   */
  action: CmdAction;
  /** The command's `data`, complete. Every contract field present. */
  data: Record<string, unknown>;
  /** The text a `say` speaks, for the Output_Guard. null for a non-say action. */
  narration: string | null;
}>;

/** What firing a behaviour did. Declared here, the leaf module, so no importer needs the others. */
export type FireResult = Readonly<{
  actions: number;
  sent: number;
  refused: number;
  /** null when nothing was refused, and null for a SEND failure, which is not a policy refusal. */
  refusal: PolicyRefusal | null;
}>;

/** What a behaviour needs to build its actions. Pure data; no store and no device. */
export type BehaviourContext = Readonly<{
  lang: SupportedLang;
  ageStage: AgeStage;
  /** The row the behaviour is about — a `routine_id` or an `asset_id` — for the log only. */
  refId: string | null;
  /** The day's word for `morning`, or null for the plain greeting. Unused by other behaviours. */
  word: WordEntry | null;
  /** The Grandma recording's title for `grandma_play`; null for every other behaviour. */
  title: string | null;
}>;

// ---------------------------------------------------------------------------------------------
// The payload constants

/** `say.voice` stays `xelulu` for every behaviour, including Grandma playback (C13). */
export const BEHAVIOUR_SAY_VOICE = "xelulu";

/**
 * `duration_hint_ms` from the narration's word count. The Phase 3 `say` uses a flat 2,000 ms; a
 * scheduled narration runs from three words (`tiny`) to about thirty (`maker`), so a per-word
 * figure is the honest hint. 400 ms a word is ordinary speech.
 */
export const SAY_DURATION_MS_PER_WORD = 400;
export const SAY_MIN_DURATION_HINT_MS = 1_000;
/** Bounded already by the Age_Stage word limit (60 at `maker`), so this is a belt, not a brace. */
export const SAY_MAX_DURATION_HINT_MS = 30_000;

export function durationHintMs(narration: string): number {
  const raw = wordCount(narration) * SAY_DURATION_MS_PER_WORD;
  return Math.min(SAY_MAX_DURATION_HINT_MS, Math.max(SAY_MIN_DURATION_HINT_MS, raw));
}

/**
 * `animate.eyes`: the contract's two published values and no others (C42). `eyes` is a `nonEmpty`
 * free string in the schema, so `open`, `smile` or `wide` would validate — and inventing one
 * would create a firmware obligation nobody agreed to. `KNOWN_EYES` itself is not touched.
 */
export const ANIMATE_EYES = Object.freeze({ blink: "blink", hearts: "hearts" } as const);

/**
 * The one "dim" LED payload, named once so no behaviour invents a brightness. `effect` is `solid`
 * — never `rainbow`, and never any flash rate (safety.md §6). 15 % is visible in a dark room
 * without lighting it.
 */
export const LED_DIM = Object.freeze({
  target: "belly",
  color: "#3A2A5A",
  effect: "solid",
  brightness: 15,
} as const);

/** The call's ring. `pulse` is the only non-solid effect this phase uses, at a soft brightness. */
export const LED_RING = Object.freeze({
  target: "ears",
  color: "#6AA9FF",
  effect: "pulse",
  brightness: 40,
} as const);

// ---------------------------------------------------------------------------------------------
// The narrations

/**
 * The Grandma playback narration (Req 8.2, 8.2a, C41). AT `tiny` IT NAMES NO TITLE and is a
 * fixed per-language constant: one sentence of eight words cannot reliably hold a template plus
 * an adult's free-text title, and the alternative — capping a title at four words — would make
 * the feature unusable for the adult writing it. The wider three stages name it.
 *
 * This is also the function the Grandma_Store's write-time title gate runs `checkOutput` over, so
 * a title that cannot be spoken is never stored (Req 7.7a). The operative bound on a title is
 * therefore `little`'s budget — two sentences of twenty words, of which the template spends eight
 * — and NOT `GRANDMA_MAX_TITLE_CODE_POINTS`, which is a structural ceiling.
 */
export function grandmaPlaybackNarration(
  title: string,
  lang: SupportedLang,
  stage: AgeStage,
): string {
  if (lang === "hi-IN") {
    switch (stage) {
      case "tiny":
        return "नानी की कहानी सुनो।";
      case "little":
        return `नानी की कहानी है। यह ${title} है।`;
      case "explorer":
        return `नानी की कहानी है। यह ${title} है। चलो सुनें?`;
      case "maker":
        return `नानी की कहानी है। यह ${title} है। क्या हम अब सुनें?`;
    }
  }
  switch (stage) {
    case "tiny":
      return "Grandma has a story for you.";
    case "little":
      return `Grandma has a story for you. It is ${title}.`;
    case "explorer":
      return `Grandma has a story for you. It is ${title}. Shall we listen?`;
    case "maker":
      return `Grandma has a story for you. It is ${title}. Shall we listen together now?`;
  }
}

/** The Age_Stages whose playback narration names the title. `tiny`'s does not (Req 8.2a). */
export const TITLE_NAMING_STAGES: readonly AgeStage[] = Object.freeze([
  "little",
  "explorer",
  "maker",
]);

/** The call announce (Req 9.5): what the robot says when a Grandma call is accepted. */
export const CALL_ANNOUNCE_NARRATION: Readonly<
  Record<SupportedLang, Readonly<Record<AgeStage, string>>>
> = Object.freeze({
  "en-IN": Object.freeze({
    tiny: "Grandma is here.",
    little: "Grandma is here. Shall we talk?",
    explorer: "Grandma is here. Shall we talk to her now?",
    maker: "Grandma is here. Shall we say hello to her now?",
  }),
  "hi-IN": Object.freeze({
    tiny: "नानी आई हैं।",
    little: "नानी आई हैं। बात करें?",
    explorer: "नानी आई हैं। चलो उनसे बात करें?",
    maker: "नानी आई हैं। क्या हम अब उनसे बात करें?",
  }),
});

// ---------------------------------------------------------------------------------------------
// The table

function sayAction(narration: string, lang: SupportedLang, expression: string): BehaviourAction {
  return {
    action: "say",
    data: {
      expression,
      lang,
      voice: BEHAVIOUR_SAY_VOICE,
      duration_hint_ms: durationHintMs(narration),
    },
    narration,
  };
}

function ledAction(payload: Readonly<Record<string, unknown>>): BehaviourAction {
  return { action: "led", data: { ...payload }, narration: null };
}

/**
 * The ordered actions of a behaviour, in one language, for one Age_Stage. Pure, total, and the
 * only place a behaviour's payload is written.
 */
export function behaviourActions(
  id: RoutineBehaviourId,
  ctx: BehaviourContext,
): readonly BehaviourAction[] {
  switch (id) {
    case "grandma_play": {
      // A missing title would name nothing, so the title-free `tiny` wording stands in. The
      // Grandma_Store never stores a recording without a title, so this is a floor, not a path.
      const narration = grandmaPlaybackNarration(
        ctx.title ?? "",
        ctx.lang,
        ctx.title === null ? "tiny" : ctx.ageStage,
      );
      return [sayAction(narration, ctx.lang, "happy"), ledAction(LED_DIM)];
    }
    case "call_ring":
      return [
        {
          action: "animate",
          data: { expression: "love", eyes: ANIMATE_EYES.hearts, loop: true },
          narration: null,
        },
        ledAction(LED_RING),
      ];
    case "call_announce":
      return [sayAction(CALL_ANNOUNCE_NARRATION[ctx.lang][ctx.ageStage], ctx.lang, "happy")];
    case "call_end":
      return [ledAction(LED_DIM)];
  }
}
