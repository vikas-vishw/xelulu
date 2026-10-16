// Reconnect backoff (Req 3.4, G32): 1, 2, 4, 8, 16, 30, 30 ... s.

const BASE_MS = 1_000;
const CAP_MS = 30_000;

/** `failedAttempts` is 0 before the first reconnect attempt and resets to 0 after a success. */
export function backoffDelayMs(failedAttempts: number): number {
  const n = Number.isFinite(failedAttempts) && failedAttempts > 0 ? Math.floor(failedAttempts) : 0;
  return Math.min(CAP_MS, BASE_MS * 2 ** n);
}
