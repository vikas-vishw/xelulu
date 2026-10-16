// toSafeIssues: the R2 Safe_Issue rule (D5, G21, Req 4.5). Pure, never throws.
import type { ContractIssue } from "../gateway-contract/index.js";
import { SAFE_ISSUE_LIMITS } from "./constants.js";
import { CONTRACT_FIELD_NAMES } from "./contract-field-names.js";
import type { SafeIssue } from "./entries.js";

const DECLARED_FIELD_NAMES: ReadonlySet<string> = new Set(CONTRACT_FIELD_NAMES);

/** Printable ASCII: U+0020 to U+007E. */
function isPrintableAscii(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x7e;
}

/**
 * One path segment. Numbers and declared field names are kept unchanged. Any other string is an
 * unknown key: cut to its first 32 code points, then each code point outside printable ASCII is
 * replaced by one `?`. Iterating a string yields code points, and a lone surrogate is one code
 * point, so it becomes one `?`. The output of this function is printable ASCII of at most 32
 * characters, so applying it again leaves it unchanged.
 */
function safeSegment(segment: string | number): string | number {
  if (typeof segment === "number") return segment;
  if (DECLARED_FIELD_NAMES.has(segment)) return segment;
  let out = "";
  let count = 0;
  for (const ch of segment) {
    if (count >= SAFE_ISSUE_LIMITS.max_unknown_key_code_points) break;
    const codePoint = ch.codePointAt(0) ?? 0;
    out += isPrintableAscii(codePoint) ? ch : "?";
    count += 1;
  }
  return out;
}

/**
 * Keeps only `path` and `kind` of the first 20 issues, in order, with each path segment made safe.
 * Accepts its own output (a SafeIssue may carry a Gateway_Issue_Kind) and is idempotent on it.
 */
export function toSafeIssues(issues: readonly (ContractIssue | SafeIssue)[]): SafeIssue[] {
  const out: SafeIssue[] = [];
  const limit = Math.min(issues.length, SAFE_ISSUE_LIMITS.max_issues);
  for (let i = 0; i < limit; i += 1) {
    const issue = issues[i];
    if (issue === undefined) continue;
    out.push({ path: issue.path.map(safeSegment), kind: issue.kind });
  }
  return out;
}
