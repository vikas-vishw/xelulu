// hello: the device's first message on `xelulu/{device_id}/status` after connecting.
// Document B v2 §3.1, Requirements 4.1 and 4.2. `ts` is required per the envelope rule (ruling 1).
import { z } from "zod";

import { PROTO_VER } from "./constants.js";
import { deviceEnvelope } from "./envelope.js";
import { nonEmpty } from "./primitives.js";

export const HelloMessageSchema = z.strictObject({
  ...deviceEnvelope,
  type: z.literal("hello"),
  device_id: nonEmpty,
  fw_ver: nonEmpty,
  auth: nonEmpty,
  proto: z.literal(PROTO_VER),
});

export type HelloMessage = {
  proto_ver: 2;
  ts: number;
  type: "hello";
  device_id: string;
  fw_ver: string;
  auth: string;
  proto: 2;
};
