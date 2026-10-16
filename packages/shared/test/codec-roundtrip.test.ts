// Round-trip properties for every Document B v2 variant: Properties 3, 4 and 5.
// Requirements 4.1–4.4, 5.1–5.9, 6.1–6.3, 7.1, 8.1–8.14, 10.2, 10.5, 10.6, 11.1–11.3, 11.5.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseDeviceMessage, type ParseResult } from "../dist/index.js";

import { VARIANTS, type VariantCase } from "./arbitraries.js";
import { isPlainObject, variantNameOf } from "./mutations.js";

const NUM_RUNS = 200;

/** One `it.each` row per variant: the label first so `%s` names the case. */
const CASES: readonly (readonly [string, VariantCase])[] = VARIANTS.map((v) => [v.name, v]);

/**
 * True when `value` is JSON-representable without loss (C22): null, booleans, strings, finite
 * numbers other than -0, arrays of such values, and plain objects whose values are all such
 * values (so no key holds `undefined`).
 */
function isJsonRepresentable(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value) && !Object.is(value, -0);
    case "object":
      if (Array.isArray(value)) return value.every(isJsonRepresentable);
      return isPlainObject(value) && Object.values(value).every(isJsonRepresentable);
    default:
      return false;
  }
}

/** The success value of a Parse_Result; fails the test on a failure result. */
function expectOk<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected success, got issues ${JSON.stringify(result.error.issues)} (${result.error.variant})`,
    );
  }
  return result.value;
}

describe("codec round trip", () => {
  // Feature: phase-1-gateway-contract, Property 3: Variant round trip
  it.each(CASES)("Property 3: %s survives serialise then parse", (_name, v) => {
    fc.assert(
      fc.property(v.arb, (m) => {
        expect(isJsonRepresentable(m)).toBe(true);
        const text = v.serialise(m as never);
        expect(JSON.parse(text)).toEqual(m);
        expect(expectOk(v.parse(text))).toEqual(m);
        expect(v.parseOrThrow(text)).toEqual(m);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 4: Union round trip
  it.each(CASES)("Property 4: %s survives its union parser and topic dispatch", (_name, v) => {
    const { topic } = v;
    fc.assert(
      fc.property(v.arb, (m) => {
        const text = v.serialise(m as never);
        const value = expectOk(v.union(text));
        expect(value).toEqual(m);
        expect(variantNameOf(value)).toBe(v.name);
        // hello, status, events and ack also go through parseDeviceMessage on their own topic.
        if (topic !== null) {
          const dispatched = expectOk(parseDeviceMessage(topic, text));
          expect(dispatched).toEqual(m);
          expect(variantNameOf(dispatched)).toBe(v.name);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 5: Serialisation is stable
  it.each(CASES)("Property 5: %s serialises to the same text after a round trip", (_name, v) => {
    fc.assert(
      fc.property(v.arb, (m) => {
        const first = v.serialise(m as never);
        const second = v.serialise(v.parseOrThrow(first) as never);
        expect(second).toBe(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
