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

/**
 * The cases Requirement 19.5 names, each with the utterance that must cover it, plus the five
 * Phase 4 Req 22.1 additions. The list is a FLOOR and not a count: the table may grow, so
 * nothing here pins its length (Phase 4 Req 22.3).
 *
 * `scary-request` is listed as what it actually is rather than as its name suggests: the
 * Gateway's Input_Guard has no frightening-content rule, so the refusal demonstration is
 * `closed-category-request` (Phase 4 Req 22.1b, 22.1c). The Gateway pins the decision each one
 * draws; this file only asserts the text exists.
 */
const REQUIRED_CASES: readonly Readonly<{ case: string; name: string }>[] = [
  { case: "a plain English question", name: "hello" },
  { case: "a story request that needs a tool", name: "story" },
  { case: "a Defer_Topic question", name: "where-did-grandpa-go" },
  { case: "an unsafe-sounding request", name: "scary-request" },
  { case: "a request in a category the parent has not opened", name: "closed-category-request" },
  { case: "a distress disclosure", name: "sad" },
  { case: "a Hindi utterance", name: "hindi-hello" },
  { case: "a code-mixed utterance", name: "mixed-hindi-english" },
  { case: "one that triggers the Filler path", name: "slow-thinker" },
  { case: "a branch answer in English", name: "story-answer-en" },
  { case: "a branch answer in Hindi", name: "story-answer-hi" },
  { case: "an answer that matches no branch", name: "story-answer-unmatched" },
  { case: "a stop word that ends a story", name: "story-stop" },
];

describe("the Test_Utterance table (Req 19.5)", () => {
  it("covers every required case, each with its own name", () => {
    expect(new Set(TEST_UTTERANCE_NAMES).size).toBe(TEST_UTTERANCES.length);
    expect(TEST_UTTERANCE_NAMES).toEqual(TEST_UTTERANCES.map((u) => u.name));
    for (const required of REQUIRED_CASES) {
      expect(findTestUtterance(required.name), required.case).not.toBeNull();
    }
    for (const name of REQUIRED_CASES.map((c) => c.name)) {
      expect(TEST_UTTERANCE_NAMES).toContain(name);
    }
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
