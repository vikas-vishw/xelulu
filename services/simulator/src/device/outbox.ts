// Outbox and Offline_Queue (Req 15.5, 19.2–19.5, 19.7, G31). One event is in flight at a time and
// leaves only on its PUBACK, so order is preserved and nothing is lost on a drop:
//
// - Offline (no link, or the link is up but the replay has not finished), a fired event joins
//   the tail of the Offline_Queue. At 500 the head is removed and one `queue_dropped` entry
//   carries its `event_id`.
// - After the hello's PUBACK the device link calls `linkUp`. The queue head is published with
//   `time_uncertain: true` and its original `event_id`, `event`, `data` and `ts`, and removed
//   only on PUBACK; repeat until empty. A drop or offline toggle leaves the unacknowledged head in
//   place, and the next `linkUp` resumes from it.
// - After an offline-to-online toggle with `duplicate_replay` on, once the queue is empty the
//   last 5 events PUBACKed before going offline are re-published in order with
//   `time_uncertain: true` (fire-and-forget at QoS 1).
// - Then `onReplayed` runs (the device link sends its first status) and the outbox is ready:
//   fired events go out with no `time_uncertain`, still one at a time. If the link ends before
//   their PUBACK, they move to the queue and are replayed later (Req 15.5).
//
// The outbox publishes through the link it is given and never opens a connection itself.
import { serialiseEventMessage, type EventKind, type EventMessage } from "@xelulu/shared";

import type { SimLog } from "../log/logger.js";

export const OFFLINE_QUEUE_LIMIT = 500;
export const RECENT_PUBLISHED_LIMIT = 5;

export type QueuedEvent = Readonly<{
  event_id: string;
  event: EventKind;
  data: Readonly<Record<string, unknown>>;
  ts: number;
}>;

/** What the outbox needs from a live connection. */
export interface OutboxLink {
  /**
   * Publishes an event payload on the device's `event` topic at QoS 1, not retained. Resolves
   * on PUBACK; rejects if the connection closes first.
   */
  publishEvent(payload: string): Promise<void>;
}

export type LinkDownCause = "dropped" | "toggled_offline";

export interface Outbox {
  /**
   * A newly fired, already validated event. Published at once when ready, else queued.
   * `queued` is true when it went to the Offline_Queue.
   */
  fire(event: QueuedEvent): { readonly queued: boolean };
  /**
   * The hello has been PUBACKed on `link`. Replays the queue (then any duplicate replay) and
   * calls `onReplayed` once, while this link is still current, before the outbox goes ready.
   */
  linkUp(link: OutboxLink, onReplayed: () => void): void;
  /**
   * The connection ended. The unacknowledged in-flight event and any unsent ready events stay
   * queued in order. `toggled_offline` also captures the duplicate-replay ring.
   */
  linkDown(cause: LinkDownCause): void;
  setDuplicateReplay(on: boolean): void;
  duplicateReplay(): boolean;
  /** True once the replay after the last `linkUp` has finished and the link is still up. */
  ready(): boolean;
  queueLength(): number;
  /** The Offline_Queue, head first (a copy). */
  queued(): readonly QueuedEvent[];
  /** The last 5 PUBACKed events, in publish order (a copy). */
  recentPublished(): readonly QueuedEvent[];
}

export type OutboxDeps = Readonly<{ log: SimLog }>;

type Phase = "down" | "replaying" | "ready";

type InFlight = Readonly<{ entry: QueuedEvent; replay: boolean }>;

function freezeEvent(e: QueuedEvent): QueuedEvent {
  return Object.freeze({
    event_id: e.event_id,
    event: e.event,
    data: Object.freeze({ ...e.data }),
    ts: e.ts,
  });
}

export function createOutbox(deps: OutboxDeps): Outbox {
  const queue: QueuedEvent[] = [];
  /** Fired while ready and not yet published; only non-empty while ready. */
  const live: QueuedEvent[] = [];
  const recent: QueuedEvent[] = [];
  let duplicateReplay = false;
  /** The ring as captured at the last offline toggle, waiting for the next replay. */
  let pendingDuplicates: readonly QueuedEvent[] | null = null;

  let phase: Phase = "down";
  let link: OutboxLink | null = null;
  let onReplayed: (() => void) | null = null;
  /** Bumped on every link change, so callbacks from an old link do nothing. */
  let epoch = 0;
  let inFlight: InFlight | null = null;

  function enqueue(e: QueuedEvent): void {
    if (queue.length >= OFFLINE_QUEUE_LIMIT) {
      const dropped = queue.shift();
      if (dropped !== undefined)
        deps.log.add({ kind: "queue_dropped", event_id: dropped.event_id });
    }
    queue.push(e);
  }

  function remember(e: QueuedEvent): void {
    recent.push(e);
    if (recent.length > RECENT_PUBLISHED_LIMIT) recent.shift();
  }

  function payloadOf(e: QueuedEvent, timeUncertain: boolean): string {
    const message = {
      proto_ver: 2,
      ts: e.ts,
      type: "event",
      event_id: e.event_id,
      event: e.event,
      ...(timeUncertain ? { time_uncertain: true } : {}),
      data: e.data,
    } as unknown as EventMessage;
    return serialiseEventMessage(message);
  }

  function logOut(e: QueuedEvent, replay: boolean): void {
    deps.log.add({
      kind: "message_out",
      variant: e.event,
      event_id: e.event_id,
      cmd_id: null,
      turn_id: null,
      ack_status: null,
      ack_reason: null,
      replay,
      time_uncertain: replay,
    });
  }

  function send(current: OutboxLink, entry: QueuedEvent, replay: boolean): void {
    const myEpoch = epoch;
    inFlight = Object.freeze({ entry, replay });
    const payload = payloadOf(entry, replay);
    logOut(entry, replay);
    current.publishEvent(payload).then(
      () => {
        if (myEpoch !== epoch || inFlight?.entry !== entry) return;
        inFlight = null;
        if (replay) {
          // The head may have been dropped by a full queue meanwhile; remove only this entry.
          if (queue[0] === entry) queue.shift();
        } else if (live[0] === entry) {
          live.shift();
        }
        remember(entry);
        pump();
      },
      () => {
        // The connection closed first: `linkDown` puts things back. Nothing is written.
      },
    );
  }

  function finishReplay(current: OutboxLink): void {
    const duplicates = pendingDuplicates;
    pendingDuplicates = null;
    if (duplicates !== null && duplicateReplay) {
      for (const e of duplicates) {
        logOut(e, true);
        current.publishEvent(payloadOf(e, true)).catch(() => {
          // Fire-and-forget: a lost re-publication changes nothing.
        });
      }
    }
    phase = "ready";
    const done = onReplayed;
    onReplayed = null;
    done?.();
  }

  function pump(): void {
    const current = link;
    if (current === null || inFlight !== null) return;
    if (phase === "replaying") {
      const head = queue[0];
      if (head !== undefined) {
        send(current, head, true);
        return;
      }
      finishReplay(current);
      // `onReplayed` may have ended the link or fired an event; start over from the top.
      pump();
      return;
    }
    if (phase === "ready") {
      const next = live[0];
      if (next !== undefined) send(current, next, false);
    }
  }

  return {
    fire(event) {
      const e = freezeEvent(event);
      if (phase !== "ready") {
        enqueue(e);
        return { queued: true };
      }
      live.push(e);
      pump();
      return { queued: false };
    },

    linkUp(next, replayed) {
      epoch += 1;
      inFlight = null;
      link = next;
      onReplayed = replayed;
      phase = "replaying";
      pump();
    },

    linkDown(cause) {
      if (cause === "toggled_offline") pendingDuplicates = Object.freeze([...recent]);
      if (link === null && phase === "down") return;
      epoch += 1;
      link = null;
      onReplayed = null;
      phase = "down";
      inFlight = null;
      // Ready events not yet PUBACKed join the queue in firing order (the queue is empty while
      // ready, so they keep their place relative to everything fired earlier).
      for (const e of live.splice(0)) enqueue(e);
    },

    setDuplicateReplay(on) {
      duplicateReplay = on;
    },
    duplicateReplay: () => duplicateReplay,
    ready: () => phase === "ready",
    queueLength: () => queue.length,
    queued: () => [...queue],
    recentPublished: () => [...recent],
  };
}
