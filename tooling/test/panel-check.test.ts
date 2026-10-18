// Panel_Check tests (Req 11). The real-repo block below is required (task 11.6).
// Property tests for Properties 1-4 (tasks 11.2-11.5) follow it.
//
// Secret_Check scans this file, so no line here is a literal Panel_Key assignment. Mutated panel
// text is built at runtime from generated keys and values only.
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPanel, normaliseText, parsePanel, type PanelLine } from "../checks/panel.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PANEL_PATH = resolve(REPO_ROOT, ".env.example");
const APPROVED_PATH = resolve(REPO_ROOT, "tooling/fixtures/approved-panel.txt");

/** 24 since the LAN bring-up wave added DEVICE_BIND_HOST (the only key that wave adds). */
const EXPECTED_KEY_COUNT = 24;

function declaredKeys(text: string): string[] {
  return parsePanel(text)
    .filter((l): l is Extract<PanelLine, { kind: "decl" }> => l.kind === "decl")
    .map((l) => l.key);
}

describe("Panel_Check — real repo", () => {
  // Read once; a missing file fails the suite loudly rather than skipping.
  const panelBytes = readFileSync(PANEL_PATH);
  const approved = readFileSync(APPROVED_PATH, "utf8");

  it("uses an independent reference file, not the panel itself (Req 11.8)", () => {
    expect(APPROVED_PATH).not.toBe(PANEL_PATH);
  });

  it(".env.example is valid UTF-8 with no BOM (Req 11.1)", () => {
    expect([...panelBytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(panelBytes)).not.toThrow();
  });

  it("root .env.example matches the approved panel with no issues (Req 11.3, 11.6)", () => {
    const actual = new TextDecoder("utf-8", { fatal: true }).decode(panelBytes);
    expect(checkPanel(actual, approved)).toEqual([]);
  });

  it(`declares exactly ${EXPECTED_KEY_COUNT} unique keys`, () => {
    const actual = new TextDecoder("utf-8", { fatal: true }).decode(panelBytes);
    const keys = declaredKeys(actual);
    expect(keys).toHaveLength(EXPECTED_KEY_COUNT);
    expect(new Set(keys).size).toBe(EXPECTED_KEY_COUNT);
    expect(declaredKeys(approved)).toEqual(keys);
  });

  it("reports panel_missing when .env.example does not exist (Req 11.11)", () => {
    expect(checkPanel(null, approved)).toEqual([{ kind: "panel_missing" }]);
  });
});

// ---------------------------------------------------------------------------
// Property tests (fast-check). Shared generators and helpers.
// ---------------------------------------------------------------------------

const NUM_RUNS = 200; // ≥ 100 per property (Req 11.9 asks for ≥ 100 per variant kind)

const APPROVED = readFileSync(APPROVED_PATH, "utf8");
const APPROVED_LINES = normaliseText(APPROVED);
const APPROVED_KEYS = declaredKeys(APPROVED);
const APPROVED_KEY_SET = new Set(APPROVED_KEYS);
/** 0-based indices into APPROVED_LINES of every declaration line, in panel order. */
const KEY_LINE_INDICES = parsePanel(APPROVED)
  .filter((l) => l.kind === "decl")
  .map((l) => l.lineNo - 1);

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Printable ASCII (0x20-0x7E) plus tab: single-line text, no CR or LF. */
const PRINTABLE: readonly string[] = [
  "\t",
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)),
];
const PRINTABLE_NO_HASH = PRINTABLE.filter((c) => c !== "#");
const WHITESPACE = [" ", "\t"];

const keyArb = fc.stringMatching(KEY_RE);
const printableArb = (maxLength: number) =>
  fc.string({ unit: fc.constantFrom(...PRINTABLE), maxLength });
const whitespaceArb = fc.string({ unit: fc.constantFrom(...WHITESPACE), maxLength: 8 });

/** Join panel lines with LF and one trailing LF, like the fixture on disk. */
function render(lines: readonly string[]): string {
  return lines.join("\n") + "\n";
}

/** Every key named by a key-level issue (all kinds except panel_missing and line_mismatch). */
function namedKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const issue of checkPanel(text, APPROVED)) {
    if ("key" in issue) keys.add(issue.key);
  }
  return keys;
}

describe("Panel_Check — sanity of the property fixtures", () => {
  it("the approved panel has one declaration line per key", () => {
    expect(KEY_LINE_INDICES).toHaveLength(EXPECTED_KEY_COUNT);
    expect(APPROVED_KEY_SET.size).toBe(EXPECTED_KEY_COUNT);
  });
});

// Feature: phase-0-skeleton, Property 1: Approved panel accepted under any line-ending variant
// Validates: Requirements 11.2, 11.12
describe("Property 1: approved panel accepted under any line-ending variant", () => {
  it("checkPanel returns no issues for LF/CRLF, with or without one trailing EOL", () => {
    fc.assert(
      fc.property(fc.constantFrom("\n", "\r\n"), fc.boolean(), (eol, trailing) => {
        const text = APPROVED_LINES.join(eol) + (trailing ? eol : "");
        expect(checkPanel(text, APPROVED)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: phase-0-skeleton, Property 2: Panel declaration value rule
// Validates: Requirements 11.5, 11.6
describe("Property 2: panel declaration value rule", () => {
  // Bias towards the interesting cases: whitespace-only, and `#` text after `=`.
  const valueArb = fc.oneof(
    printableArb(64),
    whitespaceArb,
    fc.tuple(whitespaceArb, printableArb(16)).map(([ws, rest]) => `${ws}#${rest}`),
  );

  it("KEY=v yields one declaration with value v.trim(), empty iff v is whitespace-only", () => {
    fc.assert(
      fc.property(keyArb, valueArb, (key, v) => {
        const lines = parsePanel(`${key}=${v}`);
        expect(lines).toHaveLength(1);
        const line = lines[0];
        expect(line?.kind).toBe("decl");
        if (line?.kind !== "decl") return;
        expect(line.key).toBe(key);
        expect(line.value).toBe(v.trim());
        expect(line.value === "").toBe(v.trim() === "");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("blank lines and lines whose first non-whitespace character is # yield no declaration", () => {
    const nonDeclArb = fc.oneof(
      whitespaceArb.map((ws) => ({ raw: ws, kind: "blank" as const })),
      fc
        .tuple(whitespaceArb, printableArb(64))
        .map(([ws, rest]) => ({ raw: `${ws}#${rest}`, kind: "comment" as const })),
    );
    fc.assert(
      fc.property(nonDeclArb, ({ raw, kind }) => {
        const lines = parsePanel(raw);
        expect(lines).toHaveLength(1);
        expect(lines[0]?.kind).toBe(kind);
        expect(lines.some((l) => l.kind === "decl")).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// Feature: phase-0-skeleton, Property 3: Every panel mutation is rejected and names its keys
// Validates: Requirements 11.3, 11.4, 11.7, 11.9
type Variant = { text: string; affected: string[] };

const keyIndexArb = fc.integer({ min: 0, max: KEY_LINE_INDICES.length - 1 });
const insertPosArb = fc.integer({ min: 0, max: APPROVED_LINES.length });

/** 1–64 printable non-`#` characters with at least one non-whitespace character. */
const nonEmptyValueArb = fc
  .string({ unit: fc.constantFrom(...PRINTABLE_NO_HASH), minLength: 1, maxLength: 64 })
  .filter((v) => v.trim() !== "");

function keyAt(k: number): { lineIdx: number; key: string } {
  const lineIdx = KEY_LINE_INDICES[k] ?? -1;
  const key = APPROVED_KEYS[k] ?? "";
  return { lineIdx, key };
}

const VARIANTS: Record<string, fc.Arbitrary<Variant>> = {
  "drop one Panel_Key line": keyIndexArb.map((k) => {
    const { lineIdx, key } = keyAt(k);
    const lines = APPROVED_LINES.filter((_, i) => i !== lineIdx);
    return { text: render(lines), affected: [key] };
  }),
  "duplicate one Panel_Key line": fc.tuple(keyIndexArb, insertPosArb).map(([k, pos]) => {
    const { lineIdx, key } = keyAt(k);
    const lines = [...APPROVED_LINES];
    lines.splice(pos, 0, APPROVED_LINES[lineIdx] ?? "");
    return { text: render(lines), affected: [key] };
  }),
  "add a line with a key absent from the panel": fc
    .tuple(
      keyArb.filter((k) => !APPROVED_KEY_SET.has(k)),
      insertPosArb,
    )
    .map(([key, pos]) => {
      const lines = [...APPROVED_LINES];
      lines.splice(pos, 0, `${key}=`);
      return { text: render(lines), affected: [key] };
    }),
  "give one Panel_Key a non-empty value": fc
    .tuple(keyIndexArb, nonEmptyValueArb)
    .map(([k, value]) => {
      const { lineIdx, key } = keyAt(k);
      const lines = [...APPROVED_LINES];
      lines[lineIdx] = `${key}=${value}`;
      return { text: render(lines), affected: [key] };
    }),
  "swap two Panel_Key lines": fc
    .uniqueArray(keyIndexArb, { minLength: 2, maxLength: 2 })
    .map(([k1 = 0, k2 = 1]) => {
      const a = keyAt(k1);
      const b = keyAt(k2);
      const lines = [...APPROVED_LINES];
      lines[a.lineIdx] = APPROVED_LINES[b.lineIdx] ?? "";
      lines[b.lineIdx] = APPROVED_LINES[a.lineIdx] ?? "";
      return { text: render(lines), affected: [a.key, b.key] };
    }),
};

describe.each(Object.keys(VARIANTS))(
  "Property 3: every panel mutation is rejected and names its keys (%s)",
  (kind) => {
    it(`rejects the variant and names every affected key (${NUM_RUNS} runs)`, () => {
      const arb = VARIANTS[kind];
      if (arb === undefined) throw new Error(`unknown variant kind: ${kind}`);
      fc.assert(
        fc.property(arb, ({ text, affected }) => {
          expect(checkPanel(text, APPROVED).length).toBeGreaterThan(0);
          const named = namedKeys(text);
          for (const key of affected) expect(named.has(key)).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  },
);

// Feature: phase-0-skeleton, Property 4: First differing line is reported
// Validates: Requirements 11.10
describe("Property 4: first differing line is reported", () => {
  const lineIdxArb = fc.integer({ min: 0, max: APPROVED_LINES.length - 1 });
  const charArb = fc.constantFrom(...PRINTABLE);

  /** A single-line edit (replace one char, insert one char, or append text) that changes the line. */
  const editArb = fc
    .tuple(
      lineIdxArb,
      fc.constantFrom("replace", "insert", "append"),
      fc.nat(),
      charArb,
      printableArb(16),
    )
    .map(([idx, op, n, ch, tail]) => {
      const line = APPROVED_LINES[idx] ?? "";
      let edited: string;
      if (op === "replace" && line.length > 0) {
        const p = n % line.length;
        edited = line.slice(0, p) + ch + line.slice(p + 1);
      } else if (op === "insert") {
        const p = n % (line.length + 1);
        edited = line.slice(0, p) + ch + line.slice(p);
      } else {
        edited = line + (tail === "" ? ch : tail);
      }
      return { idx, edited };
    })
    .filter(({ idx, edited }) => edited !== APPROVED_LINES[idx]);

  it("a single-line edit at line i reports line_mismatch with lineNo === i", () => {
    fc.assert(
      fc.property(editArb, ({ idx, edited }) => {
        const lines = [...APPROVED_LINES];
        lines[idx] = edited;
        const mismatches = checkPanel(render(lines), APPROVED).filter(
          (i) => i.kind === "line_mismatch",
        );
        expect(mismatches).toEqual([{ kind: "line_mismatch", lineNo: idx + 1 }]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("truncation or extension by whole lines reports lineNo === min(lenA, lenB) + 1", () => {
    const n = APPROVED_LINES.length;
    const reshapeArb = fc.oneof(
      // Truncate to k whole lines (k ≥ 1: an empty file is a different case, not a truncation).
      fc.integer({ min: 1, max: n - 1 }).map((k) => APPROVED_LINES.slice(0, k)),
      // Extend with 1–5 extra lines of printable text (possibly empty).
      fc
        .array(printableArb(32), { minLength: 1, maxLength: 5 })
        .map((extra) => [...APPROVED_LINES, ...extra]),
    );
    fc.assert(
      fc.property(reshapeArb, (lines) => {
        const mismatches = checkPanel(render(lines), APPROVED).filter(
          (i) => i.kind === "line_mismatch",
        );
        const expected = Math.min(lines.length, n) + 1;
        expect(mismatches).toEqual([{ kind: "line_mismatch", lineNo: expected }]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
