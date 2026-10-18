// @vitest-environment jsdom
// Devices page through the whole console path (Phase 6 Req 3.1–3.5): App with a fake EventSource,
// so each event runs stream client → reducer → page exactly as in the browser.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOUCH_ZONES } from "@xelulu/shared";
import type { DeviceLastAck } from "@xelulu/shared";

import { App } from "../src/app";
import { PAGE_HASHES } from "../src/routing/use-hash-page";

import { DEVICE_ID, atFor, deviceSummary, touchAccepted, turnView } from "./support/entries";
import { fakeSources } from "./support/fake-event-source";

/** The text of each data cell in the device's session row (device_id is its row header). */
function sessionRowCells(deviceId: string): string[] {
  const table = screen.getByRole("table", { name: "Device sessions" });
  const row = within(table).getByRole("rowheader", { name: deviceId }).closest("tr");
  if (row === null) throw new Error("no session row");
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

/** The "Last touch" cell for one zone of one device. */
function zoneCell(deviceId: string, zone: string): string {
  const table = screen.getByRole("table", { name: `Touch zones — ${deviceId}` });
  const row = within(table).getByRole("rowheader", { name: zone }).closest("tr");
  if (row === null) throw new Error(`no row for zone ${zone}`);
  return within(row).getAllByRole("cell")[0]?.textContent ?? "";
}

function renderDevicesPage() {
  const fake = fakeSources();
  render(<App createSource={fake.createSource} />);
  act(() => fake.latest().open());
  return fake;
}

const MOVE_REJECTED: DeviceLastAck = Object.freeze({
  action: "move",
  outcome: "rejected",
  reason: "picked_up",
  cmd_id: "cmd_000009",
});

describe("Devices page", () => {
  beforeEach(() => {
    window.location.hash = PAGE_HASHES.devices;
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("is reachable from the nav and shows no data before a devices event", () => {
    renderDevicesPage();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Devices");
    const nav = screen.getByRole("navigation", { name: "Console pages" });
    expect(within(nav).getByRole("link", { name: "Devices" }).getAttribute("href")).toBe(
      PAGE_HASHES.devices,
    );
    expect(screen.getByText("Waiting for device data.")).toBeTruthy();
  });

  it("shows the session, pairing code, firmware and last ack of a device", () => {
    const fake = renderDevicesPage();
    act(() =>
      fake
        .latest()
        .emitDevices([
          deviceSummary({ session: "connected", events_accepted: 2, last_ack: MOVE_REJECTED }),
        ]),
    );

    expect(sessionRowCells(DEVICE_ID)).toEqual([
      "B7K2QD",
      "Connected — hello accepted",
      "Online",
      "No",
      "0.1.0",
      "100%",
      "10:00:00 UTC",
      "2",
      "0",
      "move rejected (picked_up)",
    ]);
  });

  it("shows a dash for every value a device has not reported yet", () => {
    const fake = renderDevicesPage();
    act(() =>
      fake.latest().emitDevices([
        deviceSummary({
          session: "unpaired",
          presence: "unknown",
          pairing_code: null,
          fw_ver: null,
          battery_pct: null,
          charging: null,
          last_heartbeat_at: null,
        }),
      ]),
    );

    expect(sessionRowCells(DEVICE_ID)).toEqual([
      "—",
      "Unpaired — no hello accepted yet",
      "Not seen yet",
      "No",
      "—",
      "—",
      "—",
      "0",
      "0",
      "—",
    ]);
  });

  it("holds one row per contract touch zone and fills the zone a touch arrived on", () => {
    const fake = renderDevicesPage();
    act(() => fake.latest().emitDevices([deviceSummary()]));
    act(() => fake.latest().emitEntry(touchAccepted(4, "left_ear")));

    const table = screen.getByRole("table", { name: `Touch zones — ${DEVICE_ID}` });
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual([...TOUCH_ZONES]);
    expect(zoneCell(DEVICE_ID, "left_ear")).toBe("10:00:04 UTC");
    expect(zoneCell(DEVICE_ID, "belly")).toBe("—");
  });

  it("follows a session change on the stream with no reload", () => {
    const fake = renderDevicesPage();
    act(() => fake.latest().emitDevices([deviceSummary({ session: "idle" })]));
    expect(sessionRowCells(DEVICE_ID)[1]).toBe("Idle — heartbeat accepted");
    expect(sessionRowCells(DEVICE_ID)[3]).toBe("No");

    act(() => fake.latest().emitDevices([deviceSummary({ session: "in_turn" })]));
    expect(sessionRowCells(DEVICE_ID)[1]).toBe("In turn — audio turn open");
    expect(sessionRowCells(DEVICE_ID)[3]).toBe("Yes");
  });

  it("keeps the row and clears the in-turn cell when the device goes offline", () => {
    const fake = renderDevicesPage();
    act(() => fake.latest().emitDevices([deviceSummary({ session: "in_turn" })]));
    act(() =>
      fake.latest().emitDevices([deviceSummary({ session: "offline", presence: "offline" })]),
    );

    const cells = sessionRowCells(DEVICE_ID);
    expect(cells[1]).toBe("Offline — 45 s silence");
    expect(cells[2]).toBe("Offline");
    expect(cells[3]).toBe("No");
    // The row stays, so the operator still sees what was last seen (Req 3.4).
    expect(cells[6]).toBe("10:00:00 UTC");
  });

  it("shows presence and session side by side when they disagree", () => {
    const fake = renderDevicesPage();
    // Heartbeats resumed without a republished `hello`: Document C 2.3's conformance failure.
    act(() =>
      fake.latest().emitDevices([deviceSummary({ session: "offline", presence: "online" })]),
    );

    const cells = sessionRowCells(DEVICE_ID);
    expect(cells[1]).toBe("Offline — 45 s silence");
    expect(cells[2]).toBe("Online");
  });

  it("renders no turn text even when the stream carries it", () => {
    const fake = renderDevicesPage();
    act(() => fake.latest().emitDevices([deviceSummary()]));
    act(() =>
      fake
        .latest()
        .emitTurn(turnView({ transcript_text: "why is the sky blue", reply_text: "sunlight" })),
    );

    const page = screen.getByRole("heading", { level: 2 }).closest("section");
    expect(page?.textContent).not.toContain("why is the sky blue");
    expect(page?.textContent).not.toContain("sunlight");
  });

  it("shows a time element carrying the full ISO instant", () => {
    const fake = renderDevicesPage();
    act(() => fake.latest().emitDevices([deviceSummary()]));
    const times = screen.getAllByText("10:00:00 UTC");
    expect(times[0]?.getAttribute("datetime")).toBe(atFor(0));
  });
});
