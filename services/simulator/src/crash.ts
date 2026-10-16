// Crash and signal handling (Req 21.3, 21.6, G51). A fatal error writes one entry with no error
// text (the handler never reads the error, its message or its stack) and exits with code 1.
// SIGTERM and SIGINT run the stop path and exit with code 0, which Node as PID 1 needs.
//
// stdout is asynchronous on some platforms (pipes on macOS, for example), so an exit straight
// after the fatal entry could cut that line off. When a `flush` is given, the exit waits until
// stdout has drained, with an unref'd fallback timer that still exits well within 5 s.

export type ProcessEventName = "uncaughtException" | "unhandledRejection" | "SIGTERM" | "SIGINT";

/** The part of `process` the handlers use; `process` itself fits. */
export interface ProcessLike {
  on(event: ProcessEventName, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
  /** Set to 1 before waiting for the flush, so an emptied event loop still ends with code 1. */
  exitCode?: number | string | null | undefined;
}

/** Calls `done` once everything written to stdout so far has been handed to the OS. */
export type FlushStdout = (done: () => void) => void;

/** Upper bound on the wait for stdout to drain after the fatal entry (G51: exit within 5 s). */
export const FATAL_FLUSH_TIMEOUT_MS = 2_000;

/**
 * `onFatal` writes the fatal entry (simulator: `simulator` `crashed`; nothing goes to stderr).
 * `onStop` closes listeners and the broker connection; the process exits once it settles.
 * `flush`, when given, delays the fatal exit until stdout has drained (see above); without it
 * the exit is immediate.
 */
export function installProcessHandlers(
  proc: ProcessLike,
  onFatal: () => void,
  onStop: () => void | Promise<void>,
  flush?: FlushStdout,
): void {
  let fatal = false;
  let stopping = false;
  let exited = false;

  const exitFatal = (): void => {
    if (exited) return;
    exited = true;
    proc.exit(1);
  };

  // The listener takes no parameters, so the error value is never read.
  const handleFatal = (): void => {
    if (fatal) return;
    fatal = true;
    try {
      onFatal();
    } catch {
      // Nothing about the failure is written anywhere.
    }
    if (flush === undefined) {
      exitFatal();
      return;
    }
    proc.exitCode = 1;
    const fallback = globalThis.setTimeout(exitFatal, FATAL_FLUSH_TIMEOUT_MS);
    fallback.unref();
    try {
      flush(exitFatal);
    } catch {
      exitFatal();
    }
  };

  const handleStop = (): void => {
    if (stopping || fatal) return;
    stopping = true;
    Promise.resolve()
      .then(onStop)
      .then(
        () => proc.exit(0),
        () => proc.exit(0),
      );
  };

  proc.on("uncaughtException", handleFatal);
  proc.on("unhandledRejection", handleFatal);
  proc.on("SIGTERM", handleStop);
  proc.on("SIGINT", handleStop);
}
