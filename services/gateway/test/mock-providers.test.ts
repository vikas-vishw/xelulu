// The three mocks and the four Adapter_Scaffolds (Req 2.1–2.6, 3.1–3.4).
//
// Property 3: for any transcript, Child_Context and seed, two Mock_Llm instances return deeply
// equal replies, tool requests and delays, and the Mock_Tts returns the same frame count for the
// same text; neither reads an environment variable nor opens a socket.
//
// The "no environment variable, no socket" half is proved two ways: the brain socket guard fails
// this file on any non-loopback connection, and a source scan of all seven provider
// implementation modules fails on an env read, a `fetch` call, a network-module import or a bare
// import that is not `@xelulu/shared` (Req 2.4, 2.6, 3.3, 3.4).
import { readFileSync } from "node:fs";

import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  ALLOW_LISTED_TOOLS,
  SUPPORTED_LANGS,
  encodeUtteranceFrames,
  type AgeStage,
  type ProviderId,
  type SupportedLang,
} from "@xelulu/shared";

import { MAX_FRAME_BYTES, MAX_UPLOAD_FRAMES } from "../src/audio/audio-turn.js";
import { syntheticFrame } from "../src/audio/synthetic-frame.js";
import { createDeadlines, type Deadlines } from "../src/deadlines.js";
import * as elevenLabsTts from "../src/brain/providers/adapter-elevenlabs-tts.js";
import * as hostedLlm from "../src/brain/providers/adapter-hosted-llm.js";
import * as sarvamStt from "../src/brain/providers/adapter-sarvam-stt.js";
import * as sarvamTts from "../src/brain/providers/adapter-sarvam-tts.js";
import type { LlmReply, LlmTurnInput } from "../src/brain/providers/llm-provider.js";
import {
  DEFAULT_REPLIES,
  MOCK_LLM_DEFAULT_DELAY_MS,
  MOCK_LLM_DEFAULT_SEED,
  MOCK_LLM_RULES,
  createMockLlm,
} from "../src/brain/providers/mock-llm.js";
import { createContentLibrary } from "../src/brain/tools/content-library.js";
import { MOCK_STT_MAX_SESSION_BYTES, createMockStt } from "../src/brain/providers/mock-stt.js";
import type { SttResult } from "../src/brain/providers/stt-provider.js";
import {
  MOCK_TTS_FRAMES_PER_CODE_POINT,
  MOCK_TTS_MAX_FRAMES,
  createMockTts,
  mockTtsFrameCount,
} from "../src/brain/providers/mock-tts.js";
import { checkProvider } from "../src/brain/providers/provider-gate.js";
import { firstForbidden } from "../src/brain/safety/forbidden-spans.js";
import { createTestClock, type TestClock } from "./support/test-clock.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";

const T0 = 1_760_000_000_000;

/** Every brain test installs the socket guard: nothing here may reach the network (Req 22.8). */
let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  // Restore first, then assert, so a genuine violation leaves no wrapper behind for the worker.
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Helpers.

function turnInput(over: Partial<LlmTurnInput> = {}): LlmTurnInput {
  return {
    deviceId: "xlu_000001",
    turnId: "t1",
    transcript: "hello there",
    lang: "en-IN",
    ageStage: "little",
    allowedCategories: [],
    deferTopics: [],
    tools: ALLOW_LISTED_TOOLS,
    toolResults: [],
    ...over,
  };
}

type Run = Readonly<{ reply: LlmReply; delayMs: number }>;

/** Runs one Mock_Llm call to completion on its own Clock, reporting the delay it scheduled. */
async function runLlm(input: LlmTurnInput, seed?: number): Promise<Run> {
  const clock: TestClock = createTestClock(T0);
  const deadlines: Deadlines = createDeadlines(clock);
  const llm = createMockLlm(seed === undefined ? { clock, deadlines } : { clock, deadlines, seed });
  const pending = llm.reply(input);
  const dueAt = deadlines.nextDue();
  expect(dueAt).not.toBeNull();
  const at = dueAt ?? T0;
  clock.set(at);
  deadlines.fireDue(at);
  return { reply: await pending, delayMs: at - T0 };
}

/** Drains a Mock_Tts stream, reporting the frames it yielded. */
async function ttsFrames(text: string, lang: SupportedLang = "en-IN"): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const frame of createMockTts().synthesise({
    deviceId: "xlu_000001",
    turnId: "t1",
    text,
    lang,
  })) {
    out.push(frame);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Property 3.

describe("Property 3: the mock providers are deterministic", () => {
  /** Transcripts that hit a rule and transcripts that hit none, so both paths are generated. */
  const transcript = fc.oneof(
    fc.constantFrom(
      "why is the sky blue",
      "where did grandpa go",
      "can i hurt the cat",
      "i am scared of the dark",
      "tell me a story",
      "let me think hard",
      "मुझे कहानी सुनाओ",
      "mujhe ek story sunao",
    ),
    fc.string({ minLength: 1, maxLength: 60 }),
  );
  const lang = fc.constantFrom<SupportedLang>(...SUPPORTED_LANGS);
  const ageStage = fc.constantFrom<AgeStage>(...AGE_STAGES);
  const seed = fc.integer({ min: 0, max: 1_000 });

  it("gives the same reply, tool requests and delay for the same input and seed", async () => {
    await fc.assert(
      fc.asyncProperty(transcript, lang, ageStage, seed, async (text, l, stage, s) => {
        const input = turnInput({ transcript: text, lang: l, ageStage: stage });
        const first = await runLlm(input, s);
        const second = await runLlm(input, s);
        expect(second).toEqual(first);
        expect(first.reply.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("gives the same Mock_Tts frame count for the same text, on every instance", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), lang, async (text, l) => {
        const expected = mockTtsFrameCount(text);
        const first = await ttsFrames(text, l);
        const second = await ttsFrames(text, l);
        expect(first).toHaveLength(expected);
        expect(second).toHaveLength(expected);
        for (const frame of first) expect([...frame]).toEqual([...syntheticFrame()]);
      }),
      { numRuns: 100 },
    );
  });

  it("gives the same Transcript for the same frames, on every Mock_Stt instance", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 80 }), lang, async (text, l) => {
        const { frames } = encodeUtteranceFrames(text, l);
        const results: SttResult[] = [];
        for (let run = 0; run < 2; run += 1) {
          const stt = createMockStt().open({ deviceId: "xlu_000001", turnId: "t1" });
          for (const frame of frames) stt.pushFrame(frame);
          results.push(await stt.finish());
          expect(stt.bytesHeld()).toBe(0);
        }
        expect(results[1]).toEqual(results[0]);
        expect(results[0]).toEqual({ ok: true, transcript: { text, lang: l } });
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The Mock_Llm rule table (Req 2.2, 2.5).

describe("the Mock_Llm rule table (Req 2.5)", () => {
  /** The eight cases Requirement 2.5 names, each with the reply the table must give. */
  const cases: readonly Readonly<{
    name: string;
    transcript: string;
    lang: SupportedLang;
    ruleAt: number;
  }>[] = [
    { name: "a plain question", transcript: "why is the sky blue", lang: "en-IN", ruleAt: 0 },
    {
      name: "a question on a Defer_Topic",
      transcript: "where did grandpa go",
      lang: "en-IN",
      ruleAt: 1,
    },
    { name: "an unsafe request", transcript: "can i hurt the cat", lang: "en-IN", ruleAt: 2 },
    {
      name: "a distress disclosure",
      transcript: "i am scared of the dark",
      lang: "en-IN",
      ruleAt: 3,
    },
    {
      name: "a request that needs content_lookup",
      transcript: "tell me a story",
      lang: "en-IN",
      ruleAt: 4,
    },
    {
      name: "a reply slower than the Filler_Deadline",
      transcript: "let me think hard",
      lang: "en-IN",
      ruleAt: 5,
    },
    { name: "a Hindi utterance", transcript: "मुझे कहानी सुनाओ", lang: "hi-IN", ruleAt: 6 },
    {
      name: "a code-mixed utterance",
      transcript: "mujhe ek story sunao",
      lang: "hi-IN",
      ruleAt: 7,
    },
  ];

  it("covers all eight required cases, each with its own rule", () => {
    expect(new Set(cases.map((c) => c.ruleAt)).size).toBe(cases.length);
    expect(MOCK_LLM_RULES).toHaveLength(cases.length);
  });

  it.each(cases)("answers $name from its rule", async ({ transcript, lang, ruleAt }) => {
    const rule = MOCK_LLM_RULES[ruleAt];
    expect(rule).toBeDefined();
    const run = await runLlm(turnInput({ transcript, lang }));
    expect(run.reply).toEqual({
      ok: true,
      text: rule?.reply,
      toolRequests: rule?.toolRequests,
    });
    expect(run.delayMs).toBe(rule?.delayMs);
  });

  it("has at least one rule above the 600 ms Filler_Deadline and the rest below it", () => {
    const slow = MOCK_LLM_RULES.filter((r) => r.delayMs > 600);
    expect(slow).toHaveLength(1);
    expect(slow[0]?.delayMs).toBe(1_200);
    expect(MOCK_LLM_RULES.filter((r) => r.delayMs <= 600).length).toBeGreaterThan(0);
  });

  it("covers both supported languages and at least one tool request", () => {
    expect(new Set(MOCK_LLM_RULES.map((r) => r.lang))).toEqual(new Set(SUPPORTED_LANGS));
    expect(MOCK_LLM_RULES.some((r) => r.toolRequests.length > 0)).toBe(true);
    for (const rule of MOCK_LLM_RULES) {
      for (const request of rule.toolRequests) {
        expect(ALLOW_LISTED_TOOLS).toContain(request.name);
      }
    }
  });

  it("asks content_lookup for categories the Content_Library actually has", () => {
    // Two tables that have to agree and sit in different modules. They did not: every rule asked
    // for `story` while the library's code is `stories`, so the headline story turn ran its tool
    // twice, got `unknown_category` both times, and reported `error` — silently, because the
    // model's own text still passed the Output_Guard. Only a live turn showed it, so the
    // agreement is pinned here. The category is also the Child_Context category a parent opens,
    // so a mismatch is a tool call no household can ever satisfy.
    const known = new Set(createContentLibrary().categories());
    const asked = MOCK_LLM_RULES.flatMap((rule) =>
      rule.toolRequests
        .filter((request) => request.name === "content_lookup")
        .map((request) => request.args["category"]),
    );
    expect(asked.length).toBeGreaterThan(0);
    for (const category of asked) {
      expect(known, `content_lookup asks for ${String(category)}`).toContain(category);
    }
  });

  it("speaks no URL, phone-like number, price or brand in any rule or default reply", async () => {
    // Every rule reply and every default reply in both languages, taken from the tables
    // themselves rather than from the seeds a sample happens to reach.
    const texts = [
      ...MOCK_LLM_RULES.map((r) => r.reply),
      ...SUPPORTED_LANGS.flatMap((lang) => [...DEFAULT_REPLIES[lang]]),
    ];
    for (const lang of SUPPORTED_LANGS) {
      for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const run = await runLlm(turnInput({ transcript: "zzz unmatched zzz", lang }), seed);
        if (run.reply.ok) texts.push(run.reply.text);
      }
    }
    for (const text of texts) {
      // The Safety_Layer's own detector, which is what will judge these replies at run time.
      expect(firstForbidden(text)).toBeNull();
      expect(text).not.toMatch(/https?:|www\.|\/\//i);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/[$£€₹]|\brs\b|\brupees\b/i);
      expect(text).not.toMatch(/\.(com|in|org|net)\b/i);
      // One short sentence, so the strictest Age_Stage can still hear it.
      expect(text.split(/[.!?।]+/).filter((s) => s.trim() !== "")).toHaveLength(1);
    }
  });

  it("falls back to a seeded default reply when no rule matches", async () => {
    const input = turnInput({ transcript: "zzz unmatched zzz" });
    const a = await runLlm(input, 1);
    const b = await runLlm(input, 1);
    expect(a).toEqual(b);
    expect(a.delayMs).toBe(MOCK_LLM_DEFAULT_DELAY_MS);
    expect(a.reply.ok && a.reply.toolRequests).toEqual([]);
    // The default seed is the seed used when none is given.
    expect(await runLlm(input)).toEqual(await runLlm(input, MOCK_LLM_DEFAULT_SEED));
  });

  it("asks for no further tool once the turn already has tool results", async () => {
    const withResults = turnInput({
      transcript: "tell me a story",
      toolResults: [{ name: "content_lookup", text: "a little story" }],
    });
    const run = await runLlm(withResults);
    expect(run.reply.ok && run.reply.toolRequests).toEqual([]);
    expect(run.reply.ok && run.reply.text).toBe(MOCK_LLM_RULES[4]?.reply);
  });

  it("schedules its delay on the Deadlines and never resolves before it fires", async () => {
    const clock = createTestClock(T0);
    const deadlines = createDeadlines(clock);
    const llm = createMockLlm({ clock, deadlines });
    let settled = false;
    const pending = llm.reply(turnInput({ transcript: "let me think hard" })).then((r) => {
      settled = true;
      return r;
    });
    expect(deadlines.nextDue()).toBe(T0 + 1_200);
    clock.set(T0 + 1_199);
    deadlines.fireDue(T0 + 1_199);
    await Promise.resolve();
    expect(settled).toBe(false);
    clock.set(T0 + 1_200);
    deadlines.fireDue(T0 + 1_200);
    await expect(pending).resolves.toEqual({
      ok: true,
      text: MOCK_LLM_RULES[5]?.reply,
      toolRequests: [],
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The Mock_Stt (Req 2.1, 14.3).

describe("the Mock_Stt (Req 2.1)", () => {
  function session(turnId = "t1") {
    return createMockStt().open({ deviceId: "xlu_000001", turnId });
  }

  it("carries the turn id and holds nothing before its first frame", () => {
    const stt = session("turn-7");
    expect(stt.turnId).toBe("turn-7");
    expect(stt.bytesHeld()).toBe(0);
  });

  it("transcribes an utterance's frames to its text and language", async () => {
    const { frames } = encodeUtteranceFrames("tell me a story", "en-IN");
    const stt = session();
    let pushed = 0;
    for (const frame of frames) {
      stt.pushFrame(frame);
      pushed += frame.byteLength;
      expect(stt.bytesHeld()).toBe(pushed);
    }
    await expect(stt.finish()).resolves.toEqual({
      ok: true,
      transcript: { text: "tell me a story", lang: "en-IN" },
    });
    expect(stt.bytesHeld()).toBe(0);
  });

  it("transcribes a Hindi utterance to hi-IN", async () => {
    const { frames } = encodeUtteranceFrames("मुझे कहानी सुनाओ", "hi-IN");
    const stt = session();
    for (const frame of frames) stt.pushFrame(frame);
    await expect(stt.finish()).resolves.toEqual({
      ok: true,
      transcript: { text: "मुझे कहानी सुनाओ", lang: "hi-IN" },
    });
  });

  it("answers no_speech for Phase 1.2 synthetic frames and for an empty turn", async () => {
    const synthetic = session();
    for (let n = 0; n < 50; n += 1) synthetic.pushFrame(syntheticFrame());
    await expect(synthetic.finish()).resolves.toEqual({ ok: false, reason: "no_speech" });
    await expect(session().finish()).resolves.toEqual({ ok: false, reason: "no_speech" });
  });

  it("answers decode_failed for a missing frame and for a corrupted one", async () => {
    const { frames } = encodeUtteranceFrames("x".repeat(600), "en-IN");
    expect(frames.length).toBeGreaterThan(1);

    const incomplete = session();
    incomplete.pushFrame(frames[0] ?? new Uint8Array());
    await expect(incomplete.finish()).resolves.toEqual({ ok: false, reason: "decode_failed" });

    const corrupted = session();
    corrupted.pushFrame(frames[0] ?? new Uint8Array());
    const bad = Uint8Array.from(frames[1] ?? new Uint8Array());
    bad[0] = 0x58; // breaks the second frame's magic, so the first frame still parses
    corrupted.pushFrame(bad);
    await expect(corrupted.finish()).resolves.toEqual({ ok: false, reason: "decode_failed" });
  });

  it("releases its buffer on release(), and ignores every frame after that", () => {
    const { frames } = encodeUtteranceFrames("tell me a story", "en-IN");
    const stt = session();
    for (const frame of frames) stt.pushFrame(frame);
    expect(stt.bytesHeld()).toBeGreaterThan(0);
    stt.release();
    expect(stt.bytesHeld()).toBe(0);
    stt.release();
    expect(stt.bytesHeld()).toBe(0);
    for (const frame of frames) stt.pushFrame(frame);
    expect(stt.bytesHeld()).toBe(0);
  });

  it("holds at most MAX_UPLOAD_FRAMES x MAX_FRAME_BYTES bytes (Req 14.3)", () => {
    expect(MOCK_STT_MAX_SESSION_BYTES).toBe(MAX_UPLOAD_FRAMES * MAX_FRAME_BYTES);
    const stt = session();
    const frame = new Uint8Array(MAX_FRAME_BYTES);
    for (let n = 0; n < MAX_UPLOAD_FRAMES + 10; n += 1) stt.pushFrame(frame);
    expect(stt.bytesHeld()).toBe(MOCK_STT_MAX_SESSION_BYTES);
  });
});

// ---------------------------------------------------------------------------------------------
// The Mock_Tts (Req 2.3).

describe("the Mock_Tts (Req 2.3)", () => {
  it("counts frames as a documented function of the text's code points", () => {
    expect(mockTtsFrameCount("")).toBe(0);
    expect(mockTtsFrameCount("a")).toBe(MOCK_TTS_FRAMES_PER_CODE_POINT);
    expect(mockTtsFrameCount("abcd")).toBe(4 * MOCK_TTS_FRAMES_PER_CODE_POINT);
    // Code points, not UTF-16 code units: one astral character is one code point.
    expect(mockTtsFrameCount("\u{1f600}")).toBe(MOCK_TTS_FRAMES_PER_CODE_POINT);
    expect(mockTtsFrameCount("x".repeat(10_000))).toBe(MOCK_TTS_MAX_FRAMES);
  });

  it("yields exactly that many Synthetic_Frames, and a fresh copy each time", async () => {
    const frames = await ttsFrames("hello");
    expect(frames).toHaveLength(mockTtsFrameCount("hello"));
    for (const frame of frames) expect([...frame]).toEqual([...syntheticFrame()]);
    expect(frames[0]).not.toBe(frames[1]);
    expect(await ttsFrames("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Declarations (Req 1.3, 2.4) and the Adapter_Scaffolds (Req 3.1–3.4).

describe("every provider declares no retention and no training", () => {
  it("the three mocks are accepted by the Provider_Gate", () => {
    const clock = createTestClock(T0);
    const mocks = [
      ["stt", createMockStt()],
      ["llm", createMockLlm({ clock, deadlines: createDeadlines(clock) })],
      ["tts", createMockTts()],
    ] as const;
    for (const [capability, provider] of mocks) {
      expect(provider.id).toBe("mock");
      expect(provider.dataHandling).toEqual({
        vendorRetainsRequestData: false,
        vendorMayTrainOnRequestData: false,
      });
      expect(checkProvider(capability, provider)).toEqual({ ok: true });
    }
  });
});

describe("the Adapter_Scaffolds (Req 3.1–3.4)", () => {
  type NotConfigured = { readonly ok: false; readonly reason: "not_configured" };

  type Scaffold = Readonly<{
    name: string;
    /** The module's runtime export names: exactly an id, a declaration and a factory. */
    exports: readonly string[];
    /** Those three names, written out here, so swapping one for something else fails. */
    expected: readonly string[];
    values: readonly unknown[];
    id: ProviderId;
    factory: () => NotConfigured;
  }>;

  const scaffolds: readonly Scaffold[] = [
    {
      name: "sarvam stt",
      exports: Object.keys(sarvamStt),
      expected: ["SARVAM_STT_PROVIDER_ID", "SARVAM_STT_DATA_HANDLING", "createSarvamStt"],
      values: Object.values(sarvamStt),
      id: "sarvam",
      factory: sarvamStt.createSarvamStt,
    },
    {
      name: "sarvam tts",
      exports: Object.keys(sarvamTts),
      expected: ["SARVAM_TTS_PROVIDER_ID", "SARVAM_TTS_DATA_HANDLING", "createSarvamTts"],
      values: Object.values(sarvamTts),
      id: "sarvam",
      factory: sarvamTts.createSarvamTts,
    },
    {
      name: "elevenlabs tts",
      exports: Object.keys(elevenLabsTts),
      expected: [
        "ELEVENLABS_TTS_PROVIDER_ID",
        "ELEVENLABS_TTS_DATA_HANDLING",
        "createElevenLabsTts",
      ],
      values: Object.values(elevenLabsTts),
      id: "elevenlabs",
      factory: elevenLabsTts.createElevenLabsTts,
    },
    {
      name: "hosted llm",
      exports: Object.keys(hostedLlm),
      expected: ["HOSTED_LLM_PROVIDER_ID", "HOSTED_LLM_DATA_HANDLING", "createHostedLlm"],
      values: Object.values(hostedLlm),
      id: "hosted_llm",
      factory: hostedLlm.createHostedLlm,
    },
  ];

  it("covers one scaffold per named vendor capability (Req 3.1)", () => {
    expect(scaffolds.map((s) => s.name)).toEqual([
      "sarvam stt",
      "sarvam tts",
      "elevenlabs tts",
      "hosted llm",
    ]);
  });

  it.each(scaffolds)("$name exports only an id, a declaration and a factory", (scaffold) => {
    // The names, not just the count: Req 3.2 and Omar ruling 4 fix which three exports exist.
    expect(scaffold.exports.slice().sort()).toEqual(scaffold.expected.slice().sort());
  });

  it.each(scaffolds)("$name records the vendor id and its zero-retention posture", (scaffold) => {
    expect(scaffold.values).toContain(scaffold.id);
    expect(scaffold.values.find((v) => typeof v === "object" && v !== null)).toEqual({
      vendorRetainsRequestData: false,
      vendorMayTrainOnRequestData: false,
    });
  });

  it.each(scaffolds)("$name refuses with not_configured", (scaffold) => {
    // It takes no argument, so it can keep nothing (Req 3.3).
    expect(scaffold.factory).toHaveLength(0);
    expect(scaffold.factory()).toEqual({ ok: false, reason: "not_configured" });
    expect(scaffold.factory()).toEqual(scaffold.factory());
  });
});

describe("the provider implementation modules reach nothing (Req 2.4, 2.6, 3.3, 3.4)", () => {
  const MODULES = [
    "mock-stt.ts",
    "mock-llm.ts",
    "mock-tts.ts",
    "adapter-sarvam-stt.ts",
    "adapter-sarvam-tts.ts",
    "adapter-elevenlabs-tts.ts",
    "adapter-hosted-llm.ts",
  ] as const;

  function sourceOf(name: string): string {
    return readFileSync(new URL(`../src/brain/providers/${name}`, import.meta.url), "utf8");
  }

  it.each(MODULES)("%s reads no environment variable", (name) => {
    expect(sourceOf(name)).not.toMatch(/process\s*\??\.\s*env|import\s*\.\s*meta\s*\??\.\s*env/);
  });

  it.each(MODULES)("%s calls no fetch and opens no socket", (name) => {
    const text = sourceOf(name);
    expect(text).not.toMatch(/\bfetch\s*\(/);
    expect(text).not.toMatch(/node:(net|tls|http|https|dns|dgram)/);
    expect(text).not.toMatch(/\bnew\s+(WebSocket|XMLHttpRequest)\b|\bWebSocketServer\b/);
    expect(text).not.toMatch(/\.connect\s*\(|\.listen\s*\(|\.request\s*\(/);
  });

  it.each(MODULES)("%s imports no vendor package", (name) => {
    const text = sourceOf(name);
    const specifiers = [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "@xelulu/shared" || specifier.startsWith("./") || specifier.startsWith("../");
      expect(allowed, `${name} imports ${specifier}`).toBe(true);
    }
  });
});
