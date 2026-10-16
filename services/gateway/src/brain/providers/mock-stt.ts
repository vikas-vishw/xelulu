// The Mock_Stt (Req 2.1, 2.4, 2.6, 14.1, 14.3): the deterministic speech-to-text provider this
// phase runs on. One Stt_Session per Audio_Turn. The session buffers the turn's inbound frame
// bytes, bounded at MAX_UPLOAD_FRAMES x MAX_FRAME_BYTES, decodes them with the Mock_Audio_Codec
// when the device's `audio_end` arrives, and drops them on `release()` and on `finish()`. The
// bytes reach no other module, no file and no log.
//
// It reads no environment variable, opens no socket, and needs no key: a turn's "speech" is the
// text the Simulator encoded into its Utterance_Frames. Phase 1.2 synthetic frames are not
// Utterance_Frames, so a turn without an `utterance` transcribes to `no_speech` and the pipeline
// still answers with a Safe_Redirect (design "Error Handling").
import { decodeUtteranceFrames, type ProviderId } from "@xelulu/shared";

import { MAX_FRAME_BYTES, MAX_UPLOAD_FRAMES } from "../../audio/audio-turn.js";
import { NO_RETENTION_NO_TRAINING } from "./provider-declaration.js";
import type { SttProvider, SttResult, SttSession } from "./stt-provider.js";

/** The closed-list id every Mock_Stt Log_Entry carries. */
export const MOCK_STT_PROVIDER_ID: ProviderId = "mock";

/** The hard ceiling on one session's buffer (Req 14.3): 3,000 x 1,500 = 4.5 MB. */
export const MOCK_STT_MAX_SESSION_BYTES = MAX_UPLOAD_FRAMES * MAX_FRAME_BYTES;

/** Maps a Mock_Audio_Codec failure to the Stt_Result reason the pipeline acts on. */
function reasonFor(decoded: "not_mock_audio" | "incomplete" | "bad_frame"): SttResult {
  // Synthetic frames are not speech at all; a malformed or missing frame is a decode failure.
  return decoded === "not_mock_audio"
    ? { ok: false, reason: "no_speech" }
    : { ok: false, reason: "decode_failed" };
}

function openSession(turnId: string): SttSession {
  /** The turn's frames, in arrival order. Dropped whole on release. */
  let held: Uint8Array[] = [];
  let bytes = 0;
  let closed = false;

  const release = (): void => {
    closed = true;
    held = [];
    bytes = 0;
  };

  return {
    turnId,

    pushFrame(frame) {
      // After the turn ends, and beyond the bound, a frame is simply dropped: the session never
      // grows without limit and never reports a byte count it does not hold.
      if (closed) return;
      if (held.length >= MAX_UPLOAD_FRAMES) return;
      if (bytes + frame.byteLength > MOCK_STT_MAX_SESSION_BYTES) return;
      // A COPY, not the caller's view. The hand-off is synchronous inside the transport's message
      // handler (Req 14.2) and the decode happens later, at `audio_end`: `ws` hands over a view
      // into a socket read buffer that Node reuses for the next message, so keeping the view
      // would decode whatever arrived after it. Copying also means the bound this session
      // reports is the memory it actually holds, rather than a pooled buffer it merely points at.
      held.push(frame.slice());
      bytes += frame.byteLength;
    },

    release,

    bytesHeld: () => bytes,

    finish(): Promise<SttResult> {
      const frames = held;
      // The bytes are of no further use once decoded, so they go now rather than at closeTurn.
      release();
      if (frames.length === 0) return Promise.resolve({ ok: false, reason: "no_speech" });
      const decoded = decodeUtteranceFrames(frames);
      if (!decoded.ok) return Promise.resolve(reasonFor(decoded.reason));
      // An empty decode is an empty Transcript, not an error (Req 2.1); the pipeline decides.
      return Promise.resolve({
        ok: true,
        transcript: { text: decoded.text, lang: decoded.lang },
      });
    },
  };
}

/** The Mock_Stt provider. Deterministic, offline, and holding nothing between turns. */
export function createMockStt(): SttProvider {
  return {
    id: MOCK_STT_PROVIDER_ID,
    dataHandling: NO_RETENTION_NO_TRAINING,
    open: (turn) => openSession(turn.turnId),
  };
}
