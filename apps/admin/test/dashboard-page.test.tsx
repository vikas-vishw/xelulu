// @vitest-environment jsdom
// Dashboard through the whole console path (Req 10.4, 5.1, 5.2, 5.3): App with a fake
// EventSource, so each event runs stream client → reducer → page exactly as in the browser.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app";

import { DEVICE_ID, deviceSummary } from "./support/entries";
import { fakeSources } from "./support/fake-event-source";

/** The value shown under one tile label (`<dt>` label, `<dd>` value). */
function tileValue(label: string): string | null {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? null;
}

/** The text of each data cell in the device's Device Health row. */
function healthRowCells(deviceId: string): string[] {
  const table = screen.getByRole("table", { name: "Device Health" });
  const row = within(table).getByRole("rowheader", { name: deviceId }).closest("tr");
  if (row === null) throw new Error("no health row");
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

function renderLiveDashboard() {
  const fake = fakeSources();
  render(<App createSource={fake.createSource} />);
  act(() => fake.latest().open());
  return fake;
}

describe("Dashboard page", () => {
  beforeEach(() => {
    window.location.hash = "#/";
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("opens the stream at the relative path and shows no data before a devices event", () => {
    const fake = fakeSources();
    render(<App createSource={fake.createSource} />);
    expect(fake.sources).toHaveLength(1);
    expect(fake.latest().url).toBe("/v1/stream");
    expect(screen.getByRole("status").textContent).toBe("Stream: Connecting");
    expect(tileValue("Devices")).toBe("—");
    expect(screen.getByText("Waiting for device data.")).toBeTruthy();
  });

  it("shows tiles 1/1/0 and the device's health row from the first devices event", () => {
    const fake = renderLiveDashboard();
    act(() => fake.latest().emitDevices([deviceSummary()]));

    expect(screen.getByRole("status").textContent).toContain("Live");
    expect(tileValue("Devices")).toBe("1");
    expect(tileValue("Online")).toBe("1");
    expect(tileValue("Offline")).toBe("0");
    expect(healthRowCells(DEVICE_ID)).toEqual(["Online", "100%"]);
  });

  it("updates the tiles and the row on a second devices event", () => {
    const fake = renderLiveDashboard();
    act(() => fake.latest().emitDevices([deviceSummary()]));
    act(() => fake.latest().emitDevices([deviceSummary({ presence: "offline", battery_pct: 87 })]));

    expect(tileValue("Devices")).toBe("1");
    expect(tileValue("Online")).toBe("0");
    expect(tileValue("Offline")).toBe("1");
    expect(healthRowCells(DEVICE_ID)).toEqual(["Offline", "87%"]);
  });
});
