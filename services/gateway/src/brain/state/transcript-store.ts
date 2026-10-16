// The Transcript_Store (Req 15, C11). safety.md §1 promises transcripts are text only, retained
// 30 days by default and then deleted, and that "delete all" really deletes. This module is that
// promise as executed code rather than a comment: an expiry per turn, a sweep that runs on the
// Deadlines abstraction and removes what has expired, a bounded capacity, and a delete-all.
//
// Phase 3 boundary (C10): the store is in memory only. It writes to no file, and a process
// restart loses every turn. Durable retention with the parent-facing view, delete and export that
// safety.md §1 and §2 require arrives with the Supabase phase. The spec says so rather than
// claiming the parent-facing half is met.
//
// Text lives here and NOWHERE else: no transcript text may reach a Log_Entry (Omar ruling 1,
// safety.md §7, Phase 1.2 Req 12.5). The `transcript_retention` entries this module writes carry
// an action code and two counts, never a turn's text, device or id.
import { DEFAULT_TRANSCRIPT_RETENTION_DAYS, type TranscriptSpeaker } from "@xelulu/shared";

import { type Clock, isoAt } from "../../clock.js";
import type { Deadlines } from "../../deadlines.js";
import type { GatewayLog } from "../../log/gateway-log.js";

/** How often the sweep runs. Hourly: fine-grained enough for a 30-day TTL, cheap enough to keep. */
export const TRANSCRIPT_SWEEP_INTERVAL_MS = 3_600_000;

/** The Deadlines key the sweep re-schedules itself under (Req 15.7). */
export const TRANSCRIPT_SWEEP_KEY = "transcripts:sweep";

export const TRANSCRIPT_MAX_TURNS_PER_DEVICE = 200;
export const TRANSCRIPT_MAX_TURNS_TOTAL = 1_000;

const MS_PER_DAY = 86_400_000;

export type StoredTurn = Readonly<{
  device_id: string;
  turn_id: string;
  speaker: TranscriptSpeaker;
  text: string;
  at: string;
  expires_at_ms: number;
}>;

export type TranscriptCounts = Readonly<{
  total: number;
  byDevice: Readonly<Record<string, number>>;
}>;

export interface TranscriptStore {
  /** Holds one turn's text. The expiry is computed here, so no caller can extend a TTL. */
  add(turn: Omit<StoredTurn, "expires_at_ms">): void;
  /** Removes expired turns; logs `transcript_retention` `expired` when any went. Returns how many. */
  sweep(nowMs: number): number;
  /** Really deletes: the store is empty afterwards. Logs `deleted_all`. Returns how many went. */
  deleteAll(): number;
  counts(): TranscriptCounts;
  /**
   * The held turns of one turn id, oldest first. Only the operator channel calls this, and only
   * with the Transcripts_Argument (Req 18.5); without it the pipeline never asks.
   */
  textFor(turnId: string): readonly StoredTurn[];
  /** Cancels the scheduled sweep. Called from the Gateway's `stop()`. */
  stop(): void;
}

export function createTranscriptStore(
  deps: Readonly<{
    clock: Clock;
    deadlines: Deadlines;
    log: Pick<GatewayLog, "add">;
    retentionDays?: number;
  }>,
): TranscriptStore {
  const retentionDays = deps.retentionDays ?? DEFAULT_TRANSCRIPT_RETENTION_DAYS;
  /** Insertion-ordered, so dropping the oldest is a shift from the front. */
  let turns: StoredTurn[] = [];
  let stopped = false;

  function countFor(deviceId: string): number {
    return turns.reduce((n, turn) => (turn.device_id === deviceId ? n + 1 : n), 0);
  }

  /** Drops the oldest turn of `deviceId`, then the oldest overall, until both caps hold. */
  function enforceCaps(deviceId: string): void {
    while (countFor(deviceId) > TRANSCRIPT_MAX_TURNS_PER_DEVICE) {
      const index = turns.findIndex((turn) => turn.device_id === deviceId);
      if (index === -1) break;
      turns.splice(index, 1);
    }
    while (turns.length > TRANSCRIPT_MAX_TURNS_TOTAL) turns.shift();
  }

  function sweep(nowMs: number): number {
    const before = turns.length;
    turns = turns.filter((turn) => turn.expires_at_ms > nowMs);
    const removed = before - turns.length;
    if (removed > 0) {
      deps.log.add({
        kind: "transcript_retention",
        action: "expired",
        turns_removed: removed,
        turns_held: turns.length,
      });
    }
    return removed;
  }

  /** Re-arms itself, so the policy keeps running for the life of the process (Req 15.7). */
  function scheduleSweep(): void {
    if (stopped) return;
    deps.deadlines.schedule(
      TRANSCRIPT_SWEEP_KEY,
      deps.clock.now() + TRANSCRIPT_SWEEP_INTERVAL_MS,
      () => {
        sweep(deps.clock.now());
        scheduleSweep();
      },
    );
  }

  scheduleSweep();

  return {
    add(turn) {
      if (stopped) return;
      turns.push({ ...turn, expires_at_ms: Date.parse(turn.at) + retentionDays * MS_PER_DAY });
      enforceCaps(turn.device_id);
    },

    sweep,

    deleteAll() {
      const removed = turns.length;
      turns = [];
      deps.log.add({
        kind: "transcript_retention",
        action: "deleted_all",
        turns_removed: removed,
        turns_held: 0,
      });
      return removed;
    },

    counts() {
      const byDevice: Record<string, number> = {};
      for (const turn of turns) byDevice[turn.device_id] = (byDevice[turn.device_id] ?? 0) + 1;
      return { total: turns.length, byDevice };
    },

    textFor(turnId) {
      return turns.filter((turn) => turn.turn_id === turnId);
    },

    stop() {
      stopped = true;
      deps.deadlines.cancel(TRANSCRIPT_SWEEP_KEY);
    },
  };
}

/** The ISO time a turn is stored under, from the Clock. Exported so callers share one shape. */
export function transcriptTimeAt(clock: Clock): string {
  return isoAt(clock.now());
}
