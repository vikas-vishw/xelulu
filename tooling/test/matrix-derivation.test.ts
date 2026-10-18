// The Test_Matrix is generated from the contract, not hand-listed (Phase 6 Req 4.3, 7.10, 8.6).
//
// Requirement 4.3 says a Document B list that gains a member gains its matrix row with no console
// source change. `apps/admin/test/test-matrix.test.ts` proves the behaviour; this is the static
// half, and the one that cannot be satisfied by a lucky test: it reads the console's source and
// insists that
//
//   1. `matrix/test-matrix.ts` imports the three Document B lists from the Shared_Package,
//   2. no console source holds a row id for a contract member as a literal, and
//   3. no console source breaches the contract-use rules at all — the same detector the service
//      sources are held to, reused rather than reimplemented.
//
// Nothing about the contract is restated here: the names come from the Contract_Module's export
// lists and the values from the built Shared_Package, exactly as `contract-use.test.ts` does.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as shared from "../../packages/shared/dist/index.js";
import { exportedNames, findContractMisuse, type ContractSurface } from "../checks/contract-use.js";
import { formatSourceFindings } from "../checks/service-sources.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONSOLE_SRC = "apps/admin/src";
const MATRIX_MODULE = "apps/admin/src/matrix/test-matrix.ts";
/** The Device_Action_Gate, whose allow-list the console's drivable set must equal exactly. */
const GATE_MODULE = "services/gateway/src/brain/tools/device-action.ts";
const EXCLUDED_DIRS = new Set(["node_modules", "dist"]);

/** The three Document B lists the matrix walks, by their Shared_Package export name. */
const MATRIX_LIST_NAMES = ["CMD_ACTIONS", "EVENT_KINDS", "TOUCH_ZONES"] as const;

/** The row-id prefix each list's rows are built with. */
const ROW_PREFIXES: Readonly<Record<(typeof MATRIX_LIST_NAMES)[number], string>> = Object.freeze({
  CMD_ACTIONS: "cmd",
  EVENT_KINDS: "event",
  TOUCH_ZONES: "zone",
});

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

/** Every `.ts`/`.tsx` source of the console, as `[repoPath, text]`. */
function consoleSources(): [string, string][] {
  return walk(join(ROOT, CONSOLE_SRC))
    .filter((abs) => [".ts", ".tsx"].includes(extname(abs)))
    .map((abs) => [toRepoPath(abs), readFileSync(abs, "utf8")]);
}

const contractNames = exportedNames(read("packages/shared/src/gateway-contract/index.ts"));

const contractLists: Record<string, readonly string[]> = Object.fromEntries(
  contractNames.flatMap((name) => {
    const value: unknown = (shared as Record<string, unknown>)[name];
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? [[name, value as readonly string[]]]
      : [];
  }),
);

const contract: ContractSurface = { typeNames: contractNames, lists: contractLists };

/**
 * The `{ action: true | false }` entries of a frozen decision table, read off the source. Lines
 * that are not `name: true,` or `name: false,` — the comments that explain each `false` — are
 * ignored, so the check reads the decisions and nothing else.
 */
function decisionTable(source: string, name: string, where: string): Record<string, boolean> {
  const declared = source.indexOf(`const ${name}`);
  expect(declared, `${where} must declare ${name}`).toBeGreaterThanOrEqual(0);
  const frozen = source.indexOf("Object.freeze(", declared);
  expect(frozen, `${where}'s ${name} must be Object.freeze(...)`).toBeGreaterThan(declared);
  const open = source.indexOf("{", frozen);
  const close = source.indexOf("});", open);
  expect(close, `${where}'s ${name} must close`).toBeGreaterThan(open);

  const out: Record<string, boolean> = {};
  for (const match of source
    .slice(open + 1, close)
    .matchAll(/^[ \t]*([a-z_][a-z0-9_]*)[ \t]*:[ \t]*(true|false)[ \t]*,/gm)) {
    out[match[1] ?? ""] = match[2] === "true";
  }
  return out;
}

describe("the Test_Matrix is derived from the contract (Req 4.3, 8.6)", () => {
  it("builds its rows from the three Document B lists in the Shared_Package", () => {
    const source = read(MATRIX_MODULE);
    // One import of the three lists, from the Shared_Package and nowhere else.
    const importMatch = /import\s*\{([^}]*)\}\s*from\s*["']@xelulu\/shared["']/.exec(source);
    expect(
      importMatch,
      `${MATRIX_MODULE} must import the contract lists from @xelulu/shared`,
    ).not.toBeNull();
    const imported = (importMatch?.[1] ?? "").split(",").map((name) => name.trim());
    for (const name of MATRIX_LIST_NAMES) {
      expect(imported, `${MATRIX_MODULE} must import ${name}`).toContain(name);
      // And it must walk the list, not just mention it.
      expect(source, `${MATRIX_MODULE} must iterate ${name}`).toMatch(
        new RegExp(`${name}\\b[\\s\\S]{0,200}`),
      );
    }
    // Non-vacuity: the three names really are contract lists in the built package.
    for (const name of MATRIX_LIST_NAMES) {
      expect(Object.keys(contractLists), `${name} is a contract list`).toContain(name);
      expect(contractLists[name]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("holds no row id for a contract member as a literal in any console source", () => {
    const sources = consoleSources();
    // Non-vacuity: the scan covers the matrix module and the page that renders it.
    expect(sources.map(([path]) => path)).toEqual(
      expect.arrayContaining([MATRIX_MODULE, "apps/admin/src/pages/matrix-page.tsx"]),
    );

    const banned: string[] = [];
    for (const listName of MATRIX_LIST_NAMES) {
      for (const member of contractLists[listName] ?? []) {
        banned.push(`${ROW_PREFIXES[listName]}:${member}`);
      }
    }
    expect(banned.length).toBeGreaterThan(20);

    const found: string[] = [];
    for (const [path, text] of sources) {
      for (const id of banned) {
        if (text.includes(id)) found.push(`${path} holds the hand-written row id ${id}`);
      }
    }
    expect(found, `Hand-listed matrix rows:\n${found.join("\n")}`).toEqual([]);
  });

  // Phase 6, Wave 3 review: the console cannot import the Gateway's allow-list (an app may not
  // import from a service), so each derives the same answer from its own exhaustive decision
  // table over `CmdAction`. Nothing static tied the two together, which means a changed
  // allow-list could have drifted silently in either direction. This reads both tables off disk
  // and insists they are the same table.
  it("keeps the console's drivable set identical to the Device_Action_Gate's allow-list", () => {
    const gate = decisionTable(read(GATE_MODULE), "CONVERSATIONAL", GATE_MODULE);
    const operator = decisionTable(read(MATRIX_MODULE), "OPERATOR_DRIVABLE", MATRIX_MODULE);
    const actions = contractLists["CMD_ACTIONS"] ?? [];

    // Non-vacuity: both tables are exhaustive over Document B's actions, so a comparison of
    // them really is a comparison of the whole allow-list.
    expect(actions.length).toBeGreaterThan(0);
    expect(Object.keys(gate).sort(), `${GATE_MODULE} must decide every CMD_ACTIONS member`).toEqual(
      [...actions].sort(),
    );
    expect(
      Object.keys(operator).sort(),
      `${MATRIX_MODULE} must decide every CMD_ACTIONS member`,
    ).toEqual([...actions].sort());

    expect(
      operator,
      "the console's OPERATOR_DRIVABLE has drifted from the gate's CONVERSATIONAL",
    ).toEqual(gate);
    // And movement is false in both, which is the entry that matters (safety.md §5).
    expect(gate["move"]).toBe(false);
    expect(operator["move"]).toBe(false);
  });

  it("breaches none of the contract-use rules anywhere in the console source", () => {
    const findings = consoleSources().flatMap(([path, text]) =>
      findContractMisuse(path, text, contract),
    );
    expect(findings, `Contract-use breaches:\n${formatSourceFindings(findings)}`).toEqual([]);
  });
});
