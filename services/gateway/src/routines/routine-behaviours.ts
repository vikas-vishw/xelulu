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
// WHAT IS HERE. The six routine behaviours, the Nap_Sequence, the two charge reminders, the
// Grandma playback and the three call behaviours: every behaviour this phase can fire, in one
// table. The playback narration is also the function the Grandma_Store's write-time title gate
// runs (Req 7.7a), so it has to be the same one playback speaks.
import {
  type AgeStage,
  type CmdAction,
  type PolicyRefusal,
  type SupportedLang,
  type WordEntry,
} from "@xelulu/shared";

import { wordCount } from "../brain/safety/age-shape.js";
import { morningGreeting, wordNarration } from "../brain/story/word-of-the-day.js";

/** The behaviours this phase can fire. Extended, never renumbered. */
export const ROUTINE_BEHAVIOUR_IDS = Object.freeze([
  "morning",
  "brushing",
  "meals",
  "play_time",
  "wind_down",
  "bedtime",
  "nap",
  "battery_20",
  "battery_10",
  "grandma_play",
  "call_ring",
  "call_announce",
  "call_end",
] as const);
export type RoutineBehaviourId = (typeof ROUTINE_BEHAVIOUR_IDS)[number];

/**
 * The behaviours whose `say` reads a fixed template from the table below. `morning` is NOT one of
 * them: its narration is the Word_Of_The_Day's, or the Requirement 5.4b greeting when the day's
 * word is not available to this child — and the Grandma playback and the call announce build
 * theirs from their own functions.
 */
type NarratedBehaviourId =
  | "brushing"
  | "meals"
  | "play_time"
  | "wind_down"
  | "bedtime"
  | "nap"
  | "battery_20"
  | "battery_10";

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

/** A warm `solid` for a routine that is not about sleep. */
export const LED_WARM = Object.freeze({
  target: "cheeks",
  color: "#FFB36A",
  effect: "solid",
  brightness: 35,
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

/**
 * The fixed narration of every templated behaviour, per language AND per Age_Stage (Req 10.8,
 * 11.5, 13.3). One string cannot be inside `tiny`'s one sentence of eight words and still be
 * useful at `maker`, so each cell is written for the stage it is spoken at, and the tests measure
 * every one of the sixty-four with `checkOutput` at exactly that stage.
 *
 * None of them names a number, a brand, a price or a URL, and none uses a word on the
 * Output_Guard's romantic, frightening, medical, legal or financial lists — so the robot asks for
 * a charge rather than saying it is ill, and bedtime is a hum rather than a nightmare.
 */
const BEHAVIOUR_NARRATIONS: Readonly<
  Record<NarratedBehaviourId, Readonly<Record<SupportedLang, Readonly<Record<AgeStage, string>>>>>
> = Object.freeze({
  brushing: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "Time to brush your teeth.",
      little: "Time to brush your teeth. Shall we do it together?",
      explorer: "Time to brush your teeth. Up and down, then round and round. Shall we start?",
      maker:
        "Time to brush your teeth. Up and down, then round and round, top and bottom. Can you finish before I stop humming?",
    }),
    "hi-IN": Object.freeze({
      tiny: "दाँत साफ़ करने का समय है।",
      little: "दाँत साफ़ करने का समय है। चलो साथ करें?",
      explorer: "दाँत साफ़ करने का समय है। ऊपर नीचे, फिर गोल गोल। चलो शुरू करें?",
      maker:
        "दाँत साफ़ करने का समय है। ऊपर नीचे, फिर गोल गोल, ऊपर और नीचे। मेरे गुनगुनाने तक पूरा कर पाओगे?",
    }),
  }),
  meals: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "It is time to eat.",
      little: "It is time to eat. Shall we wash our hands first?",
      explorer: "It is time to eat. Let us wash our hands first. What is on your plate today?",
      maker:
        "It is time to eat. Let us wash our hands first. Tell me one thing on your plate that grew in the ground.",
    }),
    "hi-IN": Object.freeze({
      tiny: "खाने का समय है।",
      little: "खाने का समय है। पहले हाथ धो लें?",
      explorer: "खाने का समय है। पहले हाथ धो लें। आज थाली में क्या है?",
      maker: "खाने का समय है। पहले हाथ धो लें। मुझे थाली की एक चीज़ बताओ जो ज़मीन में उगी हो।",
    }),
  }),
  play_time: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "It is play time now.",
      little: "It is play time now. What shall we play?",
      explorer: "It is play time now. We can dance or hunt for colours. What shall we play first?",
      maker:
        "It is play time now. We can dance, hunt for colours or make up a new game. What shall we try first?",
    }),
    "hi-IN": Object.freeze({
      tiny: "खेलने का समय है।",
      little: "खेलने का समय है। क्या खेलें?",
      explorer: "खेलने का समय है। हम नाच सकते हैं या रंग खोज सकते हैं। पहले क्या खेलें?",
      maker:
        "खेलने का समय है। हम नाच सकते हैं, रंग खोज सकते हैं या नया खेल बना सकते हैं। पहले क्या करें?",
    }),
  }),
  wind_down: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "It is quiet time now.",
      little: "It is quiet time now. Shall we breathe slowly together?",
      explorer:
        "It is quiet time now. Let us breathe slowly together. Shall the toys go in their basket?",
      maker:
        "It is quiet time now. Let us breathe slowly together. Shall we put the toys away and pick one calm story?",
    }),
    "hi-IN": Object.freeze({
      tiny: "शांत समय है।",
      little: "शांत समय है। चलो धीरे धीरे साँस लें?",
      explorer: "शांत समय है। चलो धीरे धीरे साँस लें। खिलौने टोकरी में रख दें?",
      maker: "शांत समय है। चलो धीरे धीरे साँस लें। खिलौने रख दें और एक शांत कहानी चुनें?",
    }),
  }),
  bedtime: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "It is bedtime now.",
      little: "It is bedtime now. Shall I hum a soft tune?",
      explorer: "It is bedtime now. I will hum a soft tune. Close your eyes and listen?",
      maker:
        "It is bedtime now. I will hum a soft tune while you settle. Close your eyes and tell me one happy thing from today?",
    }),
    "hi-IN": Object.freeze({
      tiny: "सोने का समय है।",
      little: "सोने का समय है। एक धीमी धुन गुनगुनाऊँ?",
      explorer: "सोने का समय है। मैं एक धीमी धुन गुनगुनाऊँगा। आँखें बंद करके सुनोगे?",
      maker:
        "सोने का समय है। मैं एक धीमी धुन गुनगुनाऊँगा। आँखें बंद करो और आज की एक अच्छी बात बताओ?",
    }),
  }),
  nap: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "Let us rest now.",
      little: "Let us rest now. I will be here when you wake.",
      explorer: "Let us rest now. Play time is over for today. I will be here when you wake.",
      maker:
        "Let us rest now. Play time is over for today. I will be right here when you want to play again.",
    }),
    "hi-IN": Object.freeze({
      tiny: "अब आराम करें।",
      little: "अब आराम करें। मैं यहीं रहूँगा।",
      explorer: "अब आराम करें। आज का खेल पूरा हुआ। मैं यहीं रहूँगा।",
      maker: "अब आराम करें। आज का खेल पूरा हुआ। जब फिर खेलना हो, मैं यहीं रहूँगा।",
    }),
  }),
  battery_20: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "I need a little charge.",
      little: "I need a little charge soon. Can you plug me in?",
      explorer: "I need a little charge soon. My power is getting low. Can you plug me in?",
      maker:
        "I need a little charge soon. My power is getting low, and I would like to keep playing. Can you plug me in?",
    }),
    "hi-IN": Object.freeze({
      tiny: "मुझे थोड़ा चार्ज चाहिए।",
      little: "मुझे थोड़ा चार्ज चाहिए। मुझे प्लग में लगा दोगे?",
      explorer: "मुझे थोड़ा चार्ज चाहिए। मेरी शक्ति कम हो रही है। मुझे प्लग में लगा दोगे?",
      maker:
        "मुझे थोड़ा चार्ज चाहिए। मेरी शक्ति कम हो रही है और मैं खेलते रहना चाहता हूँ। मुझे प्लग में लगा दोगे?",
    }),
  }),
  battery_10: Object.freeze({
    "en-IN": Object.freeze({
      tiny: "I am very sleepy now.",
      little: "I am very sleepy now. Please plug me in.",
      explorer: "I am very sleepy now. My power is almost gone. Please plug me in?",
      maker:
        "I am very sleepy now. My power is almost gone, so I will rest soon. Please plug me in?",
    }),
    "hi-IN": Object.freeze({
      tiny: "मुझे बहुत नींद आ रही है।",
      little: "मुझे बहुत नींद आ रही है। कृपया मुझे प्लग में लगा दो।",
      explorer: "मुझे बहुत नींद आ रही है। मेरी शक्ति लगभग खत्म है। कृपया मुझे प्लग में लगा दो।",
      maker:
        "मुझे बहुत नींद आ रही है। मेरी शक्ति लगभग खत्म है, इसलिए मैं जल्दी आराम करूँगा। कृपया मुझे प्लग में लगा दो।",
    }),
  }),
});

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

function animateAction(expression: string, eyes: string, loop: boolean): BehaviourAction {
  return { action: "animate", data: { expression, eyes, loop }, narration: null };
}

/**
 * The only two gestures of the phase: `morning`'s wave and `battery_20`'s nod (C37). They exist
 * so Requirement 12.7's movement-off case has something real to refuse for a routine AND for a
 * charge reminder; the gate keys on the ACTION and not on the name.
 */
function gestureAction(name: string): BehaviourAction {
  return { action: "gesture", data: { name }, narration: null };
}

/**
 * `morning`'s narration IS the Word_Of_The_Day's, at every stage — no greeting precedes it,
 * because `tiny` has room for one sentence of eight words and cannot be both (Req 5.4). A null
 * `word` is the single signal for the Requirement 5.4b greeting, and it covers both of that
 * case's causes: no entry carries the Child_Context's first language, or the parent has not
 * opened the `world` category (C38). The Routine_Scheduler resolves both before it calls here.
 */
function morningNarration(ctx: BehaviourContext): string {
  return ctx.word === null
    ? morningGreeting(ctx.lang, ctx.ageStage)
    : wordNarration(ctx.word, ctx.lang, ctx.ageStage);
}

/** The fixed template for a behaviour that has one, for this language and Age_Stage. */
function templated(id: NarratedBehaviourId, ctx: BehaviourContext): string {
  return BEHAVIOUR_NARRATIONS[id][ctx.lang][ctx.ageStage];
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
    case "morning": {
      const narration = morningNarration(ctx);
      return [
        sayAction(narration, ctx.lang, "happy"),
        animateAction("happy", ANIMATE_EYES.blink, false),
        gestureAction("wave"),
        ledAction(LED_WARM),
      ];
    }
    case "brushing":
      return [
        sayAction(templated(id, ctx), ctx.lang, "happy"),
        animateAction("happy", ANIMATE_EYES.blink, true),
      ];
    case "meals":
      return [sayAction(templated(id, ctx), ctx.lang, "happy"), ledAction(LED_WARM)];
    case "play_time":
      return [
        sayAction(templated(id, ctx), ctx.lang, "happy"),
        animateAction("happy", ANIMATE_EYES.blink, true),
        ledAction(LED_WARM),
      ];
    case "wind_down":
      return [
        sayAction(templated(id, ctx), ctx.lang, "sleepy"),
        animateAction("sleepy", ANIMATE_EYES.blink, true),
        ledAction(LED_DIM),
      ];
    case "bedtime":
    case "nap":
      return [
        sayAction(templated(id, ctx), ctx.lang, "sleepy"),
        animateAction("sleepy", ANIMATE_EYES.blink, false),
        ledAction(LED_DIM),
      ];
    case "battery_20":
      return [
        sayAction(templated(id, ctx), ctx.lang, "happy"),
        // The one movement-bearing action a charge reminder carries (C37, Req 11.5).
        gestureAction("nod"),
        ledAction({ target: "belly", color: "#FFB36A", effect: "solid", brightness: 35 }),
      ];
    case "battery_10":
      // No `gesture`: a nearly flat robot is never asked to move (Req 11.5).
      return [
        sayAction(templated(id, ctx), ctx.lang, "sleepy"),
        ledAction({ target: "belly", color: "#FF8A6A", effect: "solid", brightness: 25 }),
      ];
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

/**
 * The context the action COUNT is measured in. A behaviour's action list has the same length in
 * every language and at every Age_Stage — only the narration text differs — so one fixed context
 * answers the question the console asks: how many actions a firing's `sent` should be read
 * against (Req 16.5). A null title gives `grandma_play` its title-free wording, which is the same
 * two actions.
 */
const COUNT_CONTEXT: BehaviourContext = Object.freeze({
  lang: "en-IN",
  ageStage: "little",
  refId: null,
  word: null,
  title: null,
});

/** How many actions a behaviour sends when nothing refuses it. Pure, total, no state. */
export function behaviourActionCount(id: RoutineBehaviourId): number {
  return behaviourActions(id, COUNT_CONTEXT).length;
}
