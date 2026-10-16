// MQTT topic builder and parser. Requirements 1.2–1.7.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ContractError,
  TOPIC_SUFFIXES,
  buildTopic,
  parseTopic,
  type TopicSuffix,
} from "../dist/index.js";

const SUFFIXES: readonly string[] = ["status", "event", "cmd", "ack"];
const TOPIC_KINDS: readonly string[] = [
  "invalid_topic",
  "invalid_device_id",
  "invalid_topic_suffix",
];

// Reference predicates, written from C23 and Requirement 1 (independent of src).
const isValidDeviceIdRef = (s: string): boolean =>
  s.length > 0 && !s.includes("/") && !s.includes("+") && !s.includes("#");

const isValidTopicRef = (s: string): boolean => {
  const levels = s.split("/");
  return (
    levels.length === 3 &&
    levels[0] === "xelulu" &&
    isValidDeviceIdRef(levels[1] ?? "") &&
    SUFFIXES.includes(levels[2] ?? "")
  );
};

const anyText = fc.string({ unit: "grapheme" });

/** Valid device ids: free text without `/`, `+`, `#`, plus Document B-style `xlu_` ids. */
const validDeviceIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, unit: "grapheme" }).filter(isValidDeviceIdRef),
  fc.stringMatching(/^xlu_[0-9a-f]{6}$/),
);

/** Invalid device ids: empty, or containing at least one of `/`, `+`, `#`. */
const invalidDeviceIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc
    .tuple(anyText, fc.constantFrom("/", "+", "#"), anyText)
    .map(([before, bad, after]) => before + bad + after),
);

/** Invalid device ids that keep the topic at three levels: empty, or containing `+` or `#`. */
const invalidLevelDeviceIdArb: fc.Arbitrary<string> = invalidDeviceIdArb.filter(
  (s) => !s.includes("/"),
);

const suffixArb: fc.Arbitrary<TopicSuffix> = fc.constantFrom(...TOPIC_SUFFIXES);

/** Suffix strings outside the four Topic_Suffix values, including ota and near misses. */
const badSuffixArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom("ota", "OTA", "Status", "EVENT", " cmd", "ack ", "", "status/", "acks"),
    suffixArb.map((s) => s.toUpperCase()),
    anyText,
  )
  .filter((s) => !SUFFIXES.includes(s));

/** Strings with no `/`, so each is exactly one topic level. */
const levelArb: fc.Arbitrary<string> = anyText.filter((s) => !s.includes("/"));

/** Malformed topic strings, one family per clause of Requirement 1.6. */
const malformedTopicArb: fc.Arbitrary<string> = fc
  .oneof(
    // Wrong number of levels.
    fc
      .array(levelArb, { minLength: 1, maxLength: 6 })
      .filter((levels) => levels.length !== 3)
      .map((levels) => levels.join("/")),
    // Wrong first level (case-sensitive), valid rest.
    fc
      .tuple(
        fc.oneof(fc.constantFrom("Xelulu", "XELULU", "xelulu ", " xelulu", ""), levelArb),
        validDeviceIdArb,
        suffixArb,
      )
      .map(([prefix, id, suffix]) => `${prefix}/${id}/${suffix}`),
    // Invalid device id level.
    fc.tuple(invalidLevelDeviceIdArb, suffixArb).map(([id, suffix]) => `xelulu/${id}/${suffix}`),
    // Bad suffix level.
    fc
      .tuple(
        validDeviceIdArb,
        badSuffixArb.filter((s) => !s.includes("/")),
      )
      .map(([id, suffix]) => `xelulu/${id}/${suffix}`),
    // Arbitrary text.
    anyText,
  )
  .filter((s) => !isValidTopicRef(s));

function expectTopicFailure(topic: string): void {
  const result = parseTopic(topic);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBeInstanceOf(ContractError);
  expect(result.error.issues.length).toBeGreaterThanOrEqual(1);
  for (const issue of result.error.issues) {
    expect(TOPIC_KINDS).toContain(issue.kind);
  }
}

describe("topic builder and parser", () => {
  // Feature: phase-1-gateway-contract, Property 1: Topic round trip
  it("Property 1: buildTopic output is xelulu/{device_id}/{suffix} and parses back", () => {
    fc.assert(
      fc.property(validDeviceIdArb, suffixArb, (deviceId, suffix) => {
        const topic = buildTopic(deviceId, suffix);
        expect(topic).toBe(`xelulu/${deviceId}/${suffix}`);
        const parsed = parseTopic(topic);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.device_id).toBe(deviceId);
        expect(parsed.value.suffix).toBe(suffix);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: phase-1-gateway-contract, Property 2: Invalid topics are refused
  it("Property 2: invalid device ids, suffixes and topic strings are refused", () => {
    // buildTopic throws a ContractError for an invalid device id, with any suffix.
    fc.assert(
      fc.property(invalidDeviceIdArb, suffixArb, (deviceId, suffix) => {
        expect(() => buildTopic(deviceId, suffix)).toThrow(ContractError);
      }),
      { numRuns: 200 },
    );
    // buildTopic throws a ContractError for any suffix outside the four (a JS caller or cast).
    fc.assert(
      fc.property(validDeviceIdArb, badSuffixArb, (deviceId, suffix) => {
        expect(() => buildTopic(deviceId, suffix as TopicSuffix)).toThrow(ContractError);
      }),
      { numRuns: 200 },
    );
    // parseTopic returns a failure, without throwing, for every malformed topic string.
    fc.assert(
      fc.property(malformedTopicArb, (topic) => {
        expectTopicFailure(topic);
      }),
      { numRuns: 500 },
    );
  });

  it.each(["xelulu/x/ota", "Xelulu/x/status", "xelulu/x/status/extra"])(
    "parseTopic refuses %s",
    (topic) => {
      expectTopicFailure(topic);
    },
  );

  it("buildTopic refuses the ota suffix", () => {
    expect(() => buildTopic("x", "ota" as TopicSuffix)).toThrow(ContractError);
  });
});

describe("no OTA topic (Req 1.2)", () => {
  it("TOPIC_SUFFIXES has no ota entry", () => {
    expect(TOPIC_SUFFIXES).not.toContain("ota");
  });

  it("the topics module source never mentions ota", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/gateway-contract/topics.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("ota");
  });
});
