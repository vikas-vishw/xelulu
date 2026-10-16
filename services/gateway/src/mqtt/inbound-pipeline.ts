// Inbound MQTT pipeline (Req 2.1, 2.2, 4.1–4.4, 4.9, 4.10, 5.6) as a pure classifier. The six
// steps run in order and the first failure stops the pipeline:
//   1. parseTopic                 -> invalid_topic (device_id null, no part of the topic logged)
//   2. Registered_Device?         -> unknown_device (device_id null)
//   3. payload over 8,192 bytes   -> payload_too_large (not parsed)
//   4. parseDeviceMessage         -> the message's Safe_Issues
//   5. hello device_id mismatch   -> device_id_mismatch (auth not compared)
//   6. non-hello while auth_failed -> auth_failed
// No step reads a payload field before parseDeviceMessage, and every reject entry is built only
// from the parsed topic, constants and Safe_Issues, so a rejected payload's values never reach a log.
import {
  parseDeviceMessage,
  parseTopic,
  toSafeIssues,
  type AckMessage,
  type ContractIssue,
  type EventMessage,
  type GatewayIssueKind,
  type HelloMessage,
  type ParseResult,
  type SafeIssue,
  type StatusMessage,
  type TopicSuffix,
} from "@xelulu/shared";

import type { LogEntryFields } from "../log/gateway-log.js";

/** The largest MQTT payload the gateway parses (G33). */
export const MAX_INBOUND_PAYLOAD_BYTES = 8_192;

export type RejectEntry = LogEntryFields<"message_rejected">;

export type InboundDecision =
  | { readonly kind: "reject"; readonly entry: RejectEntry }
  | { readonly kind: "hello"; readonly deviceId: string; readonly message: HelloMessage }
  | { readonly kind: "status"; readonly deviceId: string; readonly message: StatusMessage }
  | { readonly kind: "event"; readonly deviceId: string; readonly message: EventMessage }
  | { readonly kind: "ack"; readonly deviceId: string; readonly message: AckMessage };

export type InboundRegistry = Readonly<{
  isRegistered(deviceId: string): boolean;
  isAuthFailed(deviceId: string): boolean;
}>;

const decoder = new TextDecoder("utf-8");

function reject(
  deviceId: string | null,
  suffix: TopicSuffix | null,
  issues: readonly SafeIssue[],
): InboundDecision {
  return {
    kind: "reject",
    entry: {
      kind: "message_rejected",
      transport: "mqtt",
      device_id: deviceId,
      topic_suffix: suffix,
      issues,
    },
  };
}

/** One Gateway_Issue_Kind issue; only device_id_mismatch carries a path (G38). */
function gatewayIssue(kind: GatewayIssueKind): SafeIssue[] {
  return [{ path: kind === "device_id_mismatch" ? ["device_id"] : [], kind }];
}

type Parsed =
  | {
      readonly ok: true;
      readonly message: HelloMessage | StatusMessage | EventMessage | AckMessage;
    }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

function fromResult<T extends HelloMessage | StatusMessage | EventMessage | AckMessage>(
  result: ParseResult<T>,
): Parsed {
  return result.ok
    ? { ok: true, message: result.value }
    : { ok: false, issues: result.error.issues };
}

/** Step 4: the topic's own parser. `cmd` always fails (`wrong_topic`) without reading the text. */
function parseFor(suffix: TopicSuffix, text: string): Parsed {
  switch (suffix) {
    case "status":
      return fromResult(parseDeviceMessage("status", text));
    case "event":
      return fromResult(parseDeviceMessage("event", text));
    case "ack":
      return fromResult(parseDeviceMessage("ack", text));
    case "cmd": {
      const result = parseDeviceMessage("cmd", text);
      return result.ok ? { ok: false, issues: [] } : { ok: false, issues: result.error.issues };
    }
  }
}

export function classifyInbound(
  topic: string,
  payload: Uint8Array,
  registry: InboundRegistry,
): InboundDecision {
  // 1. Topic (Req 4.9).
  const parsedTopic = parseTopic(topic);
  if (!parsedTopic.ok) return reject(null, null, gatewayIssue("invalid_topic"));
  const { device_id: deviceId, suffix } = parsedTopic.value;

  // 2. Registered_Device (Req 4.10). The unverified id is not logged (G37).
  if (!registry.isRegistered(deviceId)) return reject(null, suffix, gatewayIssue("unknown_device"));

  // 3. Size, before any decoding (Req 4.2). Exactly 8,192 bytes goes on to parsing.
  if (payload.byteLength > MAX_INBOUND_PAYLOAD_BYTES) {
    return reject(deviceId, suffix, gatewayIssue("payload_too_large"));
  }

  // 4. Contract parse (Req 4.3). Safe_Issues keep path and kind only (R2).
  const parsed = parseFor(suffix, decoder.decode(payload));
  if (!parsed.ok) {
    const issues = toSafeIssues(parsed.issues);
    return reject(deviceId, suffix, issues.length > 0 ? issues : [{ path: [], kind: "custom" }]);
  }
  const message = parsed.message;

  // 5. A hello must name its own topic's device (Req 4.4); its auth is not compared here.
  if (message.type === "hello") {
    if (message.device_id !== deviceId) {
      return reject(deviceId, suffix, gatewayIssue("device_id_mismatch"));
    }
    return { kind: "hello", deviceId, message };
  }

  // 6. Everything else from an auth_failed device is dropped (Req 5.6).
  if (registry.isAuthFailed(deviceId)) return reject(deviceId, suffix, gatewayIssue("auth_failed"));

  switch (message.type) {
    case "status":
      return { kind: "status", deviceId, message };
    case "event":
      return { kind: "event", deviceId, message };
    case "ack":
      return { kind: "ack", deviceId, message };
  }
}
