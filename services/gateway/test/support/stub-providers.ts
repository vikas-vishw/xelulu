// Test helper (not a test): deterministic providers for the tests whose subject is the AUDIO
// ROUND-TRIP rather than the brain — `audio-server.test.ts`, `barge-in.test.ts`,
// `done-when.test.ts` and `fake-device.test.ts`.
//
// Those tests assert the shape of a reply on the wire: one `say`, a known number of frames, then
// `audio_end`. Before Phase 3 that shape came from the Fake_Reply's fixed 50 frames. Now it comes
// from whatever the Tts provider yields, which is the Mock_Tts's function of the reply's length —
// correct for the brain, but it makes a wire-shape assertion depend on a sentence.
//
// So these providers pin the shape instead: a fixed transcript, a fixed short safe reply, and
// exactly `STUB_REPLY_FRAMES` frames. They are injected through `GatewayDeps.providers`, the seam
// that exists for this (C7), and every one of them declares no retention and no training, so the
// start-up provider gate accepts them exactly as it accepts the mocks.
//
// The brain's own behaviour — the pipeline, the guards, the Filler, the latency and the
// multilingual round-trip — is covered by its own tests against the real mocks.
import { NO_RETENTION_NO_TRAINING } from "../../src/brain/providers/provider-declaration.js";
import type { LlmProvider } from "../../src/brain/providers/llm-provider.js";
import type { SttProvider } from "../../src/brain/providers/stt-provider.js";
import type { TtsProvider } from "../../src/brain/providers/tts-provider.js";
import { syntheticFrame } from "../../src/audio/synthetic-frame.js";

/** The frame count the audio-round-trip tests assert, matching the Phase 1.2 reply shape. */
export const STUB_REPLY_FRAMES = 50;

/** A transcript that the Input_Guard allows, so the turn reaches the model. */
export const STUB_TRANSCRIPT = "hello xelulu";

/** A reply that passes the Output_Guard at every Age_Stage: one short sentence, no forbidden span. */
export const STUB_REPLY_TEXT = "Hello there.";

export function createStubStt(): SttProvider {
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    open({ turnId }) {
      let held = 0;
      let released = false;
      return {
        turnId,
        pushFrame(frame) {
          if (!released) held += frame.byteLength;
        },
        release() {
          released = true;
          held = 0;
        },
        bytesHeld: () => held,
        finish: () =>
          Promise.resolve({ ok: true, transcript: { text: STUB_TRANSCRIPT, lang: "en-IN" } }),
      };
    },
  };
}

export function createStubLlm(): LlmProvider {
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    reply: () => Promise.resolve({ ok: true, text: STUB_REPLY_TEXT, toolRequests: [] }),
  };
}

export function createStubTts(frames = STUB_REPLY_FRAMES): TtsProvider {
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    async *synthesise() {
      for (let i = 0; i < frames; i += 1) yield syntheticFrame();
    },
  };
}

/** All three, for `GatewayDeps.providers`. */
export function stubProviders(frames = STUB_REPLY_FRAMES): Readonly<{
  stt: SttProvider;
  llm: LlmProvider;
  tts: TtsProvider;
}> {
  return { stt: createStubStt(), llm: createStubLlm(), tts: createStubTts(frames) };
}
