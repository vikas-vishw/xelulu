// No raw child audio is written anywhere (Phase 3 Req 14.4, 21.1; safety.md §1). The structural
// half of the promise: both service trees are scanned for a file-writing API (the existing Req
// 21.1 rule) and for a byte-typed value outside the modules allowed to touch a frame.
//
// The detector is self-tested first, on inline fixtures, because a scan that cannot fire is worse
// than no scan: it reads as a guarantee and provides none. Then the real trees are scanned, with
// an assertion that the scan actually looked at a non-empty set of files.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AUDIO_BYTE_MODULES,
  WIRE_BYTE_MODULES,
  findAudioByteUse,
} from "../checks/audio-retention.js";
import { findFileWrites, formatSourceFindings } from "../checks/service-sources.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every `.ts` under a directory, recursively, as repo-relative forward-slash paths. */
function sourcesUnder(relative: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".ts")) out.push(next);
    }
  };
  walk(relative);
  return out;
}

const FILES = [...sourcesUnder("services/gateway/src"), ...sourcesUnder("services/simulator/src")];

describe("the detector fires on what it claims to catch", () => {
  it("catches a byte-typed value outside the allow-list", () => {
    const found = findAudioByteUse(
      "services/gateway/src/brain/sneaky.ts",
      `function keep(frame: Uint8Array) { return frame; }`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("audio_bytes");
  });

  it("catches a Buffer too, and by type rather than by name", () => {
    // A frame renamed `blob` would slip a name-based scan; the type is what gives it away.
    expect(
      findAudioByteUse("services/gateway/src/x.ts", `let blob: Buffer | null = null;`),
    ).toHaveLength(1);
  });

  it("stays quiet for an allow-listed module", () => {
    expect(
      findAudioByteUse(
        "services/gateway/src/audio/audio-turn.ts",
        `function push(frame: Uint8Array) { return frame; }`,
      ),
    ).toEqual([]);
  });

  it("stays quiet for a control-plane module, whose bytes are a payload not a frame", () => {
    expect(
      findAudioByteUse(
        "services/gateway/src/mqtt/mqtt-transport.ts",
        `onMessage(fn: (topic: string, payload: Uint8Array) => void): void;`,
      ),
    ).toEqual([]);
  });

  it("stays quiet for prose: a comment is not code", () => {
    const source = [
      "// A Uint8Array never reaches here.",
      "/* Buffer is named in this block comment only. */",
      "const x = 1;",
    ].join("\n");
    expect(findAudioByteUse("services/gateway/src/x.ts", source)).toEqual([]);
  });

  it("reports every offending line, not just the first", () => {
    const source = `let a: Uint8Array;\nconst b = 1;\nlet c: Buffer;`;
    expect(findAudioByteUse("services/gateway/src/x.ts", source).map((f) => f.lineNo)).toEqual([
      1, 3,
    ]);
  });
});

describe("both service trees", () => {
  it("were actually scanned", () => {
    // Non-vacuity: a scan over an empty list passes trivially and proves nothing.
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES).toContain("services/gateway/src/audio/audio-turn.ts");
    expect(FILES).toContain("services/simulator/src/audio/audio-turn-client.ts");
  });

  it("write to no file anywhere", () => {
    const findings = FILES.flatMap((path) =>
      findFileWrites(path, readFileSync(join(REPO_ROOT, path), "utf8")),
    );
    expect(findings, `File writes:\n${formatSourceFindings(findings)}`).toEqual([]);
  });

  it("hold a byte-typed value only in the allow-listed modules", () => {
    const findings = FILES.flatMap((path) =>
      findAudioByteUse(path, readFileSync(join(REPO_ROOT, path), "utf8")),
    );
    expect(
      findings,
      `Audio bytes outside the allow-list:\n${formatSourceFindings(findings)}`,
    ).toEqual([]);
  });

  it("keeps both lists honest: every entry is a real source file", () => {
    for (const entry of [...AUDIO_BYTE_MODULES, ...WIRE_BYTE_MODULES]) {
      expect(FILES, `${entry} is allow-listed but not on disk`).toContain(entry);
    }
  });

  it("keeps the two lists apart: no module is both audio and control plane", () => {
    // A module in both lists would be a module nobody has classified.
    const both = AUDIO_BYTE_MODULES.filter((entry) => WIRE_BYTE_MODULES.includes(entry));
    expect(both).toEqual([]);
  });
});
