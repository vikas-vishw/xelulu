// How a Test_Matrix row goes green (Phase 6 Req 4.4, 4.6, 4.8, 4.9; Property 5).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ACK_REASONS,
  ACK_RESULT_OUTCOMES,
  AUDIO_TURN_PHASES,
  CMD_ACTIONS,
  EVENT_KINDS,
  GATEWAY_LOG_KINDS,
  POLICY_REFUSALS,
  TOUCH_ZONES,
} from "@xelulu/shared";
import type { GatewayLogEntry } from "@xelulu/shared";

import {
  initialMatrixState,
  matrixReducer,
  matrixTotals,
  rowState,
  TURN_PHASES_REQUIRED,
  UNKNOWN_CODE,
  type MatrixAction,
  type MatrixState,
  type RowEvidence,
} from "../src/matrix/matrix-state";
import { buildMatrix, fixedRowId } from "../src/matrix/test-matrix";

import { ackResult, audioTurn, DEVICE_ID, eventAccepted, touchAccepted } from "./support/entries";

const ROWS = buildMatrix();

function fresh(): MatrixState {
  return initialMatrixState(ROWS);
}

function fold(state: MatrixState, ...entries: readonly GatewayLogEntry[]): MatrixState {
  return matrixReducer(state, { type: "entries", entries });
}

/** The four phases of one complete turn, one entry each. */
function completeTurn(firstSeq: number, turnId = "turn_000042"): GatewayLogEntry[] {
  return TURN_PHASES_REQUIRED.map((phase, index) => audioTurn(firstSeq + index, phase, turnId));
}

describe("observed rows", () => {
  it("greens the event row for each event kind, and nothing else", () => {
    for (const kind of EVENT_KINDS) {
      const entry = kind === "touch" ? touchAccepted(1) : eventAccepted(1, kind);
      const state = fold(fresh(), entry);
      expect(rowState(state, `event:${kind}`).status).toBe("pass");
      for (const other of EVENT_KINDS) {
        if (other === kind) continue;
        expect(rowState(state, `event:${other}`).status).toBe("pending");
      }
    }
  });

  it("greens exactly the zone row the touch arrived on", () => {
    const state = fold(fresh(), touchAccepted(5, "right_hand"));
    expect(rowState(state, "zone:right_hand").status).toBe("pass");
    // A touch is also an event, so the kind row greens with it.
    expect(rowState(state, "event:touch").status).toBe("pass");
    for (const zone of TOUCH_ZONES) {
      if (zone === "right_hand") continue;
      expect(rowState(state, `zone:${zone}`).status).toBe("pending");
    }
  });

  it("records the entry's seq, kind, device and time as the evidence", () => {
    const state = fold(fresh(), touchAccepted(7, "belly"));
    const evidence = rowState(state, "zone:belly").evidence;
    expect(evidence?.seq).toBe(7);
    expect(evidence?.kind).toBe("event_accepted");
    expect(evidence?.device_id).toBe(DEVICE_ID);
    expect(evidence?.at).toBe(touchAccepted(7).at);
  });

  it("greens the audio row only once one turn shows every required phase", () => {
    const required = [...TURN_PHASES_REQUIRED];
    expect(required).toEqual(["started", "ended", "reply_started", "reply_ended"]);

    let state = fresh();
    for (const [index, phase] of required.entries()) {
      state = fold(state, audioTurn(10 + index, phase));
      const expected = index === required.length - 1 ? "pass" : "pending";
      expect(rowState(state, fixedRowId("audio_turn")).status, phase).toBe(expected);
    }
    expect(rowState(state, fixedRowId("audio_turn")).evidence?.turn_id).toBe("turn_000001");
  });

  it("does not green the audio row when the phases are split across two turns", () => {
    const state = fold(
      fresh(),
      audioTurn(1, "started", "turn_a"),
      audioTurn(2, "ended", "turn_a"),
      audioTurn(3, "reply_started", "turn_b"),
      audioTurn(4, "reply_ended", "turn_b"),
    );
    expect(rowState(state, fixedRowId("audio_turn")).status).toBe("pending");
  });

  it("greens the safety-refusal row on a rejected ack carrying a reason", () => {
    const safety = fixedRowId("safety_refusal");
    const noReason = fold(
      fresh(),
      ackResult(1, { cmd_id: "cmd_000001", action: "say", outcome: "rejected", reason: "" }),
    );
    expect(rowState(noReason, safety).status).toBe("pending");

    const state = fold(
      fresh(),
      ackResult(2, { cmd_id: "cmd_000002", action: "say", outcome: "rejected", reason: "at_edge" }),
    );
    expect(rowState(state, safety).status).toBe("pass");
    expect(rowState(state, safety).evidence?.reason).toBe("at_edge");
    expect(rowState(state, safety).evidence?.outcome).toBe("rejected");
  });

  it("latches a pass: a later batch without the entry leaves the row green", () => {
    const first = fold(fresh(), touchAccepted(3, "head"));
    expect(rowState(first, "zone:head").status).toBe("pass");
    // What a reconnect looks like: the console's window is empty again.
    const later = fold(first);
    expect(rowState(later, "zone:head").status).toBe("pass");
    const newer = fold(later, touchAccepted(900, "back"));
    expect(rowState(newer, "zone:head").status).toBe("pass");
    expect(rowState(newer, "zone:head").evidence?.seq).toBe(3);
  });

  it("folds each seq exactly once, so a re-sent window changes nothing", () => {
    const entries = [touchAccepted(1, "head"), ...completeTurn(2)];
    const once = fold(fresh(), ...entries);
    const twice = fold(once, ...entries);
    expect(twice.states).toEqual(once.states);
    expect(twice.turns).toEqual(once.turns);
  });
});

describe("driven rows", () => {
  const sayRow = "cmd:say";
  const moveRow = "cmd:move";

  function sent(rowId: string, cmdId: string): MatrixState {
    const running = matrixReducer(fresh(), { type: "run", rowId });
    expect(rowState(running, rowId).status).toBe("running");
    return matrixReducer(running, { type: "sent", rowId, cmd_id: cmdId });
  }

  it("shows the cmd_id while it waits, then passes on a done ack", () => {
    const waiting = sent(sayRow, "cmd_000011");
    expect(rowState(waiting, sayRow).status).toBe("running");
    expect(rowState(waiting, sayRow).evidence?.cmd_id).toBe("cmd_000011");

    const state = fold(
      waiting,
      ackResult(12, { cmd_id: "cmd_000011", action: "say", outcome: "done" }),
    );
    expect(rowState(state, sayRow).status).toBe("pass");
    expect(rowState(state, sayRow).evidence?.outcome).toBe("done");
  });

  it("passes on an accepted ack and fails on any other outcome, carrying the reason", () => {
    for (const outcome of ACK_RESULT_OUTCOMES) {
      const state = fold(
        sent(sayRow, "cmd_000020"),
        ackResult(21, { cmd_id: "cmd_000020", action: "say", outcome, reason: "busy" }),
      );
      const expected = outcome === "done" || outcome === "accepted" ? "pass" : "fail";
      expect(rowState(state, sayRow).status, outcome).toBe(expected);
      expect(rowState(state, sayRow).evidence?.reason).toBe("busy");
    }
  });

  it("ignores an ack for a cmd_id it is not waiting on", () => {
    const state = fold(
      sent(sayRow, "cmd_000030"),
      ackResult(31, { cmd_id: "cmd_000099", action: "say", outcome: "done" }),
    );
    expect(rowState(state, sayRow).status).toBe("running");
  });

  it("passes a row that expected a refusal when the gate refuses it", () => {
    const refused = matrixReducer(fresh(), {
      type: "refused",
      rowId: moveRow,
      code: "action_refused",
      refusal: "action_not_allowed",
    });
    expect(rowState(refused, moveRow).status).toBe("pass");
    expect(rowState(refused, moveRow).evidence?.refusal).toBe("action_not_allowed");
    expect(rowState(refused, moveRow).evidence?.code).toBe("action_refused");
  });

  it("fails an allow-listed row when the gate refuses it, naming the Policy_Refusal", () => {
    const refused = matrixReducer(fresh(), {
      type: "refused",
      rowId: sayRow,
      code: "action_refused",
      refusal: "quiet_hours",
    });
    expect(rowState(refused, sayRow).status).toBe("fail");
    expect(rowState(refused, sayRow).evidence?.refusal).toBe("quiet_hours");
  });

  it("fails a row that expected a refusal if an ack ever arrives for it", () => {
    const state = fold(
      sent(moveRow, "cmd_000040"),
      ackResult(41, { cmd_id: "cmd_000040", action: "move", outcome: "done" }),
    );
    // An ack proves the command reached the wire, which is what the gate was there to prevent.
    expect(rowState(state, moveRow).status).toBe("fail");
  });

  it("keeps a refusal code that is not code-shaped out of the evidence", () => {
    const refused = matrixReducer(fresh(), {
      type: "refused",
      rowId: sayRow,
      code: "why is the sky blue",
      refusal: "not a refusal",
    });
    expect(rowState(refused, sayRow).evidence?.code).toBe(UNKNOWN_CODE);
    expect(rowState(refused, sayRow).evidence?.refusal).toBeNull();
  });
});

describe("totals and reset", () => {
  it("counts every row, and moves a row between the buckets as it changes", () => {
    const empty = matrixTotals(fresh());
    expect(empty.rows).toBe(ROWS.length);
    expect(empty.pending).toBe(ROWS.length);
    expect(empty.passed + empty.failed + empty.running).toBe(0);

    const state = fold(fresh(), touchAccepted(1, "head"));
    const totals = matrixTotals(state);
    // The zone row and the touch event row both greened.
    expect(totals.passed).toBe(2);
    expect(totals.pending).toBe(ROWS.length - 2);
  });

  it("resets one row without touching the others", () => {
    const state = fold(fresh(), touchAccepted(1, "head"));
    const reset = matrixReducer(state, { type: "reset", rowId: "zone:head" });
    expect(rowState(reset, "zone:head").status).toBe("pending");
    expect(rowState(reset, "zone:head").evidence).toBeNull();
    expect(rowState(reset, "event:touch").status).toBe("pass");
  });

  it("resets every row, and does not let the held window re-prove them", () => {
    const entries = [touchAccepted(1, "head"), ...completeTurn(2)];
    const state = fold(fresh(), ...entries);
    const reset = matrixReducer(state, { type: "reset", rowId: null });
    expect(matrixTotals(reset).pending).toBe(ROWS.length);

    const again = fold(reset, ...entries);
    expect(matrixTotals(again).pending).toBe(ROWS.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Property 5. Every closed list the evidence may draw on is imported, never restated, and the
// oracle is "is this value a member of one of them" rather than a list of allowed strings.

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID_RE = /^[A-Za-z0-9_:.-]+$/;

const entryArb: fc.Arbitrary<GatewayLogEntry> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 1, max: 50 }), fc.constantFrom(...TOUCH_ZONES))
    .map(([seq, zone]) => touchAccepted(seq, zone)),
  fc
    .tuple(
      fc.integer({ min: 1, max: 50 }),
      fc.constantFrom(...EVENT_KINDS.filter((kind) => kind !== "touch")),
    )
    .map(([seq, kind]) => eventAccepted(seq, kind)),
  fc
    .tuple(
      fc.integer({ min: 1, max: 50 }),
      fc.constantFrom(...AUDIO_TURN_PHASES),
      fc.constantFrom("turn_a", "turn_b"),
    )
    .map(([seq, phase, turnId]) => audioTurn(seq, phase, turnId)),
  fc
    .tuple(
      fc.integer({ min: 1, max: 50 }),
      fc.constantFrom(...CMD_ACTIONS),
      fc.constantFrom(...ACK_RESULT_OUTCOMES),
      fc.constantFrom("", null, ...ACK_REASONS),
    )
    .map(([seq, action, outcome, reason]) =>
      ackResult(seq, { cmd_id: `cmd_${String(seq).padStart(6, "0")}`, action, outcome, reason }),
    ),
);

const actionArb: fc.Arbitrary<MatrixAction> = fc.oneof(
  fc.array(entryArb, { maxLength: 12 }).map((entries) => ({ type: "entries" as const, entries })),
  fc.constantFrom(...ROWS.map((row) => row.id)).map((rowId) => ({ type: "run" as const, rowId })),
  fc
    .tuple(fc.constantFrom(...ROWS.map((row) => row.id)), fc.integer({ min: 1, max: 50 }))
    .map(([rowId, seq]) => ({
      type: "sent" as const,
      rowId,
      cmd_id: `cmd_${String(seq).padStart(6, "0")}`,
    })),
  fc
    .tuple(
      fc.constantFrom(...ROWS.map((row) => row.id)),
      fc.oneof(fc.constantFrom("action_refused", "proxy_disabled"), fc.string()),
      fc.oneof(fc.constantFrom(...POLICY_REFUSALS, null), fc.string()),
    )
    .map(([rowId, code, refusal]) => ({ type: "refused" as const, rowId, code, refusal })),
  fc
    .constantFrom(...ROWS.map((row) => row.id), null)
    .map((rowId) => ({ type: "reset" as const, rowId })),
);

/** Asserts one evidence record carries ids, closed enums, counts and times only. */
function expectNoText(evidence: RowEvidence): void {
  if (evidence.seq !== null) expect(Number.isInteger(evidence.seq)).toBe(true);
  if (evidence.kind !== null) expect(GATEWAY_LOG_KINDS).toContain(evidence.kind);
  if (evidence.at !== null) expect(evidence.at).toMatch(ISO_RE);
  if (evidence.device_id !== null) expect(evidence.device_id).toMatch(ID_RE);
  if (evidence.cmd_id !== null) expect(evidence.cmd_id).toMatch(ID_RE);
  if (evidence.turn_id !== null) expect(evidence.turn_id).toMatch(ID_RE);
  if (evidence.outcome !== null) expect(ACK_RESULT_OUTCOMES).toContain(evidence.outcome);
  if (evidence.reason !== null && evidence.reason !== "") {
    expect(ACK_REASONS).toContain(evidence.reason);
  }
  if (evidence.refusal !== null) expect(POLICY_REFUSALS).toContain(evidence.refusal);
  if (evidence.code !== null) expect(evidence.code).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
}

describe("Test_Matrix state properties", () => {
  // Feature: phase-6-integration-cockpit, Property 5: Evidence carries no text
  // Validates: Requirements 4.9, 7.7
  it("never puts anything but an id, a closed enum, a count or a time in the evidence", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 20 }), (actions) => {
        let state = fresh();
        for (const action of actions) state = matrixReducer(state, action);
        for (const row of state.rows) {
          const held = rowState(state, row.id);
          expect(["pending", "running", "pass", "fail"]).toContain(held.status);
          if (held.evidence !== null) expectNoText(held.evidence);
          // A non-pending row always carries evidence, except the bare `running` a run sets
          // before the route has answered (Req 4.4).
          if (held.status === "pass" || held.status === "fail") {
            expect(held.evidence).not.toBeNull();
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: phase-6-integration-cockpit, Property 5: Evidence carries no text
  // Validates: Requirement 4.4
  it("keeps every row's state a member of the four statuses and never loses a row", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 20 }), (actions) => {
        let state = fresh();
        for (const action of actions) state = matrixReducer(state, action);
        const totals = matrixTotals(state);
        expect(totals.rows).toBe(ROWS.length);
        expect(totals.passed + totals.failed + totals.running + totals.pending).toBe(ROWS.length);
      }),
      { numRuns: 200 },
    );
  });
});
