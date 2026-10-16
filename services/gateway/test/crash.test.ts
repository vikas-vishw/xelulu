// Crash, signal and warning handling (Req 21.3, 21.6, G51, D15, K13). The handlers are driven
// with a fake process emitter; then the built dist/index.js runs as a child process with a valid
// Local_Mode Config (broker at 127.0.0.1 port 1, so nothing outside loopback is reached), emits a
// process warning and crashes: stderr stays empty and stdout holds only Log_Entry lines, ending
// with exactly one `gateway` `stopping` entry with no error text.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { GatewayLogEntry } from "@xelulu/shared";

import { FATAL_FLUSH_TIMEOUT_MS, installProcessHandlers, type ProcessLike } from "../src/crash.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { pinnedEnv, type EnvEntry } from "./support/env-cases.js";
import { flush, HARNESS_DEVICE_ID } from "./support/gateway-harness.js";
import { createTestClock } from "./support/test-clock.js";

const INDEX_PATH = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const GATEWAY_DIR = fileURLToPath(new URL("..", import.meta.url));
const SECTION = "\u00a7";

class FakeProcess extends EventEmitter implements ProcessLike {
  readonly exits: number[] = [];
  exitCode: number | string | null | undefined = undefined;
  exit(code: number): void {
    this.exits.push(code);
  }
}

/** An error whose message and stack record any read. */
function watchedError(): { error: Error; reads: string[] } {
  const reads: string[] = [];
  const error = new Error(SECTION + "secret-message");
  for (const key of ["message", "stack", "cause"]) {
    Object.defineProperty(error, key, {
      get() {
        reads.push(key);
        return SECTION + "secret-" + key;
      },
    });
  }
  return { error, reads };
}

function setup() {
  const proc = new FakeProcess();
  const sink = createCaptureSink();
  const log = createGatewayLog(createTestClock(1_760_000_000_000), sink);
  const entries: GatewayLogEntry[] = [];
  log.subscribe((e) => entries.push(e));
  let stops = 0;
  installProcessHandlers(
    proc,
    () => {
      log.add({ kind: "gateway", state: "stopping" });
    },
    () => {
      stops += 1;
    },
  );
  return { proc, sink, entries, stops: () => stops };
}

describe("process handlers", () => {
  it.each(["uncaughtException", "unhandledRejection"] as const)(
    "%s writes one stopping entry with no error text and exits 1",
    (event) => {
      const { proc, sink, entries, stops } = setup();
      const { error, reads } = watchedError();
      proc.emit(event, error, Promise.resolve());
      expect(entries).toEqual([expect.objectContaining({ kind: "gateway", state: "stopping" })]);
      expect(Object.keys(entries[0] ?? {}).sort()).toEqual([
        "at",
        "kind",
        "log_ver",
        "seq",
        "state",
      ]);
      expect(proc.exits).toEqual([1]);
      expect(reads).toEqual([]);
      expect(sink.text()).not.toContain(SECTION);

      // A second fatal error adds nothing.
      proc.emit("uncaughtException", error);
      proc.emit("unhandledRejection", error, Promise.resolve());
      expect(entries).toHaveLength(1);
      expect(proc.exits).toEqual([1]);
      expect(stops()).toBe(0);
    },
  );

  it("with a flush, exits 1 only once stdout has drained", () => {
    const proc = new FakeProcess();
    const order: string[] = [];
    let drained: (() => void) | null = null;
    installProcessHandlers(
      proc,
      () => order.push("entry"),
      () => undefined,
      (done) => {
        order.push("flush");
        drained = done;
      },
    );
    proc.emit("uncaughtException", new Error());
    expect(order).toEqual(["entry", "flush"]);
    expect(proc.exits).toEqual([]);
    expect(proc.exitCode).toBe(1);
    (drained as (() => void) | null)?.();
    expect(proc.exits).toEqual([1]);
  });

  it("with a flush that never drains, the fallback timer still exits 1 in time", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    try {
      const proc = new FakeProcess();
      installProcessHandlers(
        proc,
        () => undefined,
        () => undefined,
        () => undefined,
      );
      proc.emit("unhandledRejection", new Error(), Promise.resolve());
      expect(proc.exits).toEqual([]);
      vi.advanceTimersByTime(FATAL_FLUSH_TIMEOUT_MS);
      expect(proc.exits).toEqual([1]);
      expect(FATAL_FLUSH_TIMEOUT_MS).toBeLessThan(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["SIGTERM", "SIGINT"] as const)("%s runs the stop path, then exits 0", async (signal) => {
    const { proc, entries, stops } = setup();
    proc.emit(signal);
    await flush();
    expect(stops()).toBe(1);
    expect(proc.exits).toEqual([0]);
    expect(entries).toEqual([]);
    proc.emit(signal);
    await flush();
    expect(stops()).toBe(1);
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

type ChildResult = { code: number | null; stdout: string; stderr: string; durationMs: number };

/** Runs the built gateway with a Local_Mode Config, then `after` (ES module code) in the child. */
async function runGatewayChild(after: string): Promise<ChildResult> {
  if (!existsSync(INDEX_PATH)) throw new Error("dist/index.js is missing: run the build first");
  const entries: EnvEntry[] = [
    ["APP_ENV", "local"],
    ["MQTT_BROKER_URL", "mqtt" + "://" + "127.0.0.1:1"],
    ["AUDIO_WSS_URL", "ws" + "://" + "127.0.0.1:" + String(await freePort())],
    ["DEVICE_ID", HARNESS_DEVICE_ID],
    ["DEVICE_TOKEN", SECTION + "child-device-token"],
    ["MQTT_PASSWORD", SECTION + "child-password"],
    ["GATEWAY_OPERATOR_PORT", String(await freePort())],
  ];
  const env = pinnedEnv(entries);
  delete env["DEBUG"];
  const script = `await import(${JSON.stringify(pathToFileURL(INDEX_PATH).href)});\n${after}`;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: GATEWAY_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => (stdout += s));
    child.stderr.on("data", (s: string) => (stderr += s));
    const timer = setTimeout(() => child.kill(), 15_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, durationMs: performance.now() - started });
    });
  });
}

function parseLines(stdout: string): GatewayLogEntry[] {
  expect(stdout.endsWith("\n")).toBe(true);
  return stdout
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line) as GatewayLogEntry);
}

describe("the built gateway", () => {
  it.each([
    ["an uncaught exception", `setTimeout(() => { throw new Error("\\u00a7crash-text"); }, 300);`],
    [
      "an unhandled rejection",
      `setTimeout(() => { void Promise.reject(new Error("\\u00a7reject-text")); }, 300);`,
    ],
  ])(
    "prints nothing on stderr for a warning and %s, and exits 1 with one stopping entry",
    async (_name, crash) => {
      const result = await runGatewayChild(`process.emitWarning("\\u00a7warning-text");\n${crash}`);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(1);
      expect(result.durationMs).toBeLessThan(5_000);
      expect(result.stdout).not.toContain(SECTION);
      const lines = parseLines(result.stdout);
      // The provider gate runs before any listener opens (Phase 3 Req 1.4).
      expect(lines.slice(0, 5).map((e) => (e.kind === "gateway" ? e.state : e.kind))).toEqual([
        "starting",
        "provider_check",
        "provider_check",
        "provider_check",
        "audio_listening",
      ]);
      expect(lines.filter((e) => e.kind === "gateway" && e.state === "stopping")).toHaveLength(1);
      expect(lines.at(-1)).toMatchObject({ kind: "gateway", state: "stopping" });
      expect(lines.map((e) => e.seq)).toEqual(lines.map((_, i) => i + 1));
    },
    20_000,
  );
});
