// Secret_Check tests (Req 12.3, 12.4, 12.7, 9.9, 10.12, 14.9).
// The real-repo part scans every tracked or untracked-but-not-ignored file for a non-empty
// assignment to any Panel_Key. Findings print as `path:line KEY` only, never a value.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parsePanel } from "../checks/panel.js";
import {
  formatFindings,
  isEmptyEquivalent,
  scanText,
  type SecretFinding,
} from "../checks/secret-scan.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE_PATH = join(REPO_ROOT, "tooling", "fixtures", "approved-panel.txt");
const BINARY_SNIFF_BYTES = 8 * 1024;

/** Panel_Keys come from the approved fixture, never a hard-coded list. */
function panelKeys(): string[] {
  return parsePanel(readFileSync(FIXTURE_PATH, "utf8")).flatMap((l) =>
    l.kind === "decl" ? [l.key] : [],
  );
}

/** Tracked plus untracked-but-not-ignored files, as repo-relative `/` paths. Fails without git. */
function listRepoFiles(): string[] {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) {
    throw new Error("git is required for Secret_Check");
  }
  return [...new Set(res.stdout.split("\0").filter((p) => p.length > 0))];
}

/** Reads a file for scanning; null if it is binary (NUL in the first 8 KiB) or no longer exists. */
function readTextFile(relPath: string): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(join(REPO_ROOT, relPath));
  } catch (err) {
    // Listed but removed before reading (e.g. a deleted tracked file): nothing to scan.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  return buf.toString("utf8");
}

/**
 * The two local-only files that carry the Local_Mode defaults for `docker compose up`, so the
 * stack starts with no root `.env`. Req 12.3/12.4 cannot be satisfied as written for them: the
 * whole point of these files is to hold `KEY=<local value>`, and `${VAR:-default}` is not
 * empty-equivalent (`isEmptyEquivalent` accepts only a bare `${NAME}`). Rather than skipping
 * them — which would stop checking them for real secrets too — both stay in the scan and the
 * allowance is written below as a positive assertion: only these two files, and in them only
 * the nine non-secret Local_Mode device-seam keys.
 *
 * The pure check (`tooling/checks/secret-scan.ts`) is untouched; widening it would weaken the
 * rule for the whole repository.
 */
const LOCAL_DEFAULT_FILES: ReadonlySet<string> = new Set([
  ".env.local.example",
  "docker-compose.yml",
]);

/** The ten keys those two files may assign: the device seam, two surface ports and the bind host. */
const LOCAL_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  "APP_ENV",
  "MQTT_BROKER_URL",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "AUDIO_WSS_URL",
  "DEVICE_ID",
  "DEVICE_TOKEN",
  "GATEWAY_OPERATOR_PORT",
  "SIMULATOR_PANEL_PORT",
  // Added by the LAN bring-up wave: a bind host, not a credential.
  "DEVICE_BIND_HOST",
]);

/** Keys that must never be assigned anywhere, the two local-only files included. */
const NEVER_ASSIGNED_KEYS: readonly string[] = [
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "DEVICE_PROVISION_SECRET",
  "LLM_API_KEY",
  "STT_API_KEY",
  "TTS_API_KEY",
];

describe("Secret_Check on the real repository", () => {
  it("derives a non-empty Panel_Key set from the approved fixture", () => {
    const keys = panelKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("allows only the nine non-secret Local_Mode keys in the two local-default files", () => {
    const keys = new Set(panelKeys());
    // The allowance is a subset of the panel, so it cannot smuggle in a key the panel never had.
    for (const key of LOCAL_DEFAULT_KEYS) expect(keys.has(key), key).toBe(true);
    // And it names no real secret: those stay forbidden everywhere, these two files included.
    for (const key of NEVER_ASSIGNED_KEYS) {
      expect(LOCAL_DEFAULT_KEYS.has(key), key).toBe(false);
      expect(keys.has(key), `${key} is a Panel_Key`).toBe(true);
    }
    expect(LOCAL_DEFAULT_KEYS.size).toBe(10);
    expect(LOCAL_DEFAULT_FILES.size).toBe(2);
  });

  it("finds no non-empty Panel_Key assignment in any tracked or unignored file", () => {
    const keys = panelKeys();
    const files = listRepoFiles();
    expect(files.length).toBeGreaterThan(0);

    const findings: SecretFinding[] = [];
    const scannedPaths: string[] = [];
    for (const file of files) {
      const text = readTextFile(file);
      if (text === null) continue;
      scannedPaths.push(file);
      findings.push(...scanText(file, text, keys));
    }

    expect(scannedPaths.length).toBeGreaterThan(0);
    // Both local-default files are really in the scan, so the allowance below is not vacuous.
    for (const file of LOCAL_DEFAULT_FILES) expect(scannedPaths).toContain(file);

    const [local, elsewhere] = [
      findings.filter((f) => LOCAL_DEFAULT_FILES.has(f.path)),
      findings.filter((f) => !LOCAL_DEFAULT_FILES.has(f.path)),
    ];

    // Everywhere else the rule is unchanged: not one non-empty Panel_Key assignment.
    // Only `path:line KEY` is ever printed, so a failure cannot leak a value.
    expect(elsewhere, `Secret_Check findings:\n${formatFindings(elsewhere)}`).toEqual([]);

    // In the two local-only files, every assignment names one of the nine allowed keys.
    const disallowed = local.filter((f) => !LOCAL_DEFAULT_KEYS.has(f.key));
    expect(
      disallowed,
      `Disallowed keys in the local-default files:\n${formatFindings(disallowed)}`,
    ).toEqual([]);
  });
});

// Every assignment line in this block is generated at runtime, so the real-repo scan above
// never sees a literal Panel_Key assignment in this source file.

/** Printable ASCII, 0x20–0x7E. */
const printableChar = fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c));

/**
 * Characters that never appear in a scanned path, a Panel_Key, a line number or the
 * `path:line KEY` layout. A literal containing one of them can only show up in the
 * formatted output if the value itself leaked.
 */
const MARKER_CHARS = "!%&*+;<>?@^|~";
const PATHS = ["config/app.env", "docker-compose.yml", "supabase/config.toml", "notes.md"];

const identifier = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/);
const leadingWs = fc.string({ unit: fc.constantFrom(" ", "\t"), maxLength: 4 });

/** Values Secret_Check must treat as empty (Req 12.3). */
const emptyValue: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.string({ unit: fc.constantFrom(" ", "\t"), minLength: 1, maxLength: 4 }),
  fc.constant('""'),
  fc.constant("''"),
  identifier.map((n) => `\${${n}}`),
  identifier.map((n) => `env(${n})`),
  fc
    .tuple(
      fc.constantFrom('"', "'"),
      fc.oneof(
        identifier.map((n) => `\${${n}}`),
        identifier.map((n) => `env(${n})`),
      ),
    )
    .map(([q, v]) => `${q}${v}${q}`),
);

/**
 * Non-empty literals: 8–64 printable non-`#` characters, no surrounding whitespace, at least
 * one marker character, and not empty-equivalent.
 */
const literalValue: fc.Arbitrary<string> = fc
  .string({
    unit: printableChar.filter((c) => c !== "#"),
    minLength: 8,
    maxLength: 64,
  })
  .filter(
    (v) => v.trim() === v && [...v].some((c) => MARKER_CHARS.includes(c)) && !isEmptyEquivalent(v),
  );

const trailingComment = fc.option(
  fc.string({ unit: printableChar, maxLength: 20 }).map((t) => ` # ${t}`),
  { nil: undefined },
);

type GenLine = { text: string; key: string | null; literal: string | null };

function injectedLine(keys: readonly string[]): fc.Arbitrary<GenLine> {
  return fc
    .record({
      ws: leadingWs,
      key: fc.constantFrom(...keys),
      form: fc.constantFrom("K=", "K: ", "export K=", "- K=", "- K: "),
      value: fc.oneof(
        emptyValue.map((v) => ({ v, literal: false })),
        literalValue.map((v) => ({ v, literal: true })),
      ),
      comment: trailingComment,
    })
    .map(({ ws, key, form, value, comment }) => ({
      text: `${ws}${form.replace("K", key)}${value.v}${comment ?? ""}`,
      key: value.literal ? key : null,
      literal: value.literal ? value.v : null,
    }));
}

/** Filler lines that cannot match any Panel_Key assignment: they never mention a Panel_Key. */
function fillerLine(keys: readonly string[]): fc.Arbitrary<GenLine> {
  return fc
    .string({ unit: printableChar, maxLength: 60 })
    .filter((t) => keys.every((k) => !t.includes(k)))
    .map((text) => ({ text, key: null, literal: null }));
}

describe("Secret_Check properties", () => {
  // Feature: phase-0-skeleton, Property 5: Secret_Check flags exactly the non-empty assignments and never leaks them
  // Validates: Requirements 12.3, 12.4, 12.7, 9.4, 9.9, 10.12, 14.9
  it("flags exactly the non-empty Panel_Key assignments, in line order, without leaking values", () => {
    const keys = panelKeys();
    expect(keys.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...PATHS),
        fc.array(fc.oneof(fillerLine(keys), injectedLine(keys)), { maxLength: 30 }),
        fc.constantFrom("\n", "\r\n"),
        (path, lines, eol) => {
          const text = lines.map((l) => l.text).join(eol);
          const expected: SecretFinding[] = lines.flatMap((l, i) =>
            l.key === null ? [] : [{ path, lineNo: i + 1, key: l.key }],
          );

          const findings = scanText(path, text, keys);
          expect(findings).toEqual(expected);

          const out = formatFindings(findings);
          for (const l of lines) {
            if (l.literal !== null) expect(out.includes(l.literal)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
