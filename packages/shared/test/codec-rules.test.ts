// Contract rule properties: Properties 6, 14, 15, 16 and 17, plus the task 16.6 examples.
// Requirements 3.4, 3.7, 4.5, 6.4, 6.6, 7.2–7.5, 8.1, 8.9, 8.11, 8.12, 8.14, 8.15, 9.5, 10.8.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  KNOWN_EXPRESSIONS,
  KNOWN_EYES,
  KNOWN_GESTURE_NAMES,
  TOPIC_SUFFIXES,
  parseDeviceMessage,
  type ContractIssue,
  type ParseResult,
} from "../dist/index.js";

import {
  COLOR_PATTERN,
  HHMM_PATTERN,
  LANG_PATTERN,
  VARIANTS,
  activeChildIdArb,
  ackArb,
  colorArb,
  hhmmArb,
  idArb,
  isReferenceHttpsUrl,
  langArb,
  manifestUrlArb,
  pctArb,
  variantByName,
  type VariantCase,
} from "./arbitraries.js";
import {
  FIELD_TABLE,
  deleteAt,
  enumPerturbationArb,
  getAt,
  hasAt,
  nonStringJsonArb,
  setAt,
  type JsonObject,
  type VariantName,
} from "./mutations.js";

const NUM_RUNS = 200;

type Case = readonly [string, VariantCase];

const CASES: readonly Case[] = VARIANTS.map((v) => [v.name, v]);

// ---------------------------------------------------------------------------------------------
// Assertion helpers.

/** The issues of a failure Parse_Result; fails the test on a success result. */
function expectFailure(result: ParseResult<unknown>): readonly ContractIssue[] {
  if (result.ok) throw new Error(`expected failure, got ${JSON.stringify(result.value)}`);
  return result.error.issues;
}

/** The value of a success Parse_Result; fails the test on a failure result. */
function expectOk(result: ParseResult<unknown>): unknown {
  if (!result.ok) {
    throw new Error(
      `expected success, got issues ${JSON.stringify(result.error.issues)} (${result.error.variant})`,
    );
  }
  return result.value;
}

function hasIssue(
  issues: readonly ContractIssue[],
  kind: ContractIssue["kind"],
  path: readonly (string | number)[],
): boolean {
  return issues.some(
    (issue) =>
      issue.kind === kind &&
      issue.path.length === path.length &&
      issue.path.every((key, i) => key === path[i]),
  );
}

/** The values of a closed-enum field, read from the hand-written FIELD_TABLE (not from src). */
function closedEnumValues(variant: VariantName, path: string): readonly string[] {
  const spec = FIELD_TABLE[variant].find((s) => s.path.join(".") === path);
  if (!spec || spec.kind.t !== "closedEnum") throw new Error(`${path} is not a closed enum`);
  return spec.kind.values;
}

/** Marks a candidate that removes the field instead of setting it. */
const REMOVE: unique symbol = Symbol("remove");

/** Whitespace-only strings of one or more characters. */
const whitespaceArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\u2003"),
  minLength: 1,
  maxLength: 4,
});

/** Case variants of known values: all upper case, or the first letter upper case. */
function caseVariantArb(known: readonly string[]): fc.Arbitrary<string> {
  return fc
    .constantFrom(...known)
    .chain((k) => fc.constantFrom(k.toUpperCase(), k.charAt(0).toUpperCase() + k.slice(1)));
}

/** Near-miss mutations of a valid string: a character inserted, deleted, case-flipped or padded. */
function nearMissArb(valid: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return valid.chain((s) =>
    fc.oneof(
      fc.constant(` ${s}`),
      fc.constant(`${s} `),
      fc.constant(`${s}\n`),
      fc.constant(s.toUpperCase()),
      fc.constant(s.toLowerCase()),
      fc
        .tuple(fc.nat({ max: s.length }), fc.string({ minLength: 1, maxLength: 1 }))
        .map(([i, c]) => s.slice(0, i) + c + s.slice(i)),
      fc.nat({ max: Math.max(0, s.length - 1) }).map((i) => s.slice(0, i) + s.slice(i + 1)),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Property 6 tables.

/** Each distinct union parser (the ack variant parser doubles as the ack topic parser). */
const UNION_PARSERS: readonly ((text: string) => ParseResult<unknown>)[] = [
  ...new Set(VARIANTS.map((v) => v.union)),
];

// ---------------------------------------------------------------------------------------------
// Property 16 and 17 tables.

type OpenVocabCase = readonly [string, VariantName, readonly string[], readonly string[]];

/** Open_Vocabulary fields: label, variant, path and known values. */
const OPEN_VOCAB_CASES: readonly OpenVocabCase[] = [
  ["say expression", "say cmd", ["data", "expression"], KNOWN_EXPRESSIONS],
  ["animate expression", "animate cmd", ["data", "expression"], KNOWN_EXPRESSIONS],
  ["animate eyes", "animate cmd", ["data", "eyes"], KNOWN_EYES],
  ["gesture name", "gesture cmd", ["data", "name"], KNOWN_GESTURE_NAMES],
];

type FormatCase = readonly [
  string,
  VariantName,
  readonly string[],
  (s: string) => boolean,
  fc.Arbitrary<string>,
  readonly string[],
];

const LANG_NEAR_MISSES = [
  "en-in",
  "EN",
  "En",
  "en_IN",
  "e",
  "engl",
  "en-",
  "-IN",
  "en-IND",
  "en-latn",
  "en-Latn-in",
  "en-1234",
  "hi-41",
  " en-IN",
  "en-IN ",
  "en-IN\n",
  "",
  "en-Latn-IN",
  "hi-419",
  "kok",
];
const HHMM_NEAR_MISSES = [
  "24:00",
  "12:60",
  "1:00",
  "12:5",
  "12-00",
  "1200",
  "12:00:00",
  "-1:00",
  "２３:00",
  " 12:00",
  "12:00 ",
  "12:00\n",
  "",
  "00:00",
  "23:59",
];
const COLOR_NEAR_MISSES = [
  "#FFF",
  "#GGGGGG",
  "FFFFFF",
  "#FFFFFFF",
  "#FFFFF",
  "##FFFFF",
  "#ffffff ",
  " #ffffff",
  "#ffffff\n",
  "",
  "#ffffff",
  "#A1b2C3",
];
const URL_NEAR_MISSES = [
  "http://localhost/ota/manifest.json",
  "wss://localhost/ota",
  "https:localhost",
  "https:/localhost",
  " https://localhost/ota/manifest.json",
  "HTTPS://localhost/ota",
  "Https://localhost/ota",
  "/ota/manifest.json",
  "ota/manifest.json",
  "",
  "https://",
  "https:///path",
  "https://localhost",
  "https://localhost/ota/manifest.json",
  "https://localhost:8443/m.json",
  "https://exa mple/x",
];

const FORMAT_CASES: readonly FormatCase[] = [
  ["say lang", "say cmd", ["data", "lang"], (s) => LANG_PATTERN.test(s), langArb, LANG_NEAR_MISSES],
  [
    "config language",
    "config cmd",
    ["data", "language"],
    (s) => LANG_PATTERN.test(s),
    langArb,
    LANG_NEAR_MISSES,
  ],
  [
    "config quiet_hours.start",
    "config cmd",
    ["data", "quiet_hours", "start"],
    (s) => HHMM_PATTERN.test(s),
    hhmmArb,
    HHMM_NEAR_MISSES,
  ],
  [
    "config quiet_hours.end",
    "config cmd",
    ["data", "quiet_hours", "end"],
    (s) => HHMM_PATTERN.test(s),
    hhmmArb,
    HHMM_NEAR_MISSES,
  ],
  [
    "led color",
    "led cmd",
    ["data", "color"],
    (s) => COLOR_PATTERN.test(s),
    colorArb,
    COLOR_NEAR_MISSES,
  ],
  [
    "ota manifest_url",
    "ota cmd",
    ["data", "manifest_url"],
    isReferenceHttpsUrl,
    manifestUrlArb,
    URL_NEAR_MISSES,
  ],
];

// ---------------------------------------------------------------------------------------------
// Properties.

describe("codec rules", () => {
  // Feature: phase-1-gateway-contract, Property 6: Messages only parse as their own variant and topic
  it.each(CASES)("Property 6: %s parses only as its own variant and topic", (_name, v) => {
    // Every other variant parser fails. audio_start and audio_end share a shape but differ by
    // `type`, so including that pair here only strengthens the property.
    const otherVariants = VARIANTS.filter((b) => b !== v);
    const foreignUnions = UNION_PARSERS.filter((u) => u !== v.union);
    const wrongSuffixes = TOPIC_SUFFIXES.filter((s) => s !== v.topic);
    expect(wrongSuffixes).toContain("cmd");
    fc.assert(
      fc.property(v.arb, (m) => {
        const text = v.serialise(m as never);
        for (const b of otherVariants) expectFailure(b.parse(text));
        for (const union of foreignUnions) expectFailure(union(text));
        for (const suffix of wrongSuffixes) {
          const issues = expectFailure(parseDeviceMessage(suffix, text));
          if (suffix === "cmd") expect(issues).toEqual([{ path: [], kind: "wrong_topic" }]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 14: Ack reason rule
  it("Property 14: an ack parses iff its reason is valid for its status", () => {
    const statuses = closedEnumValues("ack", "status");
    const reasons = closedEnumValues("ack", "reason");
    const reasonCandidateArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.constantFrom(...reasons),
      fc.constant(""),
      enumPerturbationArb(reasons),
      whitespaceArb,
      fc.string(),
      nonStringJsonArb,
      fc.constant<unknown>(REMOVE),
    );
    fc.assert(
      fc.property(
        ackArb,
        fc.constantFrom(...statuses),
        reasonCandidateArb,
        (base, status, reason) => {
          const withStatus = setAt(base, ["status"], status);
          const message =
            reason === REMOVE
              ? deleteAt(withStatus, ["reason"])
              : setAt(withStatus, ["reason"], reason);
          const isListedOrEmpty =
            typeof reason === "string" && (reason === "" || reasons.includes(reason));
          const expected = isListedOrEmpty && !(status === "rejected" && reason === "");
          const result = variantByName("ack").parse(JSON.stringify(message));
          expect(result.ok, `status ${status}, reason ${JSON.stringify(reason)}`).toBe(expected);
          if (status === "rejected" && reason === "") {
            expect(hasIssue(expectFailure(result), "reason_required", ["reason"])).toBe(true);
          }
          if (expected) expect(getAt(expectOk(result), ["reason"])).toBe(reason);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 15: Config delta needs at least one key
  it("Property 15: a config command parses iff its delta has at least one key", () => {
    const config = variantByName("config cmd");
    const deltaKeys = ["volume", "quiet_hours", "movement_on", "language", "active_child_id"];
    const fullDeltaArb = fc.record({
      volume: pctArb,
      quiet_hours: fc.record({ start: hhmmArb, end: hhmmArb }),
      movement_on: fc.boolean(),
      language: langArb,
      active_child_id: activeChildIdArb,
    });
    fc.assert(
      fc.property(idArb, fullDeltaArb, fc.subarray(deltaKeys), (cmdId, full, picked) => {
        const data: JsonObject = {};
        for (const key of picked) data[key] = (full as JsonObject)[key];
        const message = { proto_ver: 2, cmd_id: cmdId, action: "config", data };
        const text = JSON.stringify(message);
        const expected = picked.length > 0;
        for (const parse of [config.parse, config.union]) {
          const result = parse(text);
          expect(result.ok, `delta keys ${JSON.stringify(picked)}`).toBe(expected);
          if (expected) {
            expect(expectOk(result)).toEqual(message);
          } else {
            expect(hasIssue(expectFailure(result), "config_empty", ["data"])).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 16: Open vocabularies accept any non-empty string
  it.each(OPEN_VOCAB_CASES)(
    "Property 16: %s accepts any non-empty string",
    (_label, variant, path, known) => {
      const v = variantByName(variant);
      const candidateArb = fc.oneof(
        fc.string({ minLength: 1, unit: "grapheme" }),
        fc.string({ minLength: 1, unit: "binary" }),
        whitespaceArb,
        caseVariantArb(known),
        fc.constantFrom(...known),
      );
      fc.assert(
        fc.property(v.arb, candidateArb, (base, s) => {
          const text = JSON.stringify(setAt(base, path, s));
          expect(getAt(expectOk(v.parse(text)), path)).toBe(s);
          expectOk(v.union(text));
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  // Feature: phase-1-gateway-contract, Property 17: Formatted strings match their reference patterns
  it.each(FORMAT_CASES)(
    "Property 17: %s is accepted iff its reference predicate holds",
    (_label, variant, path, reference, valid, nearMisses) => {
      const v = variantByName(variant);
      const candidateArb = fc.oneof(
        valid,
        fc.constantFrom(...nearMisses),
        nearMissArb(valid),
        fc.string(),
        fc.string({ unit: "grapheme" }),
      );
      const quietHoursArb = fc.record({ start: hhmmArb, end: hhmmArb });
      const parentPath = path.slice(0, -1);
      fc.assert(
        fc.property(v.arb, quietHoursArb, candidateArb, (base, quietHours, s) => {
          // quiet_hours.start/end need their parent object present first.
          const prepared = hasAt(base, parentPath) ? base : setAt(base, parentPath, quietHours);
          const text = JSON.stringify(setAt(prepared, path, s));
          const expected = reference(s);
          for (const parse of [v.parse, v.union]) {
            const result = parse(text);
            expect(result.ok, `${path.join(".")} = ${JSON.stringify(s)}`).toBe(expected);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  it("rejects a touch event carrying cry data { confidence, duration_s }", () => {
    const touch = variantByName("touch event");
    const message = {
      proto_ver: 2,
      ts: 1733400010,
      type: "event",
      event_id: "e_1",
      event: "touch",
      data: { confidence: 0.92, duration_s: 6.5 },
    };
    const text = JSON.stringify(message);
    expectFailure(touch.parse(text));
    expectFailure(touch.union(text));
    expectFailure(parseDeviceMessage("event", text));
    // The same data is valid on a cry event.
    expectOk(variantByName("cry event").parse(JSON.stringify(setAt(message, ["event"], "cry"))));
  });

  it("accepts an audio_end with no prior audio_start", () => {
    const audioEnd = variantByName("audio_end");
    const text = JSON.stringify({
      proto_ver: 2,
      ts: 1733400004,
      type: "audio_end",
      turn_id: "t_never_started",
    });
    expectOk(audioEnd.parse(text));
    expectOk(audioEnd.union(text));
  });
});
