// Non-local URL checks (Req 12.6, 5.10; design Property 10).
// The real-repo part runs `findNonLocalUrls` over every tracked or untracked-but-not-ignored
// source, Dockerfile and config file. Findings print as `path:line host` only.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { findNonLocalUrls, URL_SCHEMES, type UrlFinding } from "../checks/url-scan.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * Files the real-repo scan skips, each with the reason it is out of scope for Req 12.6.
 * Everything else that git lists is scanned, including docker-compose.yml, supabase/config.toml,
 * .env.example and the tooling sources. Comment lines and `$schema` values are skipped by the
 * detector itself, not here.
 */
const EXCLUSIONS: readonly { reason: string; matches: (path: string) => boolean }[] = [
  {
    // Req 12.6 permits package registry URLs in the pnpm lockfile.
    reason: "pnpm lockfile (registry and tarball URLs)",
    matches: (p) => p === "pnpm-lock.yaml",
  },
  {
    // Source documents and specs: they describe hosts, they are not runtime connection URLs.
    reason: "documentation and specs",
    matches: (p) => p.startsWith("docs/") || p.startsWith(".kiro/"),
  },
  {
    // Req 12.6 covers source, Dockerfile and config files. Markdown is documentation (README
    // links to the EMQX docs, for example) and is never loaded by any package at runtime.
    reason: "Markdown documentation",
    matches: (p) => p.toLowerCase().endsWith(".md"),
  },
  {
    // Test inputs: generated or example URLs that exercise the checks, never connected to.
    reason: "test files",
    matches: (p) => p.startsWith("tooling/test/") || /^[^/]+\/[^/]+\/test\//.test(p),
  },
];

/**
 * The two local-only files that carry the Local_Mode defaults for `docker compose up`, and the
 * only two hosts they may name: `emqx` and `gateway` are Compose service names, resolvable on
 * the Compose network alone — neither loopback nor reachable from the internet, so Req 12.6
 * has no form they can be written in. They are deliberately NOT added to `EXCLUSIONS`: both
 * files stay in the scan, and any other non-local host in them still fails.
 *
 * The detector (`tooling/checks/url-scan.ts`) is untouched.
 */
const LOCAL_DEFAULT_FILES: ReadonlySet<string> = new Set([
  "docker-compose.yml",
  ".env.local.example",
]);
const LOCAL_SERVICE_HOSTS: ReadonlySet<string> = new Set(["emqx", "gateway"]);

/** True for the one finding shape the two local-only files are allowed to produce. */
function isLocalServiceDefault(finding: UrlFinding): boolean {
  return LOCAL_DEFAULT_FILES.has(finding.path) && LOCAL_SERVICE_HOSTS.has(finding.host);
}

/** Tracked plus untracked-but-not-ignored files, as repo-relative `/` paths. Fails without git. */
function listRepoFiles(): string[] {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) {
    throw new Error("git is required for the URL scan");
  }
  return [...new Set(res.stdout.split("\0").filter((p) => p.length > 0))];
}

/** Reads a file for scanning; null if it is binary (NUL in the first 8 KiB) or no longer exists. */
function readTextFile(relPath: string): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(join(REPO_ROOT, relPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  return buf.toString("utf8");
}

function format(findings: readonly UrlFinding[]): string {
  return findings.map((f) => `${f.path}:${f.lineNo} ${f.host}`).join("\n");
}

describe("real repo: non-local URLs", () => {
  it("no source, Dockerfile or config file holds a non-local connection URL", () => {
    const files = listRepoFiles().filter((p) => !EXCLUSIONS.some((e) => e.matches(p)));

    const scanned: string[] = [];
    const findings: UrlFinding[] = [];
    for (const file of files) {
      const text = readTextFile(file);
      if (text === null) continue;
      scanned.push(file);
      findings.push(...findNonLocalUrls(file, text));
    }

    // Guard against a scan that silently covers nothing. The two local-default files are named
    // here too, so they can never silently drop out of scope.
    expect(scanned).toEqual(
      expect.arrayContaining([
        ".env.example",
        ".env.local.example",
        "docker-compose.yml",
        "package.json",
        "apps/admin/index.html",
        "apps/admin/vite.config.ts",
        "apps/parent-app/app.json",
        "services/gateway/src/index.ts",
        "services/simulator/src/index.ts",
        "supabase/config.toml",
      ]),
    );
    expect(LOCAL_DEFAULT_FILES.size).toBe(2);
    expect(LOCAL_SERVICE_HOSTS.size).toBe(2);

    const reportable = findings.filter((f) => !isLocalServiceDefault(f));
    expect(reportable, `Non-local URLs found:\n${format(reportable)}`).toEqual([]);
  });
});

describe("findNonLocalUrls examples", () => {
  it("reports only the host, never userinfo, port, path or query", () => {
    expect(
      findNonLocalUrls("a.ts", 'const u = "postgres://user:pw@db.example.com:5432/app?ssl=1";'),
    ).toEqual([{ path: "a.ts", lineNo: 1, host: "db.example.com" }]);
  });

  it("allows loopback hosts, comment lines and $schema values", () => {
    const text = [
      'const a = "http://localhost:5173/";',
      'const b = "mqtt://127.0.0.1:1883";',
      'const c = "ws://[::1]:8083/mqtt";',
      "# see https://docs.example.com/page",
      '  "$schema": "https://json.example.com/schema.json",',
    ].join("\n");
    expect(findNonLocalUrls("b.json", text)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property 10. The oracle for "local" is this list, written out independently of the detector.

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

const scheme = fc.constantFrom(...URL_SCHEMES);

const label = fc.stringMatching(/^[a-z0-9]{1,10}(?:-[a-z0-9]{1,10})?$/);
const domainHost = fc
  .array(label, { minLength: 1, maxLength: 4 })
  .map((ls) => ls.join("."))
  .filter((h) => !LOCAL.has(h));

const ipv4Host = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map((o) => o.join("."))
  .filter((h) => !LOCAL.has(h));

const ipv6Host = fc.stringMatching(/^[0-9a-f]{1,4}$/).map((g) => `[2001:db8::${g}]`);

/** Hosts that look local but are not. */
const nearMissHost = fc.constantFrom(
  "localhost.example.com",
  "my-localhost",
  "127.0.0.1.nip.io",
  "127.0.0.10",
  "127.0.0.2",
  "[::2]",
);

const nonLocalHost = fc.oneof(domainHost, ipv4Host, ipv6Host, nearMissHost);
const localHost = fc.constantFrom(...LOCAL);
const host = fc.oneof(nonLocalHost, localHost);

/** Optional URL part: absent parts are the empty string. */
const NONE = { nil: "" } as const;

const userinfoPart = fc.stringMatching(/^[a-z0-9]{1,8}(?::[a-z0-9]{1,8})?$/).map((u) => `${u}@`);
const portPart = fc.integer({ min: 1, max: 65535 }).map((p) => `:${p}`);
const pathQueryPart = fc.stringMatching(
  /^(?:\/[a-z0-9-]{0,8}){1,3}(?:\?[a-z]{1,5}=[a-z0-9]{0,5})?(?:#[a-z]{0,5})?$/,
);

const userinfo = fc.option(userinfoPart, NONE);
const port = fc.option(portPart, NONE);
const pathQuery = fc.option(pathQueryPart, NONE);

const url = fc.record({ scheme, userinfo, host, port, pathQuery }).map((u) => ({
  text: `${u.scheme}://${u.userinfo}${u.host}${u.port}${u.pathQuery}`,
  host: u.host,
}));

/**
 * Code around a URL: no `/`, `-`, `#`, `*`, `<` or `$`, so a code line never starts with a
 * comment marker, never holds a `$schema` key and never holds a second URL.
 */
const codeText = fc.string({
  unit: fc.constantFrom(..."abcXYZ019 _=(),.;:".split("")),
  maxLength: 20,
});
const indent = fc.string({ unit: fc.constantFrom(" ", "\t"), maxLength: 4 });
const quote = fc.constantFrom('"', "'", "`");

type GenLine = { text: string; flaggedHost: string | null };

const codeLine: fc.Arbitrary<GenLine> = fc
  .record({ ws: indent, pre: codeText, q: quote, url, post: codeText })
  .map(({ ws, pre, q, url: u, post }) => ({
    text: `${ws}${pre}${q}${u.text}${q}${post}`,
    flaggedHost: LOCAL.has(u.host) ? null : u.host,
  }));

const commentLine: fc.Arbitrary<GenLine> = fc
  .record({
    ws: indent,
    marker: fc.constantFrom("//", "#", "*", "--"),
    pre: codeText,
    url,
  })
  .map(({ ws, marker, pre, url: u }) => ({
    text: `${ws}${marker} ${pre} ${u.text}`,
    flaggedHost: null,
  }));

const schemaLine: fc.Arbitrary<GenLine> = fc
  .record({ ws: indent, json: fc.boolean(), url })
  .map(({ ws, json, url: u }) => ({
    text: json ? `${ws}"$schema": "${u.text}",` : `${ws}$schema: ${u.text}`,
    flaggedHost: null,
  }));

const plainLine: fc.Arbitrary<GenLine> = codeText.map((text) => ({ text, flaggedHost: null }));

describe("URL detector properties", () => {
  // Feature: phase-0-skeleton, Property 10: Non-local URL detector
  // Validates: Requirements 12.6, 5.10
  it("flags exactly the non-local URLs on code lines, reporting the host only", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("src/a.ts", "config.toml", "docker-compose.yml", "app.json"),
        fc.array(fc.oneof(codeLine, commentLine, schemaLine, plainLine), { maxLength: 20 }),
        fc.constantFrom("\n", "\r\n"),
        (path, lines, eol) => {
          const text = lines.map((l) => l.text).join(eol);
          const expected: UrlFinding[] = lines.flatMap((l, i) =>
            l.flaggedHost === null ? [] : [{ path, lineNo: i + 1, host: l.flaggedHost }],
          );

          expect(findNonLocalUrls(path, text)).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
