// Test helper (not a test): a LineSink that keeps every line, for leak scans and round-trip checks.
// Copied from the gateway's test support (services and their tests never import each other).
import type { LineSink } from "../../src/log/logger.js";

export interface CaptureSink extends LineSink {
  readonly lines: readonly string[];
  /** All lines joined with "\n", as they would appear on stdout. */
  text(): string;
  clear(): void;
}

export function createCaptureSink(): CaptureSink {
  const lines: string[] = [];
  return {
    lines,
    writeLine(json) {
      lines.push(json);
    },
    text: () => lines.join("\n"),
    clear() {
      lines.length = 0;
    },
  };
}
