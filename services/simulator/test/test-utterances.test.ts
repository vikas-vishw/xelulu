// The Simulator's Test_Utterance table (Req 19.4, 19.5): the eight named utterances the panel
// offers, and the frames each one encodes to. Text constants only — nothing here, and nothing in
// the module under test, reads a microphone, an audio device or a file.
import { describe, expect, it } from "vitest";

import {
  decodeUtteranceFrames,
  encodeUtteranceFrames,
  MOCK_FRAME_MAX_BYTES,
  SUPPORTED_LANGS,
} from "@xelulu/shared";

import {
  findTestUtterance,
  TEST_UTTERANCE_NAMES,
  TEST_UTTERANCES,
} from "../src/audio/test-utterances.js";

/**
 * Document B's audio frame cap. Restated here rather than imported: the cap lives in the
 * gateway's audio module and services never import each other.
 */
const CONTRACT_FRAME_MAX_BYTES = 1_500;

/** The eight cases Requirement 19.5 names, each with the utterance that must cover it. */
const REQUIRED_CASES: readonly Readonly<{ case: string; name: string }>[] = [
  { case: "a plain English question", name: "hello" },
  { case: "a story request that needs a tool", name: "story" },
  { case: "a Defer_Topic question", name: "where-did-grandpa-go" },
  { case: "an unsafe request", name: "scary-request" },
  { case: "a distress disclosure", name: "sad" },
  { case: "a Hindi utterance", name: "hindi-hello" },
  { case: "a code-mixed utterance", name: "mixed-hindi-english" },
  { case: "one that triggers the Filler path", name: "slow-thinker" },
];

describe("the Test_Utterance table (Req 19.5)", () => {
  it("covers all eight required cases, each with its own name", () => {
    expect(TEST_UTTERANCES).toHaveLength(REQUIRED_CASES.length);
    expect(new Set(TEST_UTTERANCE_NAMES).size).toBe(TEST_UTTERANCES.length);
    expect(TEST_UTTERANCE_NAMES).toEqual(TEST_UTTERANCES.map((u) => u.name));
    for (const required of REQUIRED_CASES) {
      expect(findTestUtterance(required.name), required.case).not.toBeNull();
    }
    expect([...TEST_UTTERANCE_NAMES].sort()).toEqual(REQUIRED_CASES.map((c) => c.name).sort());
  });

  it("carries a non-empty text in a supported language, in both languages overall", () => {
    for (const utterance of TEST_UTTERANCES) {
      expect(SUPPORTED_LANGS, utterance.name).toContain(utterance.lang);
      expect(utterance.text.trim().length, utterance.name).toBeGreaterThan(0);
    }
    expect(new Set(TEST_UTTERANCES.map((u) => u.lang)).size).toBe(SUPPORTED_LANGS.length);
  });

  it.each([...TEST_UTTERANCES])(
    "$name encodes to frames inside both caps and round-trips",
    ({ name, lang, text }) => {
      const encoded = encodeUtteranceFrames(text, lang);
      expect(encoded.lang, name).toBe(lang);
      expect(encoded.frames.length, name).toBeGreaterThan(0);
      for (const frame of encoded.frames) {
        expect(frame.byteLength, name).toBeLessThanOrEqual(MOCK_FRAME_MAX_BYTES);
        expect(frame.byteLength, name).toBeLessThanOrEqual(CONTRACT_FRAME_MAX_BYTES);
      }
      expect(decodeUtteranceFrames(encoded.frames)).toEqual({ ok: true, text, lang });
    },
  );
});

describe("findTestUtterance", () => {
  it("returns the entry for every listed name", () => {
    for (const utterance of TEST_UTTERANCES) {
      expect(findTestUtterance(utterance.name)).toEqual(utterance);
    }
  });

  it("returns null for an unknown name", () => {
    for (const name of ["", "Hello", "hello ", "§not-an-utterance", "slow_thinker"]) {
      expect(findTestUtterance(name), name).toBeNull();
    }
  });
});
