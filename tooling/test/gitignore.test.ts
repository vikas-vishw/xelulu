// .gitignore tests (Req 12.1, 12.2).
// Each path is checked with `git check-ignore --no-index -q`, which applies the ignore rules
// without consulting the index: exit 0 = ignored, 1 = not ignored, anything else = error.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Returns true if git would ignore `relPath`. Throws if git is missing or errors. */
function isIgnored(relPath: string): boolean {
  const res = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", relPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.error !== undefined) {
    throw new Error(`git is required for the .gitignore check: ${res.error.message}`);
  }
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  throw new Error(
    `git check-ignore failed for ${relPath} (exit ${String(res.status)}): ${res.stderr.trim()}`,
  );
}

const MUST_BE_IGNORED = [
  ".env",
  ".env.local",
  "apps/parent-app/.env",
  "apps/parent-app/.env.local",
  "node_modules/x",
  "apps/admin/node_modules/x",
  "packages/shared/dist/x",
  "services/gateway/dist/x",
  "services/simulator/dist/x",
  "apps/admin/dist/x",
  "apps/parent-app/.expo/x",
  ".tools/x",
];

const MUST_NOT_BE_IGNORED = [".env.example"];

describe(".gitignore rules", () => {
  it.each(MUST_BE_IGNORED)("ignores %s", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it.each(MUST_NOT_BE_IGNORED)("does not ignore %s", (path) => {
    expect(isIgnored(path)).toBe(false);
  });
});
