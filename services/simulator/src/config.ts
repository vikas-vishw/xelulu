// Pure simulator config parser (Req 1.2–1.5, G3, G7). The same rules as the gateway's parser, with
// SIMULATOR_PANEL_PORT in place of GATEWAY_OPERATOR_PORT. Returns a deep-frozen Config or the
// offending key names, in G3 order, each once, and never returns or stores a rejected value.
// There is no TLS option: verification is Node's default. Services never import each other, so
// this is a copy of the gateway's parsing core.
import { buildTopic } from "@xelulu/shared";

/** The simulator's G3 keys, in G3 order. */
export const SIMULATOR_CONFIG_KEYS = Object.freeze([
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "SIMULATOR_PANEL_PORT",
] as const);
export type SimulatorConfigKey = (typeof SIMULATOR_CONFIG_KEYS)[number];

export type SimulatorConfig = Readonly<{
  localMode: boolean;
  broker: Readonly<{
    url: string;
    scheme: "mqtt" | "mqtts";
    host: string;
    port: number;
    username: string | null;
    password: string | null;
  }>;
  audio: Readonly<{
    url: string;
    scheme: "ws" | "wss";
    host: string;
    port: number;
    listenHost: "127.0.0.1" | "0.0.0.0";
  }>;
  device: Readonly<{ deviceId: string; token: string }>;
  panelPort: number;
}>;

export type ConfigResult<C> =
  | { readonly ok: true; readonly config: C }
  | { readonly ok: false; readonly offendingKeys: readonly string[] };

type RawEnv = Readonly<Record<string, string | undefined>>;

const LOCAL_MODE_VALUE = "local";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_PORTS: Readonly<Record<string, number>> = Object.freeze({
  mqtt: 1883,
  mqtts: 8883,
  ws: 80,
  wss: 443,
});

type ParsedUrl = { readonly scheme: string; readonly host: string; readonly port: number };

/**
 * An absolute URL with a non-empty host whose text starts with `<scheme>://` (case-insensitive),
 * so lenient WHATWG forms such as `wss:host` or a leading space are refused. Never throws.
 */
function parseUrl(value: string): ParsedUrl | null {
  const url = URL.parse(value);
  if (url === null || url.hostname === "") return null;
  const scheme = url.protocol.slice(0, -1);
  if (value.slice(0, scheme.length + 3).toLowerCase() !== `${scheme}://`) return null;
  const port = url.port === "" ? (DEFAULT_PORTS[scheme] ?? 0) : Number(url.port);
  return { scheme, host: url.hostname, port };
}

/** ASCII decimal digits only, 1 to 65535. */
function parsePort(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

function isValidDeviceId(value: string): boolean {
  try {
    buildTopic(value, "status");
    return true;
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The Config without its port key's name; `portKey` is the service's own local port key. */
type ServiceConfigCore = {
  readonly localMode: boolean;
  readonly broker: SimulatorConfig["broker"];
  readonly audio: SimulatorConfig["audio"];
  readonly device: SimulatorConfig["device"];
  readonly port: number;
};

function parseCore(
  raw: RawEnv,
  keys: readonly string[],
  portKey: string,
): ConfigResult<ServiceConfigCore> {
  const offending = new Set<string>();
  const localMode = raw["APP_ENV"] === LOCAL_MODE_VALUE;

  // Rule 2 (and rule 4 outside Local_Mode): required keys, never trimmed.
  const optional = new Set(["APP_ENV", ...(localMode ? ["MQTT_USERNAME", "MQTT_PASSWORD"] : [])]);
  const present = (key: string): string | null => {
    const value = raw[key];
    if (value === undefined || value === "") {
      if (!optional.has(key)) offending.add(key);
      return null;
    }
    return value;
  };

  const brokerValue = present("MQTT_BROKER_URL");
  const username = present("MQTT_USERNAME");
  const password = present("MQTT_PASSWORD");
  const audioValue = present("AUDIO_WSS_URL");
  const deviceId = present("DEVICE_ID");
  const token = present("DEVICE_TOKEN");
  const portValue = present(portKey);

  // Rule 3: URL shape and scheme for the mode.
  const brokerSchemes = localMode ? ["mqtt", "mqtts"] : ["mqtts"];
  const audioSchemes = localMode ? ["ws", "wss"] : ["wss"];
  const broker = brokerValue === null ? null : parseUrl(brokerValue);
  if (brokerValue !== null && (broker === null || !brokerSchemes.includes(broker.scheme))) {
    offending.add("MQTT_BROKER_URL");
  }
  const audio = audioValue === null ? null : parseUrl(audioValue);
  if (audioValue !== null && (audio === null || !audioSchemes.includes(audio.scheme))) {
    offending.add("AUDIO_WSS_URL");
  }

  // Rule 5: DEVICE_ID must make a valid topic.
  if (deviceId !== null && !isValidDeviceId(deviceId)) offending.add("DEVICE_ID");

  // Rule 6: port digits and range.
  const port = portValue === null ? null : parsePort(portValue);
  if (portValue !== null && port === null) offending.add(portKey);

  if (
    offending.size > 0 ||
    brokerValue === null ||
    broker === null ||
    audioValue === null ||
    audio === null ||
    deviceId === null ||
    token === null ||
    port === null
  ) {
    return { ok: false, offendingKeys: Object.freeze(keys.filter((k) => offending.has(k))) };
  }

  // Rules 7–9: listen host, null credentials, deep freeze.
  return {
    ok: true,
    config: deepFreeze({
      localMode,
      broker: {
        url: brokerValue,
        scheme: broker.scheme as "mqtt" | "mqtts",
        host: broker.host,
        port: broker.port,
        username,
        password,
      },
      audio: {
        url: audioValue,
        scheme: audio.scheme as "ws" | "wss",
        host: audio.host,
        port: audio.port,
        listenHost: LOOPBACK_HOSTS.has(audio.host) ? "127.0.0.1" : "0.0.0.0",
      },
      device: { deviceId, token },
      port,
    }),
  };
}

export function parseSimulatorConfig(raw: RawEnv): ConfigResult<SimulatorConfig> {
  const core = parseCore(raw, SIMULATOR_CONFIG_KEYS, "SIMULATOR_PANEL_PORT");
  if (!core.ok) return core;
  const { localMode, broker, audio, device, port } = core.config;
  return {
    ok: true,
    config: Object.freeze({ localMode, broker, audio, device, panelPort: port }),
  };
}
