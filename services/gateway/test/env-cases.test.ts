// Checks for the start-test env cases (test/support/env-cases.ts): the pinned env drops every
// Panel_Key case-insensitively, and each case's hand-written expected keys agree with the
// in-process parser, so the spawned start tests compare against an independent oracle.
import { describe, expect, it } from "vitest";

import { parseGatewayConfig } from "../src/config.js";
import {
  GATEWAY_G3_KEYS,
  leakValues,
  panelKeys,
  pinnedEnv,
  SENTINEL,
  startCases,
  VALID_BASE,
  type Env,
} from "./support/env-cases.js";

function raw(env: Env): Record<string, string | undefined> {
  return Object.fromEntries(GATEWAY_G3_KEYS.map((k) => [k, env[k]]));
}

describe("start-test env cases", () => {
  it("lists every fixture key and every G3 key once", () => {
    const keys = panelKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of GATEWAY_G3_KEYS) expect(keys).toContain(k);
    expect(keys).toContain("SUPABASE_SERVICE_KEY");
  });

  it("removes inherited Panel_Keys in any case and keeps other variables", () => {
    const inherited: Env = Object.fromEntries([
      ["device_token", "inherited-value"],
      ["Mqtt_Password", "inherited-value"],
      ["XELULU_UNRELATED", "kept"],
    ]);
    const env = pinnedEnv([["DEVICE_ID", "xlu_000123"]], inherited);
    expect(Object.keys(env).sort()).toEqual(["DEVICE_ID", "XELULU_UNRELATED"]);
  });

  it("has a valid base the parser accepts outside Local_Mode", () => {
    const result = parseGatewayConfig(raw(pinnedEnv(VALID_BASE, {})));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.localMode).toBe(false);
  });

  it.each(startCases().map((c) => [c.name, c] as const))(
    "%s: the expected keys match the parser",
    (_name, c) => {
      const result = parseGatewayConfig(raw(pinnedEnv(c.entries, {})));
      expect(result).toEqual({ ok: false, offendingKeys: c.expectedKeys });
    },
  );

  it("scans credentials, tokens and URLs but not APP_ENV, DEVICE_ID or the port", () => {
    expect(leakValues(VALID_BASE)).toEqual(
      VALID_BASE.filter(
        ([k]) => !["APP_ENV", "DEVICE_ID", "GATEWAY_OPERATOR_PORT"].includes(k),
      ).map(([, v]) => v),
    );
    expect(leakValues(panelKeys().map((k) => [k, SENTINEL] as const))).toEqual([SENTINEL]);
  });
});
