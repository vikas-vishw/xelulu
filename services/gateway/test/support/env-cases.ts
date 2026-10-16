// Test helper (not a test): pinned envs and per-key cases for the gateway start tests
// (design "Start tests", Req 1.3, 1.7, 22.3). Every env starts from the inherited env with every
// Panel_Key removed (case-insensitively, since Windows env names are), then gets known values.
// Env entries are [key, value] tuples and URLs are built as scheme + "://" + host, so no line of
// this file has the shape of a Panel_Key assignment or a non-local URL. The expected offending
// keys come from this file's own G3 table, never from the parser.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type EnvEntry = readonly [key: string, value: string];
export type Env = Record<string, string | undefined>;

const PANEL_FIXTURE = fileURLToPath(
  new URL("../../../../tooling/fixtures/approved-panel.txt", import.meta.url),
);

/** The gateway's G3 keys, in G3 order (written here, not imported from config.ts). */
export const GATEWAY_G3_KEYS = Object.freeze([
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "GATEWAY_OPERATOR_PORT",
] as const);
export type GatewayG3Key = (typeof GATEWAY_G3_KEYS)[number];

/** Required outside Local_Mode: every G3 key except APP_ENV. */
export const REQUIRED_KEYS: readonly GatewayG3Key[] = Object.freeze(
  GATEWAY_G3_KEYS.filter((k) => k !== "APP_ENV"),
);

/** Port keys and APP_ENV are not leak-scanned; DEVICE_ID may appear in output (Req 1.7). */
const NOT_SCANNED: ReadonlySet<string> = new Set(["APP_ENV", "DEVICE_ID", "GATEWAY_OPERATOR_PORT"]);

/** The Phase 0 start-test sentinel. */
export const SENTINEL = "xelulu-test-sentinel";

/**
 * Every Panel_Key: the keys of the approved panel fixture plus the G3 keys (the local port keys
 * join the fixture only in a later task), each once, in that order.
 */
export function panelKeys(): readonly string[] {
  const fromFixture = readFileSync(PANEL_FIXTURE, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
  return Object.freeze([...new Set([...fromFixture, ...GATEWAY_G3_KEYS])]);
}

/** The inherited env with every Panel_Key removed (case-insensitive), then `entries` set. */
export function pinnedEnv(entries: readonly EnvEntry[], inherited: Env = process.env): Env {
  const env: Env = { ...inherited };
  const upper = new Set(panelKeys().map((k) => k.toUpperCase()));
  for (const name of Object.keys(env)) {
    if (upper.has(name.toUpperCase())) delete env[name];
  }
  for (const [key, value] of entries) env[key] = value;
  return env;
}

const LOOPBACK_PORT_1 = "127.0.0.1:1";

/**
 * A valid non-Local_Mode config: mqtts and wss at 127.0.0.1 port 1 (so a case that wrongly
 * starts never reaches a network), non-empty credentials, values of at least 8 characters.
 */
export const VALID_BASE: readonly EnvEntry[] = Object.freeze([
  ["APP_ENV", "staging"],
  ["MQTT_BROKER_URL", "mqtts" + "://" + LOOPBACK_PORT_1],
  ["MQTT_USERNAME", "xelulu-start-username"],
  ["MQTT_PASSWORD", "xelulu-start-password"],
  ["AUDIO_WSS_URL", "wss" + "://" + LOOPBACK_PORT_1],
  ["DEVICE_ID", "xlu_start_000123"],
  ["DEVICE_TOKEN", "xelulu-start-device-token"],
  ["GATEWAY_OPERATOR_PORT", "8790"],
] as const);

/** One invalid value per URL, port and DEVICE_ID key. */
export const INVALID_VALUES: readonly EnvEntry[] = Object.freeze([
  ["MQTT_BROKER_URL", "xelulu-not-a-url"],
  ["AUDIO_WSS_URL", "xelulu-not-a-url"],
  ["DEVICE_ID", "xlu/start"],
  ["GATEWAY_OPERATOR_PORT", "65536"],
] as const);

/** `base` with `key` set to `value` (added if absent). */
export function withValue(base: readonly EnvEntry[], key: string, value: string): EnvEntry[] {
  return base.some(([k]) => k === key)
    ? base.map(([k, v]): EnvEntry => [k, k === key ? value : v])
    : [...base, [key, value]];
}

/** `base` without `key`. */
export function without(base: readonly EnvEntry[], key: string): EnvEntry[] {
  return base.filter(([k]) => k !== key);
}

export type StartCase = Readonly<{
  name: string;
  /** Set on top of the inherited env with every Panel_Key removed. */
  entries: readonly EnvEntry[];
  /** The offending keys the config error line names, in G3 order. */
  expectedKeys: readonly GatewayG3Key[];
}>;

/** The cases of the design's start-test table. */
export function startCases(): readonly StartCase[] {
  return Object.freeze([
    { name: "every Panel_Key removed", entries: [], expectedKeys: REQUIRED_KEYS },
    {
      name: "every Panel_Key set to the sentinel",
      entries: panelKeys().map((k): EnvEntry => [k, SENTINEL]),
      expectedKeys: ["MQTT_BROKER_URL", "AUDIO_WSS_URL", "GATEWAY_OPERATOR_PORT"],
    },
    ...REQUIRED_KEYS.map((key): StartCase => ({
      name: `${key} removed`,
      entries: without(VALID_BASE, key),
      expectedKeys: [key],
    })),
    ...INVALID_VALUES.map(([key, value]): StartCase => ({
      name: `${key} invalid`,
      entries: withValue(VALID_BASE, key, value),
      expectedKeys: GATEWAY_G3_KEYS.filter((k) => k === key),
    })),
    {
      name: "plain schemes outside Local_Mode",
      entries: withValue(
        withValue(VALID_BASE, "MQTT_BROKER_URL", "mqtt" + "://" + LOOPBACK_PORT_1),
        "AUDIO_WSS_URL",
        "ws" + "://" + LOOPBACK_PORT_1,
      ),
      expectedKeys: ["MQTT_BROKER_URL", "AUDIO_WSS_URL"],
    },
  ]);
}

/** The values a case must never print: every scanned value of at least 8 characters. */
export function leakValues(entries: readonly EnvEntry[]): readonly string[] {
  return [
    ...new Set(entries.filter(([k, v]) => !NOT_SCANNED.has(k) && v.length >= 8).map(([, v]) => v)),
  ];
}

/** The config error line the gateway writes for `keys`. */
export function configErrorLine(keys: readonly string[]): string {
  return `gateway config error: ${keys.join(", ")}\n`;
}
