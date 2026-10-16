// ack: the device's answer to a command on `xelulu/{device_id}/ack`.
// Document B v2 §5, Requirements 7.1–7.5. The reason is the hardware's truth (C7): the cloud
// accepts it and never retries around it. A rejected ack must name its reason.
import { z } from "zod";

import { deviceEnvelope } from "./envelope.js";
import { ACK_REASONS, ACK_STATUSES, type AckReason, type AckStatus } from "./enums.js";
import { enumOf, nonEmpty } from "./primitives.js";

export const AckMessageSchema = z
  .strictObject({
    ...deviceEnvelope,
    type: z.literal("ack"),
    cmd_id: nonEmpty,
    status: enumOf(ACK_STATUSES),
    reason: z.union([z.literal(""), enumOf(ACK_REASONS)]),
  })
  .superRefine((msg, ctx) => {
    if (msg.status === "rejected" && msg.reason === "") {
      ctx.addIssue({ code: "custom", path: ["reason"], params: { kind: "reason_required" } });
    }
  });

export type AckMessage = {
  proto_ver: 2;
  ts: number;
  type: "ack";
  cmd_id: string;
  status: AckStatus;
  reason: "" | AckReason;
};
