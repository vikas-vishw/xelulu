// Contract-use check (Phase 1.2 Req 2.3, 2.4, 2.5, 2.7; design "New repo checks").
// Scans every .ts file under both service `src` trees for a `zod` import, an `xelulu/` literal, a
// declaration named like a Contract_Module export, and a list of wire values. The exported names
// come from the export lists of packages/shared/src/gateway-contract/index.ts and the value lists
// from the built packages/shared/dist/index.js (root `pnpm test` builds first), so nothing about
// the contract is restated here.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as shared from "../../packages/shared/dist/index.js";
import {
  exportedNames,
  findContractMisuse,
  type ContractRule,
  type ContractSurface,
} from "../checks/contract-use.js";
import { formatSourceFindings } from "../checks/service-sources.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SERVICE_SRC_DIRS = ["services/gateway/src", "services/simulator/src"] as const;
const EXCLUDED_DIRS = new Set(["node_modules", "dist"]);

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

const contractNames = exportedNames(read("packages/shared/src/gateway-contract/index.ts"));

/** Every contract export whose built value is an array of strings: the wire value lists. */
const contractLists: Record<string, readonly string[]> = Object.fromEntries(
  contractNames.flatMap((name) => {
    const value: unknown = (shared as Record<string, unknown>)[name];
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? [[name, value as readonly string[]]]
      : [];
  }),
);

const contract: ContractSurface = { typeNames: contractNames, lists: contractLists };

const ALL_RULES: readonly ContractRule[] = [
  "zod_import",
  "topic_literal",
  "contract_type_name",
  "wire_value_list",
];

describe("contract use (Req 2.3–2.5, 2.7)", () => {
  it("reads the contract's names and value lists from the Shared_Package", () => {
    // Spot checks that the collection works; the lists themselves are never restated.
    expect(contractNames).toEqual(
      expect.arrayContaining(["TouchZone", "CmdMessage", "AckMessage", "buildTopic"]),
    );
    expect(Object.keys(contractLists)).toEqual(
      expect.arrayContaining(["TOUCH_ZONES", "ACK_REASONS", "CMD_ACTIONS", "TOPIC_SUFFIXES"]),
    );
    // 16 closed lists, 3 known vocabularies and TOPIC_SUFFIXES.
    expect(Object.keys(contractLists)).toHaveLength(20);
  });

  it("no service source breaches the contract-use rules", () => {
    const files = SERVICE_SRC_DIRS.flatMap((dir) =>
      walk(join(ROOT, dir)).filter((abs) => extname(abs) === ".ts"),
    );
    const scanned = files.map(toRepoPath);
    expect(scanned).toEqual(
      expect.arrayContaining(["services/gateway/src/index.ts", "services/simulator/src/index.ts"]),
    );

    const findings = files.flatMap((abs) =>
      findContractMisuse(toRepoPath(abs), readFileSync(abs, "utf8"), contract),
    );
    expect(findings, `Contract-use breaches:\n${formatSourceFindings(findings)}`).toEqual([]);
  });

  it("reports exactly one finding per rule in the banned fixture", () => {
    const path = "tooling/fixtures/contract-use-banned.txt";
    const findings = findContractMisuse(path, read(path), contract);
    expect(findings.map((f) => f.rule).sort()).toEqual([...ALL_RULES].sort());
    for (const f of findings) expect(f.path).toBe(path);
  });

  it("reports nothing for the clean fixture", () => {
    const path = "tooling/fixtures/contract-use-clean.txt";
    const findings = findContractMisuse(path, read(path), contract);
    expect(findings, formatSourceFindings(findings)).toEqual([]);
  });
});
