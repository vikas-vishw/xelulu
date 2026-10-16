// @vitest-environment jsdom
// Devices + Live Log page through the whole console path (Req 10.4, 6.2, 6.3, 6.4, 6.5): App with
// a fake EventSource. Property 5 (Live_Log window) and Property 6 (Filter), example-based (C15).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GatewayLogEntry } from "@xelulu/shared";

import { App } from "../src/app";
import { LIVE_LOG_CAP } from "../src/stream/console-state";

import {
  DEVICE_ID,
  deviceSummary,
  moveAckRejected,
  sayAckDone,
  sayOut,
  touchAccepted,
} from "./support/entries";
import { fakeSources } from "./support/fake-event-source";

type Row = Readonly<{ kind: string; device: string | null; label: string }>;

/** The Live_Log rows in display order. */
function shownRows(): Row[] {
  const list = screen.getByRole("list", { name: "Recent logs and events" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => ({
      kind: item.querySelector(".live-log-kind")?.textContent ?? "",
      device: item.querySelector(".live-log-device")?.textContent ?? null,
      label: item.querySelector(".live-log-label")?.textContent ?? "",
    }));
}

/** Renders the live page, opens the stream and sends one devices event plus these entries. */
function renderLiveLog(entries: readonly GatewayLogEntry[]) {
  const fake = fakeSources();
  render(<App createSource={fake.createSource} />);
  act(() => {
    const source = fake.latest();
    source.open();
    source.emitDevices([deviceSummary()]);
    for (const entry of entries) source.emitEntry(entry);
  });
  return fake;
}

describe("Live_Log page", () => {
  beforeEach(() => {
    window.location.hash = "#/live";
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("shows the device table and entries newest first, whatever the arrival order", () => {
    renderLiveLog([sayOut(2), touchAccepted(1), sayAckDone(3)]);

    const devices = screen.getByRole("table", { name: "Devices" });
    expect(within(devices).getByRole("rowheader", { name: DEVICE_ID })).toBeTruthy();
    expect(shownRows().map((r) => r.label)).toEqual([
      "ack done for say cmd_000003",
      "sent say cmd_000002",
      "touch belly (tap)",
    ]);
  });

  it("labels a touch event `touch belly (tap)` with its kind and device", () => {
    renderLiveLog([touchAccepted(1, "belly", "tap")]);

    expect(shownRows()).toEqual([
      { kind: "event_accepted", device: DEVICE_ID, label: "touch belly (tap)" },
    ]);
  });

  it("keeps the 500 highest seq of 600 entries, newest first (Property 5)", () => {
    const entries = Array.from({ length: 600 }, (_, i) => sayOut(i + 1));
    const fake = renderLiveLog(entries);

    let rows = shownRows();
    expect(LIVE_LOG_CAP).toBe(500);
    expect(rows).toHaveLength(500);
    expect(rows[0]?.label).toBe("sent say cmd_000600");
    expect(rows.at(-1)?.label).toBe("sent say cmd_000101");
    expect(screen.getByText(/Showing 500 of 500 entries/)).toBeTruthy();

    // A repeated seq and one below the window change nothing.
    act(() => {
      fake.latest().emitEntry(sayOut(600));
      fake.latest().emitEntry(sayOut(50));
    });
    rows = shownRows();
    expect(rows).toHaveLength(500);
    expect(rows[0]?.label).toBe("sent say cmd_000600");
    expect(rows.at(-1)?.label).toBe("sent say cmd_000101");
  });

  it("filters to ack_result and back to All with the labelled filter (Property 6)", () => {
    renderLiveLog([
      touchAccepted(1),
      sayOut(2),
      sayAckDone(3),
      moveAckRejected(4),
      touchAccepted(5, "head", "pat"),
    ]);
    const filter = screen.getByLabelText("Entry type");

    fireEvent.change(filter, { target: { value: "ack_result" } });
    let rows = shownRows();
    expect(rows.every((r) => r.kind === "ack_result")).toBe(true);
    expect(rows.map((r) => r.label)).toEqual([
      "ack rejected for move cmd_000004 (picked_up)",
      "ack done for say cmd_000003",
    ]);
    expect(screen.getByText(/Showing 2 of 5 entries/)).toBeTruthy();

    fireEvent.change(filter, { target: { value: "all" } });
    rows = shownRows();
    expect(rows.map((r) => r.kind)).toEqual([
      "event_accepted",
      "ack_result",
      "ack_result",
      "message_out",
      "event_accepted",
    ]);
  });
});
