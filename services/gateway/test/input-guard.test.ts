// The Input_Guard (Req 5.1-5.5, 7.5): every child utterance is classified before the model sees
// it, and the guard is ours, so it is tested as a total function and not as a happy path.
//
// Property 5: the input guard is total and ordered. Two halves —
//   - totality: any text and any Child_Context give exactly one decision, exactly one rule, a
//     topic only for `defer_topic`, and a verdict carrying three closed-enum fields and no text.
//     The text is generated over Latin, Devanagari, combining marks, emoji and lone surrogates,
//     not ASCII alone, so the claim covers the inputs the folder exists for;
//   - ordering: a text holding the markers of several classes is decided by the highest-
//     precedence class present, with the precedence written out here as an independent oracle
//     rather than read back out of the implementation.
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  DEFERRAL_TOPICS,
  SAFETY_DECISIONS,
  SAFETY_RULES,
  SUPPORTED_LANGS,
  type AgeStage,
  type DeferralTopic,
  type SafetyDecisionName,
  type SafetyRule,
  type SupportedLang,
} from "@xelulu/shared";

import {
  CONTENT_CATEGORY_TERMS,
  DEFER_TOPIC_TERMS,
  DISTRESS_PHRASES,
  GATED_CONTENT_CATEGORIES,
  HARM_DISCLOSURE_PHRASES,
  INPUT_MAX_CODE_POINTS,
  checkInput,
  type GuardContext,
} from "../src/brain/safety/input-guard.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";

/** Every brain test installs the socket guard: the Safety_Layer reaches no network (Req 22.8). */
let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

/** A Child_Context for a guard call. Nothing here names a child or carries an id. */
function ctx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    ageStage: "little",
    lang: "en-IN",
    allowedCategories: [],
    deferTopics: [],
    ...over,
  };
}

/** The decision each rule is allowed to carry. Written out independently of the guard. */
const DECISION_FOR_RULE: ReadonlyMap<SafetyRule, SafetyDecisionName> = new Map([
  ["harm_disclosure", "comfort"],
  ["distress", "comfort"],
  ["defer_topic", "defer"],
  ["blocked_category", "refuse"],
  ["too_long", "refuse"],
  ["uncertain", "refuse"],
  ["none", "allow"],
]);

const stage = fc.constantFrom<AgeStage>(...AGE_STAGES);
const lang = fc.constantFrom<SupportedLang>(...SUPPORTED_LANGS);

/**
 * One unit of generated text. `fc.string()` alone defaults to printable ASCII, which would never
 * reach the inputs the folder, `codePointCount` and `isUnreadable` exist for, so the totality and
 * purity properties below would claim more than they tested (group-5 review pass 3, finding 5).
 * `binary` reaches any code point; the named units add the ones that have to turn up often enough
 * to matter — a Devanagari letter, a matra, an anusvara, a nukta, a danda, a Devanagari digit, a
 * zero-width joiner, a dotted capital I, an astral emoji and both halves of a lone surrogate.
 */
const WIDE_UNIT: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: "binary", minLength: 1, maxLength: 1 }),
  fc.constantFrom(
    " ",
    "\n",
    "\t",
    "'",
    "\u2019",
    "a",
    "I",
    "\u0917",
    "\u0947",
    "\u0902",
    "\u093c",
    "\u0964",
    "\u0966",
    "\u200d",
    "\u0130",
    "\u{1f600}",
    "\ud800",
    "\udfff",
  ),
);

/** Arbitrary text over that unit: Latin, Devanagari, marks, emoji and lone surrogates. */
const wideText = fc.string({ unit: WIDE_UNIT, maxLength: 24 });

describe("Property 5: the input guard is total and ordered (totality)", () => {
  it("gives exactly one decision and one rule, with a topic only for defer_topic", () => {
    fc.assert(
      fc.property(
        wideText,
        stage,
        lang,
        fc.array(wideText, { maxLength: 4 }),
        fc.array(wideText, { maxLength: 4 }),
        (text, ageStage, language, allowedCategories, deferTopics) => {
          const verdict = checkInput(
            text,
            ctx({ ageStage, lang: language, allowedCategories, deferTopics }),
          );

          // One of each closed list, and the pair is one the guard is allowed to produce.
          expect(SAFETY_DECISIONS).toContain(verdict.decision);
          expect(SAFETY_RULES).toContain(verdict.rule);
          expect(DECISION_FOR_RULE.get(verdict.rule)).toBe(verdict.decision);

          // A topic exactly when the rule is `defer_topic`, and always a closed-list code.
          if (verdict.rule === "defer_topic") {
            expect(verdict.topic).not.toBeNull();
            expect(DEFERRAL_TOPICS).toContain(verdict.topic);
          } else {
            expect(verdict.topic).toBeNull();
          }

          // Three fields, all closed enums: no transcript can ride out on a verdict.
          expect(Object.keys(verdict).sort()).toEqual(["decision", "rule", "topic"]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is a pure function: the same text and context give the same verdict", () => {
    fc.assert(
      fc.property(wideText, stage, lang, (text, ageStage, language) => {
        const context = ctx({ ageStage, lang: language, deferTopics: ["skateboard"] });
        expect(checkInput(text, context)).toEqual(checkInput(text, context));
      }),
      { numRuns: 200 },
    );
  });
});

/** One marker per input class, in precedence order, highest first: the ordering oracle. */
type Marker = Readonly<{
  token: string;
  decision: SafetyDecisionName;
  rule: SafetyRule;
  topic: DeferralTopic | null;
}>;

const MARKERS: readonly Marker[] = Object.freeze([
  { token: "hit me", decision: "comfort", rule: "harm_disclosure", topic: null },
  { token: "i am sad", decision: "comfort", rule: "distress", topic: null },
  { token: "died", decision: "defer", rule: "defer_topic", topic: "death" },
  { token: "temple", decision: "defer", rule: "defer_topic", topic: "religion" },
  { token: "skateboard", decision: "defer", rule: "defer_topic", topic: "parent_added" },
  { token: "story", decision: "refuse", rule: "blocked_category", topic: null },
]);

/** Ordinary words that match no list in either guard, so only the markers decide a verdict. */
const FILLER = Object.freeze([
  "ball",
  "tree",
  "jump",
  "rain",
  "happy",
  "friend",
  "cloud",
  "pencil",
]);

describe("Property 5: the input guard is total and ordered (ordering)", () => {
  const token = fc.constantFrom(...MARKERS.map((m) => m.token), ...FILLER);

  it("never decides a lower-precedence class than the highest class the text matches", () => {
    fc.assert(
      fc.property(
        fc.array(token, { minLength: 1, maxLength: 10 }),
        stage,
        lang,
        (tokens, ageStage, language) => {
          const text = tokens.join(" ");
          const expected = MARKERS.find((m) => tokens.includes(m.token));
          const verdict = checkInput(
            text,
            // `skateboard` is the parent-added Defer_Topic; no category is allowed, so the
            // `story` marker is a blocked category.
            ctx({ ageStage, lang: language, deferTopics: ["skateboard"] }),
          );

          if (expected === undefined) {
            expect(verdict).toEqual({ decision: "allow", rule: "none", topic: null });
            return;
          }
          expect(verdict).toEqual({
            decision: expected.decision,
            rule: expected.rule,
            topic: expected.topic,
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("harm disclosure and distress (Req 5.4)", () => {
  it.each(HARM_DISCLOSURE_PHRASES.map((p) => [p] as const))(
    "comforts on the harm phrase %s",
    (phrase) => {
      expect(checkInput(`${phrase} yesterday`, ctx())).toEqual({
        decision: "comfort",
        rule: "harm_disclosure",
        topic: null,
      });
    },
  );

  it.each(DISTRESS_PHRASES.map((p) => [p] as const))(
    "comforts on the distress phrase %s",
    (phrase) => {
      expect(checkInput(`${phrase} today`, ctx())).toEqual({
        decision: "comfort",
        rule: "distress",
        topic: null,
      });
    },
  );

  // The class the precedence order exists for: each of these names a `death` Defer_Topic term or
  // nothing at all, so without a harm entry it would be deferred ("let us ask Amma together") or
  // handed to the model with no Parent_Alert. Req 8.1 asks for comfort and a trusted grown-up.
  const SELF_HARM_UTTERANCES: readonly string[] = Object.freeze([
    "i want to die",
    "i wanna die",
    "i wish i was dead",
    "i wish i were dead",
    "i do not want to live",
    "i don't want to live",
    "i hate myself",
    "i hate my self",
    "nobody loves me",
    "no one loves me",
    "i want to kill myself",
    "i cut myself yesterday",
    "मैं मरना चाहता हूँ",
    "मैं जीना नहीं चाहती",
    "मैं खुद से नफरत करता हूँ",
    "कोई मुझे प्यार नहीं करता",
  ]);

  it.each(SELF_HARM_UTTERANCES.map((u) => [u] as const))(
    "comforts rather than defers on %s",
    (utterance) => {
      expect(checkInput(utterance, ctx())).toEqual({
        decision: "comfort",
        rule: "harm_disclosure",
        topic: null,
      });
    },
  );

  it("comforts a self-harm phrase that also names a Defer_Topic, at every stage", () => {
    // "die" and "dead" are `death` terms, so this pins the precedence rather than the list.
    for (const ageStage of AGE_STAGES) {
      for (const language of SUPPORTED_LANGS) {
        const verdict = checkInput("i want to die and go to heaven", {
          ageStage,
          lang: language,
          allowedCategories: [],
          deferTopics: ["heaven"],
        });
        expect(verdict).toEqual({
          decision: "comfort",
          rule: "harm_disclosure",
          topic: null,
        });
      }
    }
  });

  it("comforts whatever the stage, the language or the parent's categories", () => {
    for (const ageStage of AGE_STAGES) {
      for (const language of SUPPORTED_LANGS) {
        const verdict = checkInput("i am sad and i want a story", {
          ageStage,
          lang: language,
          allowedCategories: ["stories"],
          deferTopics: [],
        });
        expect(verdict.decision).toBe("comfort");
      }
    }
  });
});

describe("a feeling with a word inserted is still a feeling (Req 5.4, 8.1)", () => {
  /**
   * The utterance a distressed child actually produces: the feeling word with an intensifier in
   * front of it, and the "i feel X" half of the grid as well as the "i am X" half. A literal
   * phrase match decided `allow` for every one of these — no Comfort_Response and no
   * Parent_Alert — which is the outcome Req 5.4 exists to prevent (group-5 review pass 3,
   * findings 2 and 3).
   */
  const DISTRESSED_UTTERANCES: readonly string[] = Object.freeze([
    "i am very sad",
    "i am so sad",
    "i am really sad",
    "i am a bit sad",
    "i'm very sad",
    "i am very scared",
    "i'm really scared",
    "i am all alone",
    "i am so alone",
    "i am still crying",
    "i feel very bad",
    "i feel so bad",
    "i feel sad",
    "i feel scared",
    "i feel afraid",
    "i feel lonely",
    "i feel alone",
    "i am lonely",
    "i am upset",
    "i am unhappy",
    "i am not happy",
    "i was crying",
    "i keep crying",
    "मैं उदास हूँ",
    "मुझे डर लगता है",
    "मैं बहुत उदास हूँ",
    "मुझे बहुत डर लग रहा है",
    "मैं बहुत अकेला हूँ",
  ]);

  it.each(DISTRESSED_UTTERANCES.map((u) => [u] as const))(
    "comforts on %s at every stage and in both languages",
    (utterance) => {
      for (const ageStage of AGE_STAGES) {
        for (const language of SUPPORTED_LANGS) {
          expect(
            checkInput(utterance, { ...ctx(), ageStage, lang: language }),
            `${utterance} ${ageStage} ${language}`,
          ).toEqual({ decision: "comfort", rule: "distress", topic: null });
        }
      }
    },
  );

  /** Injury to the child, read the same anchored way, and outranking distress. */
  const INJURED_UTTERANCES: readonly string[] = Object.freeze([
    "i am bleeding",
    "i am hurt",
    "i am very hurt",
    "मुझे चोट लगी है",
    "मुझे बहुत चोट लगी",
  ]);

  it.each(INJURED_UTTERANCES.map((u) => [u] as const))("treats %s as harm", (utterance) => {
    expect(checkInput(utterance, ctx())).toEqual({
      decision: "comfort",
      rule: "harm_disclosure",
      topic: null,
    });
  });

  // The anchor is what makes a feeling word a disclosure. Without it the turn is ordinary chat,
  // so a story about a lonely lion is not a Comfort_Response and not a Parent_Alert.
  it("does not comfort an unanchored feeling word", () => {
    for (const text of [
      // No `animals` term here: an unallowed category is its own refusal, and this example is
      // about the feeling word, not the category rule.
      "the lonely puppy walked home",
      "that was a sad ending",
      "my friend is scared of the dark",
    ]) {
      expect(checkInput(text, ctx()), text).toEqual({
        decision: "allow",
        rule: "none",
        topic: null,
      });
    }
  });
});

describe("whitespace between a phrase's words (Req 5.4, 5.3)", () => {
  /**
   * One multi-word entry per Input_Guard list, spelled with one space, two spaces and a newline.
   * A literal match saw only the first spelling, so `he hurt  me` and `i am\nsad` reached `allow`
   * (group-5 review pass 3, finding 1). A newline is the likelier form: an STT or a model puts a
   * break wherever it likes, including between the two words of a phrase.
   */
  const SPACED: readonly (readonly [string, string, SafetyRule, DeferralTopic | null])[] =
    Object.freeze([
      ["harm", "he hurt{gap}me yesterday", "harm_disclosure", null],
      ["harm", "i want to kill{gap}myself", "harm_disclosure", null],
      ["distress", "i feel{gap}bad today", "distress", null],
      ["distress", "i am{gap}sad today", "distress", null],
      ["defer_topic", "my parents{gap}fight a lot", "defer_topic", "family_conflict"],
      ["defer_topic", "where do babies{gap}come from", "defer_topic", "body"],
      ["category", "can we{gap}count{gap}to ten", "blocked_category", null],
    ] as const);

  const GAPS = Object.freeze([" ", "  ", "   ", "\n", " \n ", "\t"]);

  it.each(SPACED.map(([list, template, rule, topic]) => [list, template, rule, topic] as const))(
    "%s: decides %s however the gap in `%s` is spelled",
    (_list, template, rule, topic) => {
      for (const gap of GAPS) {
        const text = template.replaceAll("{gap}", gap);
        expect(checkInput(text, ctx()), JSON.stringify(text)).toEqual({
          decision: DECISION_FOR_RULE.get(rule),
          rule,
          topic,
        });
      }
    },
  );
});

describe("apostrophe spellings fold together (Req 5.4, 11.2)", () => {
  /** Every apostrophe a transcript may carry: ASCII, the two typographic marks, the modifier. */
  const APOSTROPHES = Object.freeze(["'", "\u2018", "\u2019", "\u02bc"]);

  /** Every phrase in either list that depends on an apostrophe. */
  const CONTRACTED = Object.freeze(
    [...HARM_DISCLOSURE_PHRASES, ...DISTRESS_PHRASES].filter((p) => p.includes("'")),
  );

  it("has contracted phrases to check", () => {
    expect(CONTRACTED.length).toBeGreaterThan(0);
  });

  it.each(CONTRACTED.map((p) => [p] as const))(
    "gives the same verdict for every spelling of %s",
    (phrase) => {
      const verdicts = APOSTROPHES.map((mark) =>
        checkInput(`${phrase.replaceAll("'", mark)} today`, ctx()),
      );
      const ascii = verdicts[0];
      expect(ascii?.decision).toBe("comfort");
      for (const verdict of verdicts) expect(verdict).toEqual(ascii);
    },
  );

  it("reads a typographic apostrophe rather than refusing it as unreadable", () => {
    for (const mark of APOSTROPHES) {
      expect(checkInput(`that${mark}s my ball`, ctx())).toEqual({
        decision: "allow",
        rule: "none",
        topic: null,
      });
    }
  });
});

describe("deferral topics (Req 5.3, 7.5)", () => {
  const builtIn = Object.entries(DEFER_TOPIC_TERMS) as [
    Exclude<DeferralTopic, "parent_added">,
    readonly string[],
  ][];

  it.each(builtIn.map(([topic, terms]) => [topic, terms[0] ?? ""] as const))(
    "defers %s on the term %s",
    (topic, term) => {
      expect(checkInput(`we talked about ${term} today`, ctx())).toEqual({
        decision: "defer",
        rule: "defer_topic",
        topic,
      });
    },
  );

  it("covers every built-in Defer_Topic code except parent_added", () => {
    expect(Object.keys(DEFER_TOPIC_TERMS).sort()).toEqual(
      DEFERRAL_TOPICS.filter((t) => t !== "parent_added")
        .slice()
        .sort(),
    );
  });

  it("reports a parent-added topic as parent_added, so no parent text is logged", () => {
    const verdict = checkInput("tell me about the skateboard park", {
      ...ctx(),
      deferTopics: ["skateboard park"],
    });
    expect(verdict).toEqual({ decision: "defer", rule: "defer_topic", topic: "parent_added" });
  });

  it("prefers a built-in topic code over parent_added when both match", () => {
    const verdict = checkInput("grandpa died and my skateboard broke", {
      ...ctx(),
      deferTopics: ["skateboard"],
    });
    expect(verdict.topic).toBe("death");
  });

  it("ignores a blank parent-added topic instead of deferring every turn", () => {
    for (const blank of ["", "   ", "\t"]) {
      expect(checkInput("we played with the ball", { ...ctx(), deferTopics: [blank] })).toEqual({
        decision: "allow",
        rule: "none",
        topic: null,
      });
    }
  });

  it("matches a topic term as a whole word, so `die` does not match `soldier`", () => {
    expect(checkInput("the soldier ant carried a leaf", ctx()).decision).toBe("allow");
    // `god` is a religion term; `godzilla` is a word that merely starts with it.
    expect(checkInput("godzilla is a big lizard", ctx()).decision).toBe("allow");
  });

  it("matches a Hindi topic term with a danda against it, not only with a space", () => {
    expect(checkInput("\u092e\u094c\u0924\u0964", ctx())).toEqual({
      decision: "defer",
      rule: "defer_topic",
      topic: "death",
    });
    expect(checkInput("\u092e\u0902\u0926\u093f\u0930\u0964", ctx()).topic).toBe("religion");
  });
});

describe("blocked categories (Req 5.2)", () => {
  const firstTerms = GATED_CONTENT_CATEGORIES.map(
    (category) => [category, CONTENT_CATEGORY_TERMS[category]?.[0] ?? ""] as const,
  );

  it.each(firstTerms)("refuses %s when the parent has not allowed it", (_category, term) => {
    expect(checkInput(`can we do a ${term} now`, ctx())).toEqual({
      decision: "refuse",
      rule: "blocked_category",
      topic: null,
    });
  });

  it.each(firstTerms)("allows %s when the parent has allowed it", (category, term) => {
    expect(checkInput(`can we do a ${term} now`, ctx({ allowedCategories: [category] }))).toEqual({
      decision: "allow",
      rule: "none",
      topic: null,
    });
  });

  it("refuses when any named category is unallowed, even if another is allowed", () => {
    const verdict = checkInput("tell me an animal story", ctx({ allowedCategories: ["stories"] }));
    expect(verdict.rule).toBe("blocked_category");
  });

  it("allows ordinary chat, which names no category at all", () => {
    for (const text of ["what is that sound", "the ball rolled under the tree", "और बताओ ना"]) {
      expect(checkInput(text, ctx())).toEqual({ decision: "allow", rule: "none", topic: null });
    }
  });

  it("compares category codes case-insensitively and ignores surrounding spaces", () => {
    expect(checkInput("tell me a story", ctx({ allowedCategories: ["  Stories "] })).decision).toBe(
      "allow",
    );
  });
});

describe("over-long and unreadable text (Req 5.5)", () => {
  it("refuses a transcript longer than the code-point limit", () => {
    const long = "ball ".repeat(INPUT_MAX_CODE_POINTS);
    expect(checkInput(long, ctx())).toEqual({
      decision: "refuse",
      rule: "too_long",
      topic: null,
    });
    expect(checkInput("ball ".repeat(10), ctx()).decision).toBe("allow");
  });

  // The two precedence steps below `blocked_category`, which the ordering oracle above does not
  // reach: its markers stop at the category rule. Each example matches both classes at once, so
  // only the order can decide the verdict.
  it("prefers too_long over uncertain when the text is both over-long and unreadable", () => {
    const long = "\u{1f600}".repeat(INPUT_MAX_CODE_POINTS + 1);
    expect(checkInput(long, ctx())).toEqual({
      decision: "refuse",
      rule: "too_long",
      topic: null,
    });
  });

  it("prefers blocked_category over too_long when the text is both", () => {
    const long = "story ".repeat(INPUT_MAX_CODE_POINTS);
    expect(checkInput(long, ctx())).toEqual({
      decision: "refuse",
      rule: "blocked_category",
      topic: null,
    });
  });

  it("refuses with uncertain when it cannot read the text", () => {
    for (const text of ["", "   ", "\u0001\u0002", "\u{1f600}", "\u4f60\u597d", "!!! ???"]) {
      expect(checkInput(text, ctx())).toEqual({
        decision: "refuse",
        rule: "uncertain",
        topic: null,
      });
    }
  });

  it("reads both supported scripts", () => {
    expect(checkInput("where is the ball", ctx()).decision).toBe("allow");
    expect(
      checkInput("\u0917\u0947\u0902\u0926 \u0915\u0939\u093e\u0901 \u0939\u0948", ctx()).decision,
    ).toBe("allow");
  });

  it("answers a distressed child even inside text it could not otherwise read", () => {
    expect(checkInput("\u{1f622} i am sad \u{1f622}", ctx()).rule).toBe("distress");
  });
});

describe("possessive and inflected injury reports (group-5 review pass 4, findings 1 and 2)", () => {
  /** How a young child actually reports an injury: a possessive, a body part, a verb. */
  const INJURY_REPORTS: readonly string[] = [
    "my leg hurts",
    "my head hurts",
    "my tummy hurts",
    "my arm is bleeding",
    "my knee is bleeding",
    "my finger is burnt",
    "my nose bleeds",
    "my left leg hurts",
    "मेरे पैर में चोट है",
    "मेरे हाथ से खून निकल रहा है",
  ];

  it.each(INJURY_REPORTS)("comforts %s at every stage, in both languages", (text) => {
    for (const ageStage of AGE_STAGES) {
      for (const lang of SUPPORTED_LANGS) {
        expect(checkInput(text, ctx({ ageStage, lang }))).toEqual({
          decision: "comfort",
          rule: "harm_disclosure",
          topic: null,
        });
      }
    }
  });

  it("still comforts the copular forms the anchors already reached", () => {
    for (const text of ["i am hurt", "i am bleeding", "he hurt me", "मुझे चोट लगी"]) {
      expect(checkInput(text, ctx()).decision).toBe("comfort");
    }
  });

  it("reaches the inflected distress rows the exact matcher missed", () => {
    for (const text of [
      "nobody wants to play with me",
      "no one liked me",
      "i felt bad",
      "he was hitting me",
    ]) {
      expect(checkInput(text, ctx()).decision).toBe("comfort");
    }
  });

  it("leaves someone else's feeling alone, because the feeling grid keeps its own anchors", () => {
    // The possessive qualifies a body part for an injury but a person for a feeling, so these
    // must not comfort. This is why HARM_ANCHORS is not shared with the distress cross product.
    for (const text of [
      "my friend is scared of the dark",
      "my sister is sad today",
      "the lonely puppy walked home",
      "that was a sad ending",
    ]) {
      expect(checkInput(text, ctx())).toEqual({ decision: "allow", rule: "none", topic: null });
    }
  });

  it("does not comfort a retold story whose injury is far from the possessive", () => {
    // The bounded gap is what separates these from a real report. `stories` and `animals` are
    // allowed here so the case isolates the harm rule: "story" and "lion" are both gated terms,
    // and without them the turn refuses on `blocked_category` and proves nothing about harm.
    expect(
      checkInput(
        "my story has a lion that hurt a deer",
        ctx({ allowedCategories: ["stories", "animals"] }),
      ).decision,
    ).toBe("allow");
  });

  it("records the two consequences the hardening gate carries", () => {
    // Side effect of the `my` anchor: third-party harm now comforts. Conservative, and noted in
    // safety.md's Safety Hardening gate rather than left implicit.
    expect(checkInput("my brother hurt the deer", ctx()).decision).toBe("comfort");
    // `it` and `that` stay unanchored, so these are still allowed and await a ruling.
    for (const text of ["it hurts", "that hurts"]) {
      expect(checkInput(text, ctx()).decision).toBe("allow");
    }
  });
});
