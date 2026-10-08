// Env-read checks (Req 12.5, 12.8, 5.6, 6.6, 7.4; design Property 8).
// The real-repo part walks the file system (not git) from the repo root and runs
// `findEnvReads` over the parent app, admin, gateway, simulator and shared sources.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { findEnvReads, type EnvRead } from "../checks/env-reads.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Directories never scanned anywhere.
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".expo"]);

const PARENT_APP_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);

type Finding = { file: string; lineNo: number; name: string | null };

function toRepoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

/** Recursively lists files under `dir`, skipping excluded directories. */
function walk(dir: string, accept: (file: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) out.push(...walk(abs, accept));
    } else if (entry.isFile() && accept(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function scan(files: readonly string[]): Finding[] {
  return files.flatMap((abs) =>
    findEnvReads(readFileSync(abs, "utf8")).map((read) => ({
      file: toRepoPath(abs),
      lineNo: read.lineNo,
      name: read.name,
    })),
  );
}

/**
 * The parent-app policy (Req 12.5, 12.8): a read fails when its name is unknown (computed or
 * destructured access) or does not start with `EXPO_PUBLIC_`.
 */
function violatesParentAppPolicy(read: Pick<EnvRead, "name">): boolean {
  return read.name === null || !read.name.startsWith("EXPO_PUBLIC_");
}

function format(findings: readonly Finding[]): string {
  return findings
    .map((f) => `${f.file}:${f.lineNo} ${f.name ?? "<computed or destructured>"}`)
    .join("\n");
}

describe("real repo: env reads", () => {
  it("parent app reads only EXPO_PUBLIC_* names, and never via computed or destructured access", () => {
    const files = walk(join(ROOT, "apps/parent-app"), (abs) =>
      PARENT_APP_EXTENSIONS.has(extname(abs)),
    );
    const scanned = files.map(toRepoPath);
    // Guard against a walk that silently scans nothing.
    expect(scanned).toContain("apps/parent-app/app/index.tsx");
    expect(scanned).toContain("apps/parent-app/app/_layout.tsx");

    const violations = scan(files).filter(violatesParentAppPolicy);
    expect(violations, `Disallowed env reads in the parent app:\n${format(violations)}`).toEqual(
      [],
    );
  });

  it("admin, gateway, simulator and shared sources contain no env reads at all", () => {
    const files = [
      ...walk(join(ROOT, "apps/admin/src")),
      join(ROOT, "apps/admin/vite.config.ts"),
      join(ROOT, "apps/admin/index.html"),
      ...walk(join(ROOT, "services/gateway/src")),
      ...walk(join(ROOT, "services/simulator/src")),
      ...walk(join(ROOT, "packages/shared/src")),
    ];
    for (const abs of files) expect(statSync(abs).isFile(), toRepoPath(abs)).toBe(true);

    const scanned = files.map(toRepoPath);
    expect(scanned).toEqual(
      expect.arrayContaining([
        "apps/admin/src/main.tsx",
        "services/gateway/src/index.ts",
        "services/simulator/src/index.ts",
        "packages/shared/src/index.ts",
      ]),
    );

    const findings = scan(files);
    expect(findings, `Env reads found where none are allowed:\n${format(findings)}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property 8. The real-repo scan above covers apps/, services/ and packages/ only, so the
// literal env accesses generated below never reach it.

/** Printable ASCII, 0x20–0x7E. No line breaks, so a filler string stays on one line. */
const printableChar = fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c));

/**
 * Random surrounding code with no env access in it: without the substring `env` neither
 * `process.env` nor `import.meta.env` can appear.
 */
const filler = fc.string({ unit: printableChar, maxLength: 40 }).filter((s) => !s.includes("env"));

/**
 * Text placed before or after an access on the same line. The separator next to the access is
 * never an identifier character, so the access is not glued into a longer identifier.
 */
const separator = fc.constantFrom(" ", ";", "(", ")", ",", "=", "+", "!", "{", "}");
const prefix = fc.tuple(filler, separator).map(([f, s]) => f + s);
const suffix = fc.tuple(separator, filler).map(([s, f]) => s + f);

const identifier = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,24}$/);

/** A variable name with its expected policy outcome, decided by construction. */
type GenName = { name: string; isPublic: boolean };

const publicName: fc.Arbitrary<GenName> = fc
  .stringMatching(/^[A-Za-z0-9_]{1,20}$/)
  .map((rest) => ({ name: `EXPO_PUBLIC_${rest}`, isPublic: true }));

const plainName: fc.Arbitrary<GenName> = identifier
  .filter((n) => !n.startsWith("EXPO_PUBLIC_"))
  .map((name) => ({ name, isPublic: false }));

/** Near misses of the prefix: wrong case, a missing underscore, a misspelling, or not at the start. */
const lookalikeName: fc.Arbitrary<GenName> = fc
  .tuple(
    fc.constantFrom(
      "EXPO_PUBLIC",
      "expo_public_",
      "Expo_Public_",
      "EXPO_PUBLI_",
      "EXPOPUBLIC_",
      "X_EXPO_PUBLIC_",
      "_EXPO_PUBLIC_",
    ),
    fc.stringMatching(/^[A-Za-z0-9]{1,12}$/),
  )
  .map(([p, rest]) => ({ name: p + rest, isPublic: false }));

const envName = fc.oneof(publicName, plainName, lookalikeName);

/** The four static access forms of design Property 8. */
const ACCESS_FORMS: readonly ((name: string) => string)[] = [
  (n) => `process.env.${n}`,
  (n) => `process.env["${n}"]`,
  (n) => `process.env['${n}']`,
  (n) => `import.meta.env.${n}`,
];

/** Destructuring and computed accesses: the name read cannot be known statically. */
const DYNAMIC_FORMS: readonly ((name: string, v: string) => string)[] = [
  (n) => `const { ${n} } = process.env;`,
  (n, v) => `const { ${n}: ${v}, ...rest } = process.env;`,
  (_n, v) => `process.env[${v}]`,
  (_n, v) => `process.env[\`\${${v}}\`]`,
  (n, v) => `process.env["${n}" + ${v}]`,
  () => `Object.keys(process.env)`,
  () => `({ ...process.env })`,
  (_n, v) => `import.meta.env[${v}]`,
  (n) => `const { ${n} } = import.meta.env;`,
];

type GenLine = { text: string; read: GenName | null };

const fillerLine: fc.Arbitrary<GenLine> = filler.map((text) => ({ text, read: null }));

const staticReadLine: fc.Arbitrary<GenLine> = fc
  .record({
    pre: prefix,
    form: fc.constantFrom(...ACCESS_FORMS),
    name: envName,
    post: suffix,
  })
  .map(({ pre, form, name, post }) => ({ text: pre + form(name.name) + post, read: name }));

describe("env-read detector properties", () => {
  // Feature: phase-0-skeleton, Property 8: Environment-read detector
  // Validates: Requirements 12.5, 12.8, 5.6, 6.6, 7.4
  it("finds every static read by name, and the parent-app policy fails exactly on non-EXPO_PUBLIC_ names", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fillerLine, staticReadLine), { maxLength: 20 }),
        fc.constantFrom("\n", "\r\n"),
        (lines, eol) => {
          const source = lines.map((l) => l.text).join(eol);
          const expected = lines.flatMap((l, i) =>
            l.read === null ? [] : [{ lineNo: i + 1, name: l.read.name }],
          );

          const reads = findEnvReads(source);
          expect(reads).toEqual(expected);

          const flagged = lines.flatMap((l) => (l.read === null ? [] : [!l.read.isPublic]));
          expect(reads.map(violatesParentAppPolicy)).toEqual(flagged);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: phase-0-skeleton, Property 8: Environment-read detector
  // Validates: Requirements 12.5, 12.8, 5.6, 6.6, 7.4
  it("reports destructuring and computed access with name null, and the policy always fails on it", () => {
    fc.assert(
      fc.property(
        fc.array(fillerLine, { maxLength: 10 }),
        fc.array(fillerLine, { maxLength: 10 }),
        prefix,
        fc.constantFrom(...DYNAMIC_FORMS),
        envName,
        identifier,
        suffix,
        (before, after, pre, form, name, variable, post) => {
          const line = pre + form(name.name, variable) + post;
          const source = [...before.map((l) => l.text), line, ...after.map((l) => l.text)].join(
            "\n",
          );

          const reads = findEnvReads(source);
          expect(reads).toEqual([{ lineNo: before.length + 1, name: null }]);
          expect(reads.every(violatesParentAppPolicy)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
