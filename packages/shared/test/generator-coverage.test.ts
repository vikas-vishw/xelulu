// Generator coverage: 1,000 fixed-seed samples per Message_Generator reach every optional field
// state, closed-enum value and boundary value that Requirement 11.6 lists.
// Requirements 11.1 and 11.6.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VARIANTS, type VariantCase } from "./arbitraries.js";
import { getAt, hasAt, type FieldSpec, type VariantName } from "./mutations.js";

const SEED = 20261008;
const SAMPLES = 1000;

/** Boundary values per variant (Requirement 11.6), besides `ts` on every device envelope. */
const BOUNDARIES: Partial<Record<VariantName, readonly (readonly [string, readonly unknown[]])[]>> =
  {
    status: [["battery_pct", [0, 100]]],
    "wake event": [["data.dir_deg", [0, 359]]],
    "cry event": [
      ["data.confidence", [0, 1]],
      ["data.duration_s", [0]],
    ],
    "error event": [
      ["data.code", [""]],
      ["data.detail", [""]],
    ],
    "say cmd": [["data.duration_hint_ms", [0]]],
    "move cmd": [
      ["data.max_dist_mm", [0]],
      ["data.linear_mms", [0]],
      ["data.angular_mrad_s", [0]],
    ],
    "led cmd": [["data.brightness", [0, 100]]],
    "volume cmd": [["data.level", [0, 100]]],
    "config cmd": [
      ["data.volume", [0, 100]],
      ["data.quiet_hours.start", ["00:00", "23:59"]],
      ["data.quiet_hours.end", ["00:00", "23:59"]],
    ],
  };
const TS_EDGES: readonly unknown[] = [0, Number.MAX_SAFE_INTEGER];

const sampleCache = new Map<VariantName, readonly unknown[]>();

/** 1,000 messages from the variant's generator with the fixed seed, sampled once per variant. */
function samplesOf(v: VariantCase): readonly unknown[] {
  let samples = sampleCache.get(v.name);
  if (!samples) {
    samples = fc.sample(v.arb, { seed: SEED, numRuns: SAMPLES });
    sampleCache.set(v.name, samples);
  }
  return samples;
}

const label = (path: readonly string[]): string => path.join(".");
const pathOf = (dotted: string): readonly string[] => dotted.split(".");

/** Values of `wanted` never seen at `path` in `samples`, as readable labels. */
function missingValues(
  samples: readonly unknown[],
  path: readonly string[],
  wanted: readonly unknown[],
): string[] {
  return wanted
    .filter((w) => !samples.some((m) => hasAt(m, path) && getAt(m, path) === w))
    .map((w) => `${label(path)}=${JSON.stringify(w)}`);
}

/** "present" and/or "absent" for any state of `path` never seen in `samples`. */
function missingPresence(samples: readonly unknown[], path: readonly string[]): string[] {
  const missing: string[] = [];
  if (!samples.some((m) => hasAt(m, path))) missing.push(`${label(path)} present`);
  if (!samples.some((m) => !hasAt(m, path))) missing.push(`${label(path)} absent`);
  return missing;
}

const closedEnumFields = (v: VariantCase): FieldSpec[] =>
  v.fields.filter((spec) => spec.kind.t === "closedEnum");
const optionalFields = (v: VariantCase): FieldSpec[] =>
  v.fields.filter((spec) => spec.required === false);
const conditionalFields = (v: VariantCase): FieldSpec[] =>
  v.fields.filter((spec) => typeof spec.required === "object");
const nullableFields = (v: VariantCase): FieldSpec[] =>
  v.fields.filter((spec) => spec.kind.t === "nullableString");

/** `it.each` rows for the variants where `pick` finds something to check. */
function casesWith(
  pick: (v: VariantCase) => readonly unknown[],
): (readonly [string, VariantCase])[] {
  return VARIANTS.filter((v) => pick(v).length > 0).map((v) => [v.name, v] as const);
}

describe("generator coverage (Requirement 11.6)", () => {
  it.each(VARIANTS.map((v) => [v.name, v] as const))(
    "%s: samples 1,000 messages with the fixed seed",
    (_name, v) => {
      expect(samplesOf(v)).toHaveLength(SAMPLES);
    },
  );

  it.each(casesWith(closedEnumFields))(
    "%s: uses every closed-enum value (ack reason also as empty)",
    (_name, v) => {
      const samples = samplesOf(v);
      const missing = closedEnumFields(v).flatMap((spec) => {
        if (spec.kind.t !== "closedEnum") return [];
        const wanted = [...spec.kind.values, ...(spec.kind.alsoAccepts ?? [])];
        return missingValues(samples, spec.path, wanted);
      });
      expect(missing).toEqual([]);
    },
  );

  it.each(casesWith(optionalFields))(
    "%s: has each optional field both present and absent",
    (_name, v) => {
      const samples = samplesOf(v);
      const missing = optionalFields(v).flatMap((spec) => missingPresence(samples, spec.path));
      expect(missing).toEqual([]);
    },
  );

  it.each(casesWith(conditionalFields))(
    "%s: has each conditionally required field present and absent where it is optional",
    (_name, v) => {
      const samples = samplesOf(v);
      const missing = conditionalFields(v).flatMap((spec) => {
        const { required } = spec;
        if (typeof required !== "object") return [];
        const { path: whenPath, in: requiredIn } = required.when;
        // Group the samples by the sibling value; check the groups where the field is optional.
        const values = [
          ...new Set(
            samples
              .map((m) => getAt(m, whenPath))
              .filter((x): x is string => typeof x === "string"),
          ),
        ];
        const optionalValues = values.filter((value) => !requiredIn.includes(value));
        if (optionalValues.length === 0) return [`${label(spec.path)}: no optional case sampled`];
        return optionalValues.flatMap((value) =>
          missingPresence(
            samples.filter((m) => getAt(m, whenPath) === value),
            spec.path,
          ).map((s) => `${s} when ${label(whenPath)}=${value}`),
        );
      });
      expect(missing).toEqual([]);
    },
  );

  it("move: stop moves carry each speed both present and absent", () => {
    const move = VARIANTS.find((v) => v.name === "move cmd");
    if (!move) throw new Error("move cmd variant missing");
    const stops = samplesOf(move).filter((m) => getAt(m, ["data", "cmd"]) === "stop");
    const missing = ["data.linear_mms", "data.angular_mrad_s"].flatMap((p) =>
      missingPresence(stops, pathOf(p)),
    );
    expect(missing).toEqual([]);
  });

  it.each(casesWith(nullableFields))(
    "%s: has active_child_id as a string and as null",
    (_name, v) => {
      const samples = samplesOf(v);
      const missing = nullableFields(v).flatMap((spec) => {
        const out: string[] = [];
        if (!samples.some((m) => typeof getAt(m, spec.path) === "string")) {
          out.push(`${label(spec.path)} as a string`);
        }
        if (!samples.some((m) => hasAt(m, spec.path) && getAt(m, spec.path) === null)) {
          out.push(`${label(spec.path)} as null`);
        }
        return out;
      });
      expect(missing).toEqual([]);
    },
  );

  it.each(VARIANTS.filter((v) => v.envelope === "device").map((v) => [v.name, v] as const))(
    "%s: has ts 0 and 9007199254740991",
    (_name, v) => {
      expect(missingValues(samplesOf(v), ["ts"], TS_EDGES)).toEqual([]);
    },
  );

  it.each(casesWith((v) => BOUNDARIES[v.name] ?? []))(
    "%s: reaches every listed boundary value",
    (_name, v) => {
      const samples = samplesOf(v);
      const missing = (BOUNDARIES[v.name] ?? []).flatMap(([p, wanted]) =>
        missingValues(samples, pathOf(p), wanted),
      );
      expect(missing).toEqual([]);
    },
  );
});
