// @vitest-environment jsdom
// Conversation page through the whole console path (Req 20.1, 20.2, 20.3, 20.4): App with a fake
// EventSource, so each `turn` event runs stream client → reducer → page exactly as in the browser.
// Smoke plus key interaction only: the fields of a row, text shown vs lengths plus the note, the
// cap, replace-by-turn_id and a stream reopen clearing the list.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationTurnView } from "@xelulu/shared";

import { App } from "../src/app";
import { CONVERSATION_CAP } from "../src/stream/console-state";

import { DEVICE_ID, TURN_ID, turnView } from "./support/entries";
import { fakeSources } from "./support/fake-event-source";

/** The turn rows in display order, newest first. */
function turnRows(): HTMLElement[] {
  const list = screen.getByRole("list", { name: "Conversation" });
  return within(list).getAllByRole("listitem");
}

/** The value shown under one field label in a row (`<dt>` term, `<dd>` value). */
function fieldValue(row: HTMLElement, term: string): string {
  const dt = within(row).getByText(term, { selector: "dt" });
  return dt.nextElementSibling?.textContent ?? "";
}

/** Renders the console on the Conversation page, opens the stream and sends these views. */
function renderConversation(views: readonly ConversationTurnView[]) {
  const fake = fakeSources();
  render(<App createSource={fake.createSource} />);
  act(() => {
    const source = fake.latest();
    source.open();
    for (const view of views) source.emitTurn(view);
  });
  return fake;
}

describe("Conversation page", () => {
  beforeEach(() => {
    window.location.hash = "#/conversation";
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("says so before any turn event", () => {
    renderConversation([]);
    expect(screen.getByRole("heading", { name: "Conversation", level: 2 })).toBeTruthy();
    expect(screen.getByText("No turns yet.")).toBeTruthy();
  });

  it("shows both decisions, the tool and outcome, the latency in ms and the state", () => {
    renderConversation([
      turnView({
        input_decision: "defer",
        input_rule: "defer_topic",
        input_topic: "death",
        output_decision: "allow",
        output_rule: "none",
        tools: [{ tool: "content_lookup", outcome: "ok" }],
        latency_ms: 940,
        filler_spoken: true,
        frames_out: 31,
        state: "done",
      }),
    ]);

    const rows = turnRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(fieldValue(row, "Input safety")).toBe("defer (defer_topic) [death]");
    expect(fieldValue(row, "Output safety")).toBe("allow (none)");
    expect(fieldValue(row, "Tools called")).toBe("content_lookup ok");
    expect(fieldValue(row, "Latency")).toBe("940 ms");
    expect(fieldValue(row, "Filler spoken")).toBe("Yes");
    expect(fieldValue(row, "Frames sent")).toBe("31");
    expect(fieldValue(row, "State")).toBe("Done");
    expect(fieldValue(row, "Device")).toBe(DEVICE_ID);
    expect(fieldValue(row, "Turn")).toBe(TURN_ID);
    expect(fieldValue(row, "Language")).toBe("en-IN");
    expect(fieldValue(row, "Age stage")).toBe("little");
  });

  it("shows the transcript and reply text when the turn event carries them", () => {
    renderConversation([
      turnView({
        transcript_text: "tell me a story",
        reply_text: "Here is one about a clever crow.",
      }),
    ]);

    const row = turnRows()[0] as HTMLElement;
    expect(fieldValue(row, "Child's words")).toBe("tell me a story");
    expect(fieldValue(row, "Xelulu's reply")).toBe("Here is one about a clever crow.");
    expect(screen.queryByText(/text is off/)).toBeNull();
  });

  it("shows the lengths and the text-off note when it does not", () => {
    renderConversation([turnView({ transcript_len: 15, reply_len: 32 })]);

    const row = turnRows()[0] as HTMLElement;
    expect(fieldValue(row, "Child's words")).toBe("15 characters");
    expect(fieldValue(row, "Xelulu's reply")).toBe("32 characters");
    expect(screen.getByText(/text is off/)).toBeTruthy();
  });

  it(`keeps the newest ${CONVERSATION_CAP} of 60 turns, newest first`, () => {
    const views = Array.from({ length: 60 }, (_, i) =>
      turnView({ turn_id: `turn_${String(i + 1).padStart(6, "0")}` }),
    );
    renderConversation(views);

    const rows = turnRows();
    expect(CONVERSATION_CAP).toBe(50);
    expect(rows).toHaveLength(50);
    expect(fieldValue(rows[0] as HTMLElement, "Turn")).toBe("turn_000060");
    expect(fieldValue(rows.at(-1) as HTMLElement, "Turn")).toBe("turn_000011");
    expect(screen.getByText(/Showing 50 turns, newest first/)).toBeTruthy();
  });

  it("replaces a turn when a later event repeats its turn_id", () => {
    const fake = renderConversation([turnView({ state: "listening", latency_ms: null })]);
    let row = turnRows()[0] as HTMLElement;
    expect(fieldValue(row, "State")).toBe("Listening");
    expect(fieldValue(row, "Latency")).toBe("—");

    act(() => fake.latest().emitTurn(turnView({ state: "done", latency_ms: 700 })));

    const rows = turnRows();
    expect(rows).toHaveLength(1);
    row = rows[0] as HTMLElement;
    expect(fieldValue(row, "State")).toBe("Done");
    expect(fieldValue(row, "Latency")).toBe("700 ms");
  });

  it("ignores a malformed turn payload", () => {
    const fake = renderConversation([]);
    act(() => {
      const source = fake.latest();
      source.emit("turn", "not json");
      source.emit("turn", "[]");
      source.emit("turn", JSON.stringify({ ...turnView(), state: "pondering" }));
      source.emit("turn", JSON.stringify({ ...turnView(), lang: "fr-FR" }));
    });
    expect(screen.getByText("No turns yet.")).toBeTruthy();
  });

  it("clears the held turns when the stream reopens", () => {
    vi.useFakeTimers();
    try {
      const fake = renderConversation([turnView()]);
      expect(turnRows()).toHaveLength(1);

      act(() => fake.latest().fail());
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(fake.sources).toHaveLength(2);
      act(() => fake.latest().open());

      expect(screen.getByText("No turns yet.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
