// The Device Control page (Phase 6 Req 5.7): the operator fires the allow-listed commands by hand
// and reads exactly what the device answered. A bring-up and debugging surface, not a product one.
//
// WHAT IT CAN AND CANNOT DO. One control per allow-listed action, derived from the contract and the
// same decision table the Test_Matrix uses, so there is no control for `move` and none for any
// other action outside `DEVICE_ACTION_ALLOWED` — not because the page hides them, but because the
// list it walks never contains them. The Gateway's Device_Action_Gate refuses them anyway, which is
// the real guarantee; this page simply does not offer the operator a button that cannot work.
//
// WHAT IT SHOWS. Per request: the action, the target device, the `cmd_id` the route minted, and
// then the ack's outcome and `reason` once it arrives on the Operator_Stream. An ack `reason` is
// final: nothing here retries, and the page offers no way to. A refusal is shown as its own code
// and Policy_Refusal — `quiet_hours` at night is the gate working, not a broken page.
//
// Every value on this page is an id, a closed enum, a count or a time. No token, no env value, no
// Panel_Key name, no text from any turn. Nothing animates.
import { useEffect, useId, useMemo, useState } from "react";

import type { AckReason, AckResultOutcome, DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import { probeData } from "../control/command-data";
import {
  createControlClient,
  type ControlClient,
  type ControlResult,
} from "../control/control-client";
import { DRIVABLE_ACTIONS } from "../matrix/test-matrix";

export type ControlPageProps = Readonly<{
  /** null until the first `devices` event; the operator picks the target from this list. */
  devices: readonly DeviceSummary[] | null;
  /** Held entries, ascending seq (from ConsoleState). Where a sent command's ack is found. */
  entries: readonly GatewayLogEntry[];
  /** The browser's client unless a test passes a fake. */
  client?: ControlClient;
}>;

/** Shown wherever a value is not held yet. */
const NONE = "—";

/** One attempt by the operator, in the order they were made (newest first on the page). */
type Attempt = Readonly<{
  /** Monotonic within this page's life, so React has a stable key per attempt. */
  n: number;
  action: string;
  device_id: string;
  /** The `cmd_id` the route minted, or null when it refused before sending. */
  cmd_id: string | null;
  /** The route's error code, or the client's `proxy_disabled` / `unreachable`. */
  code: string | null;
  /** The Device_Action_Gate's Policy_Refusal, when the gate was the one that answered. */
  refusal: string | null;
}>;

/** The ack an attempt is waiting for, read off the stream by `cmd_id` (Req 5.7). */
export type AttemptAck = Readonly<{
  outcome: AckResultOutcome;
  reason: "" | AckReason | null;
  action: string | null;
  seq: number;
}>;

/**
 * The LAST ack held for a `cmd_id`, or null. The last and not the first: a device may answer
 * `accepted` and then `done` or `failed`, and the operator wants the outcome that stands rather
 * than the one that arrived first.
 */
export function ackFor(
  entries: readonly GatewayLogEntry[],
  cmdId: string | null,
): AttemptAck | null {
  if (cmdId === null) return null;
  let found: AttemptAck | null = null;
  for (const entry of entries) {
    if (entry.kind !== "ack_result" || entry.cmd_id !== cmdId) continue;
    found = {
      outcome: entry.outcome,
      reason: entry.reason,
      action: entry.action,
      seq: entry.seq,
    };
  }
  return found;
}

/** The ack in words: its outcome, and its `reason` when the device gave one. */
export function ackText(ack: AttemptAck | null, pending: boolean): string {
  if (ack === null) return pending ? "Waiting for ack" : NONE;
  return typeof ack.reason === "string" && ack.reason !== ""
    ? `${ack.outcome} (${ack.reason})`
    : ack.outcome;
}

/** A refusal in words: the route's code, plus the gate's Policy_Refusal when it carried one. */
export function refusalText(attempt: Attempt): string {
  if (attempt.code === null) return NONE;
  return attempt.refusal === null ? attempt.code : `${attempt.code} · ${attempt.refusal}`;
}

export function ControlPage({ devices, entries, client }: ControlPageProps) {
  const headingId = useId();
  const selectId = useId();
  const resolved = useMemo(() => client ?? createControlClient(), [client]);
  const [attempts, setAttempts] = useState<readonly Attempt[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<readonly string[]>([]);

  const ids = useMemo(() => (devices ?? []).map((device) => device.device_id), [devices]);

  // The target follows the stream: the first device when none is chosen, and it falls back when
  // the chosen one leaves the list. The operator always sees which device a command goes to.
  useEffect(() => {
    setTarget((held) => (held !== null && ids.includes(held) ? held : (ids[0] ?? null)));
  }, [ids]);

  const send = (action: string): void => {
    if (target === null) return;
    const deviceId = target;
    setBusy((held) => [...held, action]);
    void (async () => {
      const result: ControlResult = await resolved.send(deviceId, action, probeData(action));
      setAttempts((held) => [
        {
          n: held.length + 1,
          action,
          device_id: deviceId,
          cmd_id: result.ok ? result.cmd_id : null,
          code: result.ok ? null : result.code,
          refusal: result.ok ? null : result.refusal,
        },
        ...held,
      ]);
      setBusy((held) => held.filter((name) => name !== action));
    })();
  };

  return (
    <section className="page control-page" aria-labelledby={headingId}>
      <h2 id={headingId}>Device control</h2>
      <p className="control-note">
        These are the actions the device-action gate allows. Movement is not among them and never
        will be from here: the body controller owns its own hard limits, so the gate refuses a move
        command whoever asks for it. Quiet hours, a reached play limit and the movement toggle
        refuse the rest, and a refusal shown below is the gate working rather than a broken control.
        Every ack reason is final — nothing here retries.
      </p>
      <p className="control-note">
        The route is off unless the gateway runs in local mode with its device-control argument and
        the dev server runs in device-control mode. Without both, a send answers with a disabled or
        proxy refusal below, and nothing reaches the robot.
      </p>

      <p className="control-target">
        {ids.length === 0 ? (
          <span className="device-list-empty">No device on the stream yet.</span>
        ) : (
          <>
            <label htmlFor={selectId}>Target device</label>{" "}
            <select
              id={selectId}
              value={target ?? ""}
              onChange={(event) => setTarget(event.target.value)}
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </>
        )}
      </p>

      <p className="control-actions">
        {DRIVABLE_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => send(action)}
            disabled={target === null || busy.includes(action)}
          >
            {`Send ${action}`}
          </button>
        ))}
      </p>

      <table className="device-table control-table">
        <caption>Commands sent from this page</caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Device</th>
            <th scope="col">Command ID</th>
            <th scope="col">Ack</th>
            <th scope="col">Refusal</th>
          </tr>
        </thead>
        <tbody>
          {attempts.length === 0 ? (
            <tr>
              <td colSpan={5}>Nothing sent from this page yet.</td>
            </tr>
          ) : (
            attempts.map((attempt) => {
              const ack = ackFor(entries, attempt.cmd_id);
              return (
                <tr key={attempt.n}>
                  <th scope="row">{attempt.action}</th>
                  <td>{attempt.device_id}</td>
                  <td className="control-cmd-id">{attempt.cmd_id ?? NONE}</td>
                  <td>{ackText(ack, attempt.cmd_id !== null)}</td>
                  <td>{refusalText(attempt)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
