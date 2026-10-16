// Devices + Live Log page (Req 6.1, 6.2, 6.4, 6.5, 8.4). It receives console state as props;
// app.tsx owns the stream hook. The device list is a real table with a caption and column
// headers; presence and battery are text, never colour alone. Nothing here animates.
import type { DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import { LiveLog } from "../components/live-log";

export type LiveLogPageProps = Readonly<{
  /** null until the first devices event of the current connection. */
  devices: readonly DeviceSummary[] | null;
  /** Held entries, ascending seq (from ConsoleState). */
  entries: readonly GatewayLogEntry[];
}>;

const PRESENCE_TEXT: Readonly<Record<DeviceSummary["presence"], string>> = Object.freeze({
  online: "Online",
  offline: "Offline",
  unknown: "Not seen yet",
});

function batteryText(device: DeviceSummary): string {
  if (device.battery_pct === null) return "—";
  return device.charging === true ? `${device.battery_pct}%, charging` : `${device.battery_pct}%`;
}

/** HH:MM:SS UTC from an ISO 8601 time, or the text as given when it is not one. */
function heartbeatText(at: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(at);
  return match?.[1] === undefined ? at : `${match[1]} UTC`;
}

function DeviceListTable({ devices }: Readonly<{ devices: readonly DeviceSummary[] }>) {
  return (
    <table className="device-list">
      <caption>Devices</caption>
      <thead>
        <tr>
          <th scope="col">Device ID</th>
          <th scope="col">Presence</th>
          <th scope="col">Battery</th>
          <th scope="col">Last heartbeat</th>
          <th scope="col">Events accepted</th>
          <th scope="col">Duplicate events</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((device) => (
          <tr key={device.device_id}>
            <th scope="row">{device.device_id}</th>
            <td>{PRESENCE_TEXT[device.presence]}</td>
            <td>{batteryText(device)}</td>
            <td>
              {device.last_heartbeat_at === null ? (
                "—"
              ) : (
                <time dateTime={device.last_heartbeat_at}>
                  {heartbeatText(device.last_heartbeat_at)}
                </time>
              )}
            </td>
            <td>{device.events_accepted}</td>
            <td>{device.events_duplicate}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LiveLogPage({ devices, entries }: LiveLogPageProps) {
  return (
    <div className="page live-log-page">
      <section className="device-list-section" aria-label="Devices">
        {devices === null ? (
          <p className="device-list-empty">Waiting for device data.</p>
        ) : devices.length === 0 ? (
          <p className="device-list-empty">No devices registered.</p>
        ) : (
          <DeviceListTable devices={devices} />
        )}
      </section>
      <LiveLog entries={entries} />
    </div>
  );
}
