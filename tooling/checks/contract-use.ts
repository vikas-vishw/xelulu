// Contract-use detectors (Phase 1.2 Req 2.3, 2.4, 2.5, 2.7; design "New repo checks").
// Pure: text in, findings out. No filesystem access. The caller supplies the contract's exported
// names (read from packages/shared/src/gateway-contract/index.ts) and its value lists (imported
// from packages/shared/dist/index.js), so the check follows the contract without restating it.
// Findings carry `{ path, lineNo, rule }` only, never source text.
//
// Matching is deliberately conservative, like the Phase 0 detectors: comments and strings are
// not skipped, so a mention inside either is still reported.

import { findModuleSpecifiers, lineIndex, type SourceFinding } from "./service-sources.js";

export type ContractRule =
  "zod_import" | "topic_literal" | "contract_type_name" | "wire_value_list";
export type ContractFinding = SourceFinding & { rule: ContractRule };

/** What the contract offers: its exported names and its wire value lists, by export name. */
export type ContractSurface = Readonly<{
  typeNames: readonly string[];
  lists: Readonly<Record<string, readonly string[]>>;
}>;

/**
 * Every name in the `export { … }` and `export type { … }` lists of a module's source (the
 * Contract_Module's `index.ts`). `a as b` exports `b`; inline `type` modifiers are dropped.
 */
export function exportedNames(indexSource: string): string[] {
  const names = new Set<string>();
  for (const m of indexSource.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const words = raw
        .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")
        .trim()
        .split(/\s+/)
        .filter((w) => w !== "");
      if (words[0] === "type" && words.length > 1) words.shift();
      const name = words.length >= 3 && words[1] === "as" ? words[2] : words[0];
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `zod`, or a `zod/` subpath, as any module specifier (Req 2.3). */
function zodImports(path: string, text: string): ContractFinding[] {
  return findModuleSpecifiers(text)
    .filter((s) => s.specifier === "zod" || s.specifier.startsWith("zod/"))
    .map((s) => ({ path, lineNo: s.lineNo, rule: "zod_import" }));
}

/** A string or template literal whose text starts with `xelulu/` (Req 2.3). */
function topicLiterals(path: string, text: string): ContractFinding[] {
  const lineAt = lineIndex(text);
  return [...text.matchAll(/["'`]xelulu\//g)].map((m) => ({
    path,
    lineNo: lineAt(m.index ?? 0),
    rule: "topic_literal",
  }));
}

/**
 * A `type`, `interface`, `enum` or `class` declaration named exactly like a contract export
 * (Req 2.3). An inline `type` modifier in an import or export list (`{ type TouchZone, … }`) is
 * not a declaration and is skipped: it is followed by `,`, `}` or `as`.
 */
function contractTypeNames(
  path: string,
  text: string,
  names: readonly string[],
): ContractFinding[] {
  if (names.length === 0) return [];
  const lineAt = lineIndex(text);
  const alt = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const re = new RegExp(
    `\\b(type|interface|enum|class)\\s+(?:${alt})(?![\\w$])(\\s*(?:[,}]|as\\b))?`,
    "g",
  );
  const findings: ContractFinding[] = [];
  for (const m of text.matchAll(re)) {
    if (m[1] === "type" && m[2] !== undefined) continue;
    findings.push({ path, lineNo: lineAt(m.index ?? 0), rule: "contract_type_name" });
  }
  return findings;
}

// A plain string literal: double, single or backtick quotes, no escapes, no `${}`, one line.
const STR = String.raw`(?:"[^"\\\r\n]*"|'[^'\\\r\n]*'|` + "`[^`\\\\$\\r\\n]*`)";
const ARRAY_OF_STRINGS = new RegExp(String.raw`\[\s*(?:${STR}\s*,\s*)+${STR}\s*,?\s*\]`, "g");
const UNION_OF_STRINGS = new RegExp(String.raw`(?:${STR}\s*\|\s*)+${STR}`, "g");
const STR_GLOBAL = new RegExp(STR, "g");

function literalValues(source: string): string[] {
  return [...source.matchAll(STR_GLOBAL)].map((m) => m[0].slice(1, -1));
}

/**
 * An array literal of two or more string literals (possibly across lines), or a union of two or
 * more string literals, whose values all belong to one contract list (Req 2.4).
 */
function wireValueLists(
  path: string,
  text: string,
  lists: Readonly<Record<string, readonly string[]>>,
): ContractFinding[] {
  const lineAt = lineIndex(text);
  const sets = Object.values(lists).map((l) => new Set(l));
  const inOneList = (values: readonly string[]): boolean =>
    values.length >= 2 && sets.some((set) => values.every((v) => set.has(v)));

  const offsets = new Set<number>();
  for (const re of [ARRAY_OF_STRINGS, UNION_OF_STRINGS]) {
    for (const m of text.matchAll(re)) {
      if (inOneList(literalValues(m[0]))) offsets.add(m.index ?? 0);
    }
  }
  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => ({ path, lineNo: lineAt(offset), rule: "wire_value_list" }));
}

/** Every breach of Req 2.3 and 2.4 in one source file, in line order. */
export function findContractMisuse(
  path: string,
  text: string,
  contract: ContractSurface,
): ContractFinding[] {
  return [
    ...zodImports(path, text),
    ...topicLiterals(path, text),
    ...contractTypeNames(path, text, contract.typeNames),
    ...wireValueLists(path, text, contract.lists),
  ].sort((a, b) => a.lineNo - b.lineNo);
}
