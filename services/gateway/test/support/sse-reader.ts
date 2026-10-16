// Test helper (not a test): a loopback reader for the Operator_Stream (Phase 1.3). It opens a
// request with node:http (no agent, so no pooled socket outlives a test), keeps the raw response
// text and parses complete SSE events as they arrive (comment lines are counted, not returned).
// `waitFor` polls with setImmediate and a real-time limit, so it works under Vitest fake timers
// without moving fake time. Every reader is tracked so `closeAllSseReaders()` in afterEach can
// destroy whatever a test left open.
import { request, type IncomingHttpHeaders } from "node:http";

import { OPERATOR_STREAM_PATH } from "../../src/operator/operator-routes.js";

/** One parsed SSE event: its `event:` name and its `data:` lines joined with "\n". */
export type SseEvent = Readonly<{ name: string; data: string }>;

export type SseOpenOptions = Readonly<{
  method?: string;
  path?: string;
  /** Added to (or, when undefined, removed from) the default `Host: 127.0.0.1:<port>`. */
  headers?: Readonly<Record<string, string | undefined>>;
}>;

export interface SseReader {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  /** Every byte received so far, as UTF-8 text. */
  text(): string;
  /** The complete events received so far, in order. */
  events(): readonly SseEvent[];
  /** The number of complete comment-only blocks (keep-alives) received so far. */
  comments(): number;
  /** True once the response has ended or its socket has closed. */
  ended(): boolean;
  /** Resolves when `cond` holds for the events so far; rejects after `limitMs` of real time. */
  waitFor(cond: (events: readonly SseEvent[]) => boolean, limitMs?: number): Promise<void>;
  /** Resolves once the response has ended or its socket has closed. */
  waitForEnd(limitMs?: number): Promise<void>;
  /** Destroys the request and response. Idempotent. */
  close(): void;
}

const open = new Set<SseReader>();

/** Destroys every reader still open (for afterEach). */
export function closeAllSseReaders(): void {
  for (const reader of [...open]) reader.close();
}

/** Polls `cond` on setImmediate turns until it holds, or rejects after `limitMs` of real time. */
export async function pollUntil(cond: () => boolean, limitMs = 5_000): Promise<void> {
  const deadline = performance.now() + limitMs;
  while (!cond()) {
    if (performance.now() > deadline) throw new Error("condition not reached in time");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Parses one SSE block; null for a comment-only block. */
function parseBlock(block: string): SseEvent | null {
  let name = "message";
  const data: string[] = [];
  let field = false;
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    field = true;
    if (line.startsWith("event: ")) name = line.slice("event: ".length);
    else if (line.startsWith("data: ")) data.push(line.slice("data: ".length));
  }
  return field ? { name, data: data.join("\n") } : null;
}

/** Opens a stream request and resolves once the response headers arrive (any status). */
export function openSse(port: number, opts: SseOpenOptions = {}): Promise<SseReader> {
  const headers: Record<string, string> = { Host: `127.0.0.1:${port}` };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing];
    }
    if (v !== undefined) headers[k] = v;
  }

  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path ?? OPERATOR_STREAM_PATH,
        headers,
        agent: false,
      },
      (res) => {
        let raw = "";
        let buffer = "";
        let comments = 0;
        let done = false;
        const events: SseEvent[] = [];

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          raw += chunk;
          buffer += chunk;
          let cut = buffer.indexOf("\n\n");
          while (cut !== -1) {
            const parsed = parseBlock(buffer.slice(0, cut));
            if (parsed === null) comments += 1;
            else events.push(parsed);
            buffer = buffer.slice(cut + 2);
            cut = buffer.indexOf("\n\n");
          }
        });
        const finish = (): void => {
          done = true;
          open.delete(reader);
        };
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", () => undefined);

        const reader: SseReader = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: () => raw,
          events: () => events,
          comments: () => comments,
          ended: () => done,
          waitFor: (cond, limitMs) => pollUntil(() => cond(events), limitMs),
          waitForEnd: (limitMs) => pollUntil(() => done, limitMs),
          close() {
            res.destroy();
            outgoing.destroy();
            finish();
          },
        };
        open.add(reader);
        resolve(reader);
      },
    );
    outgoing.on("error", (err) => reject(err));
    outgoing.end();
  });
}

/** The `seq` of an `entry` event's data. */
export function entrySeq(event: SseEvent): number {
  return (JSON.parse(event.data) as { seq: number }).seq;
}
