// Audio turn client (Req 18.1–18.9, G16, G17). One turn at a time, against `AUDIO_WSS_URL`:
//
// - Refused with `offline` while toggled offline and `turn_in_progress` while a turn runs; a
//   refusal opens nothing and leaves the running turn alone (Req 18.8).
// - The turn is in progress from the request until its result. A new `t_` turn id is drawn at
//   the request, so the Control_Surface can return it at once.
// - Once the socket opens: `audio_start`, then the upload frames on deadlines anchored to the
//   first (frame n at t0 + 20 ms x (n - 1), so there is no drift), then `audio_end`, each text
//   message built with the shared codec and the current `ts`. The upload is 50 Synthetic_Frames
//   by default (Req 19.3); a request naming a Test_Utterance uploads that utterance's
//   Utterance_Frames instead, built once at request time by the Mock_Audio_Codec (Req 19.2).
// - Reply frames are counted (their bytes never reach this module) unless `stop_audio` stopped
//   the reply; the latency is whole milliseconds from the own `audio_end` to the first counted
//   reply frame, or null. Every text message goes through `parseAudioControlMessage` first.
// - The reply's `audio_end` for this `turn_id` ends the turn `complete`, or `interrupted` when an
//   interrupt was fired after the own `audio_end`. Failure causes, in the fixed list below:
//   upgrade refused, connect failure, socket closed early, invalid text, another `turn_id`, no
//   reply `audio_end` 10,000 ms after the own one, toggled offline. A failure stops the frames and
//   closes the socket if it is still open.
// - Every result calls `onEnded`, which lets a `say` waiting on this turn get `done` (any reply
//   `audio_end`) or `failed ""` (a failed turn).
//
// Log entries carry the turn id, the phase, the cause from the fixed list and counts only.
import {
  encodeUtteranceFrames,
  parseAudioControlMessage,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  toSafeIssues,
} from "@xelulu/shared";

import { unixSeconds, type Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { TurnView } from "../device/command-handler.js";
import type { IdSource } from "../ids.js";
import type { SimLog } from "../log/logger.js";
import type { ClientAudioInbound, ClientAudioSocket, OpenAudioSocket } from "./audio-transport.js";
import { syntheticFrame } from "./synthetic-frame.js";
import { findTestUtterance } from "./test-utterances.js";

/** The upload length of a turn that names no Test_Utterance (Req 19.3). */
export const TURN_UPLOAD_FRAMES = 50;
export const TURN_FRAME_INTERVAL_MS = 20;
export const TURN_REPLY_TIMEOUT_MS = 10_000;

/** The fixed failure causes (Req 18.6). Simulator log values, not wire values. */
export const TURN_FAILURE_CAUSES = Object.freeze([
  "upgrade_refused",
  "connect_failed",
  "socket_closed",
  "invalid_message",
  "turn_id_mismatch",
  "reply_timeout",
  "toggled_offline",
] as const);
export type TurnFailureCause = (typeof TURN_FAILURE_CAUSES)[number];

export type TurnOutcome = "in_progress" | "complete" | "interrupted" | "failed";

/** The `last_turn` of the Simulator state. */
export type LastTurn = Readonly<{
  turn_id: string | null;
  outcome: TurnOutcome;
  cause: TurnFailureCause | null;
  frames_received: number;
  latency_ms: number | null;
}>;

export type TurnRefusal = "offline" | "turn_in_progress";

export type TurnRequestResult =
  | { readonly ok: true; readonly turn_id: string }
  | { readonly ok: false; readonly code: TurnRefusal };

export type AudioTurnClientDeps = Readonly<{
  /** `AUDIO_WSS_URL` and `DEVICE_TOKEN` from the Config. */
  url: string;
  token: string;
  clock: Clock;
  deadlines: Deadlines;
  ids: IdSource;
  log: SimLog;
  open: OpenAudioSocket;
  /** The device link's toggle state. */
  isOnline: () => boolean;
  /** The turn's result, for the command handler (`turnEnded`). */
  onEnded?: ((outcome: "reply_ended" | "failed") => void) | undefined;
}>;

export interface AudioTurnClient extends TurnView {
  /**
   * The Control_Surface's audio turn request (Req 18.1, 18.8, 19.2, 19.3). With no `utterance`
   * the upload is the Phase 1.2 Synthetic_Frames; with one, that Test_Utterance's
   * Utterance_Frames. An unknown name cannot arrive here — the Control_Surface refuses it before
   * any side effect — and falls back to the synthetic upload, so this stays a total function.
   */
  request(utterance?: string): TurnRequestResult;
  /** An interrupt event was fired (Req 18.9). */
  noteInterrupt(): void;
  /** The offline toggle (Req 19.1). */
  abort(cause: "toggled_offline"): void;
  /** The running turn (`in_progress`) or the last result, or null before the first turn. */
  lastTurn(): LastTurn | null;
  /** Ends any turn without a result entry and cancels its deadlines. */
  stop(): void;
}

type Turn = {
  readonly turnId: string;
  readonly frameKey: string;
  readonly timeoutKey: string;
  /** The Utterance_Frames to upload, or null for the Synthetic_Frame path. */
  readonly frames: readonly Uint8Array[] | null;
  /** How many frames this turn uploads before its own `audio_end`. */
  readonly frameCount: number;
  socket: ClientAudioSocket | null;
  t0: number;
  framesOut: number;
  framesIn: number;
  ownEndAt: number | null;
  firstReplyAt: number | null;
  /** `stop_audio` arrived: later reply frames are not counted (Req 18.5). */
  replyStopped: boolean;
  interrupted: boolean;
};

export function createAudioTurnClient(deps: AudioTurnClientDeps): AudioTurnClient {
  let turn: Turn | null = null;
  let last: LastTurn | null = null;

  function latencyOf(t: Turn): number | null {
    if (t.ownEndAt === null || t.firstReplyAt === null) return null;
    return Math.max(0, Math.round(t.firstReplyAt - t.ownEndAt));
  }

  function view(t: Turn, outcome: TurnOutcome, cause: TurnFailureCause | null): LastTurn {
    return Object.freeze({
      turn_id: t.turnId,
      outcome,
      cause,
      frames_received: t.framesIn,
      latency_ms: latencyOf(t),
    });
  }

  function logText(variant: "audio_start" | "audio_end", turnId: string): void {
    deps.log.add({
      kind: "message_out",
      variant,
      event_id: null,
      cmd_id: null,
      turn_id: turnId,
      ack_status: null,
      ack_reason: null,
      replay: false,
      time_uncertain: false,
    });
  }

  function logPhase(
    t: Turn,
    phase: "started" | Exclude<TurnOutcome, "in_progress">,
    cause: TurnFailureCause | null,
  ): void {
    deps.log.add({
      kind: "audio_turn",
      turn_id: t.turnId,
      phase,
      cause,
      frames_out: t.framesOut,
      frames_in: t.framesIn,
      latency_ms: latencyOf(t),
    });
  }

  function end(
    t: Turn,
    outcome: Exclude<TurnOutcome, "in_progress">,
    cause: TurnFailureCause | null,
  ): void {
    if (turn !== t) return;
    turn = null;
    deps.deadlines.cancel(t.frameKey);
    deps.deadlines.cancel(t.timeoutKey);
    const socket = t.socket;
    t.socket = null;
    if (socket !== null && cause !== "socket_closed") socket.close();
    last = view(t, outcome, cause);
    logPhase(t, outcome, cause);
    deps.onEnded?.(outcome === "failed" ? "failed" : "reply_ended");
  }

  function sendOwnEnd(t: Turn, socket: ClientAudioSocket): void {
    socket.sendText(
      serialiseAudioEndMessage({
        proto_ver: 2,
        ts: unixSeconds(deps.clock.now()),
        type: "audio_end",
        turn_id: t.turnId,
      }),
    );
    logText("audio_end", t.turnId);
    t.ownEndAt = deps.clock.now();
    deps.deadlines.schedule(t.timeoutKey, t.ownEndAt + TURN_REPLY_TIMEOUT_MS, () =>
      end(t, "failed", "reply_timeout"),
    );
  }

  /** Sends frame n (1-based); frame n + 1 is due at t0 + 20 ms x n. */
  function sendFrame(t: Turn, n: number): void {
    const socket = t.socket;
    if (turn !== t || socket === null) return;
    socket.sendBinary(t.frames === null ? syntheticFrame() : (t.frames[n - 1] ?? syntheticFrame()));
    t.framesOut += 1;
    if (n >= t.frameCount) {
      sendOwnEnd(t, socket);
      return;
    }
    deps.deadlines.schedule(t.frameKey, t.t0 + TURN_FRAME_INTERVAL_MS * n, () =>
      sendFrame(t, n + 1),
    );
  }

  function onText(t: Turn, text: string): void {
    const parsed = parseAudioControlMessage(text);
    if (!parsed.ok) {
      deps.log.add({
        kind: "message_rejected",
        transport: "ws",
        proto_ver_mismatch: parsed.error.issues.some(
          (i) => i.path.length === 1 && i.path[0] === "proto_ver",
        ),
        issues: toSafeIssues(parsed.error.issues),
      });
      end(t, "failed", "invalid_message");
      return;
    }
    const msg = parsed.value;
    if (msg.turn_id !== t.turnId) {
      end(t, "failed", "turn_id_mismatch");
      return;
    }
    // The gateway sends no downstream `audio_start` (G18); one with this turn id changes nothing.
    if (msg.type !== "audio_end") return;
    deps.log.add({
      kind: "message_in",
      variant: "audio_end",
      cmd_id: null,
      turn_id: t.turnId,
      duplicate: false,
    });
    end(t, t.interrupted ? "interrupted" : "complete", null);
  }

  function onInbound(t: Turn, message: ClientAudioInbound): void {
    if (turn !== t) return;
    deps.deadlines.fireDue(deps.clock.now());
    if (turn !== t) return;
    switch (message.kind) {
      case "closed":
        t.socket = null;
        end(t, "failed", "socket_closed");
        return;
      case "binary":
        if (t.replyStopped) return;
        t.framesIn += 1;
        if (t.firstReplyAt === null) t.firstReplyAt = deps.clock.now();
        return;
      case "text":
        onText(t, message.text);
        return;
    }
  }

  function opened(t: Turn, socket: ClientAudioSocket): void {
    if (turn !== t) {
      // The turn ended (toggled offline) while the socket was opening.
      socket.close();
      return;
    }
    t.socket = socket;
    socket.onInbound((message) => onInbound(t, message));
    socket.sendText(
      serialiseAudioStartMessage({
        proto_ver: 2,
        ts: unixSeconds(deps.clock.now()),
        type: "audio_start",
        turn_id: t.turnId,
      }),
    );
    logText("audio_start", t.turnId);
    logPhase(t, "started", null);
    t.t0 = deps.clock.now();
    sendFrame(t, 1);
  }

  return {
    request(utterance) {
      if (!deps.isOnline()) return { ok: false, code: "offline" };
      if (turn !== null) return { ok: false, code: "turn_in_progress" };
      // The whole upload is built here, once, so the 20 ms cadence carries no encoding work.
      const chosen = utterance === undefined ? null : findTestUtterance(utterance);
      const frames =
        chosen === null ? null : [...encodeUtteranceFrames(chosen.text, chosen.lang).frames];
      const turnId = deps.ids.next("t_");
      const t: Turn = {
        turnId,
        frameKey: `turn:${turnId}:frame`,
        timeoutKey: `turn:${turnId}:reply_timeout`,
        frames,
        frameCount: frames === null ? TURN_UPLOAD_FRAMES : frames.length,
        socket: null,
        t0: deps.clock.now(),
        framesOut: 0,
        framesIn: 0,
        ownEndAt: null,
        firstReplyAt: null,
        replyStopped: false,
        interrupted: false,
      };
      turn = t;
      deps.open(deps.url, deps.token).then(
        (socket) => opened(t, socket),
        (reason: unknown) =>
          end(t, "failed", reason === "upgrade_refused" ? "upgrade_refused" : "connect_failed"),
      );
      return { ok: true, turn_id: turnId };
    },

    noteInterrupt() {
      if (turn !== null && turn.ownEndAt !== null) turn.interrupted = true;
    },

    abort(cause) {
      if (turn !== null) end(turn, "failed", cause);
    },

    inProgress: () => turn !== null,

    stopReply() {
      if (turn !== null) turn.replyStopped = true;
    },

    lastTurn() {
      return turn !== null ? view(turn, "in_progress", null) : last;
    },

    stop() {
      const t = turn;
      if (t === null) return;
      turn = null;
      deps.deadlines.cancel(t.frameKey);
      deps.deadlines.cancel(t.timeoutKey);
      t.socket?.close();
      t.socket = null;
    },
  };
}
