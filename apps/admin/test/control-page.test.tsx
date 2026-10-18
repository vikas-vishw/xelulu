// @vitest-environment jsdom
// The Device Control page through the whole console path (Phase 6 Req 5.7, 8.5): App with a fake
// EventSource and a fake Control_Client, so a send runs page → client → reducerless state → stream
// exactly as in the browser, and no request leaves the test.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CMD_ACTIONS } from "@xelulu/shared";

import { App } from "../src/app";
import type { ControlClient, ControlResult } from "../src/control/control-client";
import { ackFor, ackText, refusalText } from "../src/pages/control-page";
import { DRIVABLE_ACTIONS } from "../src/matrix/test-matrix";
import { PAGE_HASHES } from "../src/routing/use-hash-page";

import { ackResult, DEVICE_ID, deviceSummary, turnView } from "./support/entries";
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

const TABLE = "Commands sent from this page";

function table(): HTMLElement {
  return screen.getByRole("table", { name: TABLE });
}

/** The cells of the one attempt row with this action as its row header. */
function rowCells(action: string): string[] {
  const row = within(table()).getByRole("rowheader", { name: action }).closest("tr");
  if (row === null) throw new Error(`no row for ${action}`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

function renderControl(control?: ControlClient, devices = [deviceSummary()]) {
  const fake = fakeSources();
  render(
    <App
      createSource={fake.createSource}
      {...(control === undefined ? {} : { controlClient: control })}
    />,
  );
  act(() => fake.latest().open());
  act(() => fake.latest().emitDevices(devices));
  return fake;
}

async function clickSend(action: string): Promise<void> {
  const button = screen.getByRole("button", { name: `Send ${action}` });
  await act(async () => {
    button.click();
  });
}

describe("Device control page", () => {
  beforeEach(() => {
    window.location.hash = PAGE_HASHES.control;
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("is in the nav and offers one control per allow-listed action", () => {
    renderControl();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Device control");
    const nav = screen.getByRole("navigation", { name: "Console pages" });
    expect(within(nav).getByRole("link", { name: "Device control" }).getAttribute("href")).toBe(
      PAGE_HASHES.control,
    );

    const labels = screen
      .getAllByRole("button", { name: /^Send / })
      .map((button) => button.textContent);
    expect(labels).toEqual(DRIVABLE_ACTIONS.map((action) => `Send ${action}`));
    expect(DRIVABLE_ACTIONS.length).toBeGreaterThan(0);
  });

  it("offers no control for move or any other action the gate does not allow", () => {
    renderControl();
    for (const action of CMD_ACTIONS.filter((a) => !DRIVABLE_ACTIONS.includes(a))) {
      expect(screen.queryByRole("button", { name: `Send ${action}` })).toBeNull();
    }
    // Named explicitly, because `move` is the one that matters (safety.md §5).
    expect(screen.queryByRole("button", { name: "Send move" })).toBeNull();
    expect(DRIVABLE_ACTIONS).not.toContain("move");
  });

  it("shows the target device, and the operator can choose among several", () => {
    renderControl(undefined, [
      deviceSummary(),
      deviceSummary({ device_id: "xlu_000999", pairing_code: "K3MPQW" }),
    ]);
    const select = screen.getByRole("combobox", { name: "Target device" });
    expect((select as HTMLSelectElement).value).toBe(DEVICE_ID);
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([DEVICE_ID, "xlu_000999"]);
  });

  it("disables every control until a device is on the stream", () => {
    const fake = fakeSources();
    render(<App createSource={fake.createSource} />);
    act(() => fake.latest().open());
    for (const button of screen.getAllByRole("button", { name: /^Send / })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText("No device on the stream yet.")).toBeTruthy();
  });

  it("shows the cmd_id on a send, then the ack from the stream", async () => {
    const control = fakeControl({ ok: true, cmd_id: "cmd_000301" });
    const fake = renderControl(control.client);
    expect(screen.getByText("Nothing sent from this page yet.")).toBeTruthy();

    await clickSend("say");
    expect(control.sent).toHaveLength(1);
    expect(control.sent[0]?.deviceId).toBe(DEVICE_ID);
    expect(control.sent[0]?.action).toBe("say");
    // A minimal valid body, derived from the contract's own vocabularies.
    expect(Object.keys(control.sent[0]?.data ?? {}).length).toBeGreaterThan(0);

    let cells = rowCells("say");
    expect(cells[0]).toBe(DEVICE_ID);
    expect(cells[1]).toBe("cmd_000301");
    expect(cells[2]).toBe("Waiting for ack");

    act(() =>
      fake
        .latest()
        .emitEntry(ackResult(30, { cmd_id: "cmd_000301", action: "say", outcome: "done" })),
    );
    cells = rowCells("say");
    expect(cells[2]).toBe("done");
    expect(cells[3]).toBe("—");
  });

  it("shows the device's ack reason, which is final and never retried around", async () => {
    const control = fakeControl({ ok: true, cmd_id: "cmd_000302" });
    const fake = renderControl(control.client);
    await clickSend("animate");
    act(() =>
      fake.latest().emitEntry(
        ackResult(31, {
          cmd_id: "cmd_000302",
          action: "animate",
          outcome: "rejected",
          reason: "picked_up",
        }),
      ),
    );
    expect(rowCells("animate")[2]).toBe("rejected (picked_up)");
    // One send and no more: nothing on the page reacts to a rejection by sending again.
    expect(control.sent).toHaveLength(1);
  });

  it("shows a gate refusal as its code and Policy_Refusal, with no cmd_id", async () => {
    const control = fakeControl({ ok: false, code: "action_refused", refusal: "quiet_hours" });
    renderControl(control.client);
    await clickSend("play");

    const cells = rowCells("play");
    expect(cells[1]).toBe("—");
    expect(cells[2]).toBe("—");
    expect(cells[3]).toBe("action_refused · quiet_hours");
  });

  it("shows the disabled refusal plainly when the route is not open", async () => {
    const control = fakeControl({ ok: false, code: "device_control_disabled", refusal: null });
    renderControl(control.client);
    await clickSend("led");
    expect(rowCells("led")[3]).toBe("device_control_disabled");

    // And the page says what the two switches are, so the operator knows what to turn on.
    const page = screen.getByRole("heading", { level: 2 }).closest("section");
    expect(page?.textContent).toContain("device-control argument");
    expect(page?.textContent).toContain("device-control mode");
  });

  it("renders no turn text even when the stream carries it", () => {
    const fake = renderControl();
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

describe("control page helpers", () => {
  it("reads the LAST ack for a cmd_id, so a later outcome replaces an earlier one", () => {
    const entries = [
      ackResult(1, { cmd_id: "cmd_a", action: "say", outcome: "accepted" }),
      ackResult(2, { cmd_id: "cmd_b", action: "play", outcome: "done" }),
      ackResult(3, { cmd_id: "cmd_a", action: "say", outcome: "failed", reason: "busy" }),
    ];
    expect(ackFor(entries, "cmd_a")).toEqual({
      outcome: "failed",
      reason: "busy",
      action: "say",
      seq: 3,
    });
    expect(ackFor(entries, "cmd_missing")).toBeNull();
    expect(ackFor(entries, null)).toBeNull();
  });

  it("words an ack, a pending ack and a missing one", () => {
    expect(ackText(null, true)).toBe("Waiting for ack");
    expect(ackText(null, false)).toBe("—");
    expect(ackText({ outcome: "done", reason: "", action: "say", seq: 1 }, true)).toBe("done");
    expect(
      ackText({ outcome: "rejected", reason: "at_edge", action: "gesture", seq: 1 }, true),
    ).toBe("rejected (at_edge)");
  });

  it("words a refusal with and without a Policy_Refusal", () => {
    const base = { n: 1, action: "say", device_id: DEVICE_ID, cmd_id: null };
    expect(refusalText({ ...base, code: "action_refused", refusal: "movement_off" })).toBe(
      "action_refused · movement_off",
    );
    expect(refusalText({ ...base, code: "proxy_disabled", refusal: null })).toBe("proxy_disabled");
    expect(refusalText({ ...base, code: null, refusal: null })).toBe("—");
  });
});
