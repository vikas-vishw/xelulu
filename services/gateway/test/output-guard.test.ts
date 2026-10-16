// The Output_Guard (Req 6.1-6.4, 6.7, 10.2, 11.6): every reply is checked after the model and
// before text-to-speech, so nothing unsafe is spoken even when the provider misbehaves.
//
// Property 4: every spoken text fits the age stage and passes the output guard. Each
// Safe_Redirect, Deferral, Comfort and Filler constant is within its stage's sentence and word
// limits and is allowed by the guard, so a refusal can always be answered with something sayable.
//
// Property 6: no forbidden span is ever spoken. A URL, a phone-like number, a price or a brand
// injected at any word position is refused with the matching rule, the verdict carries no part of
// the span, and the Safe_Redirect spoken in its place carries none of it either. The pipeline half
// of Property 6 — no span in a frame, a Log_Entry or a Conversation_Turn_View — belongs to the
// Turn_Pipeline's own test.
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  SAFETY_RULES,
  SUPPORTED_LANGS,
  type AgeStage,
  type SafetyRule,
  type SupportedLang,
} from "@xelulu/shared";

import {
  AGE_SENTENCE_LIMITS,
  AGE_WORD_LIMITS,
  sentenceCount,
  withinAgeShape,
  wordCount,
} from "../src/brain/safety/age-shape.js";
import {
  BLOCKED_BRANDS,
  FORBIDDEN_KIND_PRECEDENCE,
  containsTerm,
  firstForbidden,
  firstForbiddenSpan,
  isUnreadable,
  termIndex,
  type ForbiddenKind,
} from "../src/brain/safety/forbidden-spans.js";
import type { GuardContext } from "../src/brain/safety/input-guard.js";
import {
  OUTPUT_CONTENT_RULE_ORDER,
  OUTPUT_CONTENT_TERMS,
  checkOutput,
} from "../src/brain/safety/output-guard.js";
import {
  COMFORT_REPLY,
  DEFERRAL_REPLY,
  FILLER_TEXT,
  SAFE_REDIRECT,
  type SpokenText,
} from "../src/brain/safety/safe-text.js";
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

function ctx(ageStage: AgeStage, lang: SupportedLang): GuardContext {
  return { ageStage, lang, allowedCategories: [], deferTopics: [] };
}

const ALLOWED = { decision: "allow", rule: "none", topic: null } as const;

function refused(rule: SafetyRule) {
  return { decision: "refuse", rule, topic: null };
}

const stage = fc.constantFrom<AgeStage>(...AGE_STAGES);
const lang = fc.constantFrom<SupportedLang>(...SUPPORTED_LANGS);

/** The three stage-indexed spoken tables, by the name each one carries in the design. */
const SPOKEN_TABLES: readonly (readonly [string, SpokenText])[] = Object.freeze([
  ["SAFE_REDIRECT", SAFE_REDIRECT],
  ["DEFERRAL_REPLY", DEFERRAL_REPLY],
  ["COMFORT_REPLY", COMFORT_REPLY],
] as const);

/**
 * What Req 7.1 and Req 8.1 ask of the words themselves: a Deferral invites asking a grown-up
 * together, and a Comfort text encourages telling a trusted grown-up. Pinned as patterns so the
 * tables cannot later be edited into some other allowed sentence and keep the suite green on a
 * safety-critical requirement. Every stage carries the invitation, the verb and a grown-up, named
 * at `tiny` where there is only one sentence to spend and described from `little` upwards.
 */
const REQUIRED_PHRASES: readonly (readonly [
  "DEFERRAL_REPLY" | "COMFORT_REPLY",
  Readonly<Record<SupportedLang, readonly RegExp[]>>,
])[] = Object.freeze([
  [
    "DEFERRAL_REPLY",
    {
      // "let us ask ... together", and a grown-up named or described.
      "en-IN": [/\blet us\b/i, /\bask\b/i, /\btogether\b/i, /\bamma\b|\bappa\b|grown-up/i],
      "hi-IN": [/चलो/, /पूछें/, /अम्मा|अप्पा|बड़े/],
    },
  ],
  [
    "COMFORT_REPLY",
    {
      // "let us tell ... a grown-up you trust", and a grown-up named or described.
      "en-IN": [/\blet us\b/i, /\btell\b/i, /\bamma\b|\bappa\b|grown-up/i],
      "hi-IN": [/चलो/, /बताएँ/, /अम्मा|अप्पा|बड़े/],
    },
  ],
] as const);

// ---------------------------------------------------------------------------------------------
// Property 4

describe("Property 4: every spoken text fits the age stage and passes the output guard", () => {
  // The constants live in a finite domain — three tables plus the Filler, over four stages and
  // two languages — so it is enumerated rather than sampled: a generator over eight cases can
  // only make full coverage likely, and the claim is that every one of them is sayable.
  it("every stage-indexed constant is within its limits and allowed", () => {
    for (const language of SUPPORTED_LANGS) {
      for (const ageStage of AGE_STAGES) {
        for (const [name, table] of SPOKEN_TABLES) {
          const text = table[language][ageStage];
          const where = `${name} ${language} ${ageStage}`;
          expect(sentenceCount(text), where).toBeGreaterThanOrEqual(1);
          expect(sentenceCount(text), where).toBeLessThanOrEqual(AGE_SENTENCE_LIMITS[ageStage]);
          expect(wordCount(text), where).toBeLessThanOrEqual(AGE_WORD_LIMITS[ageStage]);
          expect(withinAgeShape(text, ageStage), where).toBe(true);
          expect(checkOutput(text, ctx(ageStage, language)), where).toEqual(ALLOWED);
        }
      }
    }
  });

  it("the Filler fits every stage, because it carries no stage of its own", () => {
    for (const language of SUPPORTED_LANGS) {
      for (const ageStage of AGE_STAGES) {
        const text = FILLER_TEXT[language];
        const where = `FILLER_TEXT ${language} ${ageStage}`;
        expect(withinAgeShape(text, ageStage), where).toBe(true);
        expect(checkOutput(text, ctx(ageStage, language)), where).toEqual(ALLOWED);
      }
    }
  });

  it("allows an ordinary reply built within the stage's limits", () => {
    const words = fc.constantFrom("ball", "tree", "jump", "rain", "happy", "friend", "cloud");
    fc.assert(
      fc.property(stage, lang, fc.array(words, { minLength: 1, maxLength: 5 }), (s, l, picked) => {
        const sentences = Array.from({ length: AGE_SENTENCE_LIMITS[s] }, () => picked.join(" "));
        const text = `${sentences.join(". ")}.`;
        expect(checkOutput(text, ctx(s, l))).toEqual(ALLOWED);
      }),
      { numRuns: 200 },
    );
  });

  it("names every language and every stage, so no table has a gap", () => {
    for (const [name, table] of SPOKEN_TABLES) {
      for (const language of SUPPORTED_LANGS) {
        for (const ageStage of AGE_STAGES) {
          expect(table[language][ageStage], `${name} ${language} ${ageStage}`).toMatch(/\S/);
        }
      }
      expect(Object.isFrozen(table)).toBe(true);
    }
    for (const language of SUPPORTED_LANGS) {
      expect(FILLER_TEXT[language]).toMatch(/\S/);
    }
  });

  it("names no emergency number, URL or service in the Comfort text (Req 8.3)", () => {
    for (const language of SUPPORTED_LANGS) {
      for (const ageStage of AGE_STAGES) {
        const text = COMFORT_REPLY[language][ageStage];
        expect(firstForbidden(text)).toBeNull();
        expect(text).not.toMatch(/\d/);
      }
    }
  });

  it("invites asking a grown-up together, and encourages telling one (Req 7.1, 8.1)", () => {
    for (const [name, patterns] of REQUIRED_PHRASES) {
      const table = name === "DEFERRAL_REPLY" ? DEFERRAL_REPLY : COMFORT_REPLY;
      for (const language of SUPPORTED_LANGS) {
        for (const ageStage of AGE_STAGES) {
          const text = table[language][ageStage];
          for (const pattern of patterns[language]) {
            expect(text, `${name} ${language} ${ageStage} ${String(pattern)}`).toMatch(pattern);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Property 6

/**
 * Forbidden spans, built from parts so this file holds no complete URL literal. The `@`-address
 * sample deliberately has no dotted TLD, because a dotted host is a URL and URL outranks
 * contact_detail: the sample has to exercise the rule it names.
 */
const FORBIDDEN_SAMPLES: readonly (readonly [ForbiddenKind, string])[] = Object.freeze([
  ["url", ["https:", "", "shop.example.com"].join("/")],
  ["url", ["http:", "", "toys.example.org"].join("/")],
  ["url", "www.lulu-toys.app"],
  ["url", "shop.example.in"],
  ["contact_detail", "9876543210"],
  ["contact_detail", "98765 43210"],
  ["contact_detail", ["lulu", "mailbox"].join("@")],
  ["price", "\u20b9500"],
  ["price", "Rs 20"],
  ["price", "costs"],
  ["price", "\u0915\u0940\u092e\u0924"],
  ["brand", "youtube"],
  ["brand", "amazon"],
  ["brand", "coca cola"],
] as const);

const FILLER_TOKENS = Object.freeze(["ball", "tree", "jump", "rain", "happy", "friend"]);

/**
 * Every 4-code-unit window of a span that holds no space: enough to prove no fragment of it was
 * handed back, without asserting on windows that are mostly ordinary prose spacing.
 */
function fragments(span: string): string[] {
  const lower = span.toLowerCase();
  if (lower.length <= 4) return [lower];
  const out: string[] = [];
  for (let i = 0; i + 4 <= lower.length; i += 1) {
    const window = lower.slice(i, i + 4);
    if (!window.includes(" ")) out.push(window);
  }
  return out;
}

describe("Property 6: no forbidden span is ever spoken", () => {
  const sample = fc.constantFrom(...FORBIDDEN_SAMPLES);

  it("refuses with the matching rule wherever the span sits, and leaks no part of it", () => {
    fc.assert(
      fc.property(
        sample,
        fc.array(fc.constantFrom(...FILLER_TOKENS), { minLength: 1, maxLength: 6 }),
        fc.nat(),
        stage,
        lang,
        ([kind, span], tokens, where, ageStage, language) => {
          const at = where % (tokens.length + 1);
          const text = [...tokens.slice(0, at), span, ...tokens.slice(at)].join(" ");
          const verdict = checkOutput(text, ctx(ageStage, language));

          expect(verdict).toEqual(refused(kind));

          // The verdict is three closed-enum fields, so no fragment of the span can ride out.
          const serialised = JSON.stringify(verdict).toLowerCase();
          for (const fragment of fragments(span)) {
            expect(serialised).not.toContain(fragment);
          }

          // The span detector reports a kind and a position, never the text it found.
          const found = firstForbiddenSpan(text);
          expect(found).not.toBeNull();
          expect(Object.keys(found ?? {}).sort()).toEqual(["at", "kind"]);
          expect(found?.kind).toBe(kind);
          expect(found?.at).toBeGreaterThanOrEqual(0);
          expect(found?.at).toBeLessThan(text.length);

          // What the pipeline speaks instead carries no part of the span either.
          const spoken = SAFE_REDIRECT[language][ageStage].toLowerCase();
          for (const fragment of fragments(span)) {
            expect(spoken).not.toContain(fragment);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("holds when the span is written into the middle of a word", () => {
    // The spans that need no boundary of their own. A brand and the money words are matched as
    // whole words on purpose, and a bare `host.tld` needs its trailing boundary to be a host.
    const midWord: readonly (readonly [ForbiddenKind, string])[] = [
      ["url", ["https:", "", "shop.example.com"].join("/")],
      ["url", "www.lulu-toys.app"],
      ["contact_detail", "9876543210"],
      ["contact_detail", ["lulu", "mailbox"].join("@")],
      ["price", "\u20b9500"],
    ];
    for (const [kind, span] of midWord) {
      expect(checkOutput(`tre${span}e`, ctx("maker", "en-IN")).rule).toBe(kind);
    }
  });
});

describe("one example per forbidden kind (Req 6.2)", () => {
  it.each([
    ["url", ["https:", "", "lulu.example.com"].join("/")],
    ["contact_detail", "call 98765 43210"],
    ["price", "it costs \u20b9499"],
    ["brand", "watch it on youtube"],
  ] as const)("refuses %s", (rule, text) => {
    expect(checkOutput(text, ctx("maker", "en-IN"))).toEqual(refused(rule));
  });

  it("keeps the kind precedence url, contact_detail, price, brand", () => {
    expect(FORBIDDEN_KIND_PRECEDENCE).toEqual(["url", "contact_detail", "price", "brand"]);
    // A text holding all four is refused as a URL, the highest-precedence kind.
    const all = `${["https:", "", "shop.example.com"].join("/")} 9876543210 \u20b9500 youtube`;
    expect(checkOutput(all, ctx("maker", "en-IN")).rule).toBe("url");
    expect(checkOutput("9876543210 \u20b9500 youtube", ctx("maker", "en-IN")).rule).toBe(
      "contact_detail",
    );
    expect(checkOutput("\u20b9500 youtube", ctx("maker", "en-IN")).rule).toBe("price");
  });

  it("matches a brand as a whole word, and a blocked brand list that is frozen", () => {
    expect(Object.isFrozen(BLOCKED_BRANDS)).toBe(true);
    for (const brand of BLOCKED_BRANDS) {
      expect(checkOutput(`we saw ${brand} today`, ctx("maker", "en-IN")).rule).not.toBe("none");
    }
    // A word that merely contains a brand name is not a brand mention.
    expect(firstForbidden("the legolas story")).toBeNull();
  });

  it("never returns the span's text from either detector", () => {
    const span = "youtube";
    expect(firstForbidden(`watch ${span}`)).toBe("brand");
    expect(JSON.stringify(firstForbiddenSpan(`watch ${span}`))).not.toContain(span);
  });

  it("refuses a multi-word span however the gap between its words is spelled", () => {
    // A literal match saw one spelling of the gap, so `drink coca  cola` and a brand name
    // wrapped across two lines reached `allow` (group-5 review pass 3, finding 1). One entry per
    // output list: brand, price, financial, romantic, and a Hindi brand.
    const spans: readonly (readonly [SafetyRule, string])[] = [
      ["brand", "drink coca{gap}cola"],
      ["brand", "\u0915\u094b\u0915\u093e{gap}\u0915\u094b\u0932\u093e \u092a\u093f\u092f\u094b"],
      ["price", "order{gap}now"],
      ["financial", "use your credit{gap}card"],
      ["financial", "the interest{gap}rate is high"],
      ["romantic", "will you marry{gap}me"],
      ["contact_detail", "98765{gap}43210"],
    ];
    for (const [rule, template] of spans) {
      for (const gap of [" ", "  ", "   ", "\n", " \n ", "\t"]) {
        const text = template.replaceAll("{gap}", gap);
        expect(checkOutput(text, ctx("maker", "en-IN")).rule, JSON.stringify(text)).toBe(rule);
      }
    }
  });

  it("folds a whitespace run in the term matcher itself", () => {
    expect(containsTerm("coca  cola", "coca cola")).toBe(true);
    expect(containsTerm("coca\ncola", "coca cola")).toBe(true);
    expect(containsTerm("credit\tcard", "credit card")).toBe(true);
    // And punctuation between the words, which a reply may carry either way round.
    expect(containsTerm("coca, cola", "coca cola")).toBe(true);
    expect(termIndex("drink coca  cola", "coca cola")).toBe(6);
  });

  it("reports the position in the original text, not in a lowercased copy", () => {
    // `İ` (U+0130) lowercases to two code units, so a position found in the lowercased copy
    // drifts from the original. The span starts at index 2 either way, after the `İ` and a space.
    const text = `\u0130 ${"youtube"}`;
    expect(firstForbiddenSpan(text)?.at).toBe(2);
    expect(text.slice(firstForbiddenSpan(text)?.at ?? 0, 9)).toBe("youtube");
  });

  it("keeps the position exact when the folder collapses a whitespace run", () => {
    // Two spaces fold to one, so the folded index drifts from the original by one. The origin
    // map has to absorb that, or a reported position would point into the wrong word.
    const text = `\u0130  ${"youtube"}`;
    expect(firstForbiddenSpan(text)?.at).toBe(3);
    expect(text.slice(firstForbiddenSpan(text)?.at ?? 0, 10)).toBe("youtube");
    const padded = `  ${"youtube"}`;
    expect(firstForbiddenSpan(padded)?.at).toBe(2);
  });
});

describe("the span rules hold in both scripts (Req 11.2)", () => {
  it("refuses a phone number written in Devanagari numerals", () => {
    expect(checkOutput("फोन ९८७६५४३२१०", ctx("maker", "hi-IN"))).toEqual(refused("contact_detail"));
    expect(checkOutput("फोन ९८७६५ ४३२१०", ctx("maker", "hi-IN"))).toEqual(
      refused("contact_detail"),
    );
    // Short runs are not contact details in either script.
    expect(checkOutput("हमने ९ गेंदें गिनीं।", ctx("maker", "hi-IN")).rule).not.toBe(
      "contact_detail",
    );
  });

  it("refuses a price written with Devanagari numerals beside a currency symbol", () => {
    expect(checkOutput("\u20b9५००", ctx("maker", "hi-IN")).rule).toBe("price");
    expect(checkOutput("५०० \u20b9", ctx("maker", "hi-IN")).rule).toBe("price");
  });

  it.each([
    "यूट्यूब",
    "नेटफ्लिक्स",
    "अमेज़न",
    "अमेजन",
    "व्हाट्सएप",
    "व्हाट्सऐप",
    "वाट्सएप",
    "इंस्टाग्राम",
    "गूगल",
    "ज़ोमैटो",
    "कोका कोला",
    "मैकडॉनल्ड",
    "मैकडॉनल्ड्स",
  ])("refuses the Devanagari brand %s", (brand) => {
    expect(checkOutput(`हमने ${brand} देखा।`, ctx("maker", "hi-IN"))).toEqual(refused("brand"));
  });

  it("folds the two spellings of a nukta letter together", () => {
    // `\u095b` and `\u091c\u093c` are canonically the same `ज़`, so one list entry covers both:
    // a brand said with a precomposed nukta is the same brand.
    const precomposed = `\u0905\u092e\u0947\u095b\u0928`;
    const decomposed = `\u0905\u092e\u0947\u091c\u093c\u0928`;
    expect(precomposed).not.toBe(decomposed);
    for (const spelling of [precomposed, decomposed]) {
      expect(checkOutput(`हमने ${spelling} देखा।`, ctx("maker", "hi-IN"))).toEqual(
        refused("brand"),
      );
    }
    // And the same for a money word: `कर्ज़` written either way is still money talk.
    expect(containsTerm(`\u0915\u0930\u094d\u095b`, `\u0915\u0930\u094d\u091c\u093c`)).toBe(true);
  });

  it("matches a Hindi term with a danda against it, because a danda is punctuation", () => {
    expect(checkOutput("देखो यूट्यूब।", ctx("maker", "hi-IN")).rule).toBe("brand");
    expect(checkOutput("इसकी कीमत।", ctx("maker", "hi-IN")).rule).toBe("price");
  });

  it("carries a Devanagari spelling for every Latin brand family in the list", () => {
    const devanagari = BLOCKED_BRANDS.filter((brand) => /[\u0900-\u097f]/.test(brand));
    const latin = BLOCKED_BRANDS.filter((brand) => !/[\u0900-\u097f]/.test(brand));
    expect(latin.length).toBeGreaterThan(0);
    expect(devanagari.length).toBeGreaterThanOrEqual(latin.length);
  });
});

describe("one example per refused content class (Req 6.3)", () => {
  const firstTerms = OUTPUT_CONTENT_RULE_ORDER.map(
    (rule) => [rule, OUTPUT_CONTENT_TERMS[rule][0] ?? ""] as const,
  );

  it.each(firstTerms)("refuses %s content on the term %s", (rule, term) => {
    expect(checkOutput(`we saw a ${term} there`, ctx("maker", "en-IN"))).toEqual(refused(rule));
  });

  it("refuses every term of every content class", () => {
    for (const rule of OUTPUT_CONTENT_RULE_ORDER) {
      for (const term of OUTPUT_CONTENT_TERMS[rule]) {
        expect(checkOutput(`we saw a ${term} there`, ctx("maker", "en-IN")).decision).toBe(
          "refuse",
        );
      }
    }
  });

  it("keeps the content precedence romantic, frightening, medical, legal, financial", () => {
    expect(OUTPUT_CONTENT_RULE_ORDER).toEqual([
      "romantic",
      "frightening",
      "medical",
      "legal",
      "financial",
    ]);
    expect(checkOutput("a romance with a monster", ctx("maker", "en-IN")).rule).toBe("romantic");
    expect(checkOutput("a monster took the medicine", ctx("maker", "en-IN")).rule).toBe(
      "frightening",
    );
    expect(checkOutput("the doctor called the police", ctx("maker", "en-IN")).rule).toBe("medical");
    expect(checkOutput("the police went to the bank", ctx("maker", "en-IN")).rule).toBe("legal");
  });

  it("puts a forbidden span above every content class", () => {
    expect(checkOutput("the doctor said \u20b9500", ctx("maker", "en-IN")).rule).toBe("price");
  });
});

describe("length and uncertainty (Req 6.4, 6.5)", () => {
  it("refuses a reply over the stage's sentence limit", () => {
    for (const ageStage of AGE_STAGES) {
      const over = Array.from(
        { length: AGE_SENTENCE_LIMITS[ageStage] + 1 },
        (_v, i) => `ball ${i === 0 ? "one" : "two"}.`,
      ).join(" ");
      expect(checkOutput(over, ctx(ageStage, "en-IN"))).toEqual(refused("length"));
    }
  });

  it("refuses a reply over the stage's word limit", () => {
    for (const ageStage of AGE_STAGES) {
      const words = Array.from({ length: AGE_WORD_LIMITS[ageStage] + 1 }, () => "ball");
      expect(checkOutput(`${words.join(" ")}.`, ctx(ageStage, "en-IN"))).toEqual(refused("length"));
    }
  });

  it("holds a tiny child to one short sentence", () => {
    expect(checkOutput("The ball is red.", ctx("tiny", "en-IN"))).toEqual(ALLOWED);
    expect(checkOutput("The ball is red. It rolled away.", ctx("tiny", "en-IN")).rule).toBe(
      "length",
    );
    expect(checkOutput("The ball is red. It rolled away.", ctx("little", "en-IN"))).toEqual(
      ALLOWED,
    );
  });

  it("refuses with uncertain when it cannot read the reply", () => {
    for (const text of ["", "   ", "\u0001", "\u{1f600}", "\u4f60\u597d"]) {
      expect(checkOutput(text, ctx("maker", "en-IN"))).toEqual(refused("uncertain"));
    }
  });

  it("puts length above uncertain, so an empty reply is uncertain and not over-long", () => {
    expect(checkOutput("", ctx("tiny", "en-IN")).rule).toBe("uncertain");
    expect(withinAgeShape("", "tiny")).toBe(true);
  });

  it("reaches every output rule the guard can produce", () => {
    const produced = new Set<SafetyRule>();
    const samples: readonly string[] = [
      ["https:", "", "shop.example.com"].join("/"),
      "9876543210",
      "\u20b9500",
      "youtube",
      "a romance here",
      "a monster here",
      "the medicine here",
      "the police here",
      "the bank here",
      "ball ball ball ball ball ball ball ball ball.",
      "",
      "The ball is red.",
    ];
    for (const text of samples) produced.add(checkOutput(text, ctx("tiny", "en-IN")).rule);
    expect([...produced].sort()).toEqual(
      [
        "brand",
        "contact_detail",
        "financial",
        "frightening",
        "legal",
        "length",
        "medical",
        "none",
        "price",
        "romantic",
        "uncertain",
        "url",
      ].sort(),
    );
    for (const rule of produced) expect(SAFETY_RULES).toContain(rule);
  });
});

// ---------------------------------------------------------------------------------------------
// The counting and matching the guard is built on

describe("age shape (Req 10.2)", () => {
  it("counts sentences in both languages, including the Hindi danda", () => {
    expect(sentenceCount("The ball is red.")).toBe(1);
    expect(sentenceCount("One. Two. Three.")).toBe(3);
    expect(sentenceCount("Really?!")).toBe(1);
    expect(sentenceCount("No terminator here")).toBe(1);
    expect(sentenceCount("")).toBe(0);
    expect(sentenceCount("   ")).toBe(0);
    expect(sentenceCount("\u0938\u0941\u0928\u094b\u0964")).toBe(1);
    expect(sentenceCount("\u0938\u0941\u0928\u094b\u0964 \u0905\u0924\u0903\u0964")).toBe(2);
  });

  it("counts words, ignoring stray punctuation", () => {
    expect(wordCount("The ball is red.")).toBe(4);
    expect(wordCount("grown-up friend")).toBe(2);
    expect(wordCount("  -  ")).toBe(0);
    expect(wordCount("")).toBe(0);
    expect(wordCount("\u0917\u0947\u0902\u0926 \u0932\u093e\u0932 \u0939\u0948")).toBe(3);
  });

  it("keeps the limits of Req 10.2", () => {
    expect(AGE_SENTENCE_LIMITS).toEqual({ tiny: 1, little: 2, explorer: 3, maker: 3 });
    expect(AGE_WORD_LIMITS).toEqual({ tiny: 8, little: 20, explorer: 40, maker: 60 });
    expect(Object.isFrozen(AGE_SENTENCE_LIMITS)).toBe(true);
    expect(Object.isFrozen(AGE_WORD_LIMITS)).toBe(true);
  });
});

describe("term matching and readability", () => {
  it("matches a term only as a whole word or phrase", () => {
    expect(containsTerm("the soldier ant", "die")).toBe(false);
    // `died` now meets `die`: the matcher allows one common English inflection on either side
    // (group-5 review pass 4, finding 2). This line asserted the exact-match behaviour that rule
    // replaces. Whole-word matching itself is unchanged, which the rest of this case pins.
    expect(containsTerm("he died today", "die")).toBe(true);
    expect(containsTerm("he died today", "died")).toBe(true);
    expect(containsTerm("godzilla", "god")).toBe(false);
    expect(containsTerm("oh god", "god")).toBe(true);
    expect(containsTerm("anything", "")).toBe(false);
    expect(containsTerm("anything", "   ")).toBe(false);
  });

  it("matches one inflection on either side, in both directions", () => {
    // The listed form may be the shorter or the longer one; the rule is symmetric.
    for (const [text, term] of [
      ["my leg hurts", "hurt"],
      ["my nose bleeds", "bleed"],
      ["he was hitting me", "hit"],
      ["nobody wants to play with me", "plays"],
      ["no one liked me", "likes"],
      ["he kissed her", "kiss"],
      ["he murdered them", "murder"],
      ["banking is fun", "bank"],
      ["loaning money is easy", "loan"],
      ["i am hurt", "hurts"],
      ["she plays outside", "playing"],
    ] as const) {
      expect(containsTerm(text, term)).toBe(true);
    }
  });

  it("does not collapse two unrelated words to reach a match", () => {
    // A trailing `e` is never removed on its own, so these stay apart.
    for (const [text, term] of [
      ["the red car", "care"],
      ["i wear a hat", "hate"],
      ["we were late", "lat"],
      ["the bus stop", "bu"],
      ["a class of ten", "clas"],
      ["the soldier ant", "die"],
      ["godzilla", "god"],
    ] as const) {
      expect(containsTerm(text, term)).toBe(false);
    }
  });

  it("leaves Devanagari to exact word matching, as the hardening gate records", () => {
    expect(containsTerm("मुझे चोट लगी", "चोट")).toBe(true);
    // Suffix removal is Latin-only, so a Hindi inflection is not reached. Recorded in safety.md's
    // Safety Hardening gate rather than half-solved here.
    expect(containsTerm("मुझे चोटें लगी", "चोट")).toBe(false);
  });

  it("reports the whole-word position, not the first loose occurrence", () => {
    expect(termIndex("soldier, die now", "die")).toBe(9);
    expect(termIndex("soldier ant", "die")).toBe(-1);
  });

  it("folds every apostrophe spelling onto one, so a list entry needs only one", () => {
    // U+2019 is what an STT and most text normalisation emit; U+2018 and U+02BC turn up too.
    // None canonically decomposes to U+0027, so the folder maps them explicitly.
    for (const mark of ["'", "\u2018", "\u2019", "\u02bc"]) {
      expect(containsTerm(`please don${mark}t go`, "don't")).toBe(true);
      expect(containsTerm("please don't go", `don${mark}t`)).toBe(true);
      expect(isUnreadable(`don${mark}t`)).toBe(false);
    }
  });

  it("reads the two supported scripts and refuses to guess at anything else", () => {
    expect(isUnreadable("hello there")).toBe(false);
    expect(isUnreadable("\u0938\u0941\u0928\u094b\u0964")).toBe(false);
    expect(isUnreadable("grown-up, don't (stop)")).toBe(false);
    expect(isUnreadable("")).toBe(true);
    expect(isUnreadable("12 34")).toBe(true);
    expect(isUnreadable("hello \u{1f600}")).toBe(true);
    expect(isUnreadable("\u4f60\u597d")).toBe(true);
  });

  it("counts a Devanagari digit, a danda and a bare mark as not-a-letter", () => {
    // The ASCII net and the Devanagari net are the same size: digits, punctuation and a lone
    // combining mark carry no letter, so the guards refuse rather than treat them as words.
    expect(isUnreadable("०१२ ३४५")).toBe(true); // Devanagari digits only
    expect(isUnreadable("\u0964")).toBe(true); // a lone danda
    expect(isUnreadable("\u0965")).toBe(true); // a lone double danda
    expect(isUnreadable("\u093c")).toBe(true); // a lone nukta
    expect(isUnreadable("\u0902")).toBe(true); // a lone anusvara
    // A real Hindi word still reads, marks and all.
    expect(isUnreadable("\u0917\u0947\u0902\u0926")).toBe(false);
  });
});

describe("inflected content terms (group-5 review pass 4, finding 2)", () => {
  /** Each row is a reply whose only forbidden word is an inflection of a listed term. */
  const ROWS: readonly (readonly [string, string])[] = [
    ["He kissed her.", "romantic"],
    ["The policeman is here.", "legal"],
    ["The policemen are here.", "legal"],
    ["Banking is fun.", "financial"],
    ["He murdered them.", "frightening"],
    ["Loaning money is easy.", "financial"],
  ];

  it.each(ROWS)("refuses %s with rule %s", (text, rule) => {
    expect(checkOutput(text, ctx("little", "en-IN"))).toEqual({
      decision: "refuse",
      rule,
      topic: null,
    });
  });

  it("still refuses the base forms that already matched", () => {
    for (const [text, rule] of [
      ["He gave her a kiss.", "romantic"],
      ["The police are here.", "legal"],
      ["The bank is open.", "financial"],
      ["He will murder them.", "frightening"],
      ["Get a loan.", "financial"],
    ] as const) {
      expect(checkOutput(text, ctx("little", "en-IN"))).toEqual({
        decision: "refuse",
        rule,
        topic: null,
      });
    }
  });

  it("keeps an ordinary reply allowed", () => {
    // The inflection rule must not make everyday words reach a content list.
    for (const text of [
      "We can count the stars.",
      "Shall we hop like a frog?",
      "That was a kind thing to do.",
    ]) {
      expect(checkOutput(text, ctx("little", "en-IN"))).toEqual({
        decision: "allow",
        rule: "none",
        topic: null,
      });
    }
  });
});
