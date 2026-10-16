// Test helper (not a test): a minimal TurnResponder for the tests whose subject is the AUDIO
// PLANE rather than the brain — the Audio_Server's socket handling and barge-in.
//
// It reproduces just enough of a reply to exercise those paths: one `say`, then a fixed number of
// synthetic frames on the 20 ms cadence, then `audio_end`. It replaces the Phase 1.2 Fake_Reply,
// which those tests used before the Voice_Brain took the seam over (Phase 3 C1). Using a stub
// here rather than the real brain keeps the audio-plane tests testing the audio plane: the
// pipeline, the Filler and the latency path have their own tests.
import { syntheticFrame } from "../../src/audio/synthetic-frame.js";
import type { SttSession } from "../../src/brain/providers/stt-provider.js";
import type { TurnResponder } from "../../src/brain/turn-responder.js";
import type { Clock } from "../../src/clock.js";
import type { Deadlines } from "../../src/deadlines.js";
import type { CommandRequest, CommandResult } from "../../src/mqtt/command-sender.js";

export const STUB_REPLY_FRAMES = 50;
export const STUB_REPLY_FRAME_INTERVAL_MS = 20;

/** The same four keys the contract requires of `say` data. */
export const STUB_SAY_DATA = Object.freeze({
  expression: "happy",
  lang: "en-IN",
  voice: "xelulu",
  duration_hint_ms: 1000,
});

export interface StubResponder extends TurnResponder {
  openStt(deviceId: string, turnId: string): SttSession;
}

export function createStubResponder(
  deps: Readonly<{
    clock: Clock;
    deadlines: Deadlines;
    sendCommand: (request: CommandRequest) => CommandResult;
    frames?: number;
  }>,
): StubResponder {
  const total = deps.frames ?? STUB_REPLY_FRAMES;
  let seq = 0;

  return {
    openStt(_deviceId, turnId) {
      // Discards every frame: this stub transcribes nothing, so it holds nothing to release.
      return {
        turnId,
        pushFrame: () => undefined,
        release: () => undefined,
        bytesHeld: () => 0,
        finish: () => Promise.resolve({ ok: false, reason: "no_speech" }),
      };
    },

    respond(target) {
      const result = deps.sendCommand({
        device_id: target.deviceId,
        action: "say",
        data: { ...STUB_SAY_DATA },
      });
      if (!result.ok) {
        target.abort(
          result.error.code === "broker_disconnected" ? "broker_disconnected" : "device_offline",
        );
        return;
      }

      seq += 1;
      const key = `stub-reply:${seq}`;
      const t0 = deps.clock.now();
      target.signal.onStop(() => deps.deadlines.cancel(key));

      const send = (n: number): void => {
        if (target.signal.stopped || !target.sendFrame(syntheticFrame())) return;
        if (n === total) {
          target.finish();
          return;
        }
        deps.deadlines.schedule(key, t0 + STUB_REPLY_FRAME_INTERVAL_MS * n, () => send(n + 1));
      };
      send(1);
    },
  };
}
