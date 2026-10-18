// @vitest-environment jsdom
// The Test Matrix page through the whole console path (Phase 6 Req 4.5–4.9): App with a fake
// EventSource and a fake Control_Client, so every row runs stream client → reducer → page exactly
// as in the browser, and no request leaves the test.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CMD_ACTIONS, EVENT_KINDS, TOUCH_ZONES } from "@xelulu/shared";

import { App } from "../src/app";
import type { ControlClient, ControlResult } from "../src/control/control-client";
import { FIXED_ROWS } from "../src/matrix/test-matrix";
import { PAGE_HASHES } from "../src/routing/use-hash-page";

import {
  ackResult,
  audioTurn,
  DEVICE_ID,
  deviceSummary,
  eventAccepted,
  touchAccepted,
  turnView,
} from "./support/entries";
import { fakeSources } from "./support/fake-event-source";

/** A Control_Client that answers whatever the test queued, and records what it was asked. */
function fakeControl(answer: ControlResult) {
  const sent: { deviceId: string; action: string; data: Readonly<Record<string, unknown>> }[] = [];
  const client: ControlClient = {
    send(deviceId, action, data) {
      sent.push({ deviceId, action, data });
      return Promise.resolve(answer);
    },
  };
  return { client, sent };
}

function tableOf(name: string): HTMLElement {
  return screen.getByRole("table", { name });
}

const DRIVEN_TABLE = "Cloud to device — the console fires these";
const OBSERVED_TABLE = "Device to cloud — fire these at the device";

/** The cells of one row, found by its row header in one of the two tables. */
function rowCells(table: string, label: string): string[] {
  const row = within(tableOf(table)).getByRole("rowheader", { name: label }).closest("tr");
  if (row === null) throw new Error(`no row for ${label}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

function rowOf(table: string, label: string): HTMLElement {
  const row = within(tableOf(table)).getByRole("rowheader", { name: label }).closest("tr");
  if (row === null) throw new Error(`no row for ${label}`);
  return row;
}

function renderMatrix(control?: ControlClient) {
  const fake = fakeSources();
  render(
    <App
      createSource={fake.createSource}
      {...(control === undefined ? {} : { controlClient: control })}
    />,
  );
  act(() => fake.latest().open());
  act(() => fake.latest().emitDevices([deviceSummary()]));
  return fake;
}

describe("Test matrix page", () => {
  beforeEach(() => {
    window.location.hash = PAGE_HASHES.matrix;
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("is in the nav and builds one row per contract member plus the two fixed rows", () => {
    renderMatrix();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Test matrix");
    const nav = screen.getByRole("navigation", { name: "Console pages" });
    expect(within(nav).getByRole("link", { name: "Test matrix" }).getAttribute("href")).toBe(
      PAGE_HASHES.matrix,
    );

    expect(
      within(tableOf(DRIVEN_TABLE))
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual([...CMD_ACTIONS]);
    expect(
      within(tableOf(OBSERVED_TABLE))
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual([...EVENT_KINDS, ...TOUCH_ZONES, ...FIXED_ROWS]);

    const total = CMD_ACTIONS.length + EVENT_KINDS.length + TOUCH_ZONES.length + FIXED_ROWS.length;
    expect(screen.getByText(new RegExp(`^${total} rows`))).toBeTruthy();
  });

  it("gives an observed row no run control and says the device originates it", () => {
    renderMatrix();
    const row = rowOf(OBSERVED_TABLE, "belly");
    const buttons = within(row)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons).toEqual(["Reset belly"]);
    // Not one observed row offers a way to fire it.
    expect(within(tableOf(OBSERVED_TABLE)).queryByRole("button", { name: /^Run / })).toBeNull();
    expect(screen.getByText(/originate at the device/)).toBeTruthy();
  });

  it("greens an observed row when its entry arrives on the stream", () => {
    const fake = renderMatrix();
    expect(rowCells(OBSERVED_TABLE, "left_ear")[1]).toBe("Pending");

    act(() => fake.latest().emitEntry(touchAccepted(4, "left_ear")));
    const cells = rowCells(OBSERVED_TABLE, "left_ear");
    expect(cells[1]).toBe("Pass");
    expect(cells[2]).toContain("seq 4");
    expect(cells[2]).toContain("event_accepted");
    // Only the touched zone greened.
    expect(rowCells(OBSERVED_TABLE, "back")[1]).toBe("Pending");
  });

  it("greens the audio row on one complete turn and the safety row on a rejected ack", () => {
    const fake = renderMatrix();
    act(() => fake.latest().emitEntry(eventAccepted(1, "wake")));
    for (const [index, phase] of (
      ["started", "ended", "reply_started", "reply_ended"] as const
    ).entries()) {
      act(() => fake.latest().emitEntry(audioTurn(2 + index, phase)));
    }
    act(() =>
      fake.latest().emitEntry(
        ackResult(9, {
          cmd_id: "cmd_000009",
          action: "gesture",
          outcome: "rejected",
          reason: "picked_up",
        }),
      ),
    );

    expect(rowCells(OBSERVED_TABLE, "wake")[1]).toBe("Pass");
    expect(rowCells(OBSERVED_TABLE, "audio_turn")[1]).toBe("Pass");
    const safety = rowCells(OBSERVED_TABLE, "safety_refusal");
    expect(safety[1]).toBe("Pass");
    expect(safety[2]).toContain("picked_up");
  });

  it("sends a driven row through the route and greens it on the matching ack", async () => {
    const control = fakeControl({ ok: true, cmd_id: "cmd_000101" });
    const fake = renderMatrix(control.client);

    const run = within(rowOf(DRIVEN_TABLE, "say")).getByRole("button", { name: "Run say" });
    await act(async () => {
      run.click();
    });

    expect(control.sent).toHaveLength(1);
    expect(control.sent[0]?.deviceId).toBe(DEVICE_ID);
    expect(control.sent[0]?.action).toBe("say");
    expect(rowCells(DRIVEN_TABLE, "say")[1]).toBe("Running");
    expect(rowCells(DRIVEN_TABLE, "say")[2]).toContain("cmd_000101");

    act(() =>
      fake
        .latest()
        .emitEntry(ackResult(20, { cmd_id: "cmd_000101", action: "say", outcome: "done" })),
    );
    const cells = rowCells(DRIVEN_TABLE, "say");
    expect(cells[1]).toBe("Pass");
    expect(cells[2]).toContain("done");
  });

  it("fails an allow-listed driven row the gate refuses, showing the Policy_Refusal", async () => {
    const control = fakeControl({ ok: false, code: "action_refused", refusal: "quiet_hours" });
    renderMatrix(control.client);

    const run = within(rowOf(DRIVEN_TABLE, "play")).getByRole("button", { name: "Run play" });
    await act(async () => {
      run.click();
    });

    const cells = rowCells(DRIVEN_TABLE, "play");
    expect(cells[1]).toBe("Fail");
    expect(cells[2]).toContain("quiet_hours");
  });

  it("passes the move row on the gate's refusal and expects nothing else of it", async () => {
    const control = fakeControl({
      ok: false,
      code: "action_refused",
      refusal: "action_not_allowed",
    });
    renderMatrix(control.client);

    expect(rowCells(DRIVEN_TABLE, "move")[0]).toBe("Refusal (not allow-listed)");
    const run = within(rowOf(DRIVEN_TABLE, "move")).getByRole("button", { name: "Run move" });
    await act(async () => {
      run.click();
    });

    const cells = rowCells(DRIVEN_TABLE, "move");
    expect(cells[1]).toBe("Pass");
    expect(cells[2]).toContain("action_not_allowed");
    // The five allow-listed actions expect an ack instead.
    expect(rowCells(DRIVEN_TABLE, "say")[0]).toBe("Ack done or accepted");
  });

  it("resets one row and every row", () => {
    const fake = renderMatrix();
    act(() => fake.latest().emitEntry(touchAccepted(4, "head")));
    expect(rowCells(OBSERVED_TABLE, "head")[1]).toBe("Pass");

    act(() => {
      within(rowOf(OBSERVED_TABLE, "head")).getByRole("button", { name: "Reset head" }).click();
    });
    expect(rowCells(OBSERVED_TABLE, "head")[1]).toBe("Pending");
    expect(rowCells(OBSERVED_TABLE, "touch")[1]).toBe("Pass");

    act(() => {
      screen.getByRole("button", { name: "Reset all rows" }).click();
    });
    expect(rowCells(OBSERVED_TABLE, "touch")[1]).toBe("Pending");
  });

  it("disables every run control until a device is on the stream", () => {
    const fake = fakeSources();
    render(<App createSource={fake.createSource} />);
    act(() => fake.latest().open());

    for (const button of within(tableOf(DRIVEN_TABLE)).getAllByRole("button", { name: /^Run / })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/No device on the stream yet/)).toBeTruthy();
  });

  it("renders no turn text even when the stream carries it", () => {
    const fake = renderMatrix();
    act(() =>
      fake
        .latest()
        .emitTurn(turnView({ transcript_text: "why is the sky blue", reply_text: "sunlight" })),
    );

    const page = screen.getByRole("heading", { level: 2 }).closest("section");
    expect(page?.textContent).not.toContain("why is the sky blue");
    expect(page?.textContent).not.toContain("sunlight");
  });
});
