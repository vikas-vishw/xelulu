// One Audio_Turn per accepted socket (Req 9.4–9.12, G19, G40, G41, D7). Stages:
//   awaiting_start -> uploading -> replying -> closed
// Every text message up to 4,096 bytes is parsed with parseAudioControlMessage before any field is
// read. A binary frame is counted by length and then handed to this turn's Stt_Session inside the
// handler that received it; this module keeps no reference to its bytes and passes them nowhere
// else (Req 14.2). Every terminal path releases the session's buffer exactly once (Req 14.3).
// Any message over 65,536 bytes arrives as `too_large` and aborts with `frame_too_large` in every
// stage. During the reply, device traffic within the limits is ignored (an invalid text is logged
// as a ws `message_rejected`); only an oversized message aborts, and a reply-stage frame within
// the limit is released without being counted or pushed. An aborted turn gets no `audio_end`.
import {
  PROTO_VER,
  parseAudioControlMessage,
  serialiseAudioEndMessage,
  toSafeIssues,
  type AbortCause,
  type AudioTurnPhase,
  type InterruptCause,
  type SafeIssue,
} from "@xelulu/shared";

import type { SttSession } from "../brain/providers/stt-provider.js";
import type { ReplyTarget } from "../brain/turn-responder.js";
import { unixSeconds, type Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { AudioCloseCode, AudioInbound, AudioSocket } from "./audio-transport.js";

export const MAX_TEXT_MESSAGE_BYTES = 4_096;
export const MAX_FRAME_BYTES = 1_500;
/** 60 s of 20 ms frames. */
export const MAX_UPLOAD_FRAMES = 3_000;
export const START_TIMEOUT_MS = 5_000;
export const IDLE_TIMEOUT_MS = 10_000;

export type TurnStage = "awaiting_start" | "uploading" | "replying" | "closed";

export type AudioTurnDeps = Readonly<{
  deviceId: string;
  socket: AudioSocket;
  clock: Clock;
  deadlines: Deadlines;
  log: Pick<GatewayLog, "add">;
  /** Unique per turn; prefixes this turn's deadline keys. */
  key: string;
  /** The turn's speech-to-text sink. Called only inside the inbound handler. */
  stt: SttSession;
  /** Called once, when a valid `audio_end` ends the upload. */
  onUploadEnded(target: ReplyTarget): void;
  /** Called once, when the turn ends for any reason other than `dispose`. */
  onClosed(): void;
}>;

export interface AudioTurn {
  readonly deviceId: string;
  stage(): TurnStage;
  turnId(): string | null;
  counts(): Readonly<{ framesIn: number; bytesIn: number; framesOut: number }>;
  /** One inbound socket message. The caller fires due deadlines first (G49). */
  handle(message: AudioInbound): void;
  /** Aborts under Req 9.8: close (unless the device closed), one `aborted` entry, forget. */
  abort(cause: AbortCause, issues?: readonly SafeIssue[]): void;
  /**
   * Barge-in (Req 11.1–11.3): only while replying. Stops the reply, sends `audio_end`, logs
   * `message_out`, closes 1000, then calls `sendStop` and logs `interrupted` with its refusal cause.
   * Returns false, changing nothing, when no reply is in flight (Req 11.4).
   */
  bargeIn(sendStop: () => InterruptCause | null): boolean;
  /** Gateway stop: closes 1001 and cancels deadlines, with no entry. */
  dispose(): void;
}

/** 1009 for size, 1001 for replaced, 1008 for every other protocol or policy cause. */
function closeCodeFor(cause: AbortCause): AudioCloseCode {
  switch (cause) {
    case "text_too_large":
    case "frame_too_large":
      return 1009;
    case "replaced":
      return 1001;
    default:
      return 1008;
  }
}

export function createAudioTurn(deps: AudioTurnDeps): AudioTurn {
  const { deviceId, socket, clock, deadlines, log } = deps;
  const startKey = `${deps.key}:start`;
  const idleKey = `${deps.key}:idle`;
  let stage: TurnStage = "awaiting_start";
  let turnId: string | null = null;
  let framesIn = 0;
  let bytesIn = 0;
  let framesOut = 0;
  let replyStarted = false;
  let stopped = false;
  const stopListeners: (() => void)[] = [];

  function turnEntry(
    phase: AudioTurnPhase,
    cause: AbortCause | null = null,
    issues: readonly SafeIssue[] = [],
  ): void {
    log.add({
      kind: "audio_turn",
      device_id: deviceId,
      turn_id: turnId,
      phase,
      frames_in: framesIn,
      bytes_in: bytesIn,
      frames_out: framesOut,
      cause,
      issues,
    });
  }

  function messageIn(variant: "audio_start" | "audio_end"): void {
    log.add({
      kind: "message_in",
      transport: "ws",
      device_id: deviceId,
      topic_suffix: null,
      variant,
      event_id: null,
      cmd_id: null,
      turn_id: turnId,
      battery_pct: null,
      charging: null,
      mode: null,
    });
  }

  /**
   * Every terminal transition: stage closed, timers cancelled, the Stt_Session's buffer released,
   * the reply told to stop. Reached by client close, abort, replaced, barge-in, finish and
   * dispose, so the turn's bytes are freed on every exit path (Req 14.3).
   */
  function closeTurn(): void {
    stage = "closed";
    deadlines.cancel(startKey);
    deadlines.cancel(idleKey);
    deps.stt.release();
    if (stopped) return;
    stopped = true;
    for (const fn of stopListeners.splice(0)) fn();
  }

  function abort(cause: AbortCause, issues: readonly SafeIssue[] = []): void {
    if (stage === "closed") return;
    closeTurn();
    if (cause !== "client_closed") socket.close(closeCodeFor(cause));
    turnEntry("aborted", cause, cause === "invalid_message" ? issues : []);
    deps.onClosed();
  }

  /** The one `audio_end` a turn may get (Req 10.3, 11.2), serialised with the contract. */
  function sendAudioEnd(id: string): void {
    socket.sendText(
      serialiseAudioEndMessage({
        proto_ver: PROTO_VER,
        ts: unixSeconds(clock.now()),
        type: "audio_end",
        turn_id: id,
      }),
    );
    log.add({
      kind: "message_out",
      transport: "ws",
      device_id: deviceId,
      variant: "audio_end",
      cmd_id: null,
      turn_id: id,
    });
  }

  function armIdle(): void {
    deadlines.schedule(idleKey, clock.now() + IDLE_TIMEOUT_MS, () => abort("idle_timeout"));
  }

  function replyTarget(id: string): ReplyTarget {
    return {
      deviceId,
      turnId: id,
      // The session this turn's frames went into, handed over rather than looked up by id: the
      // responder has no way to reach it otherwise, because it was opened under the socket's key
      // before this turn_id existed.
      stt: deps.stt,
      sendFrame(frame) {
        if (stage !== "replying") return false;
        if (!replyStarted) {
          replyStarted = true;
          turnEntry("reply_started");
        }
        socket.sendBinary(frame);
        framesOut += 1;
        return true;
      },
      finish() {
        if (stage !== "replying") return;
        closeTurn();
        sendAudioEnd(id);
        socket.close(1000);
        turnEntry("reply_ended");
        deps.onClosed();
      },
      abort(cause) {
        abort(cause);
      },
      signal: {
        get stopped() {
          return stopped;
        },
        onStop(fn) {
          if (stopped) fn();
          else stopListeners.push(fn);
        },
      },
    };
  }

  function handleText(text: string, byteLength: number): void {
    if (byteLength > MAX_TEXT_MESSAGE_BYTES) {
      abort("text_too_large");
      return;
    }
    const parsed = parseAudioControlMessage(text);
    if (stage === "replying") {
      // Ignored during the reply; an invalid one is logged without its values (Req 9.12).
      if (!parsed.ok) {
        log.add({
          kind: "message_rejected",
          transport: "ws",
          device_id: deviceId,
          topic_suffix: null,
          issues: toSafeIssues(parsed.error.issues),
        });
      }
      return;
    }
    if (!parsed.ok) {
      abort("invalid_message", toSafeIssues(parsed.error.issues));
      return;
    }
    const message = parsed.value;
    if (stage === "awaiting_start") {
      if (message.type === "audio_end") {
        abort("end_before_start");
        return;
      }
      turnId = message.turn_id;
      stage = "uploading";
      deadlines.cancel(startKey);
      armIdle();
      messageIn("audio_start");
      turnEntry("started");
      return;
    }
    // uploading
    if (message.type === "audio_start") {
      abort("duplicate_start");
      return;
    }
    if (message.turn_id !== turnId) {
      abort("turn_id_mismatch");
      return;
    }
    const id = message.turn_id;
    deadlines.cancel(idleKey);
    stage = "replying";
    messageIn("audio_end");
    turnEntry("ended");
    deps.onUploadEnded(replyTarget(id));
  }

  function handleBinary(bytes: Uint8Array, byteLength: number): void {
    if (stage === "awaiting_start") {
      abort("frame_before_start");
      return;
    }
    if (byteLength > MAX_FRAME_BYTES) {
      abort("frame_too_large");
      return;
    }
    // During the reply a frame within the limit is released with the counts unchanged and is
    // pushed nowhere: the session's buffer is the upload's, not the reply's (Req 14.2).
    if (stage === "replying") return;
    if (framesIn >= MAX_UPLOAD_FRAMES) {
      abort("too_many_frames");
      return;
    }
    framesIn += 1;
    bytesIn += byteLength;
    deps.stt.pushFrame(bytes); // in-handler hand-off; no reference kept here (Req 14.2)
  }

  deadlines.schedule(startKey, clock.now() + START_TIMEOUT_MS, () => abort("start_timeout"));

  return {
    deviceId,
    stage: () => stage,
    turnId: () => turnId,
    counts: () => ({ framesIn, bytesIn, framesOut }),
    handle(message) {
      if (stage === "closed") return;
      // Any message while uploading counts as activity (Req 9.11 idle_timeout).
      if (stage === "uploading") armIdle();
      switch (message.kind) {
        case "too_large":
          abort("frame_too_large");
          return;
        case "closed":
          abort("client_closed");
          return;
        case "text":
          handleText(message.text, message.byteLength);
          return;
        case "binary":
          handleBinary(message.bytes, message.byteLength);
          return;
      }
    },
    abort,
    bargeIn(sendStop) {
      if (stage !== "replying" || turnId === null) return false;
      const id = turnId;
      closeTurn();
      sendAudioEnd(id);
      socket.close(1000);
      const cause = sendStop();
      turnEntry("interrupted", cause);
      deps.onClosed();
      return true;
    },
    dispose() {
      if (stage === "closed") return;
      closeTurn();
      socket.close(1001);
    },
  };
}
