// Requirement 16: age-stage derivation (Properties 21-25 plus unit examples).
// The reference model and date helpers below are test-local and independent of src.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGE_STAGES, deriveAgeStage } from "../dist/index.js";
import type { AgeStage, AgeStageError, AgeStageResult } from "../dist/index.js";

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------------------------
// Test-local calendar helpers.
type Day = { readonly y: number; readonly m: number; readonly d: number };

const isLeap = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const daysIn = (y: number, m: number): number =>
  m === 2 && isLeap(y) ? 29 : (MONTH_DAYS[m - 1] ?? 0);

const pad = (n: number, width: number): string => String(n).padStart(width, "0");
const fmt = (day: Day): string => `${pad(day.y, 4)}-${pad(day.m, 2)}-${pad(day.d, 2)}`;
const key = (day: Day): number => day.y * 10000 + day.m * 100 + day.d;
const cmp = (a: Day, b: Day): number => key(a) - key(b);

function prevDay(day: Day): Day {
  if (day.d > 1) return { y: day.y, m: day.m, d: day.d - 1 };
  if (day.m > 1) return { y: day.y, m: day.m - 1, d: daysIn(day.y, day.m - 1) };
  return { y: day.y - 1, m: 12, d: 31 };
}

/** The nth birthday: 29 February moves to 1 March when the target year is not a leap year. */
function nthBirthday(birth: Day, n: number): Day {
  const y = birth.y + n;
  if (birth.m === 2 && birth.d === 29 && !isLeap(y)) return { y, m: 3, d: 1 };
  return { y, m: birth.m, d: birth.d };
}

/** Reference model: the largest n whose nth birthday is on or before the reference date. */
function modelStage(birth: Day, ref: Day): AgeStage {
  let n = ref.y - birth.y;
  while (n > 0 && cmp(nthBirthday(birth, n), ref) > 0) n -= 1;
  return n < 3 ? "tiny" : n < 6 ? "little" : n < 9 ? "explorer" : "maker";
}

const stageIndex = (stage: AgeStage): number => AGE_STAGES.indexOf(stage);

function okValue(result: AgeStageResult): AgeStage {
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}`);
  return result.value;
}

// ---------------------------------------------------------------------------------------------
// Generators.
const dayInYears = (minY: number, maxY: number): fc.Arbitrary<Day> =>
  fc
    .record({ y: fc.integer({ min: minY, max: maxY }), m: fc.integer({ min: 1, max: 12 }) })
    .chain(({ y, m }) => fc.integer({ min: 1, max: daysIn(y, m) }).map((d) => ({ y, m, d })));

/** A 29 February in a leap year within [minY, maxY]. */
const leapDay = (minY: number, maxY: number): fc.Arbitrary<Day> =>
  fc
    .integer({ min: Math.ceil(minY / 4), max: Math.floor(maxY / 4) })
    .map((q) => q * 4)
    .filter(isLeap)
    .map((y) => ({ y, m: 2, d: 29 }));

/** A valid birth date, with 29 February and modern years well represented. */
const birthArb = (maxY = 9999): fc.Arbitrary<Day> =>
  fc.oneof(
    { weight: 3, arbitrary: dayInYears(1, maxY) },
    { weight: 3, arbitrary: dayInYears(Math.min(1990, maxY), Math.min(2030, maxY)) },
    { weight: 2, arbitrary: leapDay(4, maxY) },
  );

/** A valid reference date on or after `birth`, mostly within the 0-13 year window. */
const refOnOrAfter = (birth: Day): fc.Arbitrary<Day> => {
  const boundaries = [3, 6, 9]
    .filter((n) => birth.y + n <= 9999)
    .flatMap((n) => [nthBirthday(birth, n), prevDay(nthBirthday(birth, n))]);
  return fc
    .oneof(
      { weight: 4, arbitrary: dayInYears(birth.y, Math.min(9999, birth.y + 13)) },
      { weight: 1, arbitrary: dayInYears(birth.y, 9999) },
      { weight: 1, arbitrary: fc.constantFrom(birth, ...boundaries) },
    )
    .map((ref) => (cmp(ref, birth) < 0 ? birth : ref));
};

const validPairArb: fc.Arbitrary<{ birth: Day; ref: Day }> = birthArb().chain((birth) =>
  refOnOrAfter(birth).map((ref) => ({ birth, ref })),
);

/** Strings that are not exactly `YYYY-MM-DD` with ASCII digits. */
const malformedArb: fc.Arbitrary<string> = fc.oneof(
  fc.string().filter((s) => !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)),
  fc.constantFrom(
    "",
    "2020-1-01",
    "2020-01-1",
    "20-01-01",
    "02020-01-01",
    "+2020-01-01",
    "2020/01/01",
    "20200101",
    " 2020-01-01",
    "2020-01-01 ",
    "2020-01-01\n",
    "2020-01-01T00:00:00Z",
    "\uff12\uff10\uff12\uff10-01-01", // full-width digits
    "2020-\u0660\u0661-01", // Arabic-Indic digits
  ),
  dayInYears(1, 9999).map((day) => `${fmt(day)}x`),
);

/** Well-formed `YYYY-MM-DD` strings naming impossible dates. */
const impossibleArb: fc.Arbitrary<string> = fc.oneof(
  // year 0000
  fc
    .record({ m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) })
    .map(({ m, d }) => `0000-${pad(m, 2)}-${pad(d, 2)}`),
  // month 00 or 13-99
  fc
    .record({
      y: fc.integer({ min: 1, max: 9999 }),
      m: fc.oneof(fc.constant(0), fc.integer({ min: 13, max: 99 })),
      d: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ y, m, d }) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`),
  // day 00 or past the end of the month (29 February in common years included)
  fc
    .record({ y: fc.integer({ min: 1, max: 9999 }), m: fc.integer({ min: 1, max: 12 }) })
    .chain(({ y, m }) =>
      fc
        .oneof(fc.constant(0), fc.integer({ min: daysIn(y, m) + 1, max: 99 }))
        .map((d) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`),
    ),
  fc
    .integer({ min: 1, max: 9999 })
    .filter((y) => !isLeap(y))
    .map((y) => `${pad(y, 4)}-02-29`),
);

const invalidDateArb: fc.Arbitrary<string> = fc.oneof(malformedArb, impossibleArb);

/** Non-string inputs a JS caller could pass. */
const nonStringArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(null, undefined, 20200229, true),
  fc.integer(),
  fc.array(fc.string()),
  fc.object(),
);

function expectFailure(run: () => AgeStageResult, kind: AgeStageError["kind"]): void {
  let result: AgeStageResult | undefined;
  expect(() => {
    result = run();
  }).not.toThrow();
  expect(result).toEqual({ ok: false, error: { kind } });
}

// ---------------------------------------------------------------------------------------------
describe("deriveAgeStage properties", () => {
  // Feature: phase-1-gateway-contract, Property 21: Age stage agrees with the reference model
  it("agrees with the reference model", () => {
    fc.assert(
      fc.property(validPairArb, ({ birth, ref }) => {
        const result = deriveAgeStage(fmt(birth), fmt(ref));
        expect(result.ok).toBe(true);
        const stage = okValue(result);
        expect(AGE_STAGES).toContain(stage);
        expect(stage).toBe(modelStage(birth, ref));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 22: Birthday boundaries
  it("changes stage exactly on the 3rd, 6th and 9th birthdays", () => {
    const cases = [
      { n: 3, on: "little", before: "tiny" },
      { n: 6, on: "explorer", before: "little" },
      { n: 9, on: "maker", before: "explorer" },
    ] as const;
    fc.assert(
      fc.property(birthArb(9990), fc.constantFrom(...cases), (birth, { n, on, before }) => {
        const birthday = nthBirthday(birth, n);
        expect(okValue(deriveAgeStage(fmt(birth), fmt(birthday)))).toBe(on);
        expect(okValue(deriveAgeStage(fmt(birth), fmt(prevDay(birthday))))).toBe(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 23: Age stage is monotonic
  it("never moves to an earlier stage as the reference date advances", () => {
    const triple = birthArb().chain((birth) =>
      fc.tuple(refOnOrAfter(birth), refOnOrAfter(birth)).map(([a, b]) => ({
        birth,
        r1: cmp(a, b) <= 0 ? a : b,
        r2: cmp(a, b) <= 0 ? b : a,
      })),
    );
    fc.assert(
      fc.property(triple, ({ birth, r1, r2 }) => {
        const s1 = okValue(deriveAgeStage(fmt(birth), fmt(r1)));
        const s2 = okValue(deriveAgeStage(fmt(birth), fmt(r2)));
        expect(stageIndex(s2)).toBeGreaterThanOrEqual(stageIndex(s1));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: phase-1-gateway-contract, Property 24: Invalid dates fail without throwing
  it("fails with the matching kind, without throwing, on invalid input", () => {
    const valid = dayInYears(1, 9999).map(fmt);
    const anyInvalid = fc.oneof(
      { weight: 4, arbitrary: invalidDateArb as fc.Arbitrary<unknown> },
      { weight: 1, arbitrary: nonStringArb },
    );
    const before = fc
      .tuple(dayInYears(1, 9999), dayInYears(1, 9999))
      .filter(([a, b]) => cmp(a, b) !== 0)
      .map(([a, b]) => (cmp(a, b) < 0 ? { earlier: a, later: b } : { earlier: b, later: a }));
    fc.assert(
      fc.property(anyInvalid, valid, before, (bad, good, { earlier, later }) => {
        const badArg = bad as string;
        expectFailure(() => deriveAgeStage(badArg, good), "invalid_date_of_birth");
        expectFailure(() => deriveAgeStage(good, badArg), "invalid_reference_date");
        expectFailure(() => deriveAgeStage(fmt(later), fmt(earlier)), "reference_before_birth");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  describe("environment", () => {
    const originalTz = process.env["TZ"];

    afterEach(() => {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env["TZ"];
      else process.env["TZ"] = originalTz;
    });

    // Feature: phase-1-gateway-contract, Property 25: Age stage ignores the environment
    it("returns the same result under any time zone and system time", () => {
      const zones = [
        "UTC",
        "Asia/Kolkata",
        "Pacific/Kiritimati",
        "Pacific/Pago_Pago",
        "America/St_Johns",
      ] as const;
      const input: fc.Arbitrary<readonly [string, string]> = fc.oneof(
        {
          weight: 4,
          arbitrary: validPairArb.map(({ birth, ref }) => [fmt(birth), fmt(ref)] as const),
        },
        { weight: 1, arbitrary: fc.tuple(invalidDateArb, dayInYears(1, 9999).map(fmt)) },
      );
      // System times from 1970 to 2100, in milliseconds.
      const systemTime = fc.integer({ min: 0, max: 4_102_444_800_000 });
      fc.assert(
        fc.property(input, fc.constantFrom(...zones), systemTime, ([dob, ref], zone, now) => {
          const baseline = deriveAgeStage(dob, ref);
          try {
            process.env["TZ"] = zone;
            vi.useFakeTimers();
            vi.setSystemTime(now);
            expect(deriveAgeStage(dob, ref)).toEqual(baseline);
          } finally {
            vi.useRealTimers();
            if (originalTz === undefined) delete process.env["TZ"];
            else process.env["TZ"] = originalTz;
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("deriveAgeStage examples", () => {
  it("moves a 29 February birthday to 1 March in common years (16.3)", () => {
    expect(deriveAgeStage("2020-02-29", "2023-02-28")).toEqual({ ok: true, value: "tiny" });
    expect(deriveAgeStage("2020-02-29", "2023-03-01")).toEqual({ ok: true, value: "little" });
    expect(deriveAgeStage("2020-02-29", "2024-02-29")).toEqual({ ok: true, value: "little" });
  });

  it("changes stage on the 3rd, 6th and 9th birthday, not the day before (16.2, 16.9)", () => {
    const dob = "2018-06-15";
    expect(deriveAgeStage(dob, "2021-06-14")).toEqual({ ok: true, value: "tiny" });
    expect(deriveAgeStage(dob, "2021-06-15")).toEqual({ ok: true, value: "little" });
    expect(deriveAgeStage(dob, "2024-06-14")).toEqual({ ok: true, value: "little" });
    expect(deriveAgeStage(dob, "2024-06-15")).toEqual({ ok: true, value: "explorer" });
    expect(deriveAgeStage(dob, "2027-06-14")).toEqual({ ok: true, value: "explorer" });
    expect(deriveAgeStage(dob, "2027-06-15")).toEqual({ ok: true, value: "maker" });
  });

  it("gives tiny on the day of birth and stays maker past 12 (16.1)", () => {
    expect(deriveAgeStage("2024-01-01", "2024-01-01")).toEqual({ ok: true, value: "tiny" });
    expect(deriveAgeStage("2000-01-01", "2026-10-08")).toEqual({ ok: true, value: "maker" });
  });

  it("uses no clock, time zone or environment in its source (16.8)", () => {
    const source = readFileSync(new URL("../src/domain/age-stage.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bIntl\b/);
    expect(source).not.toMatch(/\bprocess\b/);
  });
});
