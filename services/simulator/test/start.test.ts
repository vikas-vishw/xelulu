// Simulator start-up checks (Req 7.3, 7.6, 7.7).
// The helper below is duplicated in services/gateway/test/start.test.ts on purpose:
// services never import each other (dependency-direction rule).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const PANEL_FIXTURE = fileURLToPath(
  new URL("../../../tooling/fixtures/approved-panel.txt", import.meta.url),
);
const SENTINEL = "xelulu-test-sentinel";
const TIME_LIMIT_MS = 5000;

interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  durationMs: number;
}

type Env = Record<string, string | undefined>;

/** Panel_Keys derived from the approved panel fixture, never hard-coded. */
function panelKeys(): string[] {
  const text = readFileSync(PANEL_FIXTURE, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
}

function envWithoutPanelKeys(keys: readonly string[]): Env {
  const env: Env = { ...process.env };
  // Windows env names are case-insensitive, so match case-insensitively.
  const upper = new Set(keys.map((k) => k.toUpperCase()));
  for (const name of Object.keys(env)) {
    if (upper.has(name.toUpperCase())) delete env[name];
  }
  return env;
}

function envWithSentinels(keys: readonly string[]): Env {
  const env = envWithoutPanelKeys(keys);
  for (const key of keys) env[key] = SENTINEL;
  return env;
}

/** Runs `node dist/index.js` directly with the current Node binary. */
function runNode(cwd: string, env: Env): RunResult {
  const started = performance.now();
  const r = spawnSync(process.execPath, ["dist/index.js"], {
    cwd,
    env,
    encoding: "utf8",
    timeout: TIME_LIMIT_MS * 2,
  });
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    status: r.status,
    durationMs: performance.now() - started,
  };
}

/** Runs `pnpm --silent start` through the shell so the pnpm shim resolves on every OS. */
function runPnpmStart(cwd: string, env: Env): RunResult {
  const started = performance.now();
  const r = spawnSync("pnpm --silent start", {
    cwd,
    env,
    encoding: "utf8",
    shell: true,
    timeout: TIME_LIMIT_MS * 2,
  });
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    status: r.status,
    durationMs: performance.now() - started,
  };
}

function expectOk(result: RunResult): void {
  expect(result.stdout).toBe("ok\n");
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.durationMs).toBeLessThan(TIME_LIMIT_MS);
}

const keys = panelKeys();
const envVariants: ReadonlyArray<readonly [string, () => Env]> = [
  ["the current env", () => ({ ...process.env })],
  ["every Panel_Key removed", () => envWithoutPanelKeys(keys)],
  ["every Panel_Key set to a sentinel", () => envWithSentinels(keys)],
];
const runners: ReadonlyArray<readonly [string, (cwd: string, env: Env) => RunResult]> = [
  ["node dist/index.js", runNode],
  ["pnpm --silent start", runPnpmStart],
];

describe("simulator start", () => {
  it("derives a non-empty Panel_Key list from the fixture", () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  describe.each(runners)("%s", (_name, run) => {
    it.each(envVariants)("prints ok and exits 0 with %s", (_label, makeEnv) => {
      expectOk(run(PACKAGE_DIR, makeEnv()));
    });

    it("has an identical outcome across all env variants", () => {
      const outcomes = envVariants.map(([, makeEnv]) => {
        const { stdout, stderr, status } = run(PACKAGE_DIR, makeEnv());
        return { stdout, stderr, status };
      });
      for (const outcome of outcomes) expect(outcome).toEqual(outcomes[0]);
    });
  });

  describe("without a build", () => {
    const tempDirs: string[] = [];
    afterAll(() => {
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    });

    it("exits non-zero and prints no ok when dist is missing", () => {
      const dir = mkdtempSync(join(tmpdir(), "xelulu-simulator-"));
      tempDirs.push(dir);
      const result = runNode(dir, { ...process.env });
      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stdout).not.toContain("ok");
    });
  });
});
