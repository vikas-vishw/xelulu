// Env-read detector (Req 12.5, 12.8; design Property 8).
// Pure: takes source text, returns every environment read it can see. No filesystem access.
//
// Detected forms:
//   process.env.NAME, process.env?.NAME
//   process.env["NAME"], process.env['NAME'], process.env[`NAME`] (no `${}`)
//   import.meta.env.NAME, import.meta.env["NAME"]
// Any other use of process.env / import.meta.env (destructuring, computed keys,
// spreading, passing the object around) is reported with `name: null`, so a caller
// can fail on it: the name it reads cannot be checked statically.
//
// Matching is deliberately conservative: it does not try to skip comments or strings,
// so a mention inside either is still reported.

export type EnvRead = { lineNo: number; name: string | null }; // null = destructuring / computed access

// The env object itself: `process.env`, `process?.env`, `process["env"]`, `import.meta.env`.
// The look-behind/look-ahead stop matches inside longer identifiers (`myprocess`, `envelope`).
const ENV_OBJECT =
  /(?<![\w$])(?:process\s*(?:\?\.|\.)\s*env|process\s*(?:\?\.)?\s*\[\s*(["'`])env\1\s*\]|import\s*\.\s*meta\s*(?:\?\.|\.)\s*env)(?![\w$])/g;

// Static member access straight after the env object: `.NAME` or `?.NAME`.
const DOT_ACCESS = /\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/y;

// Static bracket access straight after the env object, with a plain literal key.
// Keys containing escapes or template expressions fall through to `null`.
const BRACKET_ACCESS = /\s*(?:\?\.)?\s*\[\s*(?:"([^"\\\r\n]*)"|'([^'\\\r\n]*)'|`([^`\\$]*)`)\s*\]/y;

function staticName(source: string, from: number): string | null {
  DOT_ACCESS.lastIndex = from;
  const dot = DOT_ACCESS.exec(source);
  if (dot) return dot[1] ?? null;

  BRACKET_ACCESS.lastIndex = from;
  const bracket = BRACKET_ACCESS.exec(source);
  if (bracket) return bracket[1] ?? bracket[2] ?? bracket[3] ?? null;

  return null;
}

/** Returns every env read in `source`, in source order, with 1-based line numbers. */
export function findEnvReads(source: string): EnvRead[] {
  const reads: EnvRead[] = [];
  let lineNo = 1;
  let scanned = 0;

  ENV_OBJECT.lastIndex = 0;
  for (let m = ENV_OBJECT.exec(source); m !== null; m = ENV_OBJECT.exec(source)) {
    for (let i = scanned; i < m.index; i++) {
      if (source.charCodeAt(i) === 10) lineNo++;
    }
    scanned = m.index;
    reads.push({ lineNo, name: staticName(source, m.index + m[0].length) });
  }

  return reads;
}
