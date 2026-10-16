// The operator CLI (Req 13.2, 13.6, design CLI exit table), spawned as the built dist/cli.js
// against an in-process gateway's loopback Operator_Surface, a closed port and a listener that
// never answers. Exit codes: 0 success, 1 error response, 2 usage, 3 not reachable within 5 s,
// 4 not in Local_Mode, 5 config error.
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  configErrorLine,
  pinnedEnv,
  REQUIRED_KEYS,
  VALID_BASE,
  type EnvEntry,
} from "./support/env-cases.js";
import { HARNESS_DEVICE_ID, startHarness, type Harness } from "./support/gateway-harness.js";
import { requireBuiltCli, runCli } from "./support/operator-http.js";

beforeAll(() => {
  requireBuiltCli();
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function harness(opts: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  const h = await startHarness({ localMode: true, ...opts });
  cleanups.push(() => h.stop());
  return h;
}

function localEnv(port: number): Record<string, string | undefined> {
  const entries: EnvEntry[] = [
    ["APP_ENV", "local"],
    ["MQTT_BROKER_URL", "mqtt" + "://" + "127.0.0.1:1"],
    ["AUDIO_WSS_URL", "ws" + "://" + "127.0.0.1:1"],
    ["DEVICE_ID", HARNESS_DEVICE_ID],
    ["DEVICE_TOKEN", "cli-test-device-token-0001"],
    ["GATEWAY_OPERATOR_PORT", String(port)],
  ];
  const env = pinnedEnv(entries);
  delete env["DEBUG"];
  return env;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function operatorPort(h: Harness): number {
  const port = h.gateway.operatorPort();
  if (port === null) throw new Error("no Operator_Surface");
  return port;
}

/** Exactly one JSON line on stdout. */
function oneJsonLine(stdout: string): unknown {
  expect(stdout.endsWith("\n")).toBe(true);
  const lines = stdout.slice(0, -1).split("\n");
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? "") as unknown;
}

describe("operator CLI", () => {
  it.each([
    ["devices", ["devices"]],
    ["log", ["log"]],
    ["log --after 1", ["log", "--after", "1"]],
    ["send", ["send", HARNESS_DEVICE_ID, "volume", JSON.stringify({ level: 30 })]],
    ["conversation", ["conversation"]],
    ["brain", ["brain"]],
    ["transcripts delete-all", ["transcripts", "delete-all"]],
  ] as const)("exits 0 with the JSON response for %s", async (_name, args) => {
    const h = await harness();
    await h.online();
    const result = await runCli(args, localEnv(operatorPort(h)));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(oneJsonLine(result.stdout)).toMatchObject({ ok: true });
  });

  it("exits 1 with the error JSON on stdout for an error response", async () => {
    const h = await harness();
    const result = await runCli(
      ["send", "xlu_999999", "volume", JSON.stringify({ level: 1 })],
      localEnv(operatorPort(h)),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(oneJsonLine(result.stdout)).toEqual({ ok: false, error: { code: "unknown_device" } });
    expect(result.stdout).not.toContain("xlu_999999");
  });

  it.each([
    ["no command", []],
    ["an unknown command", ["bogus"]],
    ["devices with an extra argument", ["devices", "extra"]],
    ["log with a bad --after", ["log", "--after", "x1"]],
    ["send with too few arguments", ["send", HARNESS_DEVICE_ID, "volume"]],
    ["send with data that is not JSON", ["send", HARNESS_DEVICE_ID, "volume", "{not-json-arg"]],
    ["conversation with an extra argument", ["conversation", "extra"]],
    ["brain with an extra argument", ["brain", "extra"]],
    ["transcripts with no operation", ["transcripts"]],
    ["transcripts with an unknown operation", ["transcripts", "delete-some"]],
  ] as const)("exits 2 with one usage line for %s", async (_name, args) => {
    const result = await runCli(args, localEnv(await closedPort()));
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n")).toHaveLength(2);
    expect(result.stderr).toMatch(/^usage: /);
    expect(result.stderr).not.toContain("not-json-arg");
  });

  it("exits 3 at once when nothing listens on the operator port", async () => {
    const result = await runCli(["devices"], localEnv(await closedPort()));
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("operator surface not reachable\n");
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it("exits 3 after 5 s when the operator port never answers", async () => {
    const held: Socket[] = [];
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
      held.push(socket);
    });
    const port = await listen(server);
    cleanups.push(async () => {
      for (const s of held) s.destroy();
      await close(server);
    });
    const result = await runCli(["devices"], localEnv(port));
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("operator surface not reachable\n");
    expect(result.durationMs).toBeGreaterThanOrEqual(4_500);
    expect(result.durationMs).toBeLessThan(8_000);
  }, 20_000);

  it("exits 4 outside Local_Mode", async () => {
    const env = pinnedEnv(VALID_BASE);
    delete env["DEBUG"];
    const result = await runCli(["devices"], env);
    expect(result.code).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("operator surface is local-only\n");
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it("exits 5 with the config error line on a config error", async () => {
    const result = await runCli(["devices"], pinnedEnv([]));
    expect(result.code).toBe(5);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(configErrorLine(REQUIRED_KEYS));
  });
});
