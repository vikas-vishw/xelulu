// The single-gate check (Phase 4 Req 12.1, 20.4, C16): no Phase 4 Gateway module may name
// `sendCommand`, so the Device_Policy_Gate in `brain/tools/device-action.ts` is the only path
// from a routine, a reminder, a Grandma playback, a call behaviour or a story step to the broker.
//
// The scan is over the CODE with comment text removed, because three of these modules say in
// prose that they never call it — `routine-scheduler.ts`'s header and its `actions` dependency
// both do, and that sentence is the design decision rather than a violation of it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The five Phase 4 folders under the gateway's `src`, none of which may reach the wire itself. */
const GATED_DIRS: readonly string[] = [
  "services/gateway/src/content",
  "services/gateway/src/grandma",
  "services/gateway/src/routines",
  "services/gateway/src/reports",
  "services/gateway/src/brain/story",
];

/** The one module that owns the sender, named so the ban is a boundary and not a blanket. */
const GATE_MODULE = "services/gateway/src/brain/tools/device-action.ts";

function toRepoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const abs = join(ROOT, dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(`${dir}/${entry.name}`));
    else if (entry.isFile() && extname(abs) === ".ts") out.push(abs);
  }
  return out;
}

/** The source with `//` and `/* *\/` comment text removed; string literals are kept. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
    } else if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += quote;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += source[i] ?? "";
          i += 1;
        }
        out += source[i] ?? "";
        i += 1;
      }
      out += quote;
      i += 1;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

const SEND_NAME = /(?<![\w$])sendCommand(?![\w$])/;

describe("the Device_Policy_Gate is the only path to the wire", () => {
  it("strips comment prose and keeps code and strings", () => {
    const sample = [
      "// this module never calls sendCommand",
      "/* nor does it, per sendCommand */",
      "const name = 'sendCommand';",
      "actions.request(x);",
    ].join("\n");
    const code = stripComments(sample);
    expect(code).not.toContain("never calls");
    expect(code).toContain("actions.request(x);");
    expect(SEND_NAME.test(code)).toBe(true);
  });

  it("names sendCommand in device-action.ts, so the ban below is a boundary", () => {
    expect(SEND_NAME.test(stripComments(readFileSync(join(ROOT, GATE_MODULE), "utf8")))).toBe(true);
  });

  it.each(GATED_DIRS)("%s names no sendCommand outside a comment", (dir) => {
    expect(statSync(join(ROOT, dir)).isDirectory()).toBe(true);
    const files = tsFiles(dir);
    expect(files.length, `${dir} holds no .ts file`).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const abs of files) {
      const code = stripComments(readFileSync(abs, "utf8"));
      if (SEND_NAME.test(code)) offenders.push(toRepoPath(abs));
    }
    expect(
      offenders,
      `these modules name sendCommand instead of going through the gate:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
