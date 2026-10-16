// Gateway config parser: Property 1 and edge examples (Req 1.2–1.5, 1.8).
// Env records are built from [key, value] tuples and URLs from parts, so no line in this file
// has a Panel_Key assignment shape or a connection URL literal.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatConfigError, LISTEN_ERROR_LINE } from "../src/config-error-writer.js";
import { parseGatewayConfig, type GatewayConfig } from "../src/config.js";
import { sentinelArb } from "./support/arbitraries.js";

/** G3 gateway keys in G3 order, written here independently of the parser. */
const G3_KEYS = [
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "GATEWAY_OPERATOR_PORT",
] as const;
type Key = (typeof G3_KEYS)[number];
type Env = Partial<Record<Key, string | undefined>>;

function url(scheme: string, host: string, port?: number): string {
  return scheme + "://" + host + (port === undefined ? "" : ":" + String(port));
}

function env(entries: readonly (readonly [Key, string | undefined])[]): Env {
  return Object.fromEntries(entries) as Env;
}

/** A valid non-Local_Mode base: mqtts, wss and non-empty credentials. */
function validBase(): Env {
  return env([
    ["APP_ENV", "production"],
    ["MQTT_BROKER_URL", url("mqtts", "emqx", 8883)],
    ["MQTT_USERNAME", "gateway-user"],
    ["MQTT_PASSWORD", "gateway-pass-1234"],
    ["AUDIO_WSS_URL", url("wss", "audio.internal")],
    ["DEVICE_ID", "xlu_000123"],
    ["DEVICE_TOKEN", "device-token-abcdef"],
    ["GATEWAY_OPERATOR_PORT", "8090"],
  ]);
}

function withKey(base: Env, key: Key, value: string | undefined): Env {
  return { ...base, ...env([[key, value]]) };
}

function expectDeepFrozen(value: unknown, where = "config"): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value), where).toBe(true);
  for (const [k, v] of Object.entries(value)) expectDeepFrozen(v, `${where}.${k}`);
}

function accepted(raw: Env): GatewayConfig {
  const result = parseGatewayConfig(raw);
  if (!result.ok) throw new Error(`expected acceptance, got ${result.offendingKeys.join(", ")}`);
  return result.config;
}

function offending(raw: Env): readonly string[] {
  const result = parseGatewayConfig(raw);
  return result.ok ? [] : result.offendingKeys;
}

const appEnvArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  fc.constant("local"),
  fc.constantFrom("LOCAL", "Local", "lOcAl", " local", "local ", "\tlocal", "local\n"),
  fc.string({ maxLength: 12 }).filter((s) => s !== "local"),
);
const brokerSchemeArb = fc.constantFrom("mqtt", "mqtts", "tcp", "ssl", "ws", "wss", "http");
const audioSchemeArb = fc.constantFrom("ws", "wss", "http", "https", "mqtt", "mqtts");
const credentialArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(""),
  sentinelArb,
);
const hostArb = fc.constantFrom("127.0.0.1", "localhost", "emqx", "gateway");

describe("gateway config parser", () => {
  // Feature: phase-1-2-gateway-simulator, Property 1: Config acceptance matches the transport rules
  // **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.8**
  it("accepts exactly the transport-rule combinations, frozen, and names offending keys only", () => {
    fc.assert(
      fc.property(
        appEnvArb,
        brokerSchemeArb,
        audioSchemeArb,
        credentialArb,
        credentialArb,
        hostArb,
        sentinelArb,
        (appEnv, brokerScheme, audioScheme, username, password, host, token) => {
          const raw = env([
            ["APP_ENV", appEnv],
            ["MQTT_BROKER_URL", url(brokerScheme, host, 1883)],
            ["MQTT_USERNAME", username],
            ["MQTT_PASSWORD", password],
            ["AUDIO_WSS_URL", url(audioScheme, host, 8081)],
            ["DEVICE_ID", "xlu_000123"],
            ["DEVICE_TOKEN", token],
            ["GATEWAY_OPERATOR_PORT", "8090"],
          ]);
          const local = appEnv === "local";
          const userEmpty = username === undefined || username === "";
          const passEmpty = password === undefined || password === "";
          const brokerOk = local
            ? ["mqtt", "mqtts"].includes(brokerScheme)
            : brokerScheme === "mqtts";
          const audioOk = local ? ["ws", "wss"].includes(audioScheme) : audioScheme === "wss";

          const expectedKeys: Key[] = [];
          if (!brokerOk) expectedKeys.push("MQTT_BROKER_URL");
          if (!local && userEmpty) expectedKeys.push("MQTT_USERNAME");
          if (!local && passEmpty) expectedKeys.push("MQTT_PASSWORD");
          if (!audioOk) expectedKeys.push("AUDIO_WSS_URL");

          const result = parseGatewayConfig(raw);
          if (expectedKeys.length > 0) {
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.offendingKeys).toEqual(expectedKeys);
            // The rejection holds key names only, never a value.
            const text = JSON.stringify(result);
            for (const secret of [username, password, token]) {
              if (secret !== undefined && secret !== "") expect(text).not.toContain(secret);
            }
            return;
          }

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const c = result.config;
          expectDeepFrozen(c);
          expect(c.localMode).toBe(local);
          expect(c.broker.scheme).toBe(brokerScheme);
          expect(c.audio.scheme).toBe(audioScheme);
          expect(c.broker.username).toBe(userEmpty ? null : username);
          expect(c.broker.password).toBe(passEmpty ? null : password);
          expect(c.device).toEqual({ deviceId: "xlu_000123", token });
          expect(c.operatorPort).toBe(8090);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("gateway config edge examples", () => {
  it("accepts the valid base and keeps its values", () => {
    const c = accepted(validBase());
    expect(c.localMode).toBe(false);
    expect(c.broker).toMatchObject({ scheme: "mqtts", host: "emqx", port: 8883 });
    expect(c.audio).toMatchObject({ scheme: "wss", host: "audio.internal", port: 443 });
    expect(c.audio.listenHost).toBe("0.0.0.0");
    expect(c.operatorPort).toBe(8090);
  });

  it.each(["0", "65536", "+1", " 80", "80 ", "-1", "1e3", "8o90", "99999999999999999999"])(
    "refuses port %j",
    (port) => {
      expect(offending(withKey(validBase(), "GATEWAY_OPERATOR_PORT", port))).toEqual([
        "GATEWAY_OPERATOR_PORT",
      ]);
    },
  );

  it.each([
    ["1", 1],
    ["65535", 65535],
    ["08090", 8090],
  ])("accepts port %j as %d", (port, expected) => {
    expect(accepted(withKey(validBase(), "GATEWAY_OPERATOR_PORT", port)).operatorPort).toBe(
      expected,
    );
  });

  it.each([
    ["no host", (s: string) => s + "://"],
    ["a port but no host", (s: string) => s + "://:8883"],
    ["no slashes", (s: string) => s + ":emqx"],
    ["leading space", (s: string) => " " + url(s, "emqx")],
    ["not a URL", () => "not a url"],
  ])("refuses broker and audio URLs with %s", (_label, make) => {
    const raw = withKey(
      withKey(validBase(), "MQTT_BROKER_URL", make("mqtts")),
      "AUDIO_WSS_URL",
      make("wss"),
    );
    expect(offending(raw)).toEqual(["MQTT_BROKER_URL", "AUDIO_WSS_URL"]);
  });

  it.each(["a/b", "+", "#", "xlu/+"])("refuses DEVICE_ID %j (rejected by buildTopic)", (id) => {
    expect(offending(withKey(validBase(), "DEVICE_ID", id))).toEqual(["DEVICE_ID"]);
  });

  it("refuses an empty DEVICE_ID as missing", () => {
    expect(offending(withKey(validBase(), "DEVICE_ID", ""))).toEqual(["DEVICE_ID"]);
  });

  it.each([
    ["localhost", "127.0.0.1"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]", "127.0.0.1"],
    ["gateway", "0.0.0.0"],
    ["10.0.0.5", "0.0.0.0"],
  ])("audio host %s listens on %s", (host, listenHost) => {
    const c = accepted(withKey(validBase(), "AUDIO_WSS_URL", url("wss", host, 8081)));
    expect(c.audio.listenHost).toBe(listenHost);
  });

  it("uses the default ports when the URL has none", () => {
    const local = env([
      ["APP_ENV", "local"],
      ["MQTT_BROKER_URL", url("mqtt", "emqx")],
      ["AUDIO_WSS_URL", url("ws", "127.0.0.1")],
      ["DEVICE_ID", "xlu_000123"],
      ["DEVICE_TOKEN", "device-token-abcdef"],
      ["GATEWAY_OPERATOR_PORT", "8090"],
    ]);
    const c = accepted(local);
    expect(c.broker.port).toBe(1883);
    expect(c.audio.port).toBe(80);
    expect(c.broker.username).toBeNull();
    expect(c.broker.password).toBeNull();

    expect(
      accepted(withKey(validBase(), "MQTT_BROKER_URL", url("mqtts", "emqx"))).broker.port,
    ).toBe(8883);
    expect(accepted(validBase()).audio.port).toBe(443);
    expect(
      accepted(withKey(validBase(), "MQTT_BROKER_URL", url("mqtts", "emqx", 1234))).broker.port,
    ).toBe(1234);
  });

  it("lists every required key, in G3 order, when nothing is set", () => {
    expect(offending({})).toEqual(G3_KEYS.filter((k) => k !== "APP_ENV"));
  });

  it("lists each offending key once, in G3 order, never short-circuiting", () => {
    const raw = env([
      ["APP_ENV", "LOCAL"],
      ["MQTT_BROKER_URL", url("mqtt", "emqx")],
      ["MQTT_USERNAME", ""],
      ["AUDIO_WSS_URL", url("ws", "127.0.0.1")],
      ["DEVICE_ID", "a/b"],
      ["GATEWAY_OPERATOR_PORT", "0"],
    ]);
    expect(offending(raw)).toEqual([
      "MQTT_BROKER_URL",
      "MQTT_USERNAME",
      "MQTT_PASSWORD",
      "AUDIO_WSS_URL",
      "DEVICE_ID",
      "DEVICE_TOKEN",
      "GATEWAY_OPERATOR_PORT",
    ]);
  });

  it("formats the config and listen error lines with key names only", () => {
    expect(formatConfigError(["MQTT_BROKER_URL", "AUDIO_WSS_URL"])).toBe(
      "gateway config error: MQTT_BROKER_URL, AUDIO_WSS_URL\n",
    );
    expect(LISTEN_ERROR_LINE).toBe("gateway listen error: GATEWAY_OPERATOR_PORT\n");
  });
});
