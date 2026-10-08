// Panel_Check core (Req 11.2–11.12). Pure functions only: no filesystem access.
// Loaders in tooling/test read `.env.example` and the approved fixture and pass the text in.
// No issue ever carries a declared value, so a failing check cannot leak a secret.

export type PanelLine =
  | { kind: "blank" | "comment"; lineNo: number; raw: string }
  // A non-blank, non-comment line that is not a `NAME=` declaration. It declares nothing;
  // against the approved panel it always shows up as a line_mismatch.
  | { kind: "other"; lineNo: number; raw: string }
  | { kind: "decl"; lineNo: number; raw: string; key: string; value: string }; // value = text after "=", trimmed

export type PanelIssue =
  | { kind: "panel_missing" }
  | { kind: "line_mismatch"; lineNo: number } // 1-based, first differing line (Req 11.10)
  | { kind: "missing_key"; key: string }
  | { kind: "unknown_key"; key: string }
  | { kind: "duplicate_key"; key: string }
  | { kind: "out_of_order"; key: string }
  | { kind: "non_empty_value"; key: string; lineNo: number }; // never carries the value

// `s` flag so a stray lone CR inside a line is still part of the value, not a parse failure.
const DECL_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const COMMENT_RE = /^\s*#/;

/** CRLF → LF, drop one trailing EOL, split into lines. */
export function normaliseText(text: string): string[] {
  let t = text.replace(/\r\n/g, "\n");
  if (t.endsWith("\n")) t = t.slice(0, -1);
  return t.split("\n");
}

/** Classify every line (1-based `lineNo`). The value is all text after `=`, trimmed (Req 11.5). */
export function parsePanel(text: string): PanelLine[] {
  return normaliseText(text).map((raw, i): PanelLine => {
    const lineNo = i + 1;
    if (raw.trim() === "") return { kind: "blank", lineNo, raw };
    if (COMMENT_RE.test(raw)) return { kind: "comment", lineNo, raw };
    const m = DECL_RE.exec(raw);
    if (m === null) return { kind: "other", lineNo, raw };
    return { kind: "decl", lineNo, raw, key: m[1] ?? "", value: (m[2] ?? "").trim() };
  });
}

function declsOf(lines: readonly PanelLine[]): Extract<PanelLine, { kind: "decl" }>[] {
  return lines.filter((l): l is Extract<PanelLine, { kind: "decl" }> => l.kind === "decl");
}

/**
 * Compare the Connection_Panel text with the Approved_Panel text.
 * Returns [] on pass. `actual === null` means `.env.example` does not exist (Req 11.11).
 */
export function checkPanel(actual: string | null, approved: string): PanelIssue[] {
  if (actual === null) return [{ kind: "panel_missing" }];

  const issues: PanelIssue[] = [];

  // Line-by-line comparison; only LF/CRLF and one trailing EOL are tolerated (Req 11.2, 11.10, 11.12).
  const a = normaliseText(actual);
  const b = normaliseText(approved);
  const common = Math.min(a.length, b.length);
  let mismatch: number | null = null;
  for (let i = 0; i < common; i++) {
    if (a[i] !== b[i]) {
      mismatch = i + 1;
      break;
    }
  }
  if (mismatch === null && a.length !== b.length) mismatch = common + 1;
  if (mismatch !== null) issues.push({ kind: "line_mismatch", lineNo: mismatch });

  // Key-level checks (Req 11.3–11.7).
  const actualDecls = declsOf(parsePanel(actual));
  const approvedKeys = declsOf(parsePanel(approved)).map((d) => d.key);
  const approvedSet = new Set(approvedKeys);

  const counts = new Map<string, number>();
  for (const d of actualDecls) counts.set(d.key, (counts.get(d.key) ?? 0) + 1);

  for (const key of approvedKeys) {
    if (!counts.has(key)) issues.push({ kind: "missing_key", key });
  }
  for (const key of counts.keys()) {
    if (!approvedSet.has(key)) issues.push({ kind: "unknown_key", key });
  }
  for (const [key, n] of counts) {
    if (n > 1) issues.push({ kind: "duplicate_key", key });
  }

  // Order: first occurrences of approved keys, compared position by position with the approved
  // order restricted to the keys that are present. A swap of two keys names both of them.
  const seen = new Set<string>();
  const declaredOrder: string[] = [];
  for (const d of actualDecls) {
    if (approvedSet.has(d.key) && !seen.has(d.key)) {
      seen.add(d.key);
      declaredOrder.push(d.key);
    }
  }
  const expectedOrder = approvedKeys.filter((k) => seen.has(k));
  declaredOrder.forEach((key, i) => {
    if (expectedOrder[i] !== key) issues.push({ kind: "out_of_order", key });
  });

  for (const d of actualDecls) {
    if (d.value !== "") issues.push({ kind: "non_empty_value", key: d.key, lineNo: d.lineNo });
  }

  return issues;
}
