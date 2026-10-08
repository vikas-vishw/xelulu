// Placeholder screen and boundary checks (Req 4.5, 4.6, 4.7, 4.9, 4.10, 5.4, 5.6, 5.8, 5.10, 6.6, 7.4).
// Static source checks on the parent-app and admin placeholders, the built admin bundle, and the
// gateway/simulator sources. Everything is read with fs from the repo root; nothing is executed.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parsePanel } from "../checks/panel.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const EXCLUDED_DIRS = new Set(["node_modules", ".expo", "dist"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function toRepoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), "utf8");
}

/** Recursively lists files under `dir`, skipping excluded directories unless `includeAll`. */
function walk(dir: string, includeAll = false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (includeAll || !EXCLUDED_DIRS.has(entry.name)) out.push(...walk(abs, includeAll));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function sourceFiles(repoDir: string): string[] {
  return walk(join(ROOT, repoDir)).filter((abs) => SOURCE_EXTENSIONS.has(extname(abs)));
}

/** Opening `<Text ...>` tags (not `<TextInput>` etc.); attributes may span lines. */
function textOpenTags(source: string): string[] {
  return [...source.matchAll(/<Text(?![\w.])([^>]*)>/g)].map((m) => m[1] ?? "");
}

/** Every `className="..."` / `className={'...'}` / template string literal value. */
function classNameValues(source: string): string[] {
  return [...source.matchAll(/className\s*=\s*\{?\s*(["'`])([^"'`]*)\1/g)].map((m) => m[2] ?? "");
}

/** Module specifiers from import/export-from/dynamic import/require. */
function moduleSpecifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`]+)\1/g;
  return [...source.matchAll(re)].map((m) => m[2] ?? "");
}

const NETWORK_MODULE_RE = /^(?:(?:node:)?(?:net|http|https|http2|dgram|tls)|(?:ws|mqtt)(?:\/.*)?)$/;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function panelKeys(): string[] {
  return parsePanel(read("tooling/fixtures/approved-panel.txt")).flatMap((l) =>
    l.kind === "decl" ? [l.key] : [],
  );
}

describe("placeholder screens and package boundaries", () => {
  describe("detector sanity", () => {
    it("finds Text tags, class names and network imports in known samples", () => {
      const sample = `import net from "node:net";\nconst ws = require('ws');\nexport * from "mqtt/x";\nimport("http");\n<Text a="1">x</Text><TextInput /><Text className="text-sm">y</Text>`;
      expect(textOpenTags(sample)).toHaveLength(2);
      expect(classNameValues(sample)).toEqual(["text-sm"]);
      expect(moduleSpecifiers(sample).filter((s) => NETWORK_MODULE_RE.test(s))).toEqual([
        "node:net",
        "ws",
        "mqtt/x",
        "http",
      ]);
      expect(NETWORK_MODULE_RE.test("react-native")).toBe(false);
      expect(NETWORK_MODULE_RE.test("wsx")).toBe(false);
    });
  });

  describe("parent app", () => {
    const appFiles = sourceFiles("apps/parent-app/app");
    const indexSource = read("apps/parent-app/app/index.tsx");

    it("index has exactly two Text elements, the title is a header, and both use NativeWind", () => {
      const tags = textOpenTags(indexSource);
      expect(tags).toHaveLength(2);
      for (const attrs of tags) expect(attrs).toMatch(/\bclassName\s*=/);

      const title = /<Text(?![\w.])([^>]*)>\s*Xelulu\s*<\/Text>/.exec(indexSource);
      expect(title, "title Text 'Xelulu' not found").not.toBeNull();
      expect(title?.[1] ?? "").toMatch(/\baccessibilityRole\s*=\s*\{?\s*["']header["']/);
      expect(indexSource).toMatch(/<Text(?![\w.])[^>]*>\s*Phase 0 placeholder\s*<\/Text>/);

      // Only the layout and index files exist, and only index renders Text.
      const others = appFiles.filter((abs) => !abs.endsWith("index.tsx"));
      for (const abs of others)
        expect(textOpenTags(readFileSync(abs, "utf8")), toRepoPath(abs)).toEqual([]);
    });

    it("every arbitrary text size is at least 16px and no small preset sizes are used", () => {
      expect(appFiles.length).toBeGreaterThan(0);
      for (const abs of appFiles) {
        const src = readFileSync(abs, "utf8");
        for (const m of src.matchAll(/(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g)) {
          expect(Number(m[1]), `${toRepoPath(abs)}: ${m[0]}`).toBeGreaterThanOrEqual(16);
        }
        expect(src, toRepoPath(abs)).not.toMatch(/(?<![\w-])text-(?:xs|sm|base)(?![\w-])/);
      }
      // The two placeholder sizes are present at all (guards against a vacuous loop).
      expect(indexSource).toContain("text-[28px]");
      expect(indexSource).toContain("text-[18px]");
    });

    it("has no font-scaling overrides and no animation APIs or classes", () => {
      for (const abs of appFiles) {
        const src = readFileSync(abs, "utf8");
        const where = toRepoPath(abs);
        expect(src, where).not.toMatch(/\ballowFontScaling\b/);
        expect(src, where).not.toMatch(/\bmaxFontSizeMultiplier\b/);
        expect(src, where).not.toMatch(/\bAnimated\b/);
        const specs = moduleSpecifiers(src);
        expect(
          specs.filter((s) => /^(?:react-native-reanimated|moti)(?:\/.*)?$/.test(s)),
          where,
        ).toEqual([]);
        for (const value of classNameValues(src)) {
          expect(value, where).not.toMatch(
            /(?<![\w-])(?:animate-[\w-]+|transition(?:-[\w-]+)?)(?![\w-])/,
          );
        }
        expect(src, where).not.toMatch(/(?<![\w-])(?:animate|transition)-[a-z0-9[]/);
      }
    });
  });

  describe("admin console", () => {
    const srcFiles = walk(join(ROOT, "apps/admin/src"));
    const indexHtml = read("apps/admin/index.html");

    it("has exactly one h1, in app.tsx, and none elsewhere in src", () => {
      expect(read("apps/admin/src/app.tsx").match(/<h1\b/g) ?? []).toHaveLength(1);
      for (const abs of srcFiles.filter((f) => !f.endsWith(`${sep}app.tsx`))) {
        expect(readFileSync(abs, "utf8"), toRepoPath(abs)).not.toMatch(/<h1\b/);
      }
    });

    it('index.html declares lang="en" and loads no external resources', () => {
      expect(indexHtml).toMatch(/<html\b[^>]*\blang\s*=\s*["']en["']/);
      expect(indexHtml).not.toMatch(/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
      expect(indexHtml).not.toMatch(/\bhttps?:\/\//i);
    });

    it("src has no import.meta.env reads", () => {
      expect(srcFiles.length).toBeGreaterThan(0);
      for (const abs of srcFiles) {
        expect(readFileSync(abs, "utf8"), toRepoPath(abs)).not.toMatch(/import\.meta\.env\b/);
      }
    });

    it("styles have no animation, transition or keyframes", () => {
      const cssFiles = srcFiles.filter((abs) => extname(abs) === ".css");
      expect(cssFiles.map(toRepoPath)).toContain("apps/admin/src/styles.css");
      for (const abs of cssFiles) {
        const css = stripCssComments(readFileSync(abs, "utf8"));
        expect(css, toRepoPath(abs)).not.toMatch(/\b(?:animation|transition)\b/i);
        expect(css, toRepoPath(abs)).not.toMatch(/@(?:-[a-z]+-)?keyframes\b/i);
      }
    });

    it("the built bundle in apps/admin/dist contains no Panel_Key name", () => {
      const distDir = join(ROOT, "apps/admin/dist");
      expect(
        existsSync(distDir) && statSync(distDir).isDirectory(),
        "apps/admin/dist is missing: run `pnpm build` first (root `pnpm test` builds before testing)",
      ).toBe(true);

      const keys = panelKeys();
      expect(keys.length).toBeGreaterThan(0);

      const distFiles = walk(distDir, true);
      expect(distFiles.map(toRepoPath)).toContain("apps/admin/dist/index.html");

      const leaks: string[] = [];
      for (const abs of distFiles) {
        const text = readFileSync(abs, "utf8");
        for (const key of keys) if (text.includes(key)) leaks.push(`${toRepoPath(abs)} ${key}`);
      }
      expect(leaks, `Panel_Key names found in the admin bundle:\n${leaks.join("\n")}`).toEqual([]);
    });
  });

  describe("boundaries", () => {
    it("the parent app never references the admin console", () => {
      const files = walk(join(ROOT, "apps/parent-app"));
      expect(files.map(toRepoPath)).toContain("apps/parent-app/package.json");
      for (const abs of files) {
        const text = readFileSync(abs, "utf8");
        const where = toRepoPath(abs);
        expect(text, where).not.toContain("apps/admin");
        expect(text, where).not.toContain("@xelulu/admin");
        expect(text, where).not.toMatch(/["'`](?:\.\.\/)+admin(?:["'`/])/);
      }
    });

    it.each(["services/gateway/src", "services/simulator/src"])(
      "%s imports no network modules",
      (dir) => {
        const files = sourceFiles(dir);
        expect(files.length).toBeGreaterThan(0);
        for (const abs of files) {
          const bad = moduleSpecifiers(readFileSync(abs, "utf8")).filter((s) =>
            NETWORK_MODULE_RE.test(s),
          );
          expect(bad, toRepoPath(abs)).toEqual([]);
        }
      },
    );
  });
});
