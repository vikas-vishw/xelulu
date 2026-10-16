// Operator_Stream hub (Phase 1.3 C2, C12, Req 1.2–1.4, 1.7–1.10, 2.1; Phase 3 Req 18.2, 18.6).
// Pure: no network import. It owns the stream count, SSE formatting, Device_Summary change
// detection and keep-alive timers. The transport in transport/http-listener.ts gives it one
// StreamSink per open response.
// Each stream: a `devices` event, then the Gateway_Log backlog and later entries as `entry`
// events, then one `turn` event per retained Conversation_Turn_View, a fresh `devices` event
// after any entry that changed a summary, later views as `turn` events, and a comment line
// every 15 s. A stream is closed when more than 1 MiB is unsent. The hub only reads: it changes
// no Gateway state and publishes nothing (Req 1.10). No view reaches stdout or a Log_Entry: the
// `turn` event is this channel's only exit (Phase 3 Req 18.6).
import type {
  ConversationTurnView,
  DeviceSummary,
  GatewayLogEntry,
  OperatorStreamEvent,
} from "@xelulu/shared";

import type { Clock, TimerHandle } from "../clock.js";
import type { GatewayLog } from "../log/gateway-log.js";
import { errorResponse, type HttpResponseOut } from "./operator-routes.js";

export const OPERATOR_STREAM_LIMITS = Object.freeze({
  maxStreams: 4,
  maxPendingBytes: 1_048_576,
  keepAliveMs: 15_000,
});

/** What the transport gives the hub for one open response. */
export type StreamSink = Readonly<{
  /** The first write sends the 200 status and stream headers. */
  write(chunk: string): void;
  /** Bytes written but not yet flushed to the socket. */
  pending(): number;
  /** Ends the response. Idempotent. */
  end(): void;
  /**
   * Registers the stream's close for when the client goes away (Req 1.9). The transport calls
   * it once, on the response's `close` event, or at once if the response is already closed.
   */
  onClose?(fn: () => void): void;
}>;

export type StreamOpen =
  { readonly ok: true; close(): void } | { readonly ok: false; readonly refusal: HttpResponseOut };

export interface OperatorStreams {
  open(sink: StreamSink): StreamOpen;
  /** Sends one `turn` event, carrying `view`, on every open stream (Phase 3 Req 18.2). */
  publishTurn(view: ConversationTurnView): void;
  closeAll(): void;
}

export type OperatorStreamDeps = Readonly<{
  log: Pick<GatewayLog, "subscribe">;
  summaries: () => readonly DeviceSummary[];
  /** The retained Conversation_Turn_Views, oldest first, for a new stream's backlog (D1). */
  views: () => readonly ConversationTurnView[];
  clock: Clock;
}>;

/** One SSE event: `event: <name>\ndata: <json>\n\n`. JSON.stringify output has no line break. */
export function sseEvent(name: OperatorStreamEvent, json: string): string {
  return `event: ${name}\ndata: ${json}\n\n`;
}

/** The SSE comment line that keeps idle proxies from closing the stream (Req 1.4). */
export const SSE_KEEP_ALIVE = ": keep-alive\n\n";

/** One open stream, as the hub holds it: how to end it, and how to send it a `turn` event. */
type OpenStream = Readonly<{ close: () => void; sendTurn: (json: string) => void }>;

export function createOperatorStreams(deps: OperatorStreamDeps): OperatorStreams {
  /** Every open stream. `sendTurn` goes through the same guarded write as every other event. */
  const openStreams = new Set<OpenStream>();

  const devicesJson = (): string => JSON.stringify({ devices: deps.summaries() });

  function open(sink: StreamSink): StreamOpen {
    if (openStreams.size >= OPERATOR_STREAM_LIMITS.maxStreams) {
      return { ok: false, refusal: errorResponse(503, "too_many_streams") };
    }

    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let timer: TimerHandle | null = null;

    function close(): void {
      if (closed) return;
      closed = true;
      openStreams.delete(record);
      if (unsubscribe !== null) unsubscribe();
      unsubscribe = null;
      if (timer !== null) deps.clock.clearTimer(timer);
      timer = null;
      sink.end();
    }

    /** Writes one chunk; closes the stream on a throwing write or more than 1 MiB pending. */
    function write(chunk: string): void {
      if (closed) return;
      try {
        sink.write(chunk);
      } catch {
        // The error text could hold anything, so it is dropped with the stream.
        close();
        return;
      }
      if (sink.pending() > OPERATOR_STREAM_LIMITS.maxPendingBytes) close();
    }

    function armKeepAlive(): void {
      timer = deps.clock.setTimer(() => {
        timer = null;
        if (closed) return;
        armKeepAlive();
        write(SSE_KEEP_ALIVE);
      }, OPERATOR_STREAM_LIMITS.keepAliveMs);
    }

    const record: OpenStream = {
      close,
      sendTurn: (json) => write(sseEvent("turn", json)),
    };
    openStreams.add(record);

    // 1. The current summaries first.
    let last = devicesJson();
    write(sseEvent("devices", last));

    // 2. The backlog, then later entries. The summaries just sent are already current, so no
    //    devices event is compared during the replay.
    let replaying = true;
    const onEntry = (entry: GatewayLogEntry): void => {
      if (closed) return;
      // Exactly the text createGatewayLog writes to stdout (Req 2.1).
      write(sseEvent("entry", JSON.stringify(entry)));
      if (replaying || closed) return;
      const next = devicesJson();
      if (next !== last) {
        last = next;
        write(sseEvent("devices", next));
      }
    };
    if (!closed) {
      const off = deps.log.subscribe(onEntry);
      replaying = false;
      // A stream closed during its replay still leaves a registered subscriber behind.
      if (closed) off();
      else unsubscribe = off;
    }

    // 3. One `turn` event per retained view, oldest first (Phase 3 Req 18.2). open() is wholly
    //    synchronous — the log replay above is synchronous too — so no live `turn` can interleave
    //    with this backlog: publishTurn cannot run until open() has returned.
    for (const view of deps.views()) {
      if (closed) break;
      record.sendTurn(JSON.stringify(view));
    }

    // 4. The keep-alive, until the stream closes.
    if (!closed) armKeepAlive();

    // 5. A client that goes away closes its stream: unsubscribed, timer cleared, slot freed.
    if (!closed) sink.onClose?.(close);

    return { ok: true, close };
  }

  return {
    open,

    publishTurn(view) {
      // Serialised once for every stream: the view is the same object for all of them.
      const json = JSON.stringify(view);
      for (const stream of [...openStreams]) stream.sendTurn(json);
    },

    closeAll() {
      for (const stream of [...openStreams]) stream.close();
    },
  };
}
