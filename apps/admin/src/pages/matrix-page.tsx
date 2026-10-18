// The Test Matrix page (Phase 6 Req 4.1, 4.4–4.9): the bring-up checklist, one row per Document B
// feature, derived from the contract at runtime so it cannot drift from Document B.
//
// TWO TABLES, BECAUSE DIRECTION DECIDES EVERYTHING (C9).
//
//  - Cloud to device: one row per command action. The console fires these itself through the
//    Device_Control_Route, which puts the Device_Action_Gate between the button and the wire. The
//    six actions the gate does not allow are marked expected-to-refuse, so their refusal is a
//    PASS and not a broken row.
//  - Device to cloud: the events, the seven touch zones, one complete audio turn and the device's
//    own safety refusal. These ORIGINATE AT THE DEVICE. They carry NO run control, because the
//    console cannot cause them and must not try: it sends no request to any origin but its own.
//    The operator fires them from the Simulator control panel during bring-up, and a hardware
//    engineer touches the real robot afterwards.
//
// The matrix lives in this page's memory for as long as it is open (C13): a fresh page is a fresh
// run, the honest default for a checklist. Evidence is ids, closed enums, counts and times only.
import { useEffect, useId, useMemo, useReducer } from "react";

import type { DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import { probeData } from "../control/command-data";
import { createControlClient, type ControlClient } from "../control/control-client";
import {
  initialMatrixState,
  matrixReducer,
  matrixTotals,
  rowState,
  type RowEvidence,
  type RowState,
  type RowStatus,
} from "../matrix/matrix-state";
import { buildMatrix, type MatrixRow } from "../matrix/test-matrix";

export type MatrixPageProps = Readonly<{
  /** Held entries, ascending seq (from ConsoleState). What greens every observed row. */
  entries: readonly GatewayLogEntry[];
  /** null until the first `devices` event; the first device is the one a driven row is sent to. */
  devices: readonly DeviceSummary[] | null;
  /** The browser's client unless a test passes a fake. */
  client?: ControlClient;
}>;

/** Shown wherever a value is not held yet. */
const NONE = "—";

/** Each status in words, so no state is carried by colour alone (Req 3.5's rule, page-wide). */
const STATUS_TEXT: Readonly<Record<RowStatus, string>> = Object.freeze({
  pending: "Pending",
  running: "Running",
  pass: "Pass",
  fail: "Fail",
});

/** The line every observed row answers to (Req 4.7). */
export const OBSERVED_NOTE =
  "These originate at the device. The console watches the operator stream for them and cannot " +
  "fire them: fire each one from the simulator control panel during bring-up, or touch the real " +
  "robot once it is connected.";

/** What the console expects of a driven row, in words. */
function expectationText(row: MatrixRow): string {
  return row.expectRefusal ? "Refusal (not allow-listed)" : "Ack done or accepted";
}

/** Evidence as one line: ids, closed enums, counts and times, joined. Never text from a turn. */
export function evidenceText(evidence: RowEvidence | null): string {
  if (evidence === null) return NONE;
  const parts: string[] = [];
  if (evidence.code !== null) parts.push(evidence.code);
  if (evidence.refusal !== null) parts.push(evidence.refusal);
  if (evidence.cmd_id !== null) parts.push(evidence.cmd_id);
  if (evidence.turn_id !== null) parts.push(evidence.turn_id);
  if (evidence.outcome !== null) parts.push(evidence.outcome);
  if (typeof evidence.reason === "string" && evidence.reason !== "") parts.push(evidence.reason);
  if (evidence.kind !== null) parts.push(evidence.kind);
  if (evidence.seq !== null) parts.push(`seq ${evidence.seq}`);
  if (evidence.device_id !== null) parts.push(evidence.device_id);
  if (evidence.at !== null) parts.push(evidence.at);
  return parts.length === 0 ? NONE : parts.join(" · ");
}

/** A row's label: its contract member, or the fixed row's own name from its id. */
function rowLabel(row: MatrixRow): string {
  return row.member ?? row.id.slice(row.id.indexOf(":") + 1);
}

function StatusCell({ state }: Readonly<{ state: RowState }>) {
  return <td className="matrix-status">{STATUS_TEXT[state.status]}</td>;
}

export function MatrixPage({ entries, devices, client }: MatrixPageProps) {
  const headingId = useId();
  const resolved = useMemo(() => client ?? createControlClient(), [client]);
  const rows = useMemo(() => buildMatrix(), []);
  const [state, dispatch] = useReducer(matrixReducer, rows, initialMatrixState);

  // One batch per change: the reducer ignores every `seq` it has already folded, so a row that
  // passed stays passed even after its entry falls out of the window or the stream reconnects.
  useEffect(() => {
    dispatch({ type: "entries", entries });
  }, [entries]);

  const deviceId = devices?.[0]?.device_id ?? null;
  const totals = matrixTotals(state);
  const driven = rows.filter((row) => row.direction === "driven");
  const observed = rows.filter((row) => row.direction === "observed");

  const run = (row: MatrixRow): void => {
    if (deviceId === null || row.member === null) return;
    const action = row.member;
    dispatch({ type: "run", rowId: row.id });
    void (async () => {
      const result = await resolved.send(deviceId, action, probeData(action));
      if (result.ok) dispatch({ type: "sent", rowId: row.id, cmd_id: result.cmd_id });
      else dispatch({ type: "refused", rowId: row.id, code: result.code, refusal: result.refusal });
    })();
  };

  return (
    <section className="page matrix-page" aria-labelledby={headingId}>
      <h2 id={headingId}>Test matrix</h2>
      <p className="matrix-note">
        Every row below is built from Document B at page load: one per command action, one per event
        kind, one per touch zone, plus one complete audio turn and one device safety refusal. Add an
        action to Document B and its row appears here with no change to the console. The run is held
        in this page only — reload and it starts again.
      </p>
      <p className="matrix-totals">
        {`${totals.rows} rows · ${totals.passed} passed · ${totals.failed} failed · ` +
          `${totals.running} running · ${totals.pending} pending`}
      </p>
      <p className="matrix-actions">
        <button type="button" onClick={() => dispatch({ type: "reset", rowId: null })}>
          Reset all rows
        </button>
      </p>

      <table className="device-table matrix-table">
        <caption>Cloud to device — the console fires these</caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Expected</th>
            <th scope="col">Status</th>
            <th scope="col">Evidence</th>
            <th scope="col">Run</th>
          </tr>
        </thead>
        <tbody>
          {driven.map((row) => {
            const held = rowState(state, row.id);
            return (
              <tr key={row.id}>
                <th scope="row">{rowLabel(row)}</th>
                <td>{expectationText(row)}</td>
                <StatusCell state={held} />
                <td className="matrix-evidence">{evidenceText(held.evidence)}</td>
                <td className="matrix-row-actions">
                  <button
                    type="button"
                    onClick={() => run(row)}
                    disabled={deviceId === null || held.status === "running"}
                  >
                    {`Run ${rowLabel(row)}`}
                  </button>
                  <button type="button" onClick={() => dispatch({ type: "reset", rowId: row.id })}>
                    {`Reset ${rowLabel(row)}`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {deviceId === null ? (
        <p className="matrix-no-device">
          No device on the stream yet, so nothing can be sent. The run controls stay disabled until
          a device appears on the Devices page.
        </p>
      ) : null}

      <table className="device-table matrix-table">
        <caption>Device to cloud — fire these at the device</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Origin</th>
            <th scope="col">Status</th>
            <th scope="col">Evidence</th>
            <th scope="col">Reset</th>
          </tr>
        </thead>
        <tbody>
          {observed.map((row) => {
            const held = rowState(state, row.id);
            return (
              <tr key={row.id}>
                <th scope="row">{rowLabel(row)}</th>
                <td>{`Device · ${row.group}`}</td>
                <StatusCell state={held} />
                <td className="matrix-evidence">{evidenceText(held.evidence)}</td>
                <td className="matrix-row-actions">
                  <button type="button" onClick={() => dispatch({ type: "reset", rowId: row.id })}>
                    {`Reset ${rowLabel(row)}`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="matrix-note">{OBSERVED_NOTE}</p>
    </section>
  );
}
