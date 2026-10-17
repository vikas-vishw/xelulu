// Example tests for the console reducer and selectors (Req 5.1, 6.2, 6.3, 6.4, 6.6, 7.3).
// Node environment, no DOM.
import { describe, expect, it } from "vitest";

import type { ConversationTurnView, DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import {
  CONVERSATION_CAP,
  type ConsoleAction,
  type ConsoleState,
  LIVE_LOG_CAP,
  consoleReducer,
  filterByKind,
  newestFirst,
  newestTurnsFirst,
  tileCounts,
} from "../src/stream/console-state";

import { turnView } from "./support/entries";

const initial: ConsoleState = {
  connection: "connecting",
  devices: null,
  entries: [],
  turns: null,
  stale: false,
};

function gatewayEntry(seq: number): GatewayLogEntry {
  return { log_ver: 3, seq, at: "2026-10-20T10:00:01.250Z", kind: "gateway", state: "starting" };
}

function presenceEntry(seq: number): GatewayLogEntry {
  return {
    log_ver: 3,
    seq,
    at: "2026-10-20T10:00:01.250Z",
    kind: "presence",
    device_id: "xlu_000123",
    state: "online",
    cause: "hello",
  };
}

function device(device_id: string, presence: DeviceSummary["presence"]): DeviceSummary {
  return {
    device_id,
    presence,
    last_heartbeat_at: null,
    battery_pct: null,
    charging: null,
    events_accepted: 0,
    events_duplicate: 0,
  };
}

function run(actions: readonly ConsoleAction[], from: ConsoleState = initial): ConsoleState {
  return actions.reduce(consoleReducer, from);
}

const seqs = (entries: readonly GatewayLogEntry[]): number[] => entries.map((e) => e.seq);

function turn(n: number): ConversationTurnView {
  return turnView({ turn_id: `t_${n}`, state: "listening", latency_ms: null });
}

const turnIds = (turns: readonly ConversationTurnView[] | null): string[] =>
  (turns ?? []).map((t) => t.turn_id);

describe("consoleReducer", () => {
  it("keeps entries in ascending seq order when they arrive out of order", () => {
    const s = run([5, 2, 9, 1].map((n) => ({ type: "entry", entry: gatewayEntry(n) })));
    expect(seqs(s.entries)).toEqual([1, 2, 5, 9]);
    expect(seqs(newestFirst(s.entries))).toEqual([9, 5, 2, 1]);
    expect(seqs(s.entries)).toEqual([1, 2, 5, 9]);
  });

  it("ignores an entry whose seq it already holds", () => {
    const s1 = run([{ type: "entry", entry: gatewayEntry(3) }]);
    const s2 = consoleReducer(s1, { type: "entry", entry: presenceEntry(3) });
    expect(s2.entries).toHaveLength(1);
    expect(s2.entries[0]?.kind).toBe("gateway");
  });

  it("keeps only the 500 highest seq of 600 entries", () => {
    const actions: ConsoleAction[] = [];
    for (let n = 600; n >= 1; n -= 1) actions.push({ type: "entry", entry: gatewayEntry(n) });
    const s = run(actions);
    expect(LIVE_LOG_CAP).toBe(500);
    expect(s.entries).toHaveLength(500);
    expect(s.entries[0]?.seq).toBe(101);
    expect(s.entries[499]?.seq).toBe(600);
  });

  it("reset clears devices, entries, turns and stale", () => {
    const s = run([
      { type: "state", state: "live" },
      { type: "devices", devices: [device("xlu_000123", "online")] },
      { type: "entry", entry: gatewayEntry(1) },
      { type: "turn", view: turnView() },
      { type: "state", state: "reconnecting" },
      { type: "reset" },
    ]);
    expect(s.devices).toBeNull();
    expect(s.entries).toEqual([]);
    expect(s.turns).toBeNull();
    expect(s.stale).toBe(false);
  });

  it("keeps only the newest 50 of 60 turns, in arrival order", () => {
    const actions: ConsoleAction[] = [];
    for (let n = 1; n <= 60; n += 1) actions.push({ type: "turn", view: turn(n) });
    const s = run(actions);
    expect(CONVERSATION_CAP).toBe(50);
    expect(turnIds(s.turns)).toHaveLength(50);
    expect(turnIds(s.turns)[0]).toBe("t_11");
    expect(turnIds(s.turns).at(-1)).toBe("t_60");
    expect(newestTurnsFirst(s.turns)[0]?.turn_id).toBe("t_60");
  });

  it("replaces a turn in place when its turn_id is already held", () => {
    const s1 = run([
      { type: "turn", view: turn(1) },
      { type: "turn", view: turn(2) },
    ]);
    const s2 = consoleReducer(s1, {
      type: "turn",
      view: turnView({ turn_id: "t_1", state: "done" }),
    });
    expect(turnIds(s2.turns)).toEqual(["t_1", "t_2"]);
    expect(s2.turns?.[0]?.state).toBe("done");
    // The input is untouched.
    expect(s1.turns?.[0]?.state).toBe("listening");
  });

  it("newestTurnsFirst is empty before the first turn event", () => {
    expect(newestTurnsFirst(initial.turns)).toEqual([]);
  });

  it("is stale while reconnecting after data was shown, and not once live", () => {
    expect(run([{ type: "state", state: "reconnecting" }]).stale).toBe(false);
    const shown = run([
      { type: "state", state: "live" },
      { type: "entry", entry: gatewayEntry(1) },
    ]);
    expect(shown.stale).toBe(false);
    const reconnecting = consoleReducer(shown, { type: "state", state: "reconnecting" });
    expect(reconnecting.stale).toBe(true);
    expect(seqs(reconnecting.entries)).toEqual([1]);
    expect(consoleReducer(reconnecting, { type: "state", state: "live" }).stale).toBe(false);
  });

  it("does not mutate its input", () => {
    const s1 = run([{ type: "entry", entry: gatewayEntry(1) }]);
    const before = [...s1.entries];
    const s2 = consoleReducer(s1, { type: "entry", entry: gatewayEntry(2) });
    expect(s2).not.toBe(s1);
    expect(s1.entries).toEqual(before);
  });
});

describe("selectors", () => {
  it("filterByKind returns all or only the chosen kind", () => {
    const entries = [gatewayEntry(1), presenceEntry(2), gatewayEntry(3)];
    expect(seqs(filterByKind(entries, "all"))).toEqual([1, 2, 3]);
    expect(seqs(filterByKind(entries, "presence"))).toEqual([2]);
    expect(filterByKind(entries, "ack_result")).toEqual([]);
  });

  it("tileCounts counts an unknown device in the total only", () => {
    const counts = tileCounts([
      device("xlu_000001", "online"),
      device("xlu_000002", "offline"),
      device("xlu_000003", "unknown"),
      device("xlu_000004", "online"),
    ]);
    expect(counts).toEqual({ total: 4, online: 2, offline: 1 });
  });
});
