// The "let me think" Filler (Req 12, C14, C15).
//
// product.md promises a filler when the reply is slow, so a child is never left with silence.
// The Filler is Xelulu's OWN synthesised speech, not child audio, so holding it in memory is not
// a retention violation (C15, safety.md §1) — but it is still never written to a file and never
// cached across processes.
//
// It is synthesised once per supported language at start-up, through the same Tts provider the
// replies use, so it sounds like Xelulu and needs no second voice path. Synthesising it per turn
// would spend the very milliseconds the Filler exists to cover.
import { SUPPORTED_LANGS, type SupportedLang } from "@xelulu/shared";

import { FILLER_TEXT } from "./safety/safe-text.js";
import type { TtsProvider } from "./providers/tts-provider.js";

export interface FillerAudio {
  /** The pre-rendered frames for a language, in play order. Empty if synthesis failed. */
  frames(lang: SupportedLang): readonly Uint8Array[];
}

/**
 * Renders the Filler for every supported language. A provider failure is not fatal: the turn
 * simply has no Filler to play and waits for the reply, which is better than failing start-up
 * over a comfort feature.
 */
export async function prerenderFiller(tts: TtsProvider, deviceId = "filler"): Promise<FillerAudio> {
  const byLang = new Map<SupportedLang, readonly Uint8Array[]>();

  for (const lang of SUPPORTED_LANGS) {
    const frames: Uint8Array[] = [];
    try {
      for await (const frame of tts.synthesise({
        deviceId,
        turnId: `filler:${lang}`,
        text: FILLER_TEXT[lang],
        lang,
      })) {
        frames.push(frame);
      }
    } catch {
      frames.length = 0;
    }
    byLang.set(lang, Object.freeze(frames));
  }

  return {
    frames: (lang) => byLang.get(lang) ?? [],
  };
}

/** An empty Filler, for tests and for the case where synthesis produced nothing. */
export const NO_FILLER: FillerAudio = Object.freeze({ frames: () => [] });
