// Gateway boundary checks (Phase 1.2 Req 14.2, 14.3, 14.4; design "New repo checks").
// The gateway imports only `node:` built-ins, relative paths, `@xelulu/shared`, `mqtt` and `ws`;
// its manifest lists exactly those three runtime dependencies and no `@supabase/` package; no
// source calls the global `fetch`; and no module outside `src/brain/` uses a provider
// implementation (a `mock-*` or `adapter-*` module under `src/brain/providers/`).
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findDisallowedGatewayImports,
  findFetchCalls,
  findProviderStubUse,
  formatSourceFindings,
  type SourceFinding,
} from "../checks/service-sources.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GATEWAY_SRC = "services/gateway/src";
const BRAIN_DIR = `${GATEWAY_SRC}/brain/`;
const EXCLUDED_DIRS = new Set(["node_modules", "dist"]);

/** The path the fixtures are read as, so relative specifiers resolve inside the gateway. */
const FIXTURE_AS_PATH = `${GATEWAY_SRC}/audio/boundary-fixture.ts`;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

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

/** Every gateway source as [repo path, text]. */
function gatewaySources(): [string, string][] {
  const files = walk(join(ROOT, GATEWAY_SRC)).filter((abs) => extname(abs) === ".ts");
  const sources = files.map((abs): [string, string] => [
    toRepoPath(abs),
    readFileSync(abs, "utf8"),
  ]);
  // Guard against a walk that silently scans nothing.
  expect(sources.map(([path]) => path)).toEqual(
    expect.arrayContaining([
      `${GATEWAY_SRC}/index.ts`,
      `${GATEWAY_SRC}/brain/providers/mock-stt.ts`,
    ]),
  );
  return sources;
}

function expectNone(findings: readonly SourceFinding[], what: string): void {
  expect(findings, `${what}:\n${formatSourceFindings(findings)}`).toEqual([]);
}

function lineRules(findings: readonly SourceFinding[]): [number, string][] {
  return findings.map((f) => [f.lineNo, f.rule]);
}

describe("gateway boundaries (Req 14.2–14.4)", () => {
  it("sources import only node: built-ins, relative paths, @xelulu/shared, mqtt and ws", () => {
    const findings = gatewaySources().flatMap(([path, text]) =>
      findDisallowedGatewayImports(path, text),
    );
    expectNone(findings, "Gateway imports outside the allowlist");
  });

  it("the manifest has exactly the three runtime dependencies and no @supabase/ package", () => {
    const manifest = JSON.parse(read("services/gateway/package.json")) as Manifest;
    const deps = Object.keys(manifest.dependencies ?? {}).sort();
    const devDeps = Object.keys(manifest.devDependencies ?? {}).sort();
    expect(deps).toEqual(["@xelulu/shared", "mqtt", "ws"]);
    expect(devDeps).toEqual(["@types/node", "@types/ws", "typescript"]);
    for (const name of [...deps, ...devDeps]) expect(name).not.toMatch(/^@supabase\//);
  });

  it("no source calls the global fetch", () => {
    const findings = gatewaySources().flatMap(([path, text]) => findFetchCalls(path, text));
    expectNone(findings, "Global fetch in the gateway");
  });

  it("no module outside src/brain/ imports or uses a provider implementation", () => {
    const outside = gatewaySources().filter(([path]) => !path.startsWith(BRAIN_DIR));
    expect(outside.length).toBeGreaterThan(0);
    const findings = outside.flatMap(([path, text]) => findProviderStubUse(path, text));
    expectNone(findings, "Provider implementation use outside src/brain/");
  });

  describe("fixture self-tests", () => {
    const banned = read("tooling/fixtures/gateway-boundaries-banned.txt");
    const clean = read("tooling/fixtures/gateway-boundaries-clean.txt");

    it("reports every banned pattern", () => {
      expect(lineRules(findDisallowedGatewayImports(FIXTURE_AS_PATH, banned))).toEqual([
        [4, "disallowed_import"],
      ]);
      expect(lineRules(findFetchCalls(FIXTURE_AS_PATH, banned))).toEqual([
        [5, "global_fetch"],
        [6, "global_fetch"],
      ]);
      // Lines 7 and 8 are the mock half of the detector, 9 and 10 the Adapter_Scaffold half.
      expect(lineRules(findProviderStubUse(FIXTURE_AS_PATH, banned))).toEqual([
        [7, "stub_provider_import"],
        [7, "stub_provider_use"],
        [8, "stub_provider_use"],
        [9, "stub_provider_import"],
        [9, "stub_provider_use"],
        [10, "stub_provider_use"],
      ]);
    });

    it("reports nothing for the clean fixture", () => {
      expectNone(findDisallowedGatewayImports(FIXTURE_AS_PATH, clean), "imports");
      expectNone(findFetchCalls(FIXTURE_AS_PATH, clean), "fetch");
      expectNone(findProviderStubUse(FIXTURE_AS_PATH, clean), "stubs");
    });
  });
});
