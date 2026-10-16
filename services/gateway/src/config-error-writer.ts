// The only stderr lines the gateway ever writes (Req 1.3, 13.8, 21.3). Key names only, never values.

export type LineWriter = (line: string) => void;

const stderrWriter: LineWriter = (line) => {
  process.stderr.write(line);
};

export function formatConfigError(offendingKeys: readonly string[]): string {
  return `gateway config error: ${offendingKeys.join(", ")}\n`;
}

export const LISTEN_ERROR_LINE = "gateway listen error: GATEWAY_OPERATOR_PORT\n";

/** Written once at start-up when the Config is refused; the caller then exits with code 2. */
export function writeConfigError(
  offendingKeys: readonly string[],
  write: LineWriter = stderrWriter,
): void {
  write(formatConfigError(offendingKeys));
}

/** Written when the Operator_Surface port cannot be bound; the caller then exits with code 3. */
export function writeListenError(write: LineWriter = stderrWriter): void {
  write(LISTEN_ERROR_LINE);
}

/**
 * The provider refusal line (Phase 3 Req 1.4, C8). Names the capability and the provider id and
 * nothing else: never a key, never a value, never a vendor URL. Written once at start-up when a
 * provider's declaration is not "no retention, no training"; the caller then exits non-zero with
 * no listener opened.
 */
export function formatProviderError(capability: string, provider: string): string {
  return `gateway provider refused: ${capability} ${provider}\n`;
}

/** Written when a provider cannot declare no retention and no training; caller exits with 4. */
export function writeProviderError(
  capability: string,
  provider: string,
  write: LineWriter = stderrWriter,
): void {
  write(formatProviderError(capability, provider));
}
