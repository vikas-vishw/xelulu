// The Mock_Audio_Codec (Phase 3 C6, Req 2.1, 19.2, 11.2): Property 2 plus the three decode
// failures. Runtime code comes from the built entry, like every other shared test.
// The codec is not the contract: nothing here asserts anything about proto_ver.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decodeUtteranceFrames,
  encodeUtteranceFrames,
  MOCK_AUDIO_VERSION,
  MOCK_FRAME_MAX_BYTES,
  SUPPORTED_LANGS,
} from "../dist/index.js";
import type { DecodedUtterance, SupportedLang, UtteranceFrames } from "../dist/index.js";

/**
 * Document B §3.4's upstream audio frame cap, restated here from the document rather than
 * imported, so the test fails if the codec ever outgrows the wire.
 */
const CONTRACT_MAX_FRAME_BYTES = 1500;

/** The codec's own cap on frames per utterance (an over-long text must throw). */
const MAX_FRAMES = 64;

/** The Gateway's Phase 1.2 Synthetic_Frame pattern, restated: ASCII, no NUL byte. */
const SYNTHETIC_PATTERN = "XLU-SYNTHETIC-PLACEHOLDER-FRAME-NOTAUDIO";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Code points that survive a UTF-8 round trip: no lone surrogate. */
const UNITS: readonly string[] = [
  ..."abcXYZ 0129.,?!'-",
  // Devanagari, for hi-IN and code-mixed text.
  ..."नमस्तेकहानीसुनाओ",
  // An astral code point, to cover four-byte UTF-8.
  "😀",
  // A combining mark, so a grapheme can straddle a chunk boundary.
  "\u0902",
];

const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.array(fc.constantFrom(...UNITS), { minLength: 1, maxLength: 240 }).map((cs) => cs.join("")),
  fc.string({ minLength: 1, maxLength: 240 }),
);

const langArb: fc.Arbitrary<SupportedLang> = fc.constantFrom(...SUPPORTED_LANGS);

describe("Mock_Audio_Codec constants", () => {
  it("carries its own version and a cap inside the contract's frame cap", () => {
    expect(MOCK_AUDIO_VERSION).toBe(1);
    expect(MOCK_FRAME_MAX_BYTES).toBe(512);
    expect(MOCK_FRAME_MAX_BYTES).toBeLessThanOrEqual(CONTRACT_MAX_FRAME_BYTES);
  });

  it("builds the MA1 NUL lang NUL index NUL total NUL chunk layout", () => {
    const { frames } = encodeUtteranceFrames("a".repeat(300), "en-IN");
    expect(frames).toHaveLength(2);
    // \u0000 rather than \0: a \0 followed by a digit is a legacy octal escape, banned in ESM.
    const first = encoder.encode("MA1\u0000en-IN\u0000001\u0000002\u0000");
    const second = encoder.encode("MA1\u0000en-IN\u0000002\u0000002\u0000");
    expect(frames[0]!.subarray(0, first.byteLength)).toEqual(first);
    expect(decoder.decode(frames[0]!.subarray(first.byteLength))).toBe("a".repeat(256));
    expect(frames[1]!.subarray(0, second.byteLength)).toEqual(second);
    expect(decoder.decode(frames[1]!.subarray(second.byteLength))).toBe("a".repeat(44));
  });
});

describe("Mock_Audio_Codec round trip", () => {
  // Feature: phase-3-voice-brain, Property 2: Mock audio round trip
  // **Validates: Requirements 2.1, 19.2, 11.2**
  it("decodes to the same text and language, within both frame caps", () => {
    fc.assert(
      fc.property(textArb, langArb, (text, lang) => {
        const encoded: UtteranceFrames = encodeUtteranceFrames(text, lang);
        expect(encoded.lang).toBe(lang);
        expect(encoded.frames.length).toBeGreaterThanOrEqual(1);
        expect(encoded.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
        for (const frame of encoded.frames) {
          expect(frame.byteLength).toBeLessThanOrEqual(MOCK_FRAME_MAX_BYTES);
          expect(frame.byteLength).toBeLessThanOrEqual(CONTRACT_MAX_FRAME_BYTES);
        }
        const decoded: DecodedUtterance = decodeUtteranceFrames(encoded.frames);
        expect(decoded).toEqual({ ok: true, text, lang });
      }),
      { numRuns: 200 },
    );
  });

  it("round-trips English, Hindi and a code-mixed utterance", () => {
    const cases: readonly [string, SupportedLang][] = [
      ["tell me a story about a lion", "en-IN"],
      ["नमस्ते लुलु, एक कहानी सुनाओ", "hi-IN"],
      ["Lulu, मुझे एक story सुनाओ please", "hi-IN"],
    ];
    for (const [text, lang] of cases) {
      const { frames } = encodeUtteranceFrames(text, lang);
      expect(decodeUtteranceFrames(frames)).toEqual({ ok: true, text, lang });
    }
  });

  it("encodes the longest allowed text and refuses an empty or over-long one", () => {
    const longest = "x".repeat(MAX_FRAMES * 256);
    const { frames } = encodeUtteranceFrames(longest, "en-IN");
    expect(frames).toHaveLength(MAX_FRAMES);
    expect(decodeUtteranceFrames(frames)).toEqual({ ok: true, text: longest, lang: "en-IN" });
    expect(() => encodeUtteranceFrames("", "en-IN")).toThrow(/empty/);
    expect(() => encodeUtteranceFrames(`${longest}y`, "en-IN")).toThrow(/too long/);
  });
});

describe("Mock_Audio_Codec decode failures", () => {
  it("reports not_mock_audio for no frames and for a Phase 1.2 synthetic frame", () => {
    expect(decodeUtteranceFrames([])).toEqual({ ok: false, reason: "not_mock_audio" });
    expect(decodeUtteranceFrames([encoder.encode(SYNTHETIC_PATTERN)])).toEqual({
      ok: false,
      reason: "not_mock_audio",
    });
    // A frame over the codec's cap is not one of ours either.
    expect(decodeUtteranceFrames([new Uint8Array(MOCK_FRAME_MAX_BYTES + 1)])).toEqual({
      ok: false,
      reason: "not_mock_audio",
    });
  });

  it("reports incomplete when a frame of the set is missing", () => {
    const { frames } = encodeUtteranceFrames("a".repeat(600), "en-IN");
    expect(frames).toHaveLength(3);
    expect(decodeUtteranceFrames([frames[0]!, frames[2]!])).toEqual({
      ok: false,
      reason: "incomplete",
    });
  });

  it("reports bad_frame for a corrupted header and for a disagreeing frame", () => {
    const { frames } = encodeUtteranceFrames("a".repeat(300), "en-IN");
    expect(frames).toHaveLength(2);

    const corrupted = frames[1]!.slice();
    corrupted[0] = "Z".charCodeAt(0);
    expect(decodeUtteranceFrames([frames[0]!, corrupted])).toEqual({
      ok: false,
      reason: "bad_frame",
    });

    const otherLang = encodeUtteranceFrames("a".repeat(300), "hi-IN").frames[1]!;
    expect(decodeUtteranceFrames([frames[0]!, otherLang])).toEqual({
      ok: false,
      reason: "bad_frame",
    });

    const synthetic = encoder.encode(SYNTHETIC_PATTERN);
    expect(decodeUtteranceFrames([frames[0]!, synthetic])).toEqual({
      ok: false,
      reason: "bad_frame",
    });
  });
});
