// Non-local URL detector (Req 12.6, 5.10; design Property 10).
// Pure: takes a path (for reporting) and the file text. No filesystem access.
//
// A URL is flagged when its scheme is a connection scheme and its host is not a
// loopback host. Lines that start with a comment marker are skipped (documentation
// links are permitted), and so is the value of a `$schema` key.
// Findings carry the host only, never userinfo, port, path or query.

export type UrlFinding = { path: string; lineNo: number; host: string }; // host only, never userinfo or path

export const URL_SCHEMES = [
  "http",
  "https",
  "ws",
  "wss",
  "mqtt",
  "mqtts",
  "postgres",
  "postgresql",
] as const;

export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

// `//`, `#`, `*` and `--` per design Property 10; `/*` and `<!--` are block-comment
// openers and are treated the same way.
const COMMENT_PREFIXES = ["//", "#", "*", "--", "/*", "<!--"] as const;

// Scheme followed by `://`. The look-behind stops matches inside a longer word.
const URL_START = new RegExp(`(?<![A-Za-z0-9])(?:${URL_SCHEMES.join("|")}):\\/\\/`, "gi");

// A `$schema` key (JSON, YAML, TOML or JS style) followed by its separator.
const SCHEMA_KEY = /["']?\$schema["']?\s*[:=]\s*/;

// Characters that end the authority part of a URL.
const AUTHORITY_STOP = /[\s/?#"'`<>\\(),;{}]/;

// A whole-host environment-variable reference, e.g. `${SUPABASE_HOST}` (permitted by Req 12.6).
const ENV_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

export function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function isLocalHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (LOCAL_HOSTS as readonly string[]).includes(lower);
}

/** Reads the authority starting at `from`; `${NAME}` references are kept whole. */
function readAuthority(line: string, from: number): string {
  let i = from;
  while (i < line.length) {
    if (line.startsWith("${", i)) {
      const close = line.indexOf("}", i + 2);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    if (AUTHORITY_STOP.test(line.charAt(i))) break;
    i++;
  }
  return line.slice(from, i);
}

/** Extracts the host from an authority: drops userinfo and port. */
function hostOf(authority: string): string {
  const afterUserinfo = authority.slice(authority.lastIndexOf("@") + 1);
  if (afterUserinfo.startsWith("[")) {
    const close = afterUserinfo.indexOf("]");
    return close === -1 ? afterUserinfo : afterUserinfo.slice(0, close + 1);
  }
  const colon = afterUserinfo.indexOf(":");
  const host = colon === -1 ? afterUserinfo : afterUserinfo.slice(0, colon);
  // Trailing sentence or markdown punctuation is not part of the host.
  return host.replace(/[.\]]+$/, "");
}

/** Returns every non-local connection URL in `text`, in order, with 1-based line numbers. */
export function findNonLocalUrls(path: string, text: string): UrlFinding[] {
  const findings: UrlFinding[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;

    // The first URL after a `$schema` key is that key's value and is permitted.
    const schemaKey = SCHEMA_KEY.exec(line);
    const schemaValueStart = schemaKey ? schemaKey.index + schemaKey[0].length : -1;
    let schemaValueSkipped = false;

    URL_START.lastIndex = 0;
    for (let m = URL_START.exec(line); m !== null; m = URL_START.exec(line)) {
      if (!schemaValueSkipped && schemaValueStart !== -1 && m.index >= schemaValueStart) {
        schemaValueSkipped = true;
        continue;
      }

      const host = hostOf(readAuthority(line, m.index + m[0].length));
      if (host === "" || isLocalHost(host) || ENV_REFERENCE.test(host)) continue;

      findings.push({ path, lineNo: index + 1, host });
    }
  });

  return findings;
}
