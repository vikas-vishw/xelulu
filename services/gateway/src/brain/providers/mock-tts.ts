// The Mock_Tts (Req 2.3, 2.4, 2.6): the deterministic text-to-speech provider this phase runs on.
// It synthesises nothing real. Each frame it yields is the gateway's existing Synthetic_Frame, the
// one fixed 40-byte ASCII pattern that is not decodable speech, and the frame count is a documented
// function of the text's length only:
//
//   frames = min(code points x MOCK_TTS_FRAMES_PER_CODE_POINT, MOCK_TTS_MAX_FRAMES)
//
// At one 20 ms frame per 20 ms of audio that is 80 ms per code point, about 12 code points a
// second, which is a plausible speaking rate for a short reply. Empty text yields no frame, so a
// turn with nothing to say sends nothing.
//
// It reads no file, no recorded audio, no environment variable and no socket, and needs no key.
import type { ProviderId } from "@xelulu/shared";

import { syntheticFrame } from "../../audio/synthetic-frame.js";
import { NO_RETENTION_NO_TRAINING } from "./provider-declaration.js";
import type { TtsInput, TtsProvider } from "./tts-provider.js";

/** The closed-list id every Mock_Tts Log_Entry carries. */
export const MOCK_TTS_PROVIDER_ID: ProviderId = "mock";

/** 20 ms frames per code point: 80 ms of audio each, about 12 code points a second. */
export const MOCK_TTS_FRAMES_PER_CODE_POINT = 4;

/** The ceiling on one utterance: 10 s of 20 ms frames. */
export const MOCK_TTS_MAX_FRAMES = 500;

/** The frame count for a text. Pure, so the same text always gives the same count (Req 2.3). */
export function mockTtsFrameCount(text: string): number {
  const codePoints = [...text].length;
  return Math.min(codePoints * MOCK_TTS_FRAMES_PER_CODE_POINT, MOCK_TTS_MAX_FRAMES);
}

/** The frames of one utterance, in play order. The pipeline stops pulling when the turn stops. */
async function* frames(input: TtsInput): AsyncGenerator<Uint8Array> {
  const total = mockTtsFrameCount(input.text);
  for (let sent = 0; sent < total; sent += 1) {
    // A fresh copy per frame, so no consumer can change the constant.
    yield syntheticFrame();
  }
}

/** The Mock_Tts provider. Offline, deterministic, and holding nothing between turns. */
export function createMockTts(): TtsProvider {
  return {
    id: MOCK_TTS_PROVIDER_ID,
    dataHandling: NO_RETENTION_NO_TRAINING,
    synthesise: (input) => frames(input),
  };
}
