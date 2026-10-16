// The only module in the gateway that writes to stdout (Req 12.8, 21.7): one JSON line per entry.

export interface LineSink {
  writeLine(json: string): void;
}

export const stdoutSink: LineSink = {
  writeLine(json) {
    process.stdout.write(json + "\n");
  },
};

/**
 * Calls `done` once every line written so far has left the process: an empty write is queued
 * behind them, and its callback runs after they are flushed. Used before a fatal exit.
 */
export function flushStdout(done: () => void): void {
  process.stdout.write("", () => done());
}
