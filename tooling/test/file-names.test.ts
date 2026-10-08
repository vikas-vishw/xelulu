// File-name checks (Req 1.11): every file name is kebab-case, except README.md, Dockerfile
// and _layout.tsx. Property 6 covers the validator; the real-repo test applies it to every
// tracked or untracked-but-not-ignored file outside docs/ and .kiro/.

import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isKebabFileName, NAME_EXCEPTIONS } from "../checks/kebab-case.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Pre-existing source documents and specs that Phase 0 does not introduce. */
const EXCLUDED_DIRS = ["docs/", ".kiro/"];

/** Tracked plus untracked-but-not-ignored files, as repo-relative `/` paths. Fails without git. */
function listRepoFiles(): string[] {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) {
    throw new Error("git is required for the file-name check");
  }
  return [...new Set(res.stdout.split("\0").filter((p) => p.length > 0))];
}

describe("file names in the real repository", () => {
  it("gives every file outside docs/ and .kiro/ a kebab-case name", () => {
    const files = listRepoFiles().filter((f) => !EXCLUDED_DIRS.some((d) => f.startsWith(d)));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => !isKebabFileName(posix.basename(f)));
    expect(offenders, `Non-kebab-case file names:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("isKebabFileName examples", () => {
  it.each([
    "index.ts",
    "no-cross-package-import.mjs",
    "tsconfig.base.json",
    ".env.example",
    ".gitkeep",
    "README.md",
    "Dockerfile",
    "_layout.tsx",
  ])("accepts %s", (name) => {
    expect(isKebabFileName(name)).toBe(true);
  });

  it.each([
    "",
    ".",
    "..env",
    "Index.ts",
    "my_file.ts",
    "my file.ts",
    "a--b.ts",
    "-a.ts",
    "a-.ts",
    "a..ts",
    "readme.MD",
  ])("rejects %j", (name) => {
    expect(isKebabFileName(name)).toBe(false);
  });
});

// Generators for Property 6.

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** A non-empty run of [a-z0-9]. */
const segment = fc.string({ unit: fc.constantFrom(...ALNUM), minLength: 1, maxLength: 8 });

/** One dot-separated part: segments joined by single hyphens. */
const part = fc.array(segment, { minLength: 1, maxLength: 3 }).map((segs) => segs.join("-"));

/** A valid kebab name, kept structured so mutations can target a single part. */
const kebabName = fc.record({
  leadingDot: fc.boolean(),
  parts: fc.array(part, { minLength: 1, maxLength: 4 }),
});

function render(name: { leadingDot: boolean; parts: readonly string[] }): string {
  return (name.leadingDot ? "." : "") + name.parts.join(".");
}

/** Inserts `text` at a chosen position of `s` (position taken modulo length + 1). */
function insertAt(s: string, pos: number, text: string): string {
  const i = pos % (s.length + 1);
  return s.slice(0, i) + text + s.slice(i);
}

/**
 * Mutations from Property 6. Uppercase letters, underscores, spaces and `--` are invalid at
 * any position, so they are inserted anywhere in the rendered name. A hyphen at the start
 * or end of a part needs the part boundary, so it is applied to one chosen part.
 */
const mutatedName: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(kebabName, fc.nat(), fc.constantFrom(...UPPER))
    .map(([n, pos, c]) => insertAt(render(n), pos, c)),
  fc.tuple(kebabName, fc.nat()).map(([n, pos]) => insertAt(render(n), pos, "_")),
  fc.tuple(kebabName, fc.nat()).map(([n, pos]) => insertAt(render(n), pos, " ")),
  fc.tuple(kebabName, fc.nat()).map(([n, pos]) => insertAt(render(n), pos, "--")),
  fc.tuple(kebabName, fc.nat(), fc.boolean()).map(([n, idx, atStart]) => {
    const i = idx % n.parts.length;
    const parts = n.parts.map((p, j) => (j === i ? (atStart ? `-${p}` : `${p}-`) : p));
    return render({ leadingDot: n.leadingDot, parts });
  }),
);

describe("isKebabFileName properties", () => {
  // Feature: phase-0-skeleton, Property 6: Kebab-case file-name validator
  // Validates: Requirements 1.11
  it("accepts every generated kebab-case name", () => {
    fc.assert(
      fc.property(kebabName, (n) => {
        expect(isKebabFileName(render(n))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: phase-0-skeleton, Property 6: Kebab-case file-name validator
  // Validates: Requirements 1.11
  it("rejects every mutated name unless it is a listed exception", () => {
    fc.assert(
      fc.property(mutatedName, (name) => {
        expect(isKebabFileName(name)).toBe(NAME_EXCEPTIONS.has(name));
      }),
      { numRuns: 500 },
    );
  });
});
