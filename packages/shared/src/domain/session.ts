import type { IsoDateTime } from "./common.js";

export type TranscriptSpeaker = "child" | "xelulu";

/** One transcript turn. Text only (safety.md §1); `text` is the only content field. */
export interface TranscriptTurn {
  speaker: TranscriptSpeaker;
  text: string;
  at: IsoDateTime;
}

export interface Session {
  session_id: string;
  household_id: string;
  device_id: string;
  child_id: string | null;
  started_at: IsoDateTime;
  ended_at: IsoDateTime | null;
  transcript: TranscriptTurn[];
  /** By default `started_at` plus `DEFAULT_TRANSCRIPT_RETENTION_DAYS`. */
  transcript_expires_at: IsoDateTime;
}
