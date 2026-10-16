// Property 9: the age stage partitions the completed years (Req 8.8, 26.5). Pure function,
// example-based at the boundaries, no fast-check (Req 26.1).

import { describe, expect, it } from "@jest/globals";

import { ageStageFor } from "../src/features/setup/age-stage";

describe("ageStageFor", () => {
  const BIRTH = "2020-03-15";

  it.each([
    ["the day before the 3rd birthday", "2023-03-14", "tiny"],
    ["the 3rd birthday", "2023-03-15", "little"],
    ["the day before the 6th birthday", "2026-03-14", "little"],
    ["the 6th birthday", "2026-03-15", "explorer"],
    ["the day before the 9th birthday", "2029-03-14", "explorer"],
    ["the 9th birthday", "2029-03-15", "maker"],
  ])("returns %s as %s", (_label, reference, stage) => {
    expect(ageStageFor(BIRTH, reference)).toEqual({ ok: true, stage });
  });

  it("counts the day of birth as tiny", () => {
    expect(ageStageFor(BIRTH, BIRTH)).toEqual({ ok: true, stage: "tiny" });
  });

  // A 29 February birthday is reached on 1 March in a common year, as `deriveAgeStage` has it.
  it.each([
    ["28 February of a common year, before the moved birthday", "2023-02-28", "tiny"],
    ["1 March of a common year, on the moved birthday", "2023-03-01", "little"],
    ["29 February of a leap year", "2024-02-29", "little"],
  ])("handles a leap-day birthday on %s as %s", (_label, reference, stage) => {
    expect(ageStageFor("2020-02-29", reference)).toEqual({ ok: true, stage });
  });

  it.each(["not-a-date", "2020-13-01", "2020-02-30", "", "2020-00-10", "2020-3-15"])(
    "rejects %p as invalid",
    (dateOfBirth) => {
      expect(ageStageFor(dateOfBirth, "2026-10-12")).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it("rejects an unusable reference day as invalid", () => {
    expect(ageStageFor(BIRTH, "not-a-date")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports a future date of birth as future, not invalid (Req 8.7)", () => {
    expect(ageStageFor("2030-01-01", "2026-10-12")).toEqual({ ok: false, reason: "future" });
  });

  it("never throws for any of the inputs above", () => {
    expect(() => ageStageFor("", "")).not.toThrow();
  });
});
