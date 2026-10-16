// The Audio_Server core (Req 9.7–9.9, 11.1–11.6). One open Audio_Turn per device. A new accepted
// socket for a device first aborts its older turn as `replaced`, before any message on the new
// socket is handled. Each opened turn is handed its own Stt_Session, the only consumer of that
// turn's frame bytes (Req 14.2). After a turn's upload ends, the TurnResponder is called exactly
// once through the turn's ReplyTarget. Barge-in follows the design: stop the reply frames,
// `audio_end`, `message_out` (ws), close 1000, then `stop_audio` through sendCommand, then
// `interrupted` with the real frames sent and the refusal cause. A refused `stop_audio` is
// neither retried nor queued.
import type { InterruptCause } from "@xelulu/shared";

import type { SttSession } from "../brain/providers/stt-provider.js";
import type { TurnResponder } from "../brain/turn-responder.js";
import type { Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { CommandRequest, CommandResult } from "../mqtt/command-sender.js";
import type { AudioSocket } from "./audio-transport.js";
import { createAudioTurn, type AudioTurn, type TurnStage } from "./audio-turn.js";

export type AudioServerDeps = Readonly<{
  clock: Clock;
  deadlines: Deadlines;
  log: Pick<GatewayLog, "add">;
  responder: TurnResponder;
  /**
   * One Stt_Session per accepted socket, handed to the turn at open time (Req 14.2). The
   * contract's `turn_id` is not known until the device's `audio_start`, so the session is opened
   * under the socket's own turn key and the Audio_Turn is its only caller.
   */
  openStt: (deviceId: string, turnId: string) => SttSession;
  sendCommand: (request: CommandRequest) => CommandResult;
}>;

export interface AudioServer {
  /** An accepted, authenticated socket for `deviceId` (AudioListen's onTurn). */
  openTurn(deviceId: string, socket: AudioSocket): void;
  /** A new, non-duplicate `interrupt` event was accepted for `deviceId`. */
  bargeIn(deviceId: string): void;
  /** The stage of the device's open turn, or null when it has none. */
  turnStage(deviceId: string): TurnStage | null;
  /** Closes every open turn with no entry and refuses new ones. */
  stop(): void;
}

export function createAudioServer(deps: AudioServerDeps): AudioServer {
  const turns = new Map<string, AudioTurn>();
  let seq = 0;
  let stopped = false;

  function stopAudio(deviceId: string): InterruptCause | null {
    const result = deps.sendCommand({ device_id: deviceId, action: "stop_audio", data: {} });
    if (result.ok) return null;
    const code = result.error.code;
    return code === "device_offline" || code === "broker_disconnected" ? code : null;
  }

  return {
    openTurn(deviceId, socket) {
      if (stopped) {
        socket.close(1001);
        return;
      }
      // Req 9.9: the older turn is aborted first; its onClosed removes it from the map.
      turns.get(deviceId)?.abort("replaced");
      seq += 1;
      const key = `audio:${seq}`;
      const turn: AudioTurn = createAudioTurn({
        deviceId,
        socket,
        clock: deps.clock,
        deadlines: deps.deadlines,
        log: deps.log,
        key,
        stt: deps.openStt(deviceId, key),
        onUploadEnded: (target) => deps.responder.respond(target),
        onClosed: () => {
          if (turns.get(deviceId) === turn) turns.delete(deviceId);
        },
      });
      turns.set(deviceId, turn);
      socket.onInbound((message) => {
        // Deadlines due at or before this message fire first (G49).
        deps.deadlines.fireDue(deps.clock.now());
        turn.handle(message);
      });
    },

    bargeIn(deviceId) {
      // A no-op unless the device's turn is replying (Req 11.4).
      turns.get(deviceId)?.bargeIn(() => stopAudio(deviceId));
    },

    turnStage: (deviceId) => turns.get(deviceId)?.stage() ?? null,

    stop() {
      stopped = true;
      for (const turn of turns.values()) turn.dispose();
      turns.clear();
    },
  };
}
