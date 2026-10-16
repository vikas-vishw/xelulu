// Device Health table for the Dashboard (Req 5.2, 5.3, 8.4): a semantic table with a caption
// and column headers. Presence and battery are text, never colour alone, and nothing animates.
// `devices` is null until the first `devices` event of the current connection.
import type { DevicePresence, DeviceSummary } from "@xelulu/shared";

const PRESENCE_TEXT: Readonly<Record<DevicePresence, string>> = Object.freeze({
  online: "Online",
  offline: "Offline",
  unknown: "Not seen yet",
});

/** Battery as text: `<pct>%` or "—" when unknown, plus "charging" when charging is true. */
export function batteryText(d: Pick<DeviceSummary, "battery_pct" | "charging">): string {
  const pct = d.battery_pct === null ? "—" : `${d.battery_pct}%`;
  return d.charging === true ? `${pct}, charging` : pct;
}

/** Presence as text (Req 5.2). */
export function presenceText(presence: DevicePresence): string {
  return PRESENCE_TEXT[presence];
}

const COLUMN_COUNT = 3;

export type DeviceHealthTableProps = Readonly<{
  devices: readonly DeviceSummary[] | null;
}>;

export function DeviceHealthTable({ devices }: DeviceHealthTableProps) {
  return (
    <table className="device-table device-health-table">
      <caption>Device Health</caption>
      <thead>
        <tr>
          <th scope="col">Device ID</th>
          <th scope="col">Presence</th>
          <th scope="col">Battery</th>
        </tr>
      </thead>
      <tbody>
        {devices === null ? (
          <tr>
            <td colSpan={COLUMN_COUNT}>Waiting for device data.</td>
          </tr>
        ) : devices.length === 0 ? (
          <tr>
            <td colSpan={COLUMN_COUNT}>No devices registered.</td>
          </tr>
        ) : (
          devices.map((d) => (
            <tr key={d.device_id}>
              <th scope="row">{d.device_id}</th>
              <td className={`presence presence-${d.presence}`}>{presenceText(d.presence)}</td>
              <td>{batteryText(d)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
