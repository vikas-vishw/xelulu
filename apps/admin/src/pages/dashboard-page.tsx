// Dashboard (Req 5.1, 5.2, 5.3, 8.4): three count tiles and the Device Health table, all from
// the latest `devices` event. State arrives as props (app.tsx owns the stream hook), so a new
// `devices` event simply re-renders with its values. Counts are text; nothing animates.
import { useId } from "react";

import type { DeviceSummary } from "@xelulu/shared";

import { DeviceHealthTable } from "../components/device-health-table";
import { tileCounts } from "../stream/console-state";

export type DashboardPageProps = Readonly<{
  /** null until the first `devices` event of the current connection. */
  devices: readonly DeviceSummary[] | null;
}>;

/** Shown in a tile before any `devices` event has arrived. */
const NO_DATA = "—";

export function DashboardPage({ devices }: DashboardPageProps) {
  const headingId = useId();
  const counts = devices === null ? null : tileCounts(devices);
  const tiles: readonly Readonly<{ label: string; value: string }>[] = [
    { label: "Devices", value: counts === null ? NO_DATA : String(counts.total) },
    { label: "Online", value: counts === null ? NO_DATA : String(counts.online) },
    { label: "Offline", value: counts === null ? NO_DATA : String(counts.offline) },
  ];

  return (
    <section className="page dashboard-page" aria-labelledby={headingId}>
      <h2 id={headingId}>Dashboard</h2>
      <dl className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className="tile">
            <dt className="tile-label">{t.label}</dt>
            <dd className="tile-value">{t.value}</dd>
          </div>
        ))}
      </dl>
      <DeviceHealthTable devices={devices} />
    </section>
  );
}
