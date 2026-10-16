// Contract errors and parse results. Requirements 3.1, 3.9, 10.3 and 10.4.
// C20: an error reports field paths and issue kinds only, never a field value.
import type { z } from "zod";

export type ContractIssueKind =
  // mapped from Zod 4 issue codes
  | "invalid_type"
  | "too_big"
  | "too_small"
  | "invalid_format"
  | "not_multiple_of"
  | "unrecognized_keys"
  | "invalid_union"
  | "invalid_key"
  | "invalid_element"
  | "invalid_value"
  | "custom"
  // raised by this package
  | "invalid_json"
  | "not_object"
  | "wrong_topic"
  | "invalid_topic"
  | "invalid_device_id"
  | "invalid_topic_suffix"
  | "reason_required"
  | "config_empty"
  | "invalid_https_url";

export type ContractIssue = {
  readonly path: readonly (string | number)[];
  readonly kind: ContractIssueKind;
};

export class ContractError extends Error {
  override readonly name = "ContractError";
  /** Which message or union failed, for example "hello", "event", "cmd" or "topic". */
  readonly variant: string;
  /** At least one issue; frozen. */
  readonly issues: readonly ContractIssue[];

  constructor(variant: string, issues: readonly ContractIssue[]) {
    if (issues.length === 0) {
      // A programming bug: the codec never builds an error without an issue.
      throw new Error("ContractError needs at least one issue");
    }
    // Fixed template: the variant label and an issue count, never an input value.
    super(`Invalid ${variant} message: ${issues.length} issue(s)`);
    this.variant = variant;
    this.issues = Object.freeze(
      issues.map((issue) =>
        Object.freeze({ path: Object.freeze([...issue.path]), kind: issue.kind }),
      ),
    );
  }
}

export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ContractError };

/** Zod 4 issue codes passed through as their own kind. */
const ZOD_CODES: ReadonlySet<string> = new Set<ContractIssueKind>([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
]);

/** Kinds a refinement may name through `params.kind`. */
const CUSTOM_KINDS: ReadonlySet<string> = new Set<ContractIssueKind>([
  "reason_required",
  "config_empty",
  "invalid_https_url",
]);

function cleanPath(path: readonly PropertyKey[]): (string | number)[] {
  return path.filter((p): p is string | number => typeof p === "string" || typeof p === "number");
}

/**
 * Internal. Maps Zod issues to contract issues, reading only `path`, `code`,
 * `params.kind` and (for unknown keys) the key names. Messages, inputs, expected
 * values, patterns and nested union errors are discarded.
 */
export function mapZodIssues(issues: readonly z.core.$ZodIssue[]): ContractIssue[] {
  const out: ContractIssue[] = [];
  for (const issue of issues) {
    const path = cleanPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      // D7: one issue per unknown key, at the parent path plus the key name.
      for (const key of issue.keys) {
        out.push({ path: [...path, key], kind: "unrecognized_keys" });
      }
      continue;
    }
    if (issue.code === "custom") {
      const kind: unknown = issue.params?.["kind"];
      out.push({
        path,
        kind:
          typeof kind === "string" && CUSTOM_KINDS.has(kind)
            ? (kind as ContractIssueKind)
            : "custom",
      });
      continue;
    }
    const code: string = issue.code;
    out.push({ path, kind: ZOD_CODES.has(code) ? (code as ContractIssueKind) : "custom" });
  }
  return out;
}
