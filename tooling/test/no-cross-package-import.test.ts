// Dependency-direction rule checks (Req 13.3, 13.5, 5.8, 6.7, 7.5, 8.8; design Property 9).
// Runs tooling/eslint/xelulu-plugin.mjs through ESLint's flat `Linter` with a synthetic package
// table, plus a few `RuleTester` examples. No file on disk is linted here.

import { posix } from "node:path";
import { Linter, RuleTester, type ESLint } from "eslint";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// The plugin is plain .mjs with no declaration file; a non-literal specifier keeps tsc from
// needing one. The shape is checked at runtime below.
const PLUGIN_URL = new URL("../eslint/xelulu-plugin.mjs", import.meta.url).href;
const xelulu = ((await import(PLUGIN_URL)) as { default: ESLint.Plugin }).default;

const RULE_ID = "xelulu/no-cross-package-import";
const rule = xelulu.rules?.["no-cross-package-import"];

type Kind = "app" | "service" | "shared";
type Pkg = { dir: string; name: string; kind: Kind };

/** Synthetic table mirroring the five Workspace_Packages. Not read from disk. */
const PACKAGES: readonly Pkg[] = [
  { dir: "apps/parent-app", name: "@xelulu/parent-app", kind: "app" },
  { dir: "apps/admin", name: "@xelulu/admin", kind: "app" },
  { dir: "services/gateway", name: "@xelulu/gateway", kind: "service" },
  { dir: "services/simulator", name: "@xelulu/simulator", kind: "service" },
  { dir: "packages/shared", name: "@xelulu/shared", kind: "shared" },
];

const LANGUAGE_OPTIONS = { sourceType: "module", ecmaVersion: "latest" } as const;

type ImportForm =
  "import" | "export-all" | "export-named" | "dynamic" | "dynamic-template" | "require";
type SpecStyle = "relative" | "name" | "name-subpath";
type PathStyle = "posix" | "windows";

/** One line of source for the given import form and specifier. */
function importLine(form: ImportForm, spec: string): string {
  switch (form) {
    case "import":
      return `import x from "${spec}";`;
    case "export-all":
      return `export * from "${spec}";`;
    case "export-named":
      return `export { a } from "${spec}";`;
    case "dynamic":
      return `void import("${spec}");`;
    case "dynamic-template":
      return `void import(\`${spec}\`);`;
    case "require":
      return `const r = require("${spec}");`;
  }
}

/** Relative specifier (always "/"-separated) from the importing file to the target path. */
function relativeSpecifier(fromRel: string, toRel: string): string {
  const rel = posix.relative(posix.dirname(fromRel), toRel);
  if (rel === "") return ".";
  return rel.startsWith("../") || rel === ".." ? rel : `./${rel}`;
}

type Root = { rootDir: string; join: (rel: string) => string };

/** Absolute root plus a joiner, in POSIX or Windows-like form (either separator). */
function makeRoot(
  style: PathStyle,
  base: string,
  drive: string,
  rootSep: string,
  fileSep: string,
): Root {
  if (style === "posix") {
    const rootDir = `/home/${base}/xelulu`;
    return { rootDir, join: (rel) => `${rootDir}/${rel}` };
  }
  const parts = [`${drive}:`, "work", base, "xelulu"];
  const rootDir = parts.join(rootSep);
  return { rootDir, join: (rel) => [...parts, ...rel.split("/")].join(fileSep) };
}

const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}(?:-[a-z0-9]{1,4})?$/);
const pkgIndex = fc.integer({ min: 0, max: PACKAGES.length - 1 });

const scenario = fc.record({
  ownerIdx: pkgIndex,
  targetIdx: pkgIndex,
  form: fc.constantFrom<ImportForm>(
    "import",
    "export-all",
    "export-named",
    "dynamic",
    "dynamic-template",
    "require",
  ),
  specStyle: fc.constantFrom<SpecStyle>("relative", "name", "name-subpath"),
  ownerDirs: fc.array(segment, { minLength: 0, maxLength: 4 }),
  ownerFile: segment,
  ownerExt: fc.constantFrom("ts", "tsx", "js", "mjs"),
  targetSegs: fc.array(segment, { minLength: 0, maxLength: 3 }),
  subpath: fc.array(segment, { minLength: 1, maxLength: 3 }),
  fillerLines: fc.integer({ min: 0, max: 5 }),
  pathStyle: fc.constantFrom<PathStyle>("posix", "windows"),
  base: segment,
  drive: fc.constantFrom("C", "D", "c"),
  rootSep: fc.constantFrom("\\", "/"),
  fileSep: fc.constantFrom("\\", "/"),
});

function lint(
  code: string,
  root: Root,
  filename: string,
  packages: readonly Pkg[],
): Linter.LintMessage[] {
  // The Linter matches configs relative to `cwd`; using the synthetic root keeps the file inside it
  // on every host OS (ESLint picks POSIX or Windows path handling from the root's form).
  const linter = new Linter({ configType: "flat", cwd: root.rootDir });
  return linter.verify(
    code,
    [
      {
        // An explicit extension list: a bare "**/*" pattern does not count as a match in flat config.
        files: ["**/*.{ts,tsx,js,mjs}"],
        languageOptions: LANGUAGE_OPTIONS,
        plugins: { xelulu },
        rules: { [RULE_ID]: ["error", { rootDir: root.rootDir, packages }] },
      },
    ],
    { filename },
  );
}

describe("xelulu/no-cross-package-import", () => {
  it("is exposed by the local plugin", () => {
    expect(rule).toBeDefined();
  });

  // Feature: phase-0-skeleton, Property 9: Dependency-direction rule
  // **Validates: Requirements 13.3, 13.5, 5.8, 6.7, 7.5, 8.8**
  it("Property 9: reports exactly one error on the import line iff the target is a different app or service", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const owner = PACKAGES[s.ownerIdx]!;
        const target = PACKAGES[s.targetIdx]!;
        const root = makeRoot(s.pathStyle, s.base, s.drive, s.rootSep, s.fileSep);

        const fromRel = [owner.dir, ...s.ownerDirs, `${s.ownerFile}.${s.ownerExt}`].join("/");
        let spec: string;
        if (s.specStyle === "relative") {
          spec = relativeSpecifier(fromRel, [target.dir, ...s.targetSegs].join("/"));
        } else if (s.specStyle === "name") {
          spec = target.name;
        } else {
          spec = `${target.name}/${s.subpath.join("/")}`;
        }

        const filler = Array.from({ length: s.fillerLines }, (_, i) => `const v${i} = ${i};`);
        const code = [...filler, importLine(s.form, spec), ""].join("\n");
        const messages = lint(code, root, root.join(fromRel), PACKAGES);

        const expectViolation = target.dir !== owner.dir && target.kind !== "shared";
        // Nothing else may be reported (no parse errors, no "no matching configuration").
        expect(messages.filter((m) => m.ruleId !== RULE_ID)).toEqual([]);
        if (expectViolation) {
          expect(messages).toHaveLength(1);
          expect(messages[0]!.line).toBe(s.fillerLines + 1);
          expect(messages[0]!.severity).toBe(2);
          expect(messages[0]!.message).toContain(`${owner.dir} must not import from ${target.dir}`);
        } else {
          expect(messages).toEqual([]);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("xelulu/no-cross-package-import RuleTester examples", () => {
  RuleTester.describe = describe;
  RuleTester.it = it;
  RuleTester.itOnly = it.only;

  const rootDir = "/repo";
  const options = [{ rootDir, packages: PACKAGES }];
  const tester = new RuleTester({ languageOptions: LANGUAGE_OPTIONS });
  const crossPackage = (owner: string, target: string) => ({
    messageId: "crossPackage",
    data: {
      message: `${owner} must not import from ${target} (apps/* and services/* are leaves; only packages/shared may be imported)`,
    },
  });

  if (!rule) throw new Error("no-cross-package-import rule missing from the plugin");

  tester.run("no-cross-package-import", rule, {
    valid: [
      {
        name: "gateway imports @xelulu/shared by name",
        code: 'import { x } from "@xelulu/shared";',
        filename: "/repo/services/gateway/src/index.ts",
        options,
      },
      {
        name: "simulator imports shared by relative path",
        code: 'export * from "../../../packages/shared/src/index.js";',
        filename: "/repo/services/simulator/src/index.ts",
        options,
      },
      {
        name: "import within the owner's own package",
        code: 'const m = require("./lib/util.js");',
        filename: "/repo/apps/admin/src/main.tsx",
        options,
      },
      {
        name: "third-party and node built-ins",
        code: 'import fs from "node:fs";\nimport react from "react";',
        filename: "/repo/apps/parent-app/app/index.tsx",
        options,
      },
      {
        name: "files outside every package (tooling) are not restricted",
        code: 'import g from "../../services/gateway/src/index.js";',
        filename: "/repo/tooling/test/x.test.ts",
        options,
      },
      {
        name: "non-literal dynamic import is not resolvable (known limitation)",
        code: "const n = '@xelulu/admin';\nvoid import(n);",
        filename: "/repo/apps/parent-app/app/index.tsx",
        options,
      },
    ],
    invalid: [
      {
        name: "parent app imports the admin console by name",
        code: 'import a from "@xelulu/admin";',
        filename: "/repo/apps/parent-app/app/index.tsx",
        options,
        errors: [crossPackage("apps/parent-app", "apps/admin")],
      },
      {
        name: "simulator requires the gateway by relative path",
        code: 'const g = require("../../gateway/src/index.js");',
        filename: "/repo/services/simulator/src/index.ts",
        options,
        errors: [crossPackage("services/simulator", "services/gateway")],
      },
      {
        name: "shared imports the gateway via import()",
        code: "void import(`@xelulu/gateway/src/x.js`);",
        filename: "/repo/packages/shared/src/index.ts",
        options,
        errors: [crossPackage("packages/shared", "services/gateway")],
      },
      {
        name: "gateway re-exports from the parent app",
        code: 'export { a } from "../../../apps/parent-app/app/index.tsx";',
        filename: "/repo/services/gateway/src/index.ts",
        options,
        errors: [crossPackage("services/gateway", "apps/parent-app")],
      },
    ],
  });
});
