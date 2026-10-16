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

// G3: the keys each service's Env_Module may read, written out here (not taken from the code).
const GATEWAY_G3_KEYS: readonly string[] = [
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "GATEWAY_OPERATOR_PORT",
];
const SIMULATOR_G3_KEYS: readonly string[] = [
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "SIMULATOR_PANEL_PORT",
];

/** The only two files allowed to read the environment (Req 1.1, 22.1), with their keys. */
const ENV_MODULE_KEYS: Readonly<Record<string, readonly string[]>> = {
  "services/gateway/src/env.ts": GATEWAY_G3_KEYS,
  "services/simulator/src/env.ts": SIMULATOR_G3_KEYS,
};

/** Every file under both service `src` trees. */
function serviceSourceFiles(): string[] {
  return [
    ...walk(join(ROOT, "services/gateway/src")),
    ...walk(join(ROOT, "services/simulator/src")),
  ];
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

  it.each(Object.entries(ENV_MODULE_KEYS))(
    "%s reads only static names from its service's G3 keys",
    (envModule, keys) => {
      const findings = scan(serviceSourceFiles().filter((abs) => toRepoPath(abs) === envModule));
      // A missing file is caught by the next test; here an empty scan would pass vacuously.
      expect(findings.length, `${envModule} has no env reads`).toBeGreaterThan(0);

      const violations = findings.filter((f) => f.name === null || !keys.includes(f.name));
      expect(
        violations,
        `Computed, destructured or non-G3 env reads in ${envModule}:\n${format(violations)}`,
      ).toEqual([]);
    },
  );

  it("both service env modules are in the scan", () => {
    const scanned = serviceSourceFiles().map(toRepoPath);
    for (const envModule of Object.keys(ENV_MODULE_KEYS)) expect(scanned).toContain(envModule);
  });

  it("admin, shared and every other service source contain no env reads at all", () => {
    const files = [
      ...walk(join(ROOT, "apps/admin/src")),
      join(ROOT, "apps/admin/vite.config.ts"),
      join(ROOT, "apps/admin/vite-proxy.ts"),
      join(ROOT, "apps/admin/index.html"),
      ...serviceSourceFiles().filter((abs) => !(toRepoPath(abs) in ENV_MODULE_KEYS)),
      ...walk(join(ROOT, "packages/shared/src")),
    ];
    for (const abs of files) expect(statSync(abs).isFile(), toRepoPath(abs)).toBe(true);

    const scanned = files.map(toRepoPath);
    expect(scanned).toEqual(
      expect.arrayContaining([
        "apps/admin/src/main.tsx",
        "apps/admin/vite.config.ts",
        "apps/admin/vite-proxy.ts",
        "services/gateway/src/index.ts",
        "services/simulator/src/index.ts",
        "packages/shared/src/index.ts",
      ]),
    );
    for (const envModule of Object.keys(ENV_MODULE_KEYS)) expect(scanned).not.toContain(envModule);

    const findings = scan(files);
    expect(findings, `Env reads found where none are allowed:\n${format(findings)}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Admin `loadEnv` (Req 4.6, 4.7, 9.2; C6). Text-based and conservative, like the detector: it
// does not skip comments or strings, so a mention inside either still counts.

const OPERATOR_PORT_KEY = "GATEWAY_OPERATOR_PORT";

/** Any `loadEnv` call: the name followed by an opening parenthesis. */
const LOAD_ENV_CALL = /(?<![\w$])loadEnv\s*\(/g;

/** Any `loadEnv` text at all, call or not. */
const LOAD_ENV_TEXT = /loadEnv/;

/** `const|let|var NAME = loadEnv(ARGS)`, with no nested parentheses in ARGS. */
const LOAD_ENV_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*loadEnv\s*\(([^()]*)\)/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("real repo: admin loadEnv", () => {
  const viteConfigPath = join(ROOT, "apps/admin/vite.config.ts");

  it(`vite.config.ts calls loadEnv once with the literal prefix "${OPERATOR_PORT_KEY}" and reads only that key`, () => {
    const source = readFileSync(viteConfigPath, "utf8");

    // Exactly one call in the whole file.
    expect(source.match(LOAD_ENV_CALL) ?? [], "loadEnv( occurrences").toHaveLength(1);

    // The one call is bound to a variable, with exactly three arguments.
    const bindings = [...source.matchAll(LOAD_ENV_BINDING)];
    expect(bindings, "loadEnv( must be assigned with const/let/var").toHaveLength(1);
    const [binding] = bindings;
    const variable = binding?.[1] ?? "";
    const args = (binding?.[2] ?? "").split(",").map((a) => a.trim());
    expect(args, "loadEnv arguments").toHaveLength(3);
    expect(args[2], "loadEnv prefix argument").toBe(`"${OPERATOR_PORT_KEY}"`);

    // Every use of the variable, other than its declaration, is a read of the literal key.
    // A use preceded by `.` is a property of some other object (e.g. `.env` in a comment).
    const uses = [
      ...source.matchAll(new RegExp(`(?<![\\w$.])${escapeRegExp(variable)}(?![\\w$])`, "g")),
    ];
    // The name starts right after the keyword and its whitespace.
    const declarationIndex =
      (binding?.index ?? 0) + (/^(?:const|let|var)\s+/.exec(binding?.[0] ?? "")?.[0].length ?? 0);
    const reads = uses.filter((u) => u.index !== declarationIndex);
    const keyRead = new RegExp(
      `^${escapeRegExp(variable)}\\s*(?:\\[\\s*(["'])${OPERATOR_PORT_KEY}\\1\\s*\\]|\\.\\s*${OPERATOR_PORT_KEY}(?![\\w$]))`,
    );
    expect(uses.length - reads.length, `declaration of ${variable}`).toBe(1);
    expect(reads.length, `reads of ${variable}`).toBeGreaterThan(0);
    for (const use of reads) {
      const rest = source.slice(use.index);
      const lineNo = source.slice(0, use.index).split("\n").length;
      expect(
        keyRead.test(rest),
        `vite.config.ts:${lineNo} uses ${variable} other than as ${variable}["${OPERATOR_PORT_KEY}"]`,
      ).toBe(true);
    }
  });

  it("vite.config.ts and vite-proxy.ts have zero process.env and import.meta.env reads", () => {
    const files = [viteConfigPath, join(ROOT, "apps/admin/vite-proxy.ts")];
    const findings = scan(files);
    expect(findings, `Env reads found:\n${format(findings)}`).toEqual([]);
  });

  it("apps/admin/src, index.html and vite-proxy.ts contain no loadEnv at all", () => {
    const files = [
      ...walk(join(ROOT, "apps/admin/src")),
      join(ROOT, "apps/admin/index.html"),
      join(ROOT, "apps/admin/vite-proxy.ts"),
    ];
    const scanned = files.map(toRepoPath);
    // Guard against a walk that silently scans nothing.
    expect(scanned).toEqual(
      expect.arrayContaining(["apps/admin/src/main.tsx", "apps/admin/src/app.tsx"]),
    );

    const offenders = files
      .filter((abs) => LOAD_ENV_TEXT.test(readFileSync(abs, "utf8")))
      .map(toRepoPath);
    expect(offenders, "Files mentioning loadEnv").toEqual([]);
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
