// Manifest checks (design: tooling/test/manifests.test.ts).
// Real-repo checks for Req 1.1, 1.2, 1.3, 1.4, 1.8, 1.9, 2.2–2.5, 3.1, 3.2, 4.1, 4.2, 4.8, 4.9,
// 5.7, 6.2, 6.3, 6.7, 7.2, 7.5, 8.8, 8.9, 13.1, 13.2.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { checkManifestDeps, DEPENDENCY_FIELDS, isExactVersion } from "../checks/exact-version.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Manifest = Record<string, unknown> & {
  name?: unknown;
  private?: unknown;
  description?: unknown;
  scripts?: Record<string, unknown>;
};

type WorkspacePackage = { dir: string; manifest: Manifest };

function readJson(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/** Expands the simple `dir/*` globs in pnpm-workspace.yaml into package folders. */
function listWorkspacePackages(globs: readonly string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const glob of globs) {
    if (!glob.endsWith("/*") || glob.slice(0, -2).includes("*")) {
      throw new Error(`Unsupported workspace glob: ${glob}`);
    }
    const parent = join(ROOT, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent).sort()) {
      const dir = join(parent, entry);
      const manifestPath = join(dir, "package.json");
      if (statSync(dir).isDirectory() && existsSync(manifestPath)) {
        packages.push({ dir: toPosix(relative(ROOT, dir)), manifest: readJson(manifestPath) });
      }
    }
  }
  return packages;
}

function depNames(manifest: Manifest): string[] {
  const names: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (typeof deps === "object" && deps !== null) names.push(...Object.keys(deps));
  }
  return names;
}

function scriptsOf(manifest: Manifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
    out[name] = String(value);
  }
  return out;
}

const workspaceYaml = parseYaml(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")) as {
  packages?: unknown;
};
const workspaceGlobs = Array.isArray(workspaceYaml.packages)
  ? workspaceYaml.packages.map(String)
  : [];
const rootManifest = readJson(join(ROOT, "package.json"));
const packages = listWorkspacePackages(workspaceGlobs);
const workspaceNames = new Set(packages.map((p) => String(p.manifest.name)));

function pkg(name: string): Manifest {
  const found = packages.find((p) => p.manifest.name === name);
  if (!found) throw new Error(`Workspace package ${name} not found`);
  return found.manifest;
}

const EXPECTED_PACKAGES: Record<string, string> = {
  "apps/admin": "@xelulu/admin",
  "apps/parent-app": "@xelulu/parent-app",
  "packages/shared": "@xelulu/shared",
  "services/gateway": "@xelulu/gateway",
  "services/simulator": "@xelulu/simulator",
};

const EXPECTED_BUILD: Record<string, string> = {
  "@xelulu/shared": "tsc -p tsconfig.json",
  "@xelulu/gateway": "tsc -p tsconfig.json",
  "@xelulu/simulator": "tsc -p tsconfig.json",
  "@xelulu/admin": "tsc --noEmit && vite build",
  "@xelulu/parent-app": "tsc --noEmit",
};

/** Per-package ESLint/Prettier config file names that must not exist (Req 3.1, 3.2). */
const LINT_CONFIG_FILE =
  /^(\.eslintrc(\..+)?|eslint\.config\..+|\.prettierrc(\..+)?|prettier\.config\..+)$/;

const PARENT_APP_FORBIDDEN_DEPS = [
  "expo-dev-client",
  "rive-react-native",
  "@rive-app/react-native",
  "lottie-react-native",
  "mqtt",
  "ws",
  "@xelulu/admin",
];

/** `rm`, `cp` or `export` used as a command, at the start or after a command separator. */
const NON_PORTABLE_COMMAND = /(^|&&|\|\||;|\|)\s*(rm|cp|export)(\s|$)/;
/** A `VAR=value` env prefix, at the start or after a command separator. */
const ENV_PREFIX = /(^|&&|\|\||;|\|)\s*[A-Za-z_][A-Za-z0-9_]*=/;

describe("real-repo manifests", () => {
  describe("workspace and versions", () => {
    it("declares exactly the three package globs", () => {
      expect([...workspaceGlobs].sort()).toEqual(["apps/*", "packages/*", "services/*"]);
    });

    it("resolves to exactly the five workspace packages", () => {
      const actual = Object.fromEntries(packages.map((p) => [p.dir, p.manifest.name]));
      expect(actual).toEqual(EXPECTED_PACKAGES);
    });

    it("marks the root and every package private", () => {
      expect(rootManifest.private).toBe(true);
      for (const { dir, manifest } of packages) {
        expect(manifest.private, dir).toBe(true);
      }
    });

    it("pins packageManager to one exact pnpm version", () => {
      const pm = String(rootManifest.packageManager ?? "");
      expect(pm).toMatch(/^pnpm@/);
      expect(isExactVersion(pm.slice("pnpm@".length)), pm).toBe(true);
    });

    it("sets engines.node equal to .nvmrc", () => {
      const nvmrc = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim().replace(/^v/, "");
      expect(isExactVersion(nvmrc), nvmrc).toBe(true);
      const engines = rootManifest.engines as Record<string, unknown> | undefined;
      expect(engines?.node).toBe(nvmrc);
    });

    it("gives every dependency in every manifest an exact or workspace: spec", () => {
      const manifests: [string, Manifest][] = [
        ["package.json", rootManifest],
        ...packages.map((p): [string, Manifest] => [`${p.dir}/package.json`, p.manifest]),
      ];
      const findings = manifests.flatMap(([path, manifest]) =>
        checkManifestDeps(manifest, workspaceNames).map(
          (f) => `${path} ${f.field}.${f.name}: ${f.reason}`,
        ),
      );
      expect(findings).toEqual([]);
    });
  });

  describe("scripts and dependencies", () => {
    it("gives every package the expected build script", () => {
      for (const [name, command] of Object.entries(EXPECTED_BUILD)) {
        expect(scriptsOf(pkg(name)).build, name).toBe(command);
      }
    });

    it("uses no rm, cp, export or VAR= prefixes in any script", () => {
      const all: [string, Manifest][] = [
        ["root", rootManifest],
        ...packages.map((p): [string, Manifest] => [p.dir, p.manifest]),
      ];
      const offenders: string[] = [];
      for (const [where, manifest] of all) {
        for (const [script, command] of Object.entries(scriptsOf(manifest))) {
          if (NON_PORTABLE_COMMAND.test(command) || ENV_PREFIX.test(command)) {
            offenders.push(`${where}:${script}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it("declares eslint and prettier only at the root", () => {
      const rootDeps = depNames(rootManifest);
      expect(rootDeps).toContain("eslint");
      expect(rootDeps).toContain("prettier");
      for (const { dir, manifest } of packages) {
        const lintDeps = depNames(manifest).filter(
          (n) =>
            n === "eslint" ||
            n === "prettier" ||
            n.startsWith("eslint-") ||
            n.startsWith("prettier-") ||
            n.startsWith("@eslint/") ||
            n === "typescript-eslint",
        );
        expect(lintDeps, dir).toEqual([]);
        expect("eslintConfig" in manifest, `${dir} eslintConfig`).toBe(false);
        expect("prettier" in manifest, `${dir} prettier`).toBe(false);
      }
    });

    it("has no per-package ESLint or Prettier config files", () => {
      for (const { dir } of packages) {
        const configs = readdirSync(join(ROOT, dir)).filter((f) => LINT_CONFIG_FILE.test(f));
        expect(configs, dir).toEqual([]);
      }
    });

    it("keeps dev-client, Rive, Lottie, MQTT, WS and admin out of the parent app", () => {
      const deps = depNames(pkg("@xelulu/parent-app"));
      expect(deps.filter((d) => PARENT_APP_FORBIDDEN_DEPS.includes(d))).toEqual([]);
    });
  });

  describe("boundaries", () => {
    it("describes the admin console as internal only", () => {
      expect(String(pkg("@xelulu/admin").description ?? "").toLowerCase()).toContain(
        "internal only",
      );
    });

    it("has only gateway -> shared and simulator -> shared workspace edges", () => {
      const edges = packages
        .flatMap(({ manifest }) =>
          depNames(manifest)
            .filter((d) => workspaceNames.has(d))
            .map((d) => `${String(manifest.name)} -> ${d}`),
        )
        .sort();
      expect(edges).toEqual([
        "@xelulu/gateway -> @xelulu/shared",
        "@xelulu/simulator -> @xelulu/shared",
      ]);
    });

    it("gives the shared package no runtime dependencies", () => {
      const deps = pkg("@xelulu/shared").dependencies;
      expect(deps === undefined || Object.keys(deps as object).length === 0).toBe(true);
    });
  });
});

// Generators for Property 7.

/** A numeric identifier with no leading zeros. */
const numericId = fc.nat({ max: 100_000 }).map(String);

const coreVersion = fc
  .tuple(numericId, numericId, numericId)
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

const prereleaseId = fc.stringMatching(/^[0-9A-Za-z-]{1,8}$/);
const prerelease = fc
  .array(prereleaseId, { minLength: 1, maxLength: 3 })
  .map((ids) => `-${ids.join(".")}`);

/** MAJOR.MINOR.PATCH with an optional pre-release suffix. */
const exactVersion = fc
  .tuple(coreVersion, fc.option(prerelease, { nil: undefined }))
  .map(([core, pre]) => core + (pre ?? ""));

const slug = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);

/** Every spec form Property 7 says isExactVersion must reject. */
const nonExactSpec: fc.Arbitrary<string> = fc.oneof(
  // Range operators.
  fc
    .tuple(fc.constantFrom("^", "~", ">", "<", ">=", "<=", "="), exactVersion)
    .map(([op, v]) => op + v),
  // Wildcards, alone or in any position.
  fc.constantFrom("*", "x", "X"),
  fc
    .tuple(numericId, numericId, numericId, fc.nat({ max: 2 }), fc.constantFrom("*", "x", "X"))
    .map(([a, b, c, pos, w]) => {
      const parts = [a, b, c];
      parts[pos] = w;
      return parts.join(".");
    }),
  // Dist-tags.
  fc.constantFrom("latest", "next", "beta", "canary", "rc"),
  slug,
  // `||` unions and hyphen ranges.
  fc.tuple(exactVersion, exactVersion).map(([a, b]) => `${a} || ${b}`),
  fc.tuple(exactVersion, exactVersion).map(([a, b]) => `${a} - ${b}`),
  // Partial versions.
  numericId,
  fc.tuple(numericId, numericId).map(([a, b]) => `${a}.${b}`),
  // Build metadata.
  fc
    .tuple(exactVersion, fc.array(prereleaseId, { minLength: 1, maxLength: 3 }))
    .map(([v, ids]) => `${v}+${ids.join(".")}`),
  // Git URLs and shorthands.
  fc
    .tuple(slug, slug, exactVersion)
    .chain(([owner, repo, v]) =>
      fc.constantFrom(
        `git+https://github.com/${owner}/${repo}.git#v${v}`,
        `git+ssh://git@github.com/${owner}/${repo}.git`,
        `git://github.com/${owner}/${repo}.git#${v}`,
        `github:${owner}/${repo}`,
        `${owner}/${repo}#semver:${v}`,
      ),
    ),
  // File paths.
  slug.chain((dir) =>
    fc.constantFrom(`file:../${dir}`, `../${dir}`, `./${dir}`, `link:../${dir}`, `/opt/${dir}`),
  ),
  // Tarball URLs.
  fc
    .tuple(slug, exactVersion)
    .map(([name, v]) => `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`),
);

type SpecKind = "exact" | "workspace" | "non-exact";

const taggedSpec: fc.Arbitrary<{ spec: string; kind: SpecKind }> = fc.oneof(
  exactVersion.map((spec) => ({ spec, kind: "exact" as const })),
  fc
    .constantFrom("workspace:*", "workspace:^", "workspace:~", "workspace:0.0.0")
    .map((spec) => ({ spec, kind: "workspace" as const })),
  nonExactSpec.map((spec) => ({ spec, kind: "non-exact" as const })),
);

/** Workspace names are scoped, third-party names are not, so the two sets never overlap. */
const workspaceNameSet = fc.uniqueArray(
  slug.map((s) => `@ws/${s}`),
  { maxLength: 4 },
);
const thirdPartyName = slug.map((s) => `dep-${s}`);

type GenDep = { name: string; spec: string; kind: SpecKind; isWorkspace: boolean };

function depsFor(wsNames: readonly string[]): fc.Arbitrary<GenDep[]> {
  const name =
    wsNames.length > 0
      ? fc.oneof(
          fc.constantFrom(...wsNames).map((n) => ({ n, isWorkspace: true })),
          thirdPartyName.map((n) => ({ n, isWorkspace: false })),
        )
      : thirdPartyName.map((n) => ({ n, isWorkspace: false }));
  return fc
    .uniqueArray(fc.record({ name, spec: taggedSpec }), {
      selector: (d) => d.name.n,
      maxLength: 6,
    })
    .map((deps) =>
      deps.map((d) => ({
        name: d.name.n,
        spec: d.spec.spec,
        kind: d.spec.kind,
        isWorkspace: d.name.isWorkspace,
      })),
    );
}

const manifestCase = workspaceNameSet.chain((wsNames) =>
  fc
    .record({
      fields: fc.shuffledSubarray([...DEPENDENCY_FIELDS]),
      deps: fc.array(depsFor(wsNames), {
        minLength: DEPENDENCY_FIELDS.length,
        maxLength: DEPENDENCY_FIELDS.length,
      }),
    })
    .map(({ fields, deps }) => ({
      wsNames,
      fieldDeps: fields.map((field, i) => ({ field, deps: deps[i] ?? [] })),
    })),
);

describe("exact-version properties", () => {
  // Feature: phase-0-skeleton, Property 7: Exact-version validator
  // Validates: Requirements 1.2, 1.3, 1.8, 8.9, 13.1
  it("accepts every MAJOR.MINOR.PATCH with an optional pre-release suffix", () => {
    fc.assert(
      fc.property(exactVersion, (v) => {
        expect(isExactVersion(v)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: phase-0-skeleton, Property 7: Exact-version validator
  // Validates: Requirements 1.2, 1.3, 1.8, 8.9, 13.1
  it("rejects ranges, wildcards, tags, unions, partials, build metadata, URLs and paths", () => {
    fc.assert(
      fc.property(nonExactSpec, (spec) => {
        expect(isExactVersion(spec)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  // Feature: phase-0-skeleton, Property 7: Exact-version validator
  // Validates: Requirements 1.2, 1.3, 1.8, 8.9, 13.1
  it("checkManifestDeps reports exactly the non-workspace: workspace deps and non-exact others", () => {
    fc.assert(
      fc.property(manifestCase, ({ wsNames, fieldDeps }) => {
        const manifest: Record<string, unknown> = { name: "@ws/under-test", private: true };
        for (const { field, deps } of fieldDeps) {
          manifest[field] = Object.fromEntries(deps.map((d) => [d.name, d.spec]));
        }

        // The checker walks DEPENDENCY_FIELDS in order, then each field's entries in order.
        const expected = DEPENDENCY_FIELDS.flatMap((field) => {
          const deps = fieldDeps.find((f) => f.field === field)?.deps ?? [];
          return deps
            .filter((d) => (d.isWorkspace ? d.kind !== "workspace" : d.kind !== "exact"))
            .map((d) => ({ field, name: d.name, spec: d.spec }));
        });

        const actual = checkManifestDeps(manifest, new Set(wsNames)).map(
          ({ field, name, spec }) => ({ field, name, spec }),
        );
        expect(actual).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });
});
