// Service source checks (Phase 1.2 Req 21.1, 21.3, 21.7; design "New repo checks").
// No source under either service `src` calls a file-writing API, and only each service's logger,
// config error writer and CLI touch `console`, `process.stdout.write` or `process.stderr.write`.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findFileWrites,
  findStdioUse,
  formatSourceFindings,
  type SourceFinding,
} from "../checks/service-sources.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SERVICE_SRC_DIRS = ["services/gateway/src", "services/simulator/src"] as const;
const EXCLUDED_DIRS = new Set(["node_modules", "dist"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

/** The only files in each service allowed to use stdio (Req 21.7, design "Logging"). */
const STDIO_FILES: ReadonlySet<string> = new Set(
  SERVICE_SRC_DIRS.flatMap((dir) => [
    `${dir}/log/logger.ts`,
    `${dir}/config-error-writer.ts`,
    `${dir}/cli.ts`,
  ]),
);

function toRepoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) out.push(...walk(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), "utf8");
}

/** Every source file of both services as [repo path, text]. */
function serviceSources(): [string, string][] {
  const files = SERVICE_SRC_DIRS.flatMap((dir) =>
    walk(join(ROOT, dir)).filter((abs) => SOURCE_EXTENSIONS.has(extname(abs))),
  );
  const sources = files.map((abs): [string, string] => [
    toRepoPath(abs),
    readFileSync(abs, "utf8"),
  ]);
  expect(sources.map(([path]) => path)).toEqual(expect.arrayContaining([...STDIO_FILES]));
  return sources;
}

function expectNone(findings: readonly SourceFinding[], what: string): void {
  expect(findings, `${what}:\n${formatSourceFindings(findings)}`).toEqual([]);
}

function lineRules(findings: readonly SourceFinding[]): [number, string][] {
  return findings.map((f) => [f.lineNo, f.rule]);
}

describe("service sources (Req 21.1, 21.7)", () => {
  it("no service source calls or imports a file-writing API", () => {
    const findings = serviceSources().flatMap(([path, text]) => findFileWrites(path, text));
    expectNone(findings, "File-writing calls in service sources");
  });

  it("only the logger, config error writer and CLI use console or process stdio writes", () => {
    const sources = serviceSources();
    const findings = sources
      .filter(([path]) => !STDIO_FILES.has(path))
      .flatMap(([path, text]) => findStdioUse(path, text));
    expectNone(findings, "Stdio use outside the allowed files");

    // The allowance is used: every logger writes to stdout and every config error writer to stderr.
    for (const dir of SERVICE_SRC_DIRS) {
      const rules = (path: string): string[] =>
        findStdioUse(path, sources.find(([p]) => p === path)?.[1] ?? "").map((f) => f.rule);
      expect(rules(`${dir}/log/logger.ts`)).toContain("stdout_write");
      expect(rules(`${dir}/config-error-writer.ts`)).toContain("stderr_write");
    }
  });

  describe("fixture self-tests", () => {
    const path = "services/gateway/src/fixture.ts";
    const banned = read("tooling/fixtures/service-sources-banned.txt");
    const clean = read("tooling/fixtures/service-sources-clean.txt");

    it("reports every banned pattern", () => {
      expect(lineRules(findFileWrites(path, banned))).toEqual([
        [3, "file_write"],
        [4, "file_write"],
        [5, "file_write"],
      ]);
      expect(lineRules(findStdioUse(path, banned))).toEqual([
        [6, "console"],
        [7, "stdout_write"],
        [8, "stderr_write"],
      ]);
    });

    it("reports nothing for the clean fixture", () => {
      expectNone(findFileWrites(path, clean), "file writes");
      expectNone(findStdioUse(path, clean), "stdio");
    });
  });
});
