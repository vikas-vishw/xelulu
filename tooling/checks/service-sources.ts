// Service source detectors (Phase 1.2 Req 14.2, 14.3, 21.1, 21.7; design "New repo checks").
// Pure: each takes a repo path (for reporting) and the file text, and returns findings. No
// filesystem access. Findings carry `{ path, lineNo, rule }` only, never source text.
//
// Matching is deliberately conservative, like the Phase 0 detectors: comments and strings are
// not skipped, so a mention inside either is still reported.

export type SourceFinding = { path: string; lineNo: number; rule: string };

/** A module specifier as written in an import, export-from, dynamic import or `require`. */
export type ModuleSpecifier = { lineNo: number; specifier: string };

/** The 15 file-writing API names of Req 21.1. */
export const FILE_WRITE_NAMES = Object.freeze([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "mkdir",
  "mkdirSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "rename",
  "renameSync",
  "truncate",
  "truncateSync",
] as const);

/** The module specifiers a file-writing name may be imported from. */
export const FS_MODULES = Object.freeze(["fs", "node:fs", "fs/promises", "node:fs/promises"]);

/** The only bare packages a gateway source may import (Req 14.3). */
export const GATEWAY_ALLOWED_PACKAGES = Object.freeze(["@xelulu/shared", "mqtt", "ws"]);

/**
 * The provider implementation factories that only `src/brain/` may use (Phase 3 Req 1.2, 21.2):
 * the three mocks and the four Adapter_Scaffolds. The provider interfaces, their declaration and
 * the Provider_Gate are not here: the audio path names `SttSession` and the composition root
 * calls `checkProviders`, so those modules are importable from outside `src/brain/`.
 */
export const PROVIDER_STUB_NAMES = Object.freeze([
  "createMockStt",
  "createMockLlm",
  "createMockTts",
  "createSarvamStt",
  "createSarvamTts",
  "createElevenLabsTts",
  "createHostedLlm",
]);

/** 1-based line number of each character offset, computed once per text. */
export function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `from "x"` and the side-effect `import "x"` take a plain string literal only (a template literal
// there is a syntax error, so prose such as "from `deviceId`" in a comment is not a specifier);
// `import(…)` and `require(…)` also take a template literal.
const SPECIFIER_RE =
  /(?:(?:\bfrom\s*|\bimport\s+)(["'])([^"'\r\n]+)\1|(?:\bimport\s*\(\s*|\brequire\s*\(\s*)(["'`])([^"'`\r\n]+)\3)/g;

/** Every module specifier in `text`, in order, with the line it is written on. */
export function findModuleSpecifiers(text: string): ModuleSpecifier[] {
  const lineAt = lineIndex(text);
  return [...text.matchAll(SPECIFIER_RE)].map((m) => ({
    lineNo: lineAt((m.index ?? 0) + m[0].length - 1),
    specifier: m[2] ?? m[4] ?? "",
  }));
}

/** True for a specifier a gateway source may import: `node:` built-ins, relative paths, the three packages. */
export function isAllowedGatewayImport(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (specifier.startsWith("./") || specifier.startsWith("../")) return true;
  return GATEWAY_ALLOWED_PACKAGES.some((p) => specifier === p || specifier.startsWith(`${p}/`));
}

/** Any import of a module outside the gateway allowlist (Req 14.3). */
export function findDisallowedGatewayImports(path: string, text: string): SourceFinding[] {
  return findModuleSpecifiers(text)
    .filter((s) => !isAllowedGatewayImport(s.specifier))
    .map((s) => ({ path, lineNo: s.lineNo, rule: "disallowed_import" }));
}

const WRITE_ALT = FILE_WRITE_NAMES.map(escapeRegExp).join("|");

// A bare or member call: `writeFile(`, `fs.writeFile(`, `fs.promises.writeFile (`, `fs?.cp(`.
const WRITE_CALL_RE = new RegExp(`(?<![\\w$])(?:${WRITE_ALT})\\s*\\(`, "g");

// The named-import list of an import or re-export from one of the fs modules.
const FS_ALT = FS_MODULES.map(escapeRegExp).join("|");
const FS_NAMED_IMPORT_RE = new RegExp(
  `\\b(?:import|export)\\b[^;"'\`]*?\\{([^}]*)\\}\\s*from\\s*(["'\`])(?:${FS_ALT})\\2`,
  "g",
);
const WRITE_NAME_RE = new RegExp(`(?<![\\w$])(?:${WRITE_ALT})(?![\\w$])`, "g");

/** Calls to a file-writing API, and imports of one (even aliased) from an fs module (Req 21.1). */
export function findFileWrites(path: string, text: string): SourceFinding[] {
  const lineAt = lineIndex(text);
  const offsets = new Set<number>();
  for (const m of text.matchAll(WRITE_CALL_RE)) offsets.add(m.index ?? 0);
  for (const m of text.matchAll(FS_NAMED_IMPORT_RE)) {
    const list = m[1] ?? "";
    const listStart = (m.index ?? 0) + m[0].indexOf("{") + 1;
    for (const n of list.matchAll(WRITE_NAME_RE)) offsets.add(listStart + (n.index ?? 0));
  }
  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => ({ path, lineNo: lineAt(offset), rule: "file_write" }));
}

const CONSOLE_RE = /(?<![\w$.])console\s*(?:\?\.|\.|\[)/g;
const STDIO_WRITE_RE =
  /(?<![\w$.])process\s*(?:\?\.|\.)\s*(stdout|stderr)\s*(?:\?\.|\.)\s*write\b/g;

/** `console` member access and `process.stdout.write` / `process.stderr.write` (Req 21.7). */
export function findStdioUse(path: string, text: string): SourceFinding[] {
  const lineAt = lineIndex(text);
  const found: { offset: number; rule: string }[] = [];
  for (const m of text.matchAll(CONSOLE_RE)) found.push({ offset: m.index ?? 0, rule: "console" });
  for (const m of text.matchAll(STDIO_WRITE_RE)) {
    found.push({ offset: m.index ?? 0, rule: `${m[1] ?? "stdout"}_write` });
  }
  return found
    .sort((a, b) => a.offset - b.offset)
    .map((f) => ({ path, lineNo: lineAt(f.offset), rule: f.rule }));
}

const FETCH_CALL_RE = /(?<![\w$.])fetch\s*\(/g;
const GLOBAL_FETCH_RE = /(?<![\w$.])globalThis\s*(?:\?\.\s*|\.\s*|\[\s*["'`])fetch\b/g;

/** Calls to the global `fetch` and any `globalThis.fetch` access (Req 14.3). */
export function findFetchCalls(path: string, text: string): SourceFinding[] {
  const lineAt = lineIndex(text);
  const offsets = new Set<number>();
  for (const m of text.matchAll(FETCH_CALL_RE)) offsets.add(m.index ?? 0);
  for (const m of text.matchAll(GLOBAL_FETCH_RE)) offsets.add(m.index ?? 0);
  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => ({ path, lineNo: lineAt(offset), rule: "global_fetch" }));
}

/** Joins `specifier` onto the folder of `path` (both POSIX, repo-relative) and normalises it. */
function resolveRelative(path: string, specifier: string): string {
  const parts = path.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** A provider implementation module: `src/brain/providers/mock-*` or `.../adapter-*`. */
const STUB_MODULE_RE =
  /(?:^|\/)src\/brain\/providers\/(?:mock|adapter)-[a-z0-9-]+(?:\.[cm]?[jt]s)?$/;
const STUB_SPECIFIER_RE = /(?:^|\/)brain\/providers\/(?:mock|adapter)-[a-z0-9-]+(?:\.[cm]?[jt]s)?$/;
const STUB_NAME_RE = new RegExp(`(?<![\\w$])(?:${PROVIDER_STUB_NAMES.join("|")})(?![\\w$])`, "g");

/**
 * Any specifier resolving to a provider implementation module under `src/brain/providers/` and any
 * use of a provider implementation name. `path` is the repo path of the file; callers apply it to
 * files outside `src/brain/` (Phase 3 Req 21.2).
 */
export function findProviderStubUse(path: string, text: string): SourceFinding[] {
  const lineAt = lineIndex(text);
  const findings: SourceFinding[] = [];
  for (const s of findModuleSpecifiers(text)) {
    const relative = s.specifier.startsWith("./") || s.specifier.startsWith("../");
    const target = relative ? resolveRelative(path, s.specifier) : s.specifier;
    if (STUB_MODULE_RE.test(target) || STUB_SPECIFIER_RE.test(s.specifier)) {
      findings.push({ path, lineNo: s.lineNo, rule: "stub_provider_import" });
    }
  }
  for (const m of text.matchAll(STUB_NAME_RE)) {
    findings.push({ path, lineNo: lineAt(m.index ?? 0), rule: "stub_provider_use" });
  }
  return findings.sort((a, b) => a.lineNo - b.lineNo);
}

/** Formats findings as `path:line rule`, one per line. */
export function formatSourceFindings(findings: readonly SourceFinding[]): string {
  return findings.map((f) => `${f.path}:${f.lineNo} ${f.rule}`).join("\n");
}
