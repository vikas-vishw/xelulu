// Parent-app style-prop guard (Phase 2 styling-correctness pass).
//
// NativeWind claims the `style` prop of any element that also carries a `className`: the
// interop builds a fresh props object from the class declarations plus the *inline* ones, and
// `collectInlineRules` only knows how to merge a style object or an array of them. A style
// FUNCTION is spread as an object (contributing nothing) and never invoked, so everything
// expressed inside it — a fill, a shadow, a disabled opacity, a 44 pt touch target — never
// renders on device. A unit test that calls that function itself still passes, which is how the
// pattern survived two phases of review (nativewind issue 1105).
//
// This lives in its own file rather than inside placeholder.test.ts because it needs a
// brace-aware JSX tag reader that the other scans do not: `placeholder.test.ts` reads opening
// tags with `[^>]*`, which stops at the `>` of an `=>` and so cannot see this pattern at all.
// It follows that file's conventions: comment- and string-aware source handling, a non-vacuity
// assertion on the scanned file list, and a detector-sanity case over a synthetic snippet.

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const EXCLUDED_DIRS = new Set(["node_modules", ".expo", "dist"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function toRepoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) out.push(...walk(abs));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(abs))) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * The source with comment text removed and every string, template and single-quoted literal
 * emptied, so a commented-out example and a quoted one cannot trip the detector. Class names
 * are never read for their value here, only for their presence, and no `style` expression in
 * the app is a string, so blanking literals loses nothing this scan needs.
 *
 * Regular-expression literals are not parsed: `/` is only ever read as the start of a comment,
 * and no file under the parent app's `app/` or `src/` holds a regex literal.
 */
function scanCode(source: string): string {
  let code = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") code += "\n";
        i += 1;
      }
      i += 2;
    } else if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        i += 1;
      }
      i += 1;
      code += `${quote}${quote}`;
    } else {
      code += char;
      i += 1;
    }
  }
  return code;
}

type OpenTag = Readonly<{ name: string; attrs: string }>;

/**
 * Every JSX opening tag in comment-free, literal-free code, as its name and its attribute text.
 * Brace-aware, so the `>` of an arrow inside `style={…}` is not read as the end of the tag.
 */
function openTags(code: string): readonly OpenTag[] {
  const out: OpenTag[] = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] !== "<") {
      i += 1;
      continue;
    }
    const head = /^<([A-Za-z][\w.]*)(?=[\s/>])/.exec(code.slice(i));
    if (head === null) {
      i += 1;
      continue;
    }
    let j = i + head[0].length;
    let depth = 0;
    let attrs = "";
    while (j < code.length) {
      const char = code[j];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth <= 0) break;
      attrs += char;
      j += 1;
    }
    out.push({ name: head[1] ?? "", attrs });
    i = j + 1;
  }
  return out;
}

/** The text of a tag's `style={…}` expression, or `null` when it has none. */
function styleExpression(attrs: string): string | null {
  const at = /(?<![\w$])style\s*=\s*\{/.exec(attrs);
  if (at === null) return null;
  let depth = 0;
  let expr = "";
  for (let i = at.index + at[0].length - 1; i < attrs.length; i += 1) {
    const char = attrs[i];
    if (char === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    expr += char;
  }
  return expr.trim();
}

/** Does this expression text start a function literal: arrow or `function`? */
function isFunctionLiteral(expr: string): boolean {
  const text = expr.trim();
  if (/^(?:async\s+)?function\b/.test(text)) return true;
  if (/^(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(text)) return true;
  if (!/^(?:async\s*)?\(/.test(text)) return false;
  // Walk to the parameter list's closing bracket, then look for the arrow after it.
  let depth = 0;
  for (let i = text.indexOf("("); i < text.length; i += 1) {
    const char = text[i];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return /^\s*(?::[^=]*)?=>/.test(text.slice(i + 1));
    }
  }
  return false;
}

/** The index just past the `}` that closes the object literal opening at `open`. */
function endOfBlock(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const char = code[i];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/**
 * Member-qualified names of object-literal properties bound to a function, so
 * `style={PRESS.tint}` is caught where `const PRESS = { tint: ({ pressed }) => … }`. An object
 * of press callbacks is the likeliest way the banned pattern would reappear, and without this
 * the member spelling reads as a plain named value and slips through.
 */
function memberFunctionNames(code: string, object: string, open: number): readonly string[] {
  const close = endOfBlock(code, open);
  const names: string[] = [];
  let depth = 0;
  let atPropertyStart = true;
  for (let i = open; i < close; i += 1) {
    const char = code[i] ?? "";
    if (char === "{" || char === "(" || char === "[") {
      depth += 1;
      atPropertyStart = depth === 1;
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
      continue;
    }
    if (depth !== 1) continue;
    if (char === ",") {
      atPropertyStart = true;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (!atPropertyStart) continue;
    atPropertyStart = false;
    // `key: <value>` or the method shorthand `key(…) { … }`, both of which hold a function.
    const property = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*(:|\()/.exec(code.slice(i, close));
    if (property === null) continue;
    const key = property[1] ?? "";
    if (property[2] === "(") {
      names.push(`${object}.${key}`);
    } else {
      const value = i + property[0].length;
      if (isFunctionLiteral(code.slice(value, value + 400))) names.push(`${object}.${key}`);
    }
  }
  return names;
}

/**
 * Names bound to a function in this file, so `style={tint}` and `style={PRESS.tint}` are caught
 * as well as `style={({ pressed }) => …}`. Only local bindings are resolved; an imported
 * function-valued name cannot be followed across files, which is why the ban is also written as
 * a convention in docs/design-system.md and not left to this scan alone.
 */
function functionNames(code: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1] ?? "");
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const start = match.index + match[0].length;
    const tail = code.slice(start, start + 400);
    if (isFunctionLiteral(tail)) {
      names.add(match[1] ?? "");
    } else if (tail.trimStart().startsWith("{")) {
      for (const name of memberFunctionNames(code, match[1] ?? "", start + tail.indexOf("{"))) {
        names.add(name);
      }
    }
  }
  names.delete("");
  return names;
}

/** `"ClassName + style function"` offenders in one source, as readable lines. */
function styleFunctionOnClassName(source: string): readonly string[] {
  const code = scanCode(source);
  const fns = functionNames(code);
  const offenders: string[] = [];
  for (const tag of openTags(code)) {
    if (!/(?<![\w$])className\s*=/.test(tag.attrs)) continue;
    const expr = styleExpression(tag.attrs);
    if (expr === null) continue;
    const named = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expr);
    const isFunction =
      isFunctionLiteral(expr) || (named && (fns.has(expr) || fns.has(expr.split(".")[0] ?? "")));
    if (isFunction) offenders.push(`<${tag.name} … style={${expr.replace(/\s+/g, " ")}}>`);
  }
  return offenders;
}

describe("parent-app style props", () => {
  describe("detector sanity", () => {
    const FIRES = [
      ['<Pressable className="a" style={({ pressed }) => [x]} />', "arrow, destructured param"],
      ["<Pressable className={c} style={(s) => s} />", "arrow, single param"],
      ["<Pressable className={c} style={s => s} />", "arrow, bare param"],
      ["<Pressable className={c} style={function (s) { return s; }} />", "function expression"],
      [
        'const tint = ({ pressed }) => [p];\n<View className="a" style={tint} />',
        "a variable holding an arrow",
      ],
      [
        'function tint(s) { return s; }\n<View className="a" style={tint} />',
        "a declared function",
      ],
      [
        'const PRESS = { tint: ({ pressed }) => [x] };\n<View className="a" style={PRESS.tint} />',
        "a member holding an arrow",
      ],
      [
        'const PRESS = { tint(s) { return s; } };\n<View className="a" style={PRESS.tint} />',
        "a member holding a method shorthand",
      ],
    ] as const;

    it.each(FIRES)("fires on %s (%s)", (snippet) => {
      expect(styleFunctionOnClassName(snippet)).toHaveLength(1);
    });

    const PASSES = [
      ['<View className="a" style={{ minHeight: 44 }} />', "a static object"],
      ['<View className="a" style={cardShadow} />', "an imported static object"],
      ['<View className="a" style={[cardShadow, { minHeight: 44 }]} />', "a static array"],
      ['<View className="a" style={dotStyle(true)} />', "a call returning a style"],
      [
        'const STYLES = { box: { minHeight: 44 } };\n<View className="a" style={STYLES.box} />',
        "a member holding a static object",
      ],
      ["<Pressable style={({ pressed }) => [x]} />", "a style function with no className"],
      ['<ScrollView className="a" contentContainerStyle={({ x }) => x} />', "another style prop"],
      ['// <View className="a" style={() => 1} />', "a commented-out example"],
      ["const s = \"<View className='a' style={() => 1} />\";", "a quoted example"],
    ] as const;

    it.each(PASSES)("does not fire on %s (%s)", (snippet) => {
      expect(styleFunctionOnClassName(snippet)).toEqual([]);
    });

    it("reads a whole opening tag past the arrow's own `>`", () => {
      const tags = openTags(
        scanCode('<Pressable className="a" style={({ pressed }) => [x]} onPress={f}>'),
      );
      expect(tags).toHaveLength(1);
      expect(tags[0]?.attrs).toContain("onPress");
    });
  });

  // Phase 2 styling-correctness pass: an element may carry a className and a STATIC style
  // object, which NativeWind merges (and which inline specificity lets win), but never a style
  // function, which it drops without invoking.
  it("never gives an element both a className and a style function", () => {
    const paths = [
      ...walk(join(ROOT, "apps/parent-app/app")),
      ...walk(join(ROOT, "apps/parent-app/src")),
    ]
      .map(toRepoPath)
      .sort();

    // Non-vacuity: the scan sees the whole app, and it sees elements carrying both props.
    expect(paths.length).toBeGreaterThan(20);
    expect(paths).toEqual(expect.arrayContaining(["apps/parent-app/src/components/card.tsx"]));
    const withBoth = paths.filter((path) => {
      const code = scanCode(readFileSync(join(ROOT, path), "utf8"));
      return openTags(code).some(
        (tag) => /(?<![\w$])className\s*=/.test(tag.attrs) && styleExpression(tag.attrs) !== null,
      );
    });
    expect(withBoth.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const path of paths) {
      for (const line of styleFunctionOnClassName(readFileSync(join(ROOT, path), "utf8"))) {
        offenders.push(`${path}: ${line}`);
      }
    }
    expect(
      offenders,
      `a className element carries a style function, which NativeWind never invokes:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
