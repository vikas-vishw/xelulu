// Repo layout checks (design: tooling/test/layout.test.ts).
// Real-repo checks for Req 1.7, 1.10, 3.1, 3.2, 4.4, 6.1, 7.1, 8.4–8.6, 9.5, 9.8.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The five Workspace_Packages (Req 1.10). */
const PACKAGE_DIRS = [
  "apps/parent-app",
  "apps/admin",
  "services/gateway",
  "services/simulator",
  "packages/shared",
] as const;

const ROOT_FILES = [
  ".env.example",
  "docker-compose.yml",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  ".nvmrc",
  ".npmrc",
  "README.md",
] as const;

const ROOT_FOLDERS = [...PACKAGE_DIRS, "supabase"] as const;

/** Folders that hold generated or installed content, never authored configs. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".expo"]);

/** ESLint config file names: flat config (any extension) and legacy `.eslintrc*`. */
const ESLINT_CONFIG = /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(js|cjs|mjs|json|ya?ml))?)$/;

/** Prettier config file names: `.prettierrc*` and `prettier.config.*`. */
const PRETTIER_CONFIG =
  /^(\.prettierrc(\.(json5?|ya?ml|toml|[cm]?[jt]s))?|prettier\.config\.[cm]?[jt]s)$/;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** Sorted entry names of a folder (files and subfolders). */
function entries(relDir: string): string[] {
  return readdirSync(join(ROOT, relDir)).sort();
}

/** Every file under `dir`, skipping generated and installed folders. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Asserts that `relDir` holds exactly one entry: an empty `.gitkeep` file. */
function expectOnlyEmptyGitkeep(relDir: string): void {
  expect(isDir(join(ROOT, relDir)), `${relDir} is a folder`).toBe(true);
  expect(entries(relDir), `${relDir} entries`).toEqual([".gitkeep"]);
  const marker = join(ROOT, relDir, ".gitkeep");
  expect(isFile(marker), `${relDir}/.gitkeep is a file`).toBe(true);
  expect(statSync(marker).size, `${relDir}/.gitkeep size`).toBe(0);
}

describe("repo layout", () => {
  describe("root files and folders (Req 1.7, 1.10)", () => {
    it.each(ROOT_FILES)("root file %s exists", (name) => {
      expect(isFile(join(ROOT, name)), `${name} at the Workspace root`).toBe(true);
    });

    it.each(ROOT_FOLDERS)("folder %s exists", (dir) => {
      expect(isDir(join(ROOT, dir)), `${dir} folder`).toBe(true);
    });

    it.each(PACKAGE_DIRS)("%s has package.json and tsconfig.json", (dir) => {
      expect(isFile(join(ROOT, dir, "package.json")), `${dir}/package.json`).toBe(true);
      expect(isFile(join(ROOT, dir, "tsconfig.json")), `${dir}/tsconfig.json`).toBe(true);
    });

    it(".npmrc sets node-linker=hoisted", () => {
      const lines = readFileSync(join(ROOT, ".npmrc"), "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim());
      expect(lines).toContain("node-linker=hoisted");
    });
  });

  describe("lint and format configs live only at the root (Req 3.1, 3.2)", () => {
    it("the root has exactly one ESLint config and one Prettier config and ignore file", () => {
      const names = entries(".");
      expect(names.filter((name) => ESLINT_CONFIG.test(name))).toEqual(["eslint.config.mjs"]);
      expect(names.filter((name) => PRETTIER_CONFIG.test(name))).toEqual([".prettierrc.json"]);
      expect(names).toContain(".prettierignore");
    });

    it.each(PACKAGE_DIRS)("%s contains no ESLint or Prettier config", (dir) => {
      const offenders = walkFiles(join(ROOT, dir))
        .filter((file) => {
          const name = file.split(/[\\/]/).pop() ?? "";
          return (
            ESLINT_CONFIG.test(name) || PRETTIER_CONFIG.test(name) || name === ".prettierignore"
          );
        })
        .map((file) => toPosix(relative(ROOT, file)));
      expect(offenders).toEqual([]);
    });
  });

  describe("parent app routes (Req 4.4)", () => {
    it("apps/parent-app/app holds only _layout.tsx and index.tsx", () => {
      expect(entries("apps/parent-app/app")).toEqual(["_layout.tsx", "index.tsx"]);
    });
  });

  describe("service folders (Req 6.1, 7.1)", () => {
    it.each(["services/gateway", "services/simulator"])("%s has src/ and test/", (dir) => {
      expect(isDir(join(ROOT, dir, "src")), `${dir}/src`).toBe(true);
      expect(isDir(join(ROOT, dir, "test")), `${dir}/test`).toBe(true);
    });
  });

  describe("shared placeholder folders (Req 8.4, 8.5, 8.6)", () => {
    it("gateway-contract and domain are separate folders under shared src/", () => {
      const src = entries("packages/shared/src");
      expect(src).toContain("gateway-contract");
      expect(src).toContain("domain");
    });

    it.each(["packages/shared/src/gateway-contract", "packages/shared/src/domain"])(
      "%s holds exactly one zero-byte .gitkeep",
      (dir) => expectOnlyEmptyGitkeep(dir),
    );
  });

  describe("supabase scaffold (Req 9.5, 9.8)", () => {
    it("supabase/migrations holds only .gitkeep", () => {
      expectOnlyEmptyGitkeep("supabase/migrations");
    });

    it("supabase/functions holds no source files, only .gitkeep", () => {
      expectOnlyEmptyGitkeep("supabase/functions");
    });
  });
});
