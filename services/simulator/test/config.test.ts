// Simulator config parser: Property 1 and edge examples (Req 1.2–1.5, 1.8).
// Env records are built from [key, value] tuples and URLs from parts, so no line in this file
// has a Panel_Key assignment shape or a connection URL literal.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatConfigError } from "../src/config-error-writer.js";
import { parseSimulatorConfig, type SimulatorConfig } from "../src/config.js";

/** G3 simulator keys in G3 order, written here independently of the parser. */
const G3_KEYS = [
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "SIMULATOR_PANEL_PORT",
] as const;
type Key = (typeof G3_KEYS)[number];
type Env = Partial<Record<Key, string | undefined>>;

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
/** `§` plus 7 to 31 letters or digits: a value that can only appear in output if it leaked. */
const sentinelArb = fc
  .string({ unit: fc.constantFrom(...ALNUM), minLength: 7, maxLength: 31 })
  .map((s) => "§" + s);

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
    ["MQTT_USERNAME", "device-user"],
    ["MQTT_PASSWORD", "device-pass-1234"],
    ["AUDIO_WSS_URL", url("wss", "gateway", 8081)],
    ["DEVICE_ID", "xlu_000123"],
    ["DEVICE_TOKEN", "device-token-abcdef"],
    ["SIMULATOR_PANEL_PORT", "8091"],
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

function accepted(raw: Env): SimulatorConfig {
  const result = parseSimulatorConfig(raw);
  if (!result.ok) throw new Error(`expected acceptance, got ${result.offendingKeys.join(", ")}`);
  return result.config;
}

function offending(raw: Env): readonly string[] {
  const result = parseSimulatorConfig(raw);
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

describe("simulator config parser", () => {
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
            ["SIMULATOR_PANEL_PORT", "8091"],
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

          const result = parseSimulatorConfig(raw);
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
          expect(c.panelPort).toBe(8091);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("simulator config edge examples", () => {
  it("accepts the valid base and keeps its values", () => {
    const c = accepted(validBase());
    expect(c.localMode).toBe(false);
    expect(c.broker).toMatchObject({ scheme: "mqtts", host: "emqx", port: 8883 });
    expect(c.audio).toMatchObject({ scheme: "wss", host: "gateway", port: 8081 });
    expect(c.panelPort).toBe(8091);
  });

  it.each(["0", "65536", "+1", " 80", "80 ", "-1", "1e3", "8o91", "99999999999999999999"])(
    "refuses port %j",
    (port) => {
      expect(offending(withKey(validBase(), "SIMULATOR_PANEL_PORT", port))).toEqual([
        "SIMULATOR_PANEL_PORT",
      ]);
    },
  );

  it.each([
    ["1", 1],
    ["65535", 65535],
    ["08091", 8091],
  ])("accepts port %j as %d", (port, expected) => {
    expect(accepted(withKey(validBase(), "SIMULATOR_PANEL_PORT", port)).panelPort).toBe(expected);
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

  it.each(["a/b", "+", "#", ""])("refuses DEVICE_ID %j", (id) => {
    expect(offending(withKey(validBase(), "DEVICE_ID", id))).toEqual(["DEVICE_ID"]);
  });

  it.each([
    ["localhost", "127.0.0.1"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]", "127.0.0.1"],
    ["gateway", "0.0.0.0"],
  ])("audio host %s gives listenHost %s", (host, listenHost) => {
    const c = accepted(withKey(validBase(), "AUDIO_WSS_URL", url("wss", host, 8081)));
    expect(c.audio.listenHost).toBe(listenHost);
  });

  it("uses the default ports when the URL has none", () => {
    const local = env([
      ["APP_ENV", "local"],
      ["MQTT_BROKER_URL", url("mqtt", "emqx")],
      ["AUDIO_WSS_URL", url("ws", "gateway")],
      ["DEVICE_ID", "xlu_000123"],
      ["DEVICE_TOKEN", "device-token-abcdef"],
      ["SIMULATOR_PANEL_PORT", "8091"],
    ]);
    const c = accepted(local);
    expect(c.broker.port).toBe(1883);
    expect(c.audio.port).toBe(80);
    expect(c.broker.username).toBeNull();
    expect(c.broker.password).toBeNull();
    expect(
      accepted(withKey(validBase(), "MQTT_BROKER_URL", url("mqtts", "emqx"))).broker.port,
    ).toBe(8883);
    expect(accepted(withKey(validBase(), "AUDIO_WSS_URL", url("wss", "gateway"))).audio.port).toBe(
      443,
    );
  });

  it("lists every required key, in G3 order, when nothing is set", () => {
    expect(offending({})).toEqual(G3_KEYS.filter((k) => k !== "APP_ENV"));
  });

  it("formats the config error line with key names only", () => {
    expect(formatConfigError(["DEVICE_ID"])).toBe("simulator config error: DEVICE_ID\n");
  });
});
