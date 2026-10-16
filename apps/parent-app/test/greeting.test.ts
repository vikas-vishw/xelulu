// Greeting boundary tests (Req 11.4, 6.1–6.3). Example-based only (C16).
// Property 9: the greeting partitions the day at 05:00, 12:00 and 17:00.

import { describe, expect, it } from "@jest/globals";

import { greetingFor, type Greeting } from "../src/features/home/greeting";

/** A local-time Date on a fixed day, so the test never depends on the wall clock. */
function at(hour: number, minute: number): Date {
  return new Date(2026, 0, 15, hour, minute, 0, 0);
}

const MORNING: Greeting = { text: "Good morning", icon: "sunny" };
const AFTERNOON: Greeting = { text: "Good afternoon", icon: "partly-sunny" };
const EVENING: Greeting = { text: "Good evening", icon: "moon" };

describe("greetingFor", () => {
  const CASES: [number, number, Greeting][] = [
    [4, 59, EVENING],
    [5, 0, MORNING],
    [11, 59, MORNING],
    [12, 0, AFTERNOON],
    [16, 59, AFTERNOON],
    [17, 0, EVENING],
  ];

  it.each(CASES)("returns the right greeting at %i:%i", (hour, minute, expected) => {
    expect(greetingFor(at(hour, minute))).toEqual(expected);
  });

  it("returns exactly one of the three greetings for every hour of the day", () => {
    const seen = new Set<string>();
    for (let hour = 0; hour < 24; hour++) {
      const greeting = greetingFor(at(hour, 30));
      expect([MORNING, AFTERNOON, EVENING]).toContainEqual(greeting);
      seen.add(greeting.text);
    }
    expect([...seen].sort()).toEqual(["Good afternoon", "Good evening", "Good morning"]);
  });
});
