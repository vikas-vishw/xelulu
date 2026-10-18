// Devices page (Phase 6 Req 3.1–3.5): one row per Device_Summary with its Document C session, its
// derived Pairing_Code and its last ack, plus a touch-zone table per device. Built from the
// Operator_Stream and nothing else — no request, no env read, no Panel_Key name — and it computes
// no session state of its own: the Gateway owns the Device_Session, the page displays it.
//
// Every state is text, never colour alone; the tables are semantic with captions and column
// headers; nothing animates. No token, no `auth`, no turn text appears here.
import { useId } from "react";

import type {
  DeviceLastAck,
  DeviceSessionState,
  DeviceSummary,
  GatewayLogEntry,
} from "@xelulu/shared";

import { zoneActivity } from "../devices/zone-activity";

export type DevicesPageProps = Readonly<{
  /** null until the first `devices` event of the current connection. */
  devices: readonly DeviceSummary[] | null;
  /** Held entries, ascending seq (from ConsoleState); the source of zone activity. */
  entries: readonly GatewayLogEntry[];
}>;

/** Shown wherever a value is not held yet. */
const NONE = "—";

/** Document C 2.3, in words an operator can act on. Keys are the Device_Session_States. */
const SESSION_TEXT: Readonly<Record<DeviceSessionState, string>> = Object.freeze({
  unpaired: "Unpaired — no hello accepted yet",
  connected: "Connected — hello accepted",
  idle: "Idle — heartbeat accepted",
  in_turn: "In turn — audio turn open",
  error: "Error — auth failed, message rejected, or error event",
  offline: "Offline — 45 s silence",
});

/** The 45 s silence rule, as the Gateway reports it. */
const PRESENCE_TEXT: Readonly<Record<DeviceSummary["presence"], string>> = Object.freeze({
  online: "Online",
  offline: "Offline",
  unknown: "Not seen yet",
});

/** HH:MM:SS UTC from an ISO 8601 time, or the text as given when it is not one. */
function timeText(at: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(at);
  return match?.[1] === undefined ? at : `${match[1]} UTC`;
}

function batteryText(device: DeviceSummary): string {
  if (device.battery_pct === null) return NONE;
  return device.charging === true ? `${device.battery_pct}%, charging` : `${device.battery_pct}%`;
}

/** The last ack as its action, outcome and `reason` (Req 3.2). An ack `reason` is final. */
export function lastAckText(ack: DeviceLastAck | null): string {
  if (ack === null) return NONE;
  const text = `${ack.action} ${ack.outcome}`;
  return typeof ack.reason === "string" && ack.reason !== "" ? `${text} (${ack.reason})` : text;
}

/** "Yes" only while the session is the in-turn state, so going offline clears it (Req 3.4). */
function inTurnText(session: DeviceSessionState): string {
  return session === "in_turn" ? "Yes" : "No";
}

function TimeCell({ at }: Readonly<{ at: string | null }>) {
  if (at === null) return <>{NONE}</>;
  return <time dateTime={at}>{timeText(at)}</time>;
}

function DeviceSessionTable({ devices }: Readonly<{ devices: readonly DeviceSummary[] }>) {
  return (
    <table className="device-table devices-table">
      <caption>Device sessions</caption>
      <thead>
        <tr>
          <th scope="col">Device ID</th>
          <th scope="col">Pairing code</th>
          <th scope="col">Session</th>
          <th scope="col">Presence</th>
          <th scope="col">In turn</th>
          <th scope="col">Firmware</th>
          <th scope="col">Battery</th>
          <th scope="col">Last heartbeat</th>
          <th scope="col">Events accepted</th>
          <th scope="col">Duplicate events</th>
          <th scope="col">Last ack</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((device) => (
          <tr key={device.device_id}>
            <th scope="row">{device.device_id}</th>
            <td>{device.pairing_code ?? NONE}</td>
            <td>{SESSION_TEXT[device.session]}</td>
            <td>{PRESENCE_TEXT[device.presence]}</td>
            <td>{inTurnText(device.session)}</td>
            <td>{device.fw_ver ?? NONE}</td>
            <td>{batteryText(device)}</td>
            <td>
              <TimeCell at={device.last_heartbeat_at} />
            </td>
            <td>{device.events_accepted}</td>
            <td>{device.events_duplicate}</td>
            <td>{lastAckText(device.last_ack)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZoneTable(props: Readonly<{ deviceId: string; entries: readonly GatewayLogEntry[] }>) {
  const rows = zoneActivity(props.entries, props.deviceId);
  return (
    <table className="device-table zone-table">
      <caption>{`Touch zones — ${props.deviceId}`}</caption>
      <thead>
        <tr>
          <th scope="col">Zone</th>
          <th scope="col">Last touch</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.zone}>
            <th scope="row">{row.zone}</th>
            <td>
              <TimeCell at={row.last_at} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DevicesPage({ devices, entries }: DevicesPageProps) {
  const headingId = useId();
  return (
    <section className="page devices-page" aria-labelledby={headingId}>
      <h2 id={headingId}>Devices</h2>
      <p className="devices-note">
        Presence and session are two different facts. Presence is Document B&apos;s 45 s silence
        rule; the session is what Document C 2.3 says the cloud saw. A device whose presence reads
        Online while its session still reads Offline or Unpaired resumed its heartbeat without
        republishing <code>hello</code> — a Document C 2.3 conformance failure, shown rather than
        hidden. The pairing code is a confirmation to read out loud, never a credential.
      </p>
      {devices === null ? (
        <p className="device-list-empty">Waiting for device data.</p>
      ) : devices.length === 0 ? (
        <p className="device-list-empty">No devices registered.</p>
      ) : (
        <>
          <DeviceSessionTable devices={devices} />
          {devices.map((device) => (
            <ZoneTable key={device.device_id} deviceId={device.device_id} entries={entries} />
          ))}
        </>
      )}
    </section>
  );
}
