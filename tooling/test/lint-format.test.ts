// Lint and format exclusion checks (Req 3.7, 3.8, 3.9).
// Uses the ESLint 9 and Prettier 3 Node APIs against the real root configs. Nothing is written
// to disk: the excluded paths need not exist, and lintText / check work on in-memory strings.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const abs = (relative: string): string => path.join(repoRoot, relative);

// The Prettier API, unlike the CLI, applies no ignore files unless told to. Pass the same pair the
// CLI uses by default for `prettier --check .`. A file is ignored if either file ignores it.
const PRETTIER_IGNORE_PATHS = [abs(".prettierignore"), abs(".gitignore")];

/** Paths both tools must skip (design: lint/format exclusions). They need not exist on disk. */
const EXCLUDED_PATHS = [
  "node_modules/x.ts",
  "apps/admin/node_modules/x.ts",
  "packages/shared/dist/x.js",
  "services/gateway/dist/x.js",
  "services/simulator/dist/x.js",
  "apps/admin/dist/x.js",
  "apps/parent-app/.expo/x.ts",
  "apps/parent-app/expo-env.d.ts",
  "pnpm-lock.yaml",
  ".env.example",
  ".env.local.example",
  ".tools/x.js",
] as const;

/** Real sources both tools must still process, so "everything ignored" cannot pass. */
const INCLUDED_PATHS = ["services/gateway/src/index.ts", "apps/admin/src/app.tsx"] as const;

describe("lint and format exclusions", () => {
  const eslint = new ESLint({ cwd: repoRoot });

  describe.each(EXCLUDED_PATHS)("excluded path %s", (relative) => {
    it("is ignored by ESLint", async () => {
      expect(await eslint.isPathIgnored(abs(relative))).toBe(true);
    });

    it("is ignored by Prettier", async () => {
      const info = await prettier.getFileInfo(abs(relative), {
        ignorePath: PRETTIER_IGNORE_PATHS,
      });
      // Ignored is preferred; a path with no inferable parser would also never be formatted.
      expect(info.ignored || info.inferredParser === null).toBe(true);
    });
  });

  describe.each(INCLUDED_PATHS)("source path %s", (relative) => {
    it("is processed by ESLint and Prettier", async () => {
      expect(await eslint.isPathIgnored(abs(relative))).toBe(false);
      const info = await prettier.getFileInfo(abs(relative), {
        ignorePath: PRETTIER_IGNORE_PATHS,
      });
      expect(info.ignored).toBe(false);
      expect(info.inferredParser).not.toBeNull();
    });
  });

  it("ESLint reports a deliberate error against the given file path", async () => {
    // .mjs, because typescript-eslint turns off no-const-assign for TS files (tsc covers it).
    const filePath = abs("tooling/lint-probe.mjs");
    const results = await eslint.lintText("const a = 1;\na = 2;\nexport { a };\n", { filePath });

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result?.filePath).toBe(filePath);
    expect(result?.errorCount).toBeGreaterThan(0);
    expect(result?.messages.map((m) => m.ruleId)).toContain("no-const-assign");
  });

  it("Prettier check rejects unformatted text and leaves the source unchanged", async () => {
    const filepath = abs("tooling/format-probe.ts");
    const config = (await prettier.resolveConfig(filepath)) ?? {};
    const options = { ...config, filepath };

    const source = "const   a={b:1,c:[1,2,3]}\nexport   {a}";
    const before = source.slice();

    expect(await prettier.check(source, options)).toBe(false);
    expect(source).toBe(before);

    // Sanity: the formatted version passes, so check() is not simply always false.
    const formatted = await prettier.format(source, options);
    expect(formatted).not.toBe(source);
    expect(await prettier.check(formatted, options)).toBe(true);
  });
});
