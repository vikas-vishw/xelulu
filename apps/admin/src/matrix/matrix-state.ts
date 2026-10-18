// How a Test_Matrix row goes green (Phase 6 C13, C14; Req 4.4, 4.8, 4.9). Pure: no I/O, no DOM,
// no fetch, no timers. The reducer never mutates its input and returns new objects.
//
// RESULTS ARE LATCHED, NOT DERIVED. The Live_Log window the console holds is capped and is
// emptied on a reconnect, so a matrix recomputed from it would un-pass a row the operator proved
// ten minutes ago. Instead every entry is folded in exactly once — `seen` holds the `seq` values
// already folded — and a row that reached `pass` stays there until the operator resets it.
//
// EVIDENCE CARRIES NO TEXT. Every field below is a count, a boolean, an identifier, a time, or a
// member of a closed list from the Shared_Package. There is no field a transcript, a reply, a
// title or a submitted value could be put in, and no Log_Entry carries one to begin with.
import { AUDIO_TURN_PHASES, POLICY_REFUSALS } from "@xelulu/shared";
import type {
  AckReason,
  AckResultOutcome,
  AudioTurnPhase,
  GatewayLogEntry,
  GatewayLogKind,
  PolicyRefusal,
} from "@xelulu/shared";

import { fixedRowId, type MatrixRow } from "./test-matrix";

/** A row's state (Req 4.4). `running` means a driven row was fired and no ack has matched yet. */
export type RowStatus = "pending" | "running" | "pass" | "fail";

/** What turned a row green, or what failed it (C14, Req 4.9). Ids, closed enums, counts, times. */
export type RowEvidence = Readonly<{
  /** The matched Log_Entry's `seq`; null when nothing reached the log (a route refusal). */
  seq: number | null;
  /** The matched entry's Gateway_Log kind; null for a route refusal. */
  kind: GatewayLogKind | null;
  /** The matched entry's `at`, an ISO 8601 instant; null for a route refusal. */
  at: string | null;
  /** The device the matched entry came from; null for a route refusal. */
  device_id: string | null;
  /** The `cmd_id` the Device_Control_Route returned, or the matched ack's. */
  cmd_id: string | null;
  /** The turn the audio row completed. */
  turn_id: string | null;
  /** The ack outcome, as the Gateway recorded it. */
  outcome: AckResultOutcome | null;
  /** The ack `reason`, exactly as received: it is the hardware's truth and it is final. */
  reason: "" | AckReason | null;
  /** The Device_Action_Gate's refusal, when the gate was the one that answered. */
  refusal: PolicyRefusal | null;
  /** The route's error code, or the client's `proxy_disabled` / `unreachable`. */
  code: string | null;
}>;

const NO_EVIDENCE: RowEvidence = Object.freeze({
  seq: null,
  kind: null,
  at: null,
  device_id: null,
  cmd_id: null,
  turn_id: null,
  outcome: null,
  reason: null,
  refusal: null,
  code: null,
});

function evidence(fields: Partial<RowEvidence>): RowEvidence {
  return Object.freeze({ ...NO_EVIDENCE, ...fields });
}

export type RowState = Readonly<{ status: RowStatus; evidence: RowEvidence | null }>;

const PENDING: RowState = Object.freeze({ status: "pending", evidence: null });

export type MatrixState = Readonly<{
  rows: readonly MatrixRow[];
  /** One state per row id. Every row of `rows` has an entry. */
  states: Readonly<Record<string, RowState>>;
  /** The `cmd_id` each driven row is waiting for an ack on. */
  awaiting: Readonly<Record<string, string>>;
  /** Which audio-turn phases each `turn_id` has shown, for the fixed audio row. */
  turns: Readonly<Record<string, readonly AudioTurnPhase[]>>;
  /** The `seq` values already folded, so no entry is counted twice. */
  seen: ReadonlySet<number>;
}>;

/**
 * Which audio-turn phases a COMPLETE turn shows. Exhaustive over `AudioTurnPhase`, so a new
 * phase stops this file compiling until someone says whether a turn with it is complete;
 * `interrupted` and `aborted` are the two that mean it is not.
 */
const COMPLETES_TURN: Readonly<Record<AudioTurnPhase, boolean>> = Object.freeze({
  started: true,
  ended: true,
  reply_started: true,
  reply_ended: true,
  interrupted: false,
  aborted: false,
});

/** The phases one complete turn through the mock brain must show (Req 4.8). Derived, not listed. */
export const TURN_PHASES_REQUIRED: readonly AudioTurnPhase[] = Object.freeze(
  AUDIO_TURN_PHASES.filter((phase) => COMPLETES_TURN[phase]),
);

/** The shape a route error code may have. Anything else is recorded as `unknown`. */
const CODE_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Stands in for a code that is not code-shaped, so no free text can reach the evidence. */
export const UNKNOWN_CODE = "unknown";

function safeCode(code: string): string {
  return CODE_RE.test(code) ? code : UNKNOWN_CODE;
}

/** A Policy_Refusal, or null when the route answered with something that is not one. */
function safeRefusal(refusal: string | null): PolicyRefusal | null {
  if (refusal === null) return null;
  return POLICY_REFUSALS.find((value) => value === refusal) ?? null;
}

export function initialMatrixState(rows: readonly MatrixRow[]): MatrixState {
  const states: Record<string, RowState> = {};
  for (const row of rows) states[row.id] = PENDING;
  return Object.freeze({
    rows,
    states: Object.freeze(states),
    awaiting: Object.freeze({}),
    turns: Object.freeze({}),
    seen: new Set<number>(),
  });
}

export type MatrixAction =
  /** A batch of held entries; already-folded `seq` values are ignored. */
  | { type: "entries"; entries: readonly GatewayLogEntry[] }
  /** The operator fired a driven row. */
  | { type: "run"; rowId: string }
  /** The route accepted it and returned a `cmd_id`. */
  | { type: "sent"; rowId: string; cmd_id: string }
  /** The route or the client refused it. */
  | { type: "refused"; rowId: string; code: string; refusal: string | null }
  /** One row, or every row when `rowId` is null (Req 4.9). */
  | { type: "reset"; rowId: string | null };

function withState(state: MatrixState, rowId: string, next: RowState): MatrixState {
  return { ...state, states: { ...state.states, [rowId]: next } };
}

function withoutAwaiting(
  awaiting: Readonly<Record<string, string>>,
  rowId: string,
): Readonly<Record<string, string>> {
  if (!(rowId in awaiting)) return awaiting;
  const next = { ...awaiting };
  delete next[rowId];
  return next;
}

/** True when this observed row is the one the entry proves. */
function observedMatch(row: MatrixRow, entry: GatewayLogEntry): boolean {
  if (row.group === "event") {
    return entry.kind === "event_accepted" && entry.event === row.member;
  }
  if (row.group === "zone") {
    return (
      entry.kind === "event_accepted" && entry.event === "touch" && entry.data.zone === row.member
    );
  }
  // The safety-refusal row: the device's own refusal reaching the cloud (Req 4.8). An ack
  // `reason` is final, so a rejected ack carrying one IS the proof — nothing retries around it.
  if (row.id === fixedRowId("safety_refusal")) {
    return (
      entry.kind === "ack_result" &&
      entry.outcome === "rejected" &&
      typeof entry.reason === "string" &&
      entry.reason !== ""
    );
  }
  return false;
}

function entryEvidence(entry: GatewayLogEntry, fields: Partial<RowEvidence> = {}): RowEvidence {
  return evidence({ seq: entry.seq, kind: entry.kind, at: entry.at, ...fields });
}

/** The phases held for a turn after this entry, or the ones held before it. */
function foldTurn(turns: Record<string, readonly AudioTurnPhase[]>, entry: GatewayLogEntry): void {
  if (entry.kind !== "audio_turn" || entry.turn_id === null) return;
  const held = turns[entry.turn_id] ?? [];
  if (held.includes(entry.phase)) return;
  turns[entry.turn_id] = [...held, entry.phase];
}

function turnComplete(phases: readonly AudioTurnPhase[]): boolean {
  return TURN_PHASES_REQUIRED.every((phase) => phases.includes(phase));
}

/**
 * A driven row's verdict for the ack it was waiting on. A row that expected a refusal and got an
 * ack FAILS however the device answered: the ack proves the command reached the wire, which is
 * exactly what the gate was supposed to prevent.
 */
function drivenVerdict(row: MatrixRow, outcome: AckResultOutcome): RowStatus {
  if (row.expectRefusal) return "fail";
  return outcome === "done" || outcome === "accepted" ? "pass" : "fail";
}

function applyEntries(state: MatrixState, entries: readonly GatewayLogEntry[]): MatrixState {
  const fresh = entries.filter((entry) => !state.seen.has(entry.seq));
  if (fresh.length === 0) return state;

  const states: Record<string, RowState> = { ...state.states };
  const awaiting: Record<string, string> = { ...state.awaiting };
  const turns: Record<string, readonly AudioTurnPhase[]> = { ...state.turns };
  const seen = new Set(state.seen);
  const audioRowId = fixedRowId("audio_turn");

  for (const entry of fresh) {
    seen.add(entry.seq);
    foldTurn(turns, entry);

    for (const row of state.rows) {
      const held = states[row.id] ?? PENDING;

      if (row.direction === "driven") {
        if (
          entry.kind !== "ack_result" ||
          awaiting[row.id] === undefined ||
          awaiting[row.id] !== entry.cmd_id
        ) {
          continue;
        }
        delete awaiting[row.id];
        states[row.id] = Object.freeze({
          status: drivenVerdict(row, entry.outcome),
          evidence: entryEvidence(entry, {
            device_id: entry.device_id,
            cmd_id: entry.cmd_id,
            outcome: entry.outcome,
            reason: entry.reason,
          }),
        });
        continue;
      }

      // Observed rows latch: once green, only a reset changes them.
      if (held.status === "pass") continue;

      if (row.id === audioRowId) {
        if (entry.kind !== "audio_turn" || entry.turn_id === null) continue;
        if (!turnComplete(turns[entry.turn_id] ?? [])) continue;
        states[row.id] = Object.freeze({
          status: "pass",
          evidence: entryEvidence(entry, {
            device_id: entry.device_id,
            turn_id: entry.turn_id,
          }),
        });
        continue;
      }

      if (!observedMatch(row, entry)) continue;
      states[row.id] = Object.freeze({
        status: "pass",
        evidence:
          entry.kind === "ack_result"
            ? entryEvidence(entry, {
                device_id: entry.device_id,
                cmd_id: entry.cmd_id,
                outcome: entry.outcome,
                reason: entry.reason,
              })
            : entryEvidence(entry, {
                device_id: entry.kind === "event_accepted" ? entry.device_id : null,
              }),
      });
    }
  }

  return {
    ...state,
    states: Object.freeze(states),
    awaiting: Object.freeze(awaiting),
    turns: Object.freeze(turns),
    seen,
  };
}

export function matrixReducer(state: MatrixState, action: MatrixAction): MatrixState {
  switch (action.type) {
    case "entries":
      return applyEntries(state, action.entries);
    case "run":
      return withState(
        { ...state, awaiting: withoutAwaiting(state.awaiting, action.rowId) },
        action.rowId,
        Object.freeze({ status: "running", evidence: null }),
      );
    case "sent":
      return withState(
        { ...state, awaiting: { ...state.awaiting, [action.rowId]: action.cmd_id } },
        action.rowId,
        Object.freeze({
          status: "running",
          evidence: evidence({ cmd_id: action.cmd_id }),
        }),
      );
    case "refused": {
      const row = state.rows.find((candidate) => candidate.id === action.rowId);
      // A refusal is a PASS where the row expected one (Req 4.6): the gate did its job.
      const status: RowStatus = row?.expectRefusal === true ? "pass" : "fail";
      return withState(
        { ...state, awaiting: withoutAwaiting(state.awaiting, action.rowId) },
        action.rowId,
        Object.freeze({
          status,
          evidence: evidence({
            code: safeCode(action.code),
            refusal: safeRefusal(action.refusal),
          }),
        }),
      );
    }
    case "reset": {
      if (action.rowId === null) {
        return {
          ...state,
          states: initialMatrixState(state.rows).states,
          awaiting: Object.freeze({}),
          turns: Object.freeze({}),
          // `seen` is kept: a reset asks for a fresh proof, not for the old entries to
          // re-prove the row from the window the console still happens to hold.
          seen: state.seen,
        };
      }
      return withState(
        { ...state, awaiting: withoutAwaiting(state.awaiting, action.rowId) },
        action.rowId,
        PENDING,
      );
    }
  }
}

export type MatrixTotals = Readonly<{
  rows: number;
  passed: number;
  failed: number;
  pending: number;
  running: number;
}>;

/** The run total shown on the page (Req 4.9). `pending` counts rows nothing has been seen for. */
export function matrixTotals(state: MatrixState): MatrixTotals {
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const row of state.rows) {
    const status = (state.states[row.id] ?? PENDING).status;
    if (status === "pass") passed += 1;
    else if (status === "fail") failed += 1;
    else if (status === "running") running += 1;
  }
  return Object.freeze({
    rows: state.rows.length,
    passed,
    failed,
    running,
    pending: state.rows.length - passed - failed - running,
  });
}

/** One row's state, for the page. Never undefined: an unknown id reads as pending. */
export function rowState(state: MatrixState, rowId: string): RowState {
  return state.states[rowId] ?? PENDING;
}
