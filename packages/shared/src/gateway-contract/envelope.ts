// Internal envelope builders for the Document B v2 contract. Not re-exported. Requirements 2.1–2.5.
import { z } from "zod";

import type { CmdAction, EventKind } from "./enums.js";
import { nonEmpty, protoVer, unixSeconds } from "./primitives.js";

/** Device → cloud envelope fields shared by hello, status, event, ack, audio_start and audio_end. */
export const deviceEnvelope = { proto_ver: protoVer, ts: unixSeconds } as const;

/** One event variant: strict, discriminated by `event`, with an optional `time_uncertain`. */
export function eventSchema<K extends EventKind, D extends z.ZodType>(kind: K, data: D) {
  return z.strictObject({
    ...deviceEnvelope,
    type: z.literal("event"),
    event_id: nonEmpty,
    event: z.literal(kind),
    time_uncertain: z.boolean().optional(),
    data,
  });
}

/**
 * One command variant: strict, with no `ts` and no `type` (C2), so either key on a command is
 * an unknown key and is rejected.
 */
export function cmdSchema<A extends CmdAction, D extends z.ZodType>(action: A, data: D) {
  return z.strictObject({
    proto_ver: protoVer,
    cmd_id: nonEmpty,
    action: z.literal(action),
    data,
  });
}
