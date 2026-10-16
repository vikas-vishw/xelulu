// Crash, signal and warning handling (Req 21.3, 21.6, G51, D15). The handlers are driven with a
// fake process emitter, including the flush path (the fatal exit waits for stdout to drain, with
// a fallback timer). Then the built dist/index.js runs as a child process with a Local_Mode Config
// (broker at 127.0.0.1 port 1, so nothing outside loopback is reached): a start failure (the
// Control_Surface port already taken) and a crash after a process warning each give exactly one
// `simulator` `crashed` line with no error text on stdout, nothing on stderr, and exit 1 within 5 s.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FATAL_FLUSH_TIMEOUT_MS, installProcessHandlers, type ProcessLike } from "../src/crash.js";
import { createSimLog, type SimLogEntry } from "../src/log/logger.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { INDEX_PATH, requireBuilt, SIMULATOR_DIR } from "./support/control-http.js";
import { pinnedEnv, type EnvEntry } from "./support/env-cases.js";
import { flush, SIM_DEVICE_ID } from "./support/sim-harness.js";
import { createTestClock } from "./support/test-clock.js";

const SECTION = "\u00a7";

class FakeProcess extends EventEmitter implements ProcessLike {
  readonly exits: number[] = [];
  exitCode: number | string | null | undefined = undefined;
  exit(code: number): void {
    this.exits.push(code);
  }
}

/** An error whose message, stack and cause record any read. */
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

function setup(flushStdout?: (done: () => void) => void) {
  const proc = new FakeProcess();
  const sink = createCaptureSink();
  const log = createSimLog(createTestClock(1_760_000_000_000), sink);
  let stops = 0;
  installProcessHandlers(
    proc,
    () => {
      log.add({ kind: "simulator", state: "crashed" });
    },
    () => {
      stops += 1;
    },
    flushStdout,
  );
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  return { proc, sink, entries, stops: () => stops };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("process handlers", () => {
  it.each(["uncaughtException", "unhandledRejection"] as const)(
    "%s writes one crashed entry with no error text and exits 1",
    (event) => {
      const { proc, sink, entries, stops } = setup();
      const { error, reads } = watchedError();
      proc.emit(event, error, Promise.resolve());
      expect(entries()).toEqual([
        { seq: 1, at: "2025-10-09T08:53:20.000Z", kind: "simulator", state: "crashed" },
      ]);
      expect(proc.exits).toEqual([1]);
      expect(reads).toEqual([]);
      expect(sink.text()).not.toContain(SECTION);

      // A second fatal error adds nothing.
      proc.emit("uncaughtException", error);
      proc.emit("unhandledRejection", error, Promise.resolve());
      expect(entries()).toHaveLength(1);
      expect(proc.exits).toEqual([1]);
      expect(stops()).toBe(0);
    },
  );

  it("with a flush, writes the entry, then exits 1 only once stdout has drained", () => {
    let drained: (() => void) | null = null;
    const { proc, entries } = setup((done) => {
      drained = done;
    });
    proc.emit("uncaughtException", new Error());
    expect(entries()).toHaveLength(1);
    expect(proc.exits).toEqual([]);
    expect(proc.exitCode).toBe(1);
    (drained as (() => void) | null)?.();
    expect(proc.exits).toEqual([1]);
    // A late fallback or a second drain adds no second exit.
    (drained as (() => void) | null)?.();
    expect(proc.exits).toEqual([1]);
  });

  it("with a flush that never drains, the fallback timer still exits 1 within 5 s", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const { proc, entries } = setup(() => undefined);
    proc.emit("unhandledRejection", new Error(), Promise.resolve());
    expect(entries()).toHaveLength(1);
    expect(proc.exits).toEqual([]);
    vi.advanceTimersByTime(FATAL_FLUSH_TIMEOUT_MS - 1);
    expect(proc.exits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(proc.exits).toEqual([1]);
    expect(FATAL_FLUSH_TIMEOUT_MS).toBeLessThan(5_000);
  });

  it("a flush that throws still exits 1", () => {
    const { proc } = setup(() => {
      throw new Error(SECTION);
    });
    proc.emit("uncaughtException", new Error());
    expect(proc.exits).toEqual([1]);
  });

  it.each(["SIGTERM", "SIGINT"] as const)("%s runs the stop path, then exits 0", async (signal) => {
    const { proc, entries, stops } = setup();
    proc.emit(signal);
    await flush();
    expect(stops()).toBe(1);
    expect(proc.exits).toEqual([0]);
    expect(entries()).toEqual([]);
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

/** Runs the built simulator with a Local_Mode Config, then `after` (ES module code) in the child. */
async function runSimulatorChild(panelPort: number, after = ""): Promise<ChildResult> {
  requireBuilt(INDEX_PATH);
  const entries: EnvEntry[] = [
    ["APP_ENV", "local"],
    ["MQTT_BROKER_URL", "mqtt" + "://" + "127.0.0.1:1"],
    ["AUDIO_WSS_URL", "ws" + "://" + "127.0.0.1:1"],
    ["DEVICE_ID", SIM_DEVICE_ID],
    ["DEVICE_TOKEN", SECTION + "child-device-token"],
    ["MQTT_PASSWORD", SECTION + "child-password"],
    ["SIMULATOR_PANEL_PORT", String(panelPort)],
  ];
  const env = pinnedEnv(entries);
  delete env["DEBUG"];
  const script = `await import(${JSON.stringify(pathToFileURL(INDEX_PATH).href)});\n${after}`;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: SIMULATOR_DIR,
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

function parseLines(stdout: string): SimLogEntry[] {
  expect(stdout.endsWith("\n")).toBe(true);
  return stdout
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line) as SimLogEntry);
}

function states(lines: readonly SimLogEntry[]): string[] {
  return lines.map((e) => (e.kind === "simulator" ? e.state : e.kind));
}

function expectOneCrash(result: ChildResult): SimLogEntry[] {
  expect(result.stderr).toBe("");
  expect(result.code).toBe(1);
  expect(result.durationMs).toBeLessThan(5_000);
  expect(result.stdout).not.toContain(SECTION);
  const lines = parseLines(result.stdout);
  expect(lines.filter((e) => e.kind === "simulator" && e.state === "crashed")).toHaveLength(1);
  expect(lines.at(-1)).toEqual({
    seq: lines.length,
    at: expect.any(String) as string,
    kind: "simulator",
    state: "crashed",
  });
  expect(lines.map((e) => e.seq)).toEqual(lines.map((_, i) => i + 1));
  return lines;
}

describe("the built simulator", () => {
  let occupied: Server | null = null;
  afterEach(async () => {
    const s = occupied;
    occupied = null;
    if (s !== null) await new Promise((resolve) => s.close(resolve));
  });

  it("treats a Control_Surface that cannot listen as a crash: one crashed line, exit 1", async () => {
    const server = createServer();
    occupied = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const result = await runSimulatorChild(port);
    const lines = expectOneCrash(result);
    expect(states(lines)).toEqual(["starting", "crashed"]);
  }, 20_000);

  it.each([
    ["an uncaught exception", `setTimeout(() => { throw new Error("\\u00a7crash-text"); }, 300);`],
    [
      "an unhandled rejection",
      `setTimeout(() => { void Promise.reject(new Error("\\u00a7reject-text")); }, 300);`,
    ],
  ])(
    "prints nothing on stderr for a warning and %s, and exits 1 with one crashed line",
    async (_name, crash) => {
      const port = await freePort();
      const result = await runSimulatorChild(
        port,
        `process.emitWarning("\\u00a7warning-text");\n${crash}`,
      );
      const lines = expectOneCrash(result);
      expect(states(lines)).toEqual(["starting", "control_listening", "crashed"]);
    },
    20_000,
  );
});
