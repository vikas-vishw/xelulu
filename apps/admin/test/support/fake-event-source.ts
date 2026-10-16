// In-test EventSource for the admin console tests: records its URL and listeners, and lets a
// test fire `open`, `error` and named SSE events (`devices`, `entry`, `turn`). No network, no
// timers.
import type { ConversationTurnView, DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import type { EventSourceLike } from "../../src/stream/stream-client";

export class FakeEventSource implements EventSourceLike {
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  /** Fires one named SSE event with `data` as its text, as the browser would. */
  emit(type: string, data: string): void {
    const ev = new MessageEvent<string>(type, { data });
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  /** A `devices` event carrying exactly these summaries. */
  emitDevices(devices: readonly DeviceSummary[]): void {
    this.emit("devices", JSON.stringify({ devices }));
  }

  /** An `entry` event whose data is the entry's stdout line. */
  emitEntry(entry: GatewayLogEntry): void {
    this.emit("entry", JSON.stringify(entry));
  }

  /** A `turn` event carrying exactly this Conversation_Turn_View. */
  emitTurn(view: ConversationTurnView): void {
    this.emit("turn", JSON.stringify(view));
  }
}

/** A `createSource` factory that keeps every source it built, for App({ createSource }). */
export function fakeSources() {
  const sources: FakeEventSource[] = [];
  const createSource = (url: string): FakeEventSource => {
    const s = new FakeEventSource(url);
    sources.push(s);
    return s;
  };
  const latest = (): FakeEventSource => {
    const s = sources.at(-1);
    if (s === undefined) throw new Error("no source created");
    return s;
  };
  return { sources, createSource, latest };
}
