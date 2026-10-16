// Rejection properties for every Document B v2 variant: Properties 7–13 and 20.
// Requirements 2.1–2.5, 3.1–3.7, 4.2, 5.2, 5.4, 5.8, 5.9, 6.5, 8.2, 8.5, 8.6, 8.13, 9.1, 10.4,
// 10.7, 12.1–12.7.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ContractError, type ContractIssue, type ParseResult } from "../dist/index.js";

import { VARIANTS, variantByName, withEdges, type VariantCase } from "./arbitraries.js";
import {
  BOUNDED_KINDS,
  addKey,
  applicableFields,
  badDiscriminatorArb,
  badTsArb,
  deleteAt,
  enumPerturbationArb,
  getAt,
  notTwoArb,
  objectPositions,
  optionalRemovalCases,
  outOfRangeArb,
  presentFields,
  requiredFields,
  setAt,
  unknownKeyArb,
  wrongTypeArb,
  type FieldKind,
  type FieldSpec,
  type JsonObject,
} from "./mutations.js";

const NUM_RUNS = 200;

type Case = readonly [string, VariantCase];

/** One `it.each` row per variant: the label first so `%s` names the case. */
function casesOf(variants: readonly VariantCase[]): Case[] {
  return variants.map((v) => [v.name, v]);
}

const CASES = casesOf(VARIANTS);

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

function samePath(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

function hasIssueAt(issues: readonly ContractIssue[], path: readonly string[]): boolean {
  return issues.some((issue) => samePath(issue.path, path));
}

/** Both the variant parser and its union parser reject `message` (sent as JSON text). */
function expectBothReject(v: VariantCase, message: unknown): readonly ContractIssue[] {
  const text = JSON.stringify(message);
  const issues = expectFailure(v.parse(text));
  expectFailure(v.union(text));
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Mutation families. Each produces messages that must be rejected; Property 20 reuses them all.

/** Marks a replacement that removes the field instead of setting it. */
const REMOVE: unique symbol = Symbol("remove");

/** Removal at weight 1 against a replacement value at weight 4. */
function orRemove(arb: fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant<unknown>(REMOVE) },
    { weight: 4, arbitrary: arb },
  );
}

type FieldMutation = {
  readonly message: JsonObject;
  readonly spec: FieldSpec;
};

/**
 * A generated message with one field picked by `pick` either removed (when the replacement
 * arbitrary yields REMOVE) or set to a value from `replacement`.
 */
function fieldMutationArb(
  v: VariantCase,
  pick: (m: unknown) => readonly FieldSpec[],
  replacement: (spec: FieldSpec) => fc.Arbitrary<unknown>,
): fc.Arbitrary<FieldMutation> {
  return v.arb
    .filter((m) => pick(m).length > 0)
    .chain((m) =>
      fc.constantFrom(...pick(m)).chain((spec) =>
        replacement(spec).map((value) => ({
          message: value === REMOVE ? deleteAt(m, spec.path) : setAt(m, spec.path, value),
          spec,
        })),
      ),
    );
}

type UnknownKeyMutation = {
  readonly message: JsonObject;
  readonly position: readonly string[];
  readonly key: string;
};

/** Property 7: an undefined key with any JSON value at any object position. */
function unknownKeyFamily(v: VariantCase): fc.Arbitrary<UnknownKeyMutation> {
  return v.arb.chain((m) =>
    fc.constantFrom(...objectPositions(m)).chain((position) =>
      fc.tuple(unknownKeyArb(v.name, position), fc.jsonValue()).map(([key, value]) => ({
        message: addKey(m, position, key, value),
        position,
        key,
      })),
    ),
  );
}

const isKind =
  (t: FieldKind["t"]) =>
  (spec: FieldSpec): boolean =>
    spec.kind.t === t;

/** Property 8: `proto_ver` (and hello `proto`) removed or set to anything but the number 2. */
function literal2Family(v: VariantCase): fc.Arbitrary<FieldMutation> {
  return fieldMutationArb(
    v,
    (m) => presentFields(m).filter(isKind("literal2")),
    () => orRemove(notTwoArb),
  );
}

/** Property 9: a Discriminator removed, or set outside its defined values or to a non-string. */
function discriminatorFamily(v: VariantCase): fc.Arbitrary<FieldMutation> {
  return fieldMutationArb(
    v,
    (m) => presentFields(m).filter(isKind("discriminator")),
    (spec) => {
      if (spec.kind.t !== "discriminator") throw new Error("not a discriminator");
      return orRemove(badDiscriminatorArb(spec.kind.defined));
    },
  );
}

/** Property 10: a Closed_Enum field set to a string outside its accepted values. */
function closedEnumFamily(v: VariantCase): fc.Arbitrary<FieldMutation> {
  return fieldMutationArb(
    v,
    (m) => presentFields(m).filter(isKind("closedEnum")),
    (spec) => {
      const { kind } = spec;
      if (kind.t !== "closedEnum") throw new Error("not a closed enum");
      const alsoAccepts = kind.alsoAccepts ?? [];
      return enumPerturbationArb(kind.values).filter((s) => !alsoAccepts.includes(s));
    },
  );
}

/** Bounded numeric kinds for Property 11; `ts` has its own property (13). */
function isRangeKind(spec: FieldSpec): boolean {
  return BOUNDED_KINDS.has(spec.kind.t) && spec.kind.t !== "unixSeconds";
}

/** Property 11: a bounded numeric field (present or optional-but-absent) set out of range. */
function outOfRangeFamily(v: VariantCase): fc.Arbitrary<FieldMutation> {
  return fieldMutationArb(
    v,
    (m) => applicableFields(m).filter(isRangeKind),
    (spec) => outOfRangeArb(spec.kind),
  );
}

/** Property 12: a required field removed, or any applicable field set to a wrong JSON type. */
function requiredOrWrongTypeFamily(v: VariantCase): fc.Arbitrary<FieldMutation> {
  return fc.oneof(
    fieldMutationArb(v, requiredFields, () => fc.constant<unknown>(REMOVE)),
    fieldMutationArb(v, applicableFields, (spec) => wrongTypeArb(spec.kind)),
  );
}

/** Property 13: `ts` removed or set to a negative, non-integer, unsafe or string value. */
function badTsFamily(v: VariantCase): fc.Arbitrary<FieldMutation> {
  return fieldMutationArb(
    v,
    (m) => presentFields(m).filter(isKind("unixSeconds")),
    () => orRemove(badTsArb),
  );
}

const hasClosedEnum = (v: VariantCase): boolean => v.fields.some(isKind("closedEnum"));
const hasRangeField = (v: VariantCase): boolean => v.fields.some(isRangeKind);
const isDeviceVariant = (v: VariantCase): boolean => v.envelope === "device";

/** Every rejected-input family of Properties 7–13 that applies to the variant. */
function invalidMessageArb(v: VariantCase): fc.Arbitrary<JsonObject> {
  const families: fc.Arbitrary<JsonObject>[] = [
    unknownKeyFamily(v).map((x) => x.message),
    literal2Family(v).map((x) => x.message),
    discriminatorFamily(v).map((x) => x.message),
    requiredOrWrongTypeFamily(v).map((x) => x.message),
  ];
  if (hasClosedEnum(v)) families.push(closedEnumFamily(v).map((x) => x.message));
  if (hasRangeField(v)) families.push(outOfRangeFamily(v).map((x) => x.message));
  if (isDeviceVariant(v)) families.push(badTsFamily(v).map((x) => x.message));
  return fc.oneof(...families);
}

// ---------------------------------------------------------------------------------------------
// Properties.

describe("codec rejection", () => {
  // Feature: phase-1-gateway-contract, Property 7: Unknown keys are rejected at every depth
  it.each(CASES)("Property 7: %s rejects unknown keys at every depth", (_name, v) => {
    fc.assert(
      fc.property(unknownKeyFamily(v), ({ message, position, key }) => {
        const text = JSON.stringify(message);
        const expected = [...position, key];
        for (const parse of [v.parse, v.union]) {
          const issues = expectFailure(parse(text));
          expect(
            issues.some(
              (issue) => issue.kind === "unrecognized_keys" && samePath(issue.path, expected),
            ),
            `unrecognized_keys at ${JSON.stringify(expected)}`,
          ).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a __proto__ key at every depth without polluting Object.prototype", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const payload = { polluted: true };
    const examples: readonly (readonly [VariantCase, JsonObject, readonly string[]])[] = [
      [
        variantByName("hello"),
        {
          proto_ver: 2,
          ts: 1733400000,
          type: "hello",
          device_id: "xlu_8f3a2c",
          fw_ver: "0.4.1",
          auth: "placeholder",
          proto: 2,
        },
        [],
      ],
      [
        variantByName("interrupt event"),
        {
          proto_ver: 2,
          ts: 1733400010,
          type: "event",
          event_id: "e_1",
          event: "interrupt",
          data: {},
        },
        ["data"],
      ],
      [
        variantByName("config cmd"),
        {
          proto_ver: 2,
          cmd_id: "c_1",
          action: "config",
          data: { quiet_hours: { start: "20:00", end: "07:00" } },
        },
        ["data", "quiet_hours"],
      ],
    ];
    for (const [v, valid, position] of examples) {
      expectOk(v.parse(JSON.stringify(valid)));
      const text = JSON.stringify(addKey(valid, position, "__proto__", payload));
      expect(text).toContain('"__proto__"');
      for (const parse of [v.parse, v.union]) {
        const issues = expectFailure(parse(text));
        expect(
          issues.some(
            (issue) =>
              issue.kind === "unrecognized_keys" &&
              samePath(issue.path, [...position, "__proto__"]),
          ),
        ).toBe(true);
      }
      expect(() => v.parseOrThrow(text)).toThrow(ContractError);
    }
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  // Feature: phase-1-gateway-contract, Property 8: Literal-2 fields
  it.each(CASES)("Property 8: %s rejects proto_ver (and proto) other than 2", (_name, v) => {
    fc.assert(
      fc.property(literal2Family(v), ({ message, spec }) => {
        const issues = expectBothReject(v, message);
        expect(hasIssueAt(issues, spec.path), `issue at ${spec.path.join(".")}`).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 9: Discriminators are exact
  it.each(CASES)("Property 9: %s rejects a wrong or missing discriminator", (_name, v) => {
    fc.assert(
      fc.property(discriminatorFamily(v), ({ message, spec }) => {
        const issues = expectBothReject(v, message);
        expect(hasIssueAt(issues, spec.path), `issue at ${spec.path.join(".")}`).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 10: Closed enums are exact
  it.each(casesOf(VARIANTS.filter(hasClosedEnum)))(
    "Property 10: %s rejects closed-enum values outside the list",
    (_name, v) => {
      fc.assert(
        fc.property(closedEnumFamily(v), ({ message }) => {
          expectBothReject(v, message);
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  // Feature: phase-1-gateway-contract, Property 11: Bounded numbers are enforced
  it.each(casesOf(VARIANTS.filter(hasRangeField)))(
    "Property 11: %s rejects out-of-range and non-integer numbers",
    (_name, v) => {
      fc.assert(
        fc.property(outOfRangeFamily(v), ({ message }) => {
          expectBothReject(v, message);
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  it("Property 11 examples: dir_deg -1, 360 and 45.5, and negative speeds, are rejected", () => {
    const wake = variantByName("wake event");
    const validWake = {
      proto_ver: 2,
      ts: 1733400010,
      type: "event",
      event_id: "e_1",
      event: "wake",
      data: { source: "hey_lulu", dir_deg: 90 },
    };
    expectOk(wake.parse(JSON.stringify(validWake)));
    for (const bad of [-1, 360, 45.5, 0.5, 359.5]) {
      expectBothReject(wake, setAt(validWake, ["data", "dir_deg"], bad));
    }

    const move = variantByName("move cmd");
    const moves = [
      { cmd: "come", linear_mms: 100, angular_mrad_s: 0, max_dist_mm: 2000 },
      { cmd: "turn", linear_mms: 0, angular_mrad_s: 500, max_dist_mm: 0 },
      { cmd: "stop", max_dist_mm: 0 },
    ];
    for (const data of moves) {
      const valid = { proto_ver: 2, cmd_id: "c_1", action: "move", data };
      expectOk(move.parse(JSON.stringify(valid)));
      for (const key of ["linear_mms", "angular_mrad_s", "max_dist_mm"]) {
        for (const bad of [-1, -0.001, -Number.MAX_VALUE]) {
          expectBothReject(move, setAt(valid, ["data", key], bad));
        }
      }
    }
  });

  // Feature: phase-1-gateway-contract, Property 12: Required fields and JSON types are enforced
  it.each(CASES)("Property 12: %s enforces required fields and JSON types", (_name, v) => {
    fc.assert(
      fc.property(fc.tuple(v.arb, requiredOrWrongTypeFamily(v)), ([valid, { message }]) => {
        // A required field removed, or any applicable field given a wrong JSON type.
        expectBothReject(v, message);

        // Removing any optional field present keeps the message valid.
        for (const path of optionalRemovalCases(valid)) {
          expectOk(v.parse(JSON.stringify(deleteAt(valid, path))));
        }

        // Ruling 4: speeds are required on come and turn, optional on stop; max_dist_mm always.
        if (v.name === "move cmd") {
          const isStop = getAt(valid, ["data", "cmd"]) === "stop";
          const linear = ["data", "linear_mms"] as const;
          const angular = ["data", "angular_mrad_s"] as const;
          for (const path of [linear, angular]) {
            const result = v.parse(JSON.stringify(deleteAt(valid, path)));
            expect(result.ok, `remove ${path.join(".")}`).toBe(isStop);
          }
          const neither = v.parse(JSON.stringify(deleteAt(deleteAt(valid, linear), angular)));
          expect(neither.ok, "remove both speeds").toBe(isStop);
          expectBothReject(v, deleteAt(valid, ["data", "max_dist_mm"]));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 13: `ts` accepts exactly the non-negative safe integers
  it.each(casesOf(VARIANTS.filter(isDeviceVariant)))(
    "Property 13: %s accepts ts in [0, 2^53 - 1] and rejects anything else",
    (_name, v) => {
      const goodTs = withEdges(fc.maxSafeNat(), [0, Number.MAX_SAFE_INTEGER]);
      fc.assert(
        fc.property(v.arb, goodTs, badTsFamily(v), (valid, t, { message }) => {
          const value = expectOk(v.parse(JSON.stringify(setAt(valid, ["ts"], t))));
          expect(getAt(value, ["ts"])).toBe(t);
          expectFailure(v.parse(JSON.stringify(message)));
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );

  // Feature: phase-1-gateway-contract, Property 20: Throwing and serialising variants agree with the Result variant
  it.each(CASES)(
    "Property 20: %s OrThrow and serialise agree with the Result parser",
    (_name, v) => {
      fc.assert(
        fc.property(invalidMessageArb(v), (bad) => {
          const text = JSON.stringify(bad);
          const issues = expectFailure(v.parse(text));

          let thrown: unknown;
          try {
            v.parseOrThrow(text);
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(ContractError);
          expect((thrown as ContractError).issues).toEqual(issues);

          let output: string | undefined;
          let serialiseError: unknown;
          try {
            output = v.serialise(bad as never);
          } catch (error) {
            serialiseError = error;
          }
          expect(serialiseError).toBeInstanceOf(ContractError);
          expect(output).toBeUndefined();
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );
});
