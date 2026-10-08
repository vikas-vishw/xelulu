// TypeScript config checks (design: tooling/test/tsconfig.test.ts).
// Real-repo checks for Req 1.5, 1.6, 4.1, 5.1, 6.1, 7.1, 8.1: every workspace package compiles in
// strict mode, never switches a strict-family option off, and extends the root tsconfig.base.json.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const BASE_TSCONFIG = join(ROOT, "tsconfig.base.json");

const PACKAGES = [
  "apps/parent-app",
  "apps/admin",
  "services/gateway",
  "services/simulator",
  "packages/shared",
] as const;

const STRICT_FAMILY = [
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "noImplicitThis",
  "alwaysStrict",
  "useUnknownInCatchVariables",
  "strictBuiltinIteratorReturn",
] as const;

type ShownConfig = { compilerOptions?: Record<string, unknown> };

/** Runs `tsc --showConfig -p <dir>` with the workspace TypeScript and parses its JSON output. */
function showConfig(pkgDir: string): ShownConfig {
  const result = spawnSync(process.execPath, [TSC, "--showConfig", "-p", pkgDir], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20000,
  });
  expect(result.error, `tsc failed to start for ${pkgDir}`).toBeUndefined();
  expect(result.status, `tsc --showConfig exited non-zero for ${pkgDir}: ${result.stdout}`).toBe(0);
  const start = result.stdout.indexOf("{");
  expect(start, `tsc --showConfig printed no JSON for ${pkgDir}`).toBeGreaterThanOrEqual(0);
  return JSON.parse(result.stdout.slice(start)) as ShownConfig;
}

/** Reads a tsconfig file (JSON with comments) using TypeScript's own parser. */
function readTsconfig(path: string): { extends?: unknown } {
  const { config, error } = ts.readConfigFile(path, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(
      `Cannot parse ${path}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
    );
  }
  return config as { extends?: unknown };
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** Resolves one `extends` entry the way tsc does: relative/absolute paths, then node_modules. */
function resolveExtends(spec: string, fromDir: string): string {
  if (spec.startsWith(".") || isAbsolute(spec)) {
    const target = resolve(fromDir, spec);
    if (isFile(target)) return target;
    if (isFile(`${target}.json`)) return `${target}.json`;
    throw new Error(`Cannot resolve extends "${spec}" from ${fromDir}`);
  }
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", spec);
    if (isFile(candidate)) return candidate;
    if (isFile(`${candidate}.json`)) return `${candidate}.json`;
    if (isFile(join(candidate, "package.json"))) {
      const manifest = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as {
        tsconfig?: unknown;
      };
      const entry = typeof manifest.tsconfig === "string" ? manifest.tsconfig : "tsconfig.json";
      const target = join(candidate, entry);
      if (isFile(target)) return target;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot resolve extends "${spec}" from ${fromDir}`);
}

/** Walks the `extends` graph (string or array) from a tsconfig and returns every config reached. */
function extendsChain(start: string): string[] {
  const seen = new Set<string>();
  const stack = [realpathSync(start)];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const raw = readTsconfig(current).extends;
    const specs = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const spec of specs) {
      if (typeof spec !== "string") throw new Error(`Non-string extends entry in ${current}`);
      stack.push(realpathSync(resolveExtends(spec, dirname(current))));
    }
  }
  return [...seen];
}

describe("tsconfig strictness and base inheritance", () => {
  it("the root base config sets strict to true", () => {
    const base = readTsconfig(BASE_TSCONFIG) as { compilerOptions?: Record<string, unknown> };
    expect(base.compilerOptions?.strict).toBe(true);
  });

  describe.each(PACKAGES)("%s", (pkg) => {
    const pkgDir = join(ROOT, pkg);

    it("resolves to strict: true with no strict-family option set to false", () => {
      const options = showConfig(pkgDir).compilerOptions ?? {};
      expect(options.strict).toBe(true);
      const disabled = STRICT_FAMILY.filter((name) => options[name] === false);
      expect(disabled, `strict-family options disabled in ${pkg}`).toEqual([]);
    });

    it("extends the root tsconfig.base.json, directly or through a chain", () => {
      const chain = extendsChain(join(pkgDir, "tsconfig.json"));
      expect(chain).toContain(realpathSync(BASE_TSCONFIG));
    });
  });
});
