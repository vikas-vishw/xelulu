// Secret_Check core (Req 12.3, 12.4). Pure functions: no filesystem, git or env access.
// The test in tooling/test/secret-check.test.ts supplies file contents and the Panel_Keys
// (derived from tooling/fixtures/approved-panel.txt), and fails on any finding.

/** One non-empty Panel_Key assignment. Deliberately has no value field, so a value can never leak. */
export type SecretFinding = { path: string; lineNo: number; key: string };

const ENV_REF = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|env\([A-Za-z_][A-Za-z0-9_]*\))$/;

/**
 * True if an assigned value counts as empty: empty, whitespace only, `""`, `''`,
 * or a single `${NAME}` / `env(NAME)` reference, optionally wrapped in one pair of quotes.
 */
export function isEmptyEquivalent(value: string): boolean {
  let v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      v = v.slice(1, -1).trim();
    }
  }
  return v === "" || ENV_REF.test(v);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the secret assignment line regex from the design:
 * `^\s*(?:export\s+|-\s+)?"?(KEY)"?\s*(=|:)(.*)$`.
 * The rest after the separator is captured with its leading whitespace intact, so the
 * inline-comment rule can see a whitespace character directly before `#` (e.g. `KEY= # note`).
 */
function assignmentRegex(keys: readonly string[]): RegExp | null {
  const unique = [...new Set(keys)].filter((k) => k.length > 0);
  if (unique.length === 0) return null;
  // Longest first so a key that is a prefix of another never wins the alternation early.
  unique.sort((a, b) => b.length - a.length);
  const alt = unique.map(escapeRegExp).join("|");
  return new RegExp(`^\\s*(?:export\\s+|-\\s+)?"?(${alt})"?\\s*(?:=|:)(.*)$`);
}

/** Strips an inline comment: the first whitespace character followed by `#` starts it. */
function stripInlineComment(rest: string): string {
  const m = /\s#/.exec(rest);
  return (m === null ? rest : rest.slice(0, m.index)).trim();
}

/**
 * Scans one file's text for non-empty assignments to any of `keys`.
 * Returns findings in line order with 1-based line numbers. Never returns values.
 */
export function scanText(path: string, text: string, keys: readonly string[]): SecretFinding[] {
  const re = assignmentRegex(keys);
  if (re === null) return [];
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i] ?? "");
    if (m === null) continue;
    const key = m[1] ?? "";
    const value = stripInlineComment(m[2] ?? "");
    if (!isEmptyEquivalent(value)) {
      findings.push({ path, lineNo: i + 1, key });
    }
  }
  return findings;
}

/** Formats every finding as `path:line KEY`, one per line. Contains no values by construction. */
export function formatFindings(findings: SecretFinding[]): string {
  return findings.map((f) => `${f.path}:${f.lineNo} ${f.key}`).join("\n");
}
