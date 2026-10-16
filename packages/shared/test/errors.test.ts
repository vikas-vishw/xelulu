// Contract error properties: Properties 18 and 19, plus the SyntaxError example.
// Requirements 3.8, 3.9, 10.3 and 12.8. C20: errors carry paths and kinds only, never values.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ContractError,
  TOPIC_SUFFIXES,
  parseDeviceMessage,
  type ContractIssue,
  type ParseResult,
} from "../dist/index.js";

import { VARIANTS, type VariantCase } from "./arbitraries.js";
import {
  BOUNDED_KINDS,
  VARIANT_NAMES,
  addKey,
  applicableFields,
  badDiscriminatorArb,
  badTsArb,
  deleteAt,
  enumPerturbationArb,
  notTwoArb,
  objectPositions,
  outOfRangeArb,
  presentFields,
  requiredFields,
  sentinelArb,
  setAt,
  unknownKeyArb,
  wrongTypeArb,
  type FieldSpec,
  type JsonObject,
} from "./mutations.js";

const NUM_RUNS = 200;

type Case = readonly [string, VariantCase];

const CASES: readonly Case[] = VARIANTS.map((v) => [v.name, v]);

/** Every ContractIssueKind, written out here independently of src (design "errors.ts"). */
const ISSUE_KINDS: ReadonlySet<string> = new Set([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
  "invalid_json",
  "not_object",
  "wrong_topic",
  "invalid_topic",
  "invalid_device_id",
  "invalid_topic_suffix",
  "reason_required",
  "config_empty",
  "invalid_https_url",
]);

/** Every variant label a message ContractError may carry: the 24 variants and the unions. */
const VARIANT_LABELS: ReadonlySet<string> = new Set<string>([
  ...VARIANT_NAMES,
  "status topic",
  "event",
  "audio control",
  "cmd",
  "device",
]);

/** Each distinct union parser (the ack variant parser doubles as the ack topic parser). */
const UNION_PARSERS: readonly ((text: string) => ParseResult<unknown>)[] = [
  ...new Set(VARIANTS.map((v) => v.union)),
];

/** Every Result-returning message parser: the 24 variant parsers and the distinct unions. */
const RESULT_PARSERS: readonly ((text: string) => ParseResult<unknown>)[] = [
  ...new Set([...VARIANTS.map((v) => v.parse), ...UNION_PARSERS]),
];

// ---------------------------------------------------------------------------------------------
// Assertion helpers.

/** The error of a failure Parse_Result; fails the test on a success result. */
function expectFailure(result: ParseResult<unknown>): ContractError {
  if (result.ok) throw new Error(`expected failure, got ${JSON.stringify(result.value)}`);
  return result.error;
}

/** Every rendering of an error a log line or crash report could carry. */
function renderings(error: ContractError): string[] {
  return [
    error.message,
    JSON.stringify(error.issues),
    JSON.stringify(error),
    String(error),
    error.stack ?? "",
    error.variant,
  ];
}

/**
 * The ContractError is well-formed (design "errors.ts"): at least one frozen issue, each with
 * exactly `path` (strings and numbers) and `kind` (a ContractIssueKind), the fixed message
 * template, no `cause`, and no sentinel in any rendering.
 */
function expectWellFormed(error: unknown, sentinels: readonly string[]): void {
  expect(error).toBeInstanceOf(ContractError);
  const e = error as ContractError;
  expect(e).toBeInstanceOf(Error);
  expect(e.name).toBe("ContractError");
  expect(VARIANT_LABELS.has(e.variant), `variant label ${e.variant}`).toBe(true);
  expect(e.issues.length).toBeGreaterThanOrEqual(1);
  expect(Object.isFrozen(e.issues)).toBe(true);
  for (const issue of e.issues) {
    expect(Object.keys(issue).sort()).toEqual(["kind", "path"]);
    expect(Object.isFrozen(issue)).toBe(true);
    expect(Array.isArray(issue.path)).toBe(true);
    for (const key of issue.path) expect(["string", "number"]).toContain(typeof key);
    expect(ISSUE_KINDS.has(issue.kind), `issue kind ${issue.kind}`).toBe(true);
  }
  expect(e.message).toBe(`Invalid ${e.variant} message: ${e.issues.length} issue(s)`);
  expect("cause" in e).toBe(false);
  expect(e.cause).toBeUndefined();
  for (const text of renderings(e)) {
    for (const sentinel of sentinels) {
      expect(text.includes(sentinel), "a sentinel value leaked into the error").toBe(false);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Property 18 inputs: a valid message with sentinels planted, then one mutation of Properties
// 7–13 that makes it invalid.

/** Fields whose value may carry a sentinel (Property 18), by key name. */
const SENTINEL_KEYS: ReadonlySet<string> = new Set([
  "device_id",
  "event_id",
  "cmd_id",
  "turn_id",
  "content_id",
  "auth",
  "fw_ver",
  "card_id",
  "code",
  "detail",
  "active_child_id",
  "manifest_url",
]);

function isSentinelField(spec: FieldSpec): boolean {
  const key = spec.path[spec.path.length - 1] as string;
  return SENTINEL_KEYS.has(key) || spec.kind.t === "openVocab";
}

/** The planted value: the sentinel itself, or inside a valid https URL for `manifest_url`. */
function plantedValue(spec: FieldSpec, sentinel: string): string {
  return spec.kind.t === "httpsUrl" ? `https://localhost/${sentinel}` : sentinel;
}

type Planted = { readonly message: JsonObject; readonly sentinels: readonly string[] };

/** A generated message with a sentinel in every applicable sentinel field (still valid). */
function plantedArb(v: VariantCase): fc.Arbitrary<Planted> {
  return v.arb.chain((m) => {
    const specs = applicableFields(m).filter(isSentinelField);
    return fc
      .array(sentinelArb, { minLength: specs.length, maxLength: specs.length })
      .map((sentinels) => {
        let message = structuredClone(m) as JsonObject;
        specs.forEach((spec, i) => {
          message = setAt(message, spec.path, plantedValue(spec, sentinels[i] as string));
        });
        return { message, sentinels };
      });
  });
}

/** A JSON value carrying `sentinel`, for the value of an added unknown key. */
function sentinelValueArb(sentinel: string): fc.Arbitrary<unknown> {
  return fc.constantFrom<unknown>(sentinel, [sentinel], { nested: sentinel });
}

const REMOVE: unique symbol = Symbol("remove");

function orRemove(arb: fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant<unknown>(REMOVE) },
    { weight: 4, arbitrary: arb },
  );
}

/** Removes the field (REMOVE) or sets it to one value from `replacement`, for one of `specs`. */
function mutateField(
  m: JsonObject,
  specs: readonly FieldSpec[],
  replacement: (spec: FieldSpec) => fc.Arbitrary<unknown>,
): fc.Arbitrary<JsonObject> | null {
  if (specs.length === 0) return null;
  return fc
    .constantFrom(...specs)
    .chain((spec) =>
      replacement(spec).map((value) =>
        value === REMOVE ? deleteAt(m, spec.path) : setAt(m, spec.path, value),
      ),
    );
}

/** One mutation from the families of Properties 7–13, applied to the planted message. */
function invalidPlantedArb(v: VariantCase): fc.Arbitrary<Planted> {
  return fc.tuple(plantedArb(v), sentinelArb).chain(([{ message: m, sentinels }, extra]) => {
    const present = presentFields(m);
    const applicable = applicableFields(m);
    const families: (fc.Arbitrary<JsonObject> | null)[] = [
      // Property 7: an unknown key whose value carries a sentinel.
      fc
        .constantFrom(...objectPositions(m))
        .chain((position) =>
          fc
            .tuple(unknownKeyArb(v.name, position), sentinelValueArb(extra))
            .map(([key, value]) => addKey(m, position, key, value)),
        ),
      // Property 8: proto_ver (and hello proto) other than 2, or removed.
      mutateField(
        m,
        present.filter((s) => s.kind.t === "literal2"),
        () => orRemove(notTwoArb),
      ),
      // Property 9: a wrong or missing Discriminator.
      mutateField(
        m,
        present.filter((s) => s.kind.t === "discriminator"),
        (s) =>
          s.kind.t === "discriminator"
            ? orRemove(badDiscriminatorArb(s.kind.defined))
            : fc.constant(REMOVE),
      ),
      // Property 10: a Closed_Enum value outside its list.
      mutateField(
        m,
        present.filter((s) => s.kind.t === "closedEnum"),
        (s) => {
          if (s.kind.t !== "closedEnum") throw new Error("not a closed enum");
          const alsoAccepts = s.kind.alsoAccepts ?? [];
          return enumPerturbationArb(s.kind.values).filter((x) => !alsoAccepts.includes(x));
        },
      ),
      // Property 11: a bounded number out of range.
      mutateField(
        m,
        applicable.filter((s) => BOUNDED_KINDS.has(s.kind.t) && s.kind.t !== "unixSeconds"),
        (s) => outOfRangeArb(s.kind),
      ),
      // Property 12: a required field removed, or a field given a wrong JSON type.
      mutateField(m, requiredFields(m), () => fc.constant<unknown>(REMOVE)),
      mutateField(m, applicable, (s) => wrongTypeArb(s.kind)),
      // Property 13: a bad or missing ts.
      mutateField(
        m,
        present.filter((s) => s.kind.t === "unixSeconds"),
        () => orRemove(badTsArb),
      ),
    ];
    const usable = families.filter((f): f is fc.Arbitrary<JsonObject> => f !== null);
    return fc.oneof(...usable).map((message) => ({ message, sentinels: [...sentinels, extra] }));
  });
}

// ---------------------------------------------------------------------------------------------
// Property 19 inputs.

/** Text that is not JSON. */
const malformedJsonArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    "",
    " ",
    "{",
    "[",
    "}",
    "nul",
    "tru",
    "undefined",
    "NaN",
    "{'a':1}",
    '{"a":}',
    '{"a":1,}',
    '"unterminated',
    "{} {}",
    "\u0000",
  ),
  // A JSON object text cut short.
  fc
    .dictionary(fc.string(), fc.jsonValue(), { minKeys: 1, maxKeys: 3 })
    .map((o) => JSON.stringify(o))
    .chain((s) => fc.nat({ max: s.length - 1 }).map((n) => s.slice(0, n))),
);

/** JSON text whose top level is not an object. */
const nonObjectJsonArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constant<unknown>(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.array(fc.jsonValue(), { maxLength: 3 }),
  )
  .map((x) => JSON.stringify(x));

/** Any string, plus JSON of arbitrary objects and the cases above. */
const anyTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.string({ unit: "grapheme" }),
  fc.string({ unit: "binary" }),
  malformedJsonArb,
  nonObjectJsonArb,
  fc.jsonValue().map((x) => JSON.stringify(x)),
  fc.object().map((x) => JSON.stringify(x)),
);

/** The issue a parser must report for input that is not JSON text of an object, or null. */
function expectedEnvelopeIssue(input: unknown): ContractIssue | null {
  if (typeof input !== "string") return { path: [], kind: "invalid_type" };
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return { path: [], kind: "invalid_json" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { path: [], kind: "not_object" };
  }
  return null;
}

/** Calls `parse` and checks it returned a Parse_Result rather than throwing. */
function callNoThrow(parse: () => ParseResult<unknown>): ParseResult<unknown> {
  let result: ParseResult<unknown> | undefined;
  expect(() => {
    result = parse();
  }).not.toThrow();
  expect(typeof result).toBe("object");
  const r = result as ParseResult<unknown>;
  expect(typeof r.ok).toBe("boolean");
  if (!r.ok) expect(r.error).toBeInstanceOf(ContractError);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Properties.

describe("contract errors", () => {
  // Feature: phase-1-gateway-contract, Property 18: Contract errors are well-formed and leak no values
  it.each(CASES)("Property 18: %s errors are well-formed and leak no values", (_name, v) => {
    fc.assert(
      fc.property(invalidPlantedArb(v), ({ message, sentinels }) => {
        const text = JSON.stringify(message);
        expectWellFormed(expectFailure(v.parse(text)), sentinels);
        expectWellFormed(expectFailure(v.union(text)), sentinels);
        if (v.topic !== null) {
          expectWellFormed(expectFailure(parseDeviceMessage(v.topic, text)), sentinels);
        }
        let thrown: unknown;
        try {
          v.serialise(message as never);
        } catch (error) {
          thrown = error;
        }
        expectWellFormed(thrown, sentinels);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 19: Result parsers never throw
  it("Property 19: Result parsers never throw and report non-object input at []", () => {
    const inputArb: fc.Arbitrary<unknown> = fc.oneof(
      { weight: 4, arbitrary: anyTextArb },
      { weight: 1, arbitrary: fc.anything() },
    );
    fc.assert(
      fc.property(inputArb, (input) => {
        const expected = expectedEnvelopeIssue(input);
        for (const parse of RESULT_PARSERS) {
          const result = callNoThrow(() => parse(input as string));
          if (expected !== null) expect(expectFailure(result).issues).toEqual([expected]);
        }
        for (const suffix of TOPIC_SUFFIXES) {
          const result = callNoThrow(() => parseDeviceMessage(suffix, input as string));
          if (suffix === "cmd") {
            // A device never publishes on cmd; the text is not read.
            expect(expectFailure(result).issues).toEqual([{ path: [], kind: "wrong_topic" }]);
          } else if (expected !== null) {
            expect(expectFailure(result).issues).toEqual([expected]);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never carries the SyntaxError text of invalid JSON", () => {
    const inputs = [
      "§leaky_sentinel_value is not json",
      '{"device_id": "§leaky_sentinel_value", ',
      "{'auth': '§leaky_sentinel_value'}",
      "§leaky_sentinel_value",
    ];
    for (const input of inputs) {
      let syntaxMessage = "";
      try {
        JSON.parse(input);
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
        syntaxMessage = (error as SyntaxError).message;
      }
      expect(syntaxMessage.length).toBeGreaterThan(0);
      for (const parse of RESULT_PARSERS) {
        const error = expectFailure(parse(input));
        expect(error.issues).toEqual([{ path: [], kind: "invalid_json" }]);
        expectWellFormed(error, ["§leaky_sentinel_value"]);
        for (const text of renderings(error)) expect(text).not.toContain(syntaxMessage);
      }
    }
  });
});
