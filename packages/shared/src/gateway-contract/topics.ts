// MQTT topic builder and parser. Requirements 1.2–1.7.
// Document B v2 defines exactly four topics: xelulu/{device_id}/{status|event|cmd|ack}.
import { ContractError, type ContractIssue, type ParseResult } from "./errors.js";

export const TOPIC_PREFIX = "xelulu" as const;

export const TOPIC_SUFFIXES = Object.freeze(["status", "event", "cmd", "ack"] as const);
export type TopicSuffix = (typeof TOPIC_SUFFIXES)[number];

export type ParsedTopic = { readonly device_id: string; readonly suffix: TopicSuffix };

const TOPIC_VARIANT = "topic";

/** C23: non-empty, and none of the MQTT level separator or wildcards. */
function isValidDeviceId(deviceId: unknown): deviceId is string {
  return (
    typeof deviceId === "string" &&
    deviceId.length > 0 &&
    !deviceId.includes("/") &&
    !deviceId.includes("+") &&
    !deviceId.includes("#")
  );
}

function isTopicSuffix(suffix: unknown): suffix is TopicSuffix {
  return typeof suffix === "string" && (TOPIC_SUFFIXES as readonly string[]).includes(suffix);
}

/**
 * Builds `xelulu/{device_id}/{suffix}`.
 * Throws a ContractError (variant "topic") for an invalid device_id or suffix. The suffix is
 * checked at runtime too, because JS callers and casts can pass any string.
 */
export function buildTopic(deviceId: string, suffix: TopicSuffix): string {
  const issues: ContractIssue[] = [];
  if (!isValidDeviceId(deviceId)) issues.push({ path: ["device_id"], kind: "invalid_device_id" });
  if (!isTopicSuffix(suffix)) issues.push({ path: ["suffix"], kind: "invalid_topic_suffix" });
  if (issues.length > 0) throw new ContractError(TOPIC_VARIANT, issues);
  return `${TOPIC_PREFIX}/${deviceId}/${suffix}`;
}

/** Never throws. Fails unless the input is exactly xelulu/{valid device_id}/{suffix}. */
export function parseTopic(topic: string): ParseResult<ParsedTopic> {
  const fail = (issue: ContractIssue): ParseResult<ParsedTopic> => ({
    ok: false,
    error: new ContractError(TOPIC_VARIANT, [issue]),
  });
  if (typeof topic !== "string") return fail({ path: [], kind: "invalid_topic" });
  const levels = topic.split("/");
  if (levels.length !== 3) return fail({ path: [], kind: "invalid_topic" });
  const [prefix, deviceId, suffix] = levels;
  if (prefix !== TOPIC_PREFIX) return fail({ path: [], kind: "invalid_topic" });
  if (!isValidDeviceId(deviceId)) return fail({ path: ["device_id"], kind: "invalid_device_id" });
  if (!isTopicSuffix(suffix)) return fail({ path: ["suffix"], kind: "invalid_topic_suffix" });
  return { ok: true, value: Object.freeze({ device_id: deviceId, suffix }) };
}
