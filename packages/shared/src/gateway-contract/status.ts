// status: the device's 15 s heartbeat on `xelulu/{device_id}/status`, plus the status topic union.
// Document B v2 §3.2, Requirements 4.3 and 4.4.
import { z } from "zod";

import { deviceEnvelope } from "./envelope.js";
import { MODES, type Mode } from "./enums.js";
import { HelloMessageSchema, type HelloMessage } from "./hello.js";
import { anyString, enumOf, finite, int, pct } from "./primitives.js";

export const StatusMessageSchema = z.strictObject({
  ...deviceEnvelope,
  type: z.literal("status"),
  battery_pct: pct,
  charging: z.boolean(),
  mode: enumOf(MODES),
  wifi_rssi: int,
  fault: z.array(anyString),
  active_child_id: z.string().nullable(),
  temp_c: finite,
});

export type StatusMessage = {
  proto_ver: 2;
  ts: number;
  type: "status";
  battery_pct: number;
  charging: boolean;
  mode: Mode;
  wifi_rssi: number;
  fault: string[];
  active_child_id: string | null;
  temp_c: number;
};

/** Everything the device publishes on the `status` topic, narrowed by `type`. */
export const StatusTopicMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  StatusMessageSchema,
]);

export type StatusTopicMessage = HelloMessage | StatusMessage;
