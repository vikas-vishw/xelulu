// Speech-to-text seam (Req 1.1, 14.2, 14.3). One Stt_Session per Audio_Turn: the Audio_Turn
// pushes each inbound frame's bytes into it inside the transport's message handler and keeps no
// reference of its own, the session holds at most MAX_UPLOAD_FRAMES x MAX_FRAME_BYTES for the turn,
// and release() drops them on every terminal path. The bytes reach no other module, no file and no
// log. Vendor SDKs and vendor types never leak past this interface.
import type { ProviderId } from "@xelulu/shared";

import type { DataHandlingDeclaration } from "./provider-declaration.js";

export type SttFrameSink = { pushFrame(frame: Uint8Array): void; release(): void };

export type Transcript = Readonly<{
  text: string;
  /** The detected tag, which may be unsupported; the pipeline falls back (Req 11.3). */
  lang: string;
}>;

export type SttResult =
  | { readonly ok: true; readonly transcript: Transcript }
  | { readonly ok: false; readonly reason: "no_speech" | "decode_failed" | "provider_error" };

/** One session per Audio_Turn. `pushFrame` runs inside the transport handler. */
export interface SttSession extends SttFrameSink {
  readonly turnId: string;
  /** Called once, after the device's audio_end. */
  finish(): Promise<SttResult>;
  /** Bytes currently held. Used by tests to prove release (Req 14.3). */
  bytesHeld(): number;
}

export interface SttProvider {
  readonly id: ProviderId;
  readonly dataHandling: DataHandlingDeclaration;
  open(turn: Readonly<{ deviceId: string; turnId: string }>): SttSession;
}
