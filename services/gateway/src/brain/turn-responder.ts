// The audio path's only way to produce a reply (Req 14.1, G34). After a valid `audio_end` the
// Audio_Server calls `respond` exactly once for the turn. In this phase the Fake_Reply is the only
// implementation; the voice loop will plug STT -> LLM -> TTS in behind the same interface.
import type { InterruptCause } from "@xelulu/shared";

import type { SttSession } from "./providers/stt-provider.js";

/** `device_offline` or `broker_disconnected`: the two refusals that stop a reply before it starts. */
export type ReplyRefusal = InterruptCause;

export interface ReplyTarget {
  readonly deviceId: string;
  readonly turnId: string;
  /**
   * The turn's Stt_Session: the one the Audio_Turn pushed this upload's frames into (Req 14.2).
   *
   * It travels on the target rather than being looked up by id, because the two ids in play are
   * not the same: the Audio_Server opens the session under its own socket key before any
   * `audio_start` has been seen, while `turnId` is the device's. A lookup by `turnId` misses,
   * silently transcribes an empty session and makes every real turn answer with a Safe_Redirect.
   */
  readonly stt: SttSession;
  /**
   * Sends one binary reply frame on the turn's socket. The first call adds the `reply_started`
   * entry before its frame. Returns false once the turn is closed or interrupted.
   */
  sendFrame(frame: Uint8Array): boolean;
  /** Sends `audio_end`, closes the socket with 1000 and adds `reply_ended`. */
  finish(): void;
  /** The reply's `say` was refused: no frame, no `audio_end`, close, `aborted` with this cause. */
  abort(cause: ReplyRefusal): void;
  /** Stopped once the turn closes for any reason (client close, replaced, barge-in, finish). */
  readonly signal: { readonly stopped: boolean; onStop(fn: () => void): void };
}

export interface TurnResponder {
  /** Called exactly once per turn whose upload ended. */
  respond(turn: ReplyTarget): void;
}
