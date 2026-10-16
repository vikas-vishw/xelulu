// Audio turn markers on the per-turn WebSocket, sent as text frames around binary Opus frames.
// Document B v2 §3.4, Requirements 6.1–6.6. Each marker is validated on its own: turn pairing is
// outside the contract.
import { z } from "zod";

import { deviceEnvelope } from "./envelope.js";
import { nonEmpty } from "./primitives.js";

export const AudioStartMessageSchema = z.strictObject({
  ...deviceEnvelope,
  type: z.literal("audio_start"),
  turn_id: nonEmpty,
});

export const AudioEndMessageSchema = z.strictObject({
  ...deviceEnvelope,
  type: z.literal("audio_end"),
  turn_id: nonEmpty,
});

/** Either audio turn marker, narrowed by `type`. */
export const AudioControlMessageSchema = z.discriminatedUnion("type", [
  AudioStartMessageSchema,
  AudioEndMessageSchema,
]);

export type AudioStartMessage = { proto_ver: 2; ts: number; type: "audio_start"; turn_id: string };
export type AudioEndMessage = { proto_ver: 2; ts: number; type: "audio_end"; turn_id: string };
export type AudioControlMessage = AudioStartMessage | AudioEndMessage;
