// The only stderr line the simulator ever writes (Req 1.3, 21.3). Key names only, never values.

export type LineWriter = (line: string) => void;

const stderrWriter: LineWriter = (line) => {
  process.stderr.write(line);
};

export function formatConfigError(offendingKeys: readonly string[]): string {
  return `simulator config error: ${offendingKeys.join(", ")}\n`;
}

/** Written once at start-up when the Config is refused; the caller then exits with code 2. */
export function writeConfigError(
  offendingKeys: readonly string[],
  write: LineWriter = stderrWriter,
): void {
  write(formatConfigError(offendingKeys));
}
