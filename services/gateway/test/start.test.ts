// Gateway start-up checks (Req 1.3, 1.4, 1.7, 22.3; design "Start tests").
// Every case of the design's table runs under both `node dist/index.js` and `pnpm --silent start`
// and must exit non-zero within 5 s, write only its config error line naming exactly the expected
// keys (taken from the test's own G3 table in support/env-cases.ts) to stderr, write nothing to
// stdout and print no sentinel or other scanned value.
// The runners are duplicated in services/simulator/test/start.test.ts on purpose:
// services never import each other (dependency-direction rule).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  configErrorLine,
  leakValues,
  panelKeys,
  pinnedEnv,
  SENTINEL,
  startCases,
  type Env,
} from "./support/env-cases.js";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const TIME_LIMIT_MS = 5000;

interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  durationMs: number;
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

const runners: ReadonlyArray<readonly [string, (cwd: string, env: Env) => RunResult]> = [
  ["node dist/index.js", runNode],
  ["pnpm --silent start", runPnpmStart],
];

const cases = startCases();

describe("gateway start", () => {
  it("covers every Panel_Key, including both local port keys", () => {
    const keys = panelKeys();
    expect(keys).toContain("GATEWAY_OPERATOR_PORT");
    expect(keys).toContain("SIMULATOR_PANEL_PORT");
    expect(cases.length).toBeGreaterThanOrEqual(14);
  });

  describe.each(runners)("%s", (_runner, run) => {
    it.each(cases.map((c) => [c.name, c] as const))(
      "refuses to start with %s",
      (_name, startCase) => {
        const result = run(PACKAGE_DIR, pinnedEnv(startCase.entries));

        expect(result.status).not.toBeNull();
        expect(result.status).not.toBe(0);
        expect(result.durationMs).toBeLessThan(TIME_LIMIT_MS);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(configErrorLine(startCase.expectedKeys));

        for (const value of [SENTINEL, ...leakValues(startCase.entries)]) {
          expect(result.stdout, "stdout leaks a value").not.toContain(value);
          expect(result.stderr, "stderr leaks a value").not.toContain(value);
        }
      },
    );
  });

  describe("without a build", () => {
    const tempDirs: string[] = [];
    afterAll(() => {
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    });

    it("exits non-zero and prints no ok when dist is missing", () => {
      const dir = mkdtempSync(join(tmpdir(), "xelulu-gateway-"));
      tempDirs.push(dir);
      const result = runNode(dir, { ...process.env });
      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stdout).not.toContain("ok");
    });
  });
});
