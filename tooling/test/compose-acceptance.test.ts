// Unit tests of the Compose_Acceptance_Check's helpers (Req 23.11–23.13; design D13; Phase 1.3
// Req 10.5 and C14). No Docker: the step predicates run over sample Gateway_Log arrays and SSE
// text, the bounded GET runs against a test server on 127.0.0.1 only, and the source file is
// scanned for URL literals and Panel_Key assignment lines.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUDGET_MS,
  CRITERIA,
  CheckFailure,
  DEVICE_ID_VALUE,
  LOOPBACK_HOST,
  OPERATOR_PORT,
  PANEL_PORT,
  PASSED_LINE,
  REDACTED,
  atMs,
  checkAudioTurn,
  checkCommandDone,
  checkConversation,
  checkRoutineFired,
  checkRoutineRunShape,
  checkStoryStep,
  readActiveContentIds,
  readRoutineRun,
  checkEventLogged,
  checkEventStepClean,
  checkFirstDevicesEvent,
  checkLastTurn,
  checkPublishedPort,
  checkReconnect,
  checkRejectedOnly,
  checkReplay,
  checkSilence,
  checkStartup,
  deviceCounts,
  envFileText,
  firstSseEvent,
  isTerminalTurnState,
  localEnvEntries,
  loopbackGet,
  loopbackPost,
  newDeviceToken,
  parseLogLines,
  redact,
  remainingMs,
  resultLine,
  isOurScratchEnv,
  rootEnvRefusal,
  rootEnvRefusalFor,
  ROOT_ENV_SENTINEL,
  ROOT_ENV_EXISTS_REASON,
  ROOT_ENV_FILE,
  ROOT_ENV_UNWRITABLE_REASON,
  runInOrder,
  sseEvents,
  stateHasCommand,
  timeoutLabel,
  turnViewState,
  urlFrom,
  waitLimitMs,
  type Criterion,
  type LogEntry,
  type Step,
} from "../compose/compose-acceptance.js";
import { parsePanel } from "../checks/panel.js";
import { URL_SCHEMES } from "../checks/url-scan.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_PATH = join(REPO_ROOT, "tooling", "compose", "compose-acceptance.ts");
const DEV = DEVICE_ID_VALUE;
const T0 = Date.parse("2026-10-08T10:00:00.000Z");

/** A log entry `ms` after T0 with the given fields. */
function at(ms: number, fields: Record<string, unknown>): LogEntry {
  return { log_ver: 1, seq: 0, at: new Date(T0 + ms).toISOString(), ...fields };
}

const msgIn = (ms: number, variant: string, extra: Record<string, unknown> = {}): LogEntry =>
  at(ms, { kind: "message_in", transport: "mqtt", device_id: DEV, variant, ...extra });
const presence = (ms: number, state: string, cause: string): LogEntry =>
  at(ms, { kind: "presence", device_id: DEV, state, cause });
const ackResult = (cmdId: string, outcome: string, reason: string | null = ""): LogEntry =>
  at(0, { kind: "ack_result", device_id: DEV, cmd_id: cmdId, outcome, reason });
const msgOut = (cmdId: string, variant = "animate"): LogEntry =>
  at(0, { kind: "message_out", transport: "mqtt", device_id: DEV, variant, cmd_id: cmdId });
const turnPhase = (turnId: string, phase: string, extra: Record<string, unknown> = {}): LogEntry =>
  at(0, {
    kind: "audio_turn",
    device_id: DEV,
    turn_id: turnId,
    phase,
    frames_in: 0,
    frames_out: 0,
    ...extra,
  });

describe("step predicates", () => {
  describe("23.1 checkStartup", () => {
    const base = [
      at(0, { kind: "gateway", state: "broker_connected" }),
      msgIn(1_000, "hello"),
      at(1_000, { kind: "auth", transport: "mqtt", device_id: DEV, outcome: "ok" }),
      presence(1_000, "online", "hello"),
      msgIn(1_100, "status"),
    ];

    it("passes with two status entries within 30 s of the hello", () => {
      expect(checkStartup([...base, msgIn(16_100, "status")], DEV).status).toBe("pass");
    });

    it("stays pending while a status is more than 30 s after the hello", () => {
      expect(checkStartup([...base, msgIn(31_001, "status")], DEV).status).toBe("pending");
    });

    it("stays pending without the hello", () => {
      const noHello = base.filter((e) => e["variant"] !== "hello");
      expect(checkStartup([...noHello, msgIn(16_100, "status")], DEV).status).toBe("pending");
    });

    it("fails on a failed auth", () => {
      const failed = at(1_000, { kind: "auth", device_id: DEV, outcome: "failed" });
      expect(checkStartup([...base, failed], DEV).status).toBe("fail");
    });
  });

  describe("23.2 events", () => {
    const logged = [
      msgIn(0, "touch", { event_id: "e1" }),
      at(0, { kind: "event_accepted", device_id: DEV, event_id: "e1" }),
    ];

    it("passes with one message_in and one event_accepted", () => {
      expect(checkEventLogged(logged, DEV, "e1").status).toBe("pass");
      expect(checkEventStepClean(logged).status).toBe("pass");
    });

    it("is pending before the event_accepted and fails on a second one", () => {
      expect(checkEventLogged(logged.slice(0, 1), DEV, "e1").status).toBe("pending");
      expect(checkEventLogged([...logged, logged[1] as LogEntry], DEV, "e1").status).toBe("fail");
    });

    it.each([
      at(0, { kind: "message_rejected", device_id: null, issues: [] }),
      at(0, { kind: "event_duplicate", device_id: DEV, event_id: "e1" }),
      msgOut("c1", "stop_audio"),
    ])("fails the step on a stray %o", (stray) => {
      expect(checkEventStepClean([...logged, stray]).status).toBe("fail");
    });
  });

  describe("23.3 checkCommandDone", () => {
    it("passes on message_out, accepted, then one done with an empty reason", () => {
      const w = [msgOut("c1"), ackResult("c1", "accepted"), ackResult("c1", "done")];
      expect(checkCommandDone(w, "c1").status).toBe("pass");
    });

    it("is pending before done", () => {
      expect(checkCommandDone([msgOut("c1"), ackResult("c1", "accepted")], "c1").status).toBe(
        "pending",
      );
    });

    it.each([
      ["timed_out", [msgOut("c1"), ackResult("c1", "timed_out", null)]],
      [
        "two done",
        [
          msgOut("c1"),
          ackResult("c1", "accepted"),
          ackResult("c1", "done"),
          ackResult("c1", "done"),
        ],
      ],
      [
        "done before accepted",
        [msgOut("c1"), ackResult("c1", "done"), ackResult("c1", "accepted")],
      ],
      [
        "a done reason",
        [msgOut("c1"), ackResult("c1", "accepted"), ackResult("c1", "done", "busy")],
      ],
      ["two message_out", [msgOut("c1"), msgOut("c1")]],
    ])("fails on %s", (_name, w) => {
      expect(checkCommandDone(w, "c1").status).toBe("fail");
    });

    it("reads received commands from the simulator state", () => {
      const state = { received_commands: [{ cmd_id: "c1", action: "say", acks: [] }] };
      expect(stateHasCommand(state, "c1")).toBe(true);
      expect(stateHasCommand(state, "c2")).toBe(false);
      expect(stateHasCommand({}, "c1")).toBe(false);
    });
  });

  describe("23.4 checkRejectedOnly (the 15 s no-extra-outcome window)", () => {
    const rejected = [msgOut("c9"), ackResult("c9", "rejected", "picked_up")];

    it("passes on exactly one rejected picked_up", () => {
      expect(checkRejectedOnly(rejected, "c9").status).toBe("pass");
    });

    it("is pending before the rejection", () => {
      expect(checkRejectedOnly([msgOut("c9")], "c9").status).toBe("pending");
    });

    it.each(["accepted", "done", "timed_out"])("fails if %s follows inside the window", (o) => {
      expect(checkRejectedOnly([...rejected, ackResult("c9", o, null)], "c9").status).toBe("fail");
    });

    it("fails on a second message_out, a second rejection or another reason", () => {
      expect(checkRejectedOnly([...rejected, msgOut("c9")], "c9").status).toBe("fail");
      expect(
        checkRejectedOnly([...rejected, ackResult("c9", "rejected", "picked_up")], "c9").status,
      ).toBe("fail");
      expect(
        checkRejectedOnly([msgOut("c9"), ackResult("c9", "rejected", "at_edge")], "c9").status,
      ).toBe("fail");
    });
  });

  describe("23.5 audio turn", () => {
    const turn = [
      turnPhase("t1", "started"),
      turnPhase("t1", "ended", { frames_in: 50 }),
      msgOut("s1", "say"),
      turnPhase("t1", "reply_started"),
      turnPhase("t1", "reply_ended", { frames_out: 50 }),
      ackResult("s1", "accepted"),
      ackResult("s1", "done"),
    ];

    it("passes on the four phases in order, the say before reply_started and its done", () => {
      expect(checkAudioTurn(turn, DEV, "t1").status).toBe("pass");
    });

    it("is pending before the say's done", () => {
      expect(checkAudioTurn(turn.slice(0, 6), DEV, "t1").status).toBe("pending");
    });

    it("fails on an aborted phase, a short upload or a missing say", () => {
      expect(checkAudioTurn([...turn, turnPhase("t1", "aborted")], DEV, "t1").status).toBe("fail");
      const short = turn.map((e) => (e["phase"] === "ended" ? { ...e, frames_in: 49 } : e));
      expect(checkAudioTurn(short, DEV, "t1").status).toBe("fail");
      const noSay = turn.filter((e) => e["variant"] !== "say");
      expect(checkAudioTurn(noSay, DEV, "t1").status).toBe("fail");
    });

    it("takes the reply at whatever length the brain spoke, but not at none", () => {
      // Phase 3 C1: the Fake_Reply's fixed 50 frames are gone. A wordless upload transcribes to
      // `no_speech` and the brain speaks a Safe_Redirect, so the reply's length follows its text.
      for (const framesOut of [1, 7, 164]) {
        const other = turn.map((e) =>
          e["phase"] === "reply_ended" ? { ...e, frames_out: framesOut } : e,
        );
        expect(checkAudioTurn(other, DEV, "t1").status).toBe("pass");
      }
      const silent = turn.map((e) => (e["phase"] === "reply_ended" ? { ...e, frames_out: 0 } : e));
      expect(checkAudioTurn(silent, DEV, "t1").status).toBe("fail");
    });

    it("checks the simulator's last_turn", () => {
      const last = (fields: Record<string, unknown>) => ({
        last_turn: { turn_id: "t1", ...fields },
      });
      expect(checkLastTurn(last({ outcome: "complete", frames_received: 50 }), "t1").status).toBe(
        "pass",
      );
      // Any positive count, for the same reason: the reply's length is the brain's business now.
      expect(checkLastTurn(last({ outcome: "complete", frames_received: 164 }), "t1").status).toBe(
        "pass",
      );
      // A completed turn that received nothing is still a failure.
      expect(checkLastTurn(last({ outcome: "complete", frames_received: 0 }), "t1").status).toBe(
        "fail",
      );
      expect(checkLastTurn(last({ outcome: "in_progress", frames_received: 3 }), "t1").status).toBe(
        "pending",
      );
      expect(checkLastTurn(last({ outcome: "failed", frames_received: 0 }), "t1").status).toBe(
        "fail",
      );
      expect(checkLastTurn({ last_turn: null }, "t1").status).toBe("pending");
    });
  });

  describe("23.6 checkReplay", () => {
    const priorIds = ["p1", "p2", "p3", "p4", "p5"];
    const before = { accepted: 14, duplicate: 0 };
    const window = [
      at(0, {
        kind: "event_accepted",
        device_id: DEV,
        event_id: "q1",
        time_uncertain: true,
        ordering: "approximate",
      }),
      ...priorIds.map((id) => at(0, { kind: "event_duplicate", device_id: DEV, event_id: id })),
    ];

    it("passes with one approximate accept, five duplicates and counts +1 and +5", () => {
      const after = { accepted: 15, duplicate: 5 };
      expect(checkReplay(window, { queuedId: "q1", priorIds, before, after }).status).toBe("pass");
    });

    it("is pending until the counts catch up", () => {
      const after = { accepted: 15, duplicate: 4 };
      expect(checkReplay(window, { queuedId: "q1", priorIds, before, after }).status).toBe(
        "pending",
      );
    });

    it("fails on a device-ts ordering, an extra duplicate or a count overshoot", () => {
      const after = { accepted: 15, duplicate: 5 };
      const exact = window.map((e) =>
        e["event_id"] === "q1" ? { ...e, ordering: "device_ts" } : e,
      );
      expect(checkReplay(exact, { queuedId: "q1", priorIds, before, after }).status).toBe("fail");
      const extra = [...window, at(0, { kind: "event_duplicate", event_id: "p1" })];
      expect(checkReplay(extra, { queuedId: "q1", priorIds, before, after }).status).toBe("fail");
      const over = { accepted: 16, duplicate: 5 };
      expect(checkReplay(window, { queuedId: "q1", priorIds, before, after: over }).status).toBe(
        "fail",
      );
    });

    it("reads the device counts from a devices response", () => {
      const devices = { devices: [{ device_id: DEV, events_accepted: 3, events_duplicate: 1 }] };
      expect(deviceCounts(devices, DEV)).toEqual({ accepted: 3, duplicate: 1 });
      expect(deviceCounts({ devices: [] }, DEV)).toBeNull();
    });
  });

  describe("23.7 checkSilence (the 45.0–46.0 s window)", () => {
    const history = [msgIn(0, "hello"), presence(0, "online", "hello"), msgIn(15_000, "status")];
    const from = history.length;

    it.each([45_000, 45_500, 46_000])("passes at %i ms after the last status", (gap) => {
      const entries = [...history, presence(15_000 + gap, "offline", "silence")];
      expect(checkSilence(entries, DEV, from).status).toBe("pass");
    });

    it.each([44_999, 46_001])("fails at %i ms after the last status", (gap) => {
      const entries = [...history, presence(15_000 + gap, "offline", "silence")];
      expect(checkSilence(entries, DEV, from).status).toBe("fail");
    });

    it("is pending before the entry and fails on a cause other than silence", () => {
      expect(checkSilence(history, DEV, from).status).toBe("pending");
      const wrong = [...history, presence(60_000, "offline", "status")];
      expect(checkSilence(wrong, DEV, from).status).toBe("fail");
    });

    it("fails on an earlier presence offline after the last heartbeat", () => {
      const entries = [
        ...history,
        presence(20_000, "offline", "silence"),
        presence(60_000, "offline", "silence"),
      ];
      expect(checkSilence(entries, DEV, from + 1).status).toBe("fail");
    });

    it("parses the at field", () => {
      expect(atMs(msgIn(1_500, "status")) - T0).toBe(1_500);
    });
  });

  describe("23.8 checkReconnect", () => {
    it("passes on a hello and presence online hello", () => {
      const w = [msgIn(0, "hello"), presence(0, "online", "hello")];
      expect(checkReconnect(w, DEV).status).toBe("pass");
      expect(checkReconnect(w.slice(0, 1), DEV).status).toBe("pending");
      expect(checkReconnect([...w, presence(1, "offline", "silence")], DEV).status).toBe("fail");
    });
  });

  describe("stream (Phase 1.3 C14)", () => {
    const summary = {
      device_id: DEV,
      presence: "online",
      last_heartbeat_at: "2026-10-08T10:00:00.000Z",
      battery_pct: 80,
      charging: false,
      events_accepted: 0,
      events_duplicate: 0,
    };
    const devicesEvent = (devices: unknown[]): string =>
      `event: devices\ndata: ${JSON.stringify({ devices })}\n\n`;

    it("passes a published port only as one binding on 127.0.0.1 at the same port", () => {
      expect(checkPublishedPort("127.0.0.1:8090\n", 8090).status).toBe("pass");
      expect(checkPublishedPort("127.0.0.1:8091\r\n", 8091).status).toBe("pass");
      expect(checkPublishedPort("0.0.0.0:8090\n", 8090).status).toBe("fail");
      expect(checkPublishedPort("127.0.0.1:9000\n", 8090).status).toBe("fail");
      expect(checkPublishedPort("127.0.0.1:8090\n[::]:8090\n", 8090).status).toBe("fail");
      expect(checkPublishedPort("", 8090).status).toBe("fail");
    });

    it("reads the first complete SSE event, skipping comments", () => {
      expect(firstSseEvent(": keep-alive\n\nevent: devices\ndata: {}\n\nevent: entry\n")).toEqual({
        event: "devices",
        data: "{}",
      });
      expect(firstSseEvent("event: devices\r\ndata:{}\r\n\r\n")).toEqual({
        event: "devices",
        data: "{}",
      });
      expect(firstSseEvent("event: devices\ndata: {}\n")).toBeNull();
      expect(firstSseEvent(": keep-alive\n\n")).toBeNull();
      expect(firstSseEvent("data: x\n\n")).toEqual({ event: "message", data: "x" });
    });

    it("passes a first devices event that names only the device", () => {
      expect(checkFirstDevicesEvent(devicesEvent([summary]), DEV).status).toBe("pass");
      expect(checkFirstDevicesEvent(devicesEvent([summary]).slice(0, -1), DEV).status).toBe(
        "pending",
      );
    });

    it.each([
      ["an entry event first", `event: entry\ndata: {"kind":"gateway"}\n\n${devicesEvent([])}`],
      ["no device", devicesEvent([])],
      ["another device", devicesEvent([{ ...summary, device_id: "xlu_other" }])],
      ["two devices", devicesEvent([summary, { ...summary, device_id: "xlu_other" }])],
      [
        "an extra field",
        `event: devices\ndata: ${JSON.stringify({ devices: [summary], x: 1 })}\n\n`,
      ],
      ["data that is not JSON", "event: devices\ndata: nope\n\n"],
    ])("fails on %s", (_name, text) => {
      expect(checkFirstDevicesEvent(text, DEV).status).toBe("fail");
    });
  });

  describe("conversation (Phase 3B Req 22.1)", () => {
    const TURN = "turn_c1";
    const brainTurn = (phase: string, extra: Record<string, unknown> = {}): LogEntry =>
      at(0, {
        kind: "brain_turn",
        device_id: DEV,
        turn_id: TURN,
        phase,
        lang: "en-IN",
        age_stage: "little",
        since_audio_end_ms: null,
        frames_out: 0,
        cause: null,
        ...extra,
      });
    const decision = (stage: string): LogEntry =>
      at(0, {
        kind: "safety_decision",
        device_id: DEV,
        turn_id: TURN,
        stage,
        decision: "allow",
        rule: "none",
        topic: null,
      });
    const turnEvent = (state: string, turnId = TURN): string =>
      `event: turn\ndata: ${JSON.stringify({ turn_id: turnId, device_id: DEV, state })}\n\n`;

    const window: readonly LogEntry[] = [
      brainTurn("started"),
      decision("input"),
      brainTurn("transcribed"),
      at(0, {
        kind: "tool_call",
        device_id: DEV,
        turn_id: TURN,
        tool: "content_lookup",
        outcome: "ok",
        denied_reason: null,
      }),
      decision("output"),
      msgOut("say1", "say"),
      ackResult("say1", "accepted"),
      ackResult("say1", "done"),
      brainTurn("done"),
    ];
    const done = turnEvent("done");

    it("passes with both decisions, one say, its done ack and a done turn event", () => {
      expect(checkConversation(window, done, DEV, TURN).status).toBe("pass");
    });

    const incomplete: readonly (readonly [string, readonly LogEntry[]])[] = [
      ["the output decision", window.filter((e) => e["stage"] !== "output")],
      ["the transcribed entry", window.filter((e) => e["phase"] !== "transcribed")],
      ["the say", window.filter((e) => e["variant"] !== "say")],
      ["the say's done", window.filter((e) => e["outcome"] !== "done")],
    ];

    it.each(incomplete)("stays pending without %s", (_name, w) => {
      expect(checkConversation(w, done, DEV, TURN).status).toBe("pending");
    });

    it("stays pending before the turn event, and while it is still speaking", () => {
      expect(checkConversation(window, "", DEV, TURN).status).toBe("pending");
      expect(checkConversation(window, turnEvent("speaking"), DEV, TURN).status).toBe("pending");
      // A turn event for another turn is not this turn's.
      expect(checkConversation(window, turnEvent("done", "turn_other"), DEV, TURN).status).toBe(
        "pending",
      );
    });

    const broken: readonly (readonly [string, readonly LogEntry[], string])[] = [
      ["a second say", [...window, msgOut("say2", "say")], done],
      ["a rejected say", [...window, ackResult("say1", "rejected", "picked_up")], done],
      ["an aborted pipeline", [...window, brainTurn("aborted")], done],
      ["a failed pipeline", [...window, brainTurn("failed", { cause: "llm_failed" })], done],
      ["an interrupted turn event", window, turnEvent("interrupted")],
      ["a failed turn event", window, turnEvent("failed")],
    ];

    it.each(broken)("fails on %s", (_name, w, stream) => {
      expect(checkConversation(w, stream, DEV, TURN).status).toBe("fail");
    });

    it("asserts no reply frame count", () => {
      const many = window.map((e) => (e["kind"] === "brain_turn" ? { ...e, frames_out: 7 } : e));
      expect(checkConversation(many, done, DEV, TURN).status).toBe("pass");
    });

    it("reads the newest turn state for the turn, and names the terminal ones", () => {
      expect(turnViewState(turnEvent("thinking") + turnEvent("done"), TURN)).toBe("done");
      expect(turnViewState(turnEvent("done", "turn_other"), TURN)).toBeNull();
      expect(turnViewState("event: turn\ndata: nope\n\n", TURN)).toBeNull();
      expect(turnViewState("", TURN)).toBeNull();
      for (const state of ["done", "interrupted", "failed"]) {
        expect(isTerminalTurnState(state)).toBe(true);
      }
      for (const state of ["listening", "thinking", "speaking", null]) {
        expect(isTerminalTurnState(state)).toBe(false);
      }
    });

    it("reads every complete SSE event in order, ignoring a partial one", () => {
      expect(sseEvents(`event: devices\ndata: {}\n\n${turnEvent("done")}event: entry\n`)).toEqual([
        { event: "devices", data: "{}" },
        { event: "turn", data: JSON.stringify({ turn_id: TURN, device_id: DEV, state: "done" }) },
      ]);
      expect(sseEvents("")).toEqual([]);
    });
  });

  describe("content (Phase 4 Req 20.7)", () => {
    const TURN = "turn_s1";
    const SEEDED = "story_panchatantra_drum";

    const listBody = (over: Record<string, unknown> = {}): string =>
      JSON.stringify({
        ok: true,
        write_enabled: true,
        items: [
          { content_id: SEEDED, status: "active" },
          { content_id: "content_draft_1", status: "draft" },
        ],
        ...over,
      });

    it("reads the active ids only, from an ok write-enabled list", () => {
      expect(readActiveContentIds(listBody())).toEqual([SEEDED]);
    });

    it.each([
      ["write_enabled false", listBody({ write_enabled: false })],
      ["ok false", listBody({ ok: false })],
      ["no items array", listBody({ items: "none" })],
      ["a non-JSON body", "<html></html>"],
    ])("reads nothing from %s", (_name, body) => {
      expect(readActiveContentIds(body)).toBeNull();
    });

    const runBody = (over: Record<string, unknown>): string =>
      JSON.stringify({ ok: true, actions: 3, sent: 3, refused: 0, refusal: null, ...over });

    it("accepts the two shapes the gate can answer with, and nothing else", () => {
      const allowed = readRoutineRun(runBody({}));
      const refused = readRoutineRun(runBody({ sent: 0, refused: 1, refusal: "quiet_hours" }));
      expect(allowed).toEqual({ actions: 3, sent: 3, refusal: null });
      expect(refused).toEqual({ actions: 3, sent: 0, refusal: "quiet_hours" });
      expect(checkRoutineRunShape({ actions: 3, sent: 3, refusal: null }).status).toBe("pass");
      expect(checkRoutineRunShape({ actions: 3, sent: 0, refusal: "quiet_hours" }).status).toBe(
        "pass",
      );
      // A partial send, a refusal with a published command, and any other refusal all fail.
      for (const run of [
        { actions: 3, sent: 1, refusal: null },
        { actions: 0, sent: 0, refusal: null },
        { actions: 3, sent: 1, refusal: "quiet_hours" },
        { actions: 3, sent: 0, refusal: "movement_off" },
      ]) {
        expect(checkRoutineRunShape(run).status, JSON.stringify(run)).toBe("fail");
      }
      expect(readRoutineRun("{}")).toBeNull();
      expect(readRoutineRun(runBody({ actions: "three" }))).toBeNull();
    });

    const fired = (over: Record<string, unknown> = {}): LogEntry =>
      at(0, {
        kind: "routine_fired",
        device_id: DEV,
        trigger: "manual",
        ref_id: "morning",
        threshold: null,
        battery_pct: null,
        actions: 3,
        sent: 3,
        refused: 0,
        refusal: null,
        ...over,
      });

    const allowedRun = { actions: 3, sent: 3, refusal: null } as const;
    const refusedRun = { actions: 3, sent: 0, refusal: "quiet_hours" } as const;

    it("passes the allowed shape on the entry plus an ack done", () => {
      const window = [fired(), msgOut("cmd1", "say"), ackResult("cmd1", "done")];
      expect(checkRoutineFired(window, DEV, allowedRun).status).toBe("pass");
    });

    it("stays pending without the entry or without the ack", () => {
      expect(checkRoutineFired([], DEV, allowedRun).status).toBe("pending");
      expect(checkRoutineFired([fired(), msgOut("cmd1", "say")], DEV, allowedRun).status).toBe(
        "pending",
      );
      // A scheduled firing is not the manual run this criterion asked for.
      expect(checkRoutineFired([fired({ trigger: "schedule" })], DEV, allowedRun).status).toBe(
        "pending",
      );
    });

    it("passes the quiet-hours shape only when nothing was published", () => {
      const quiet = fired({ sent: 0, refused: 1, refusal: "quiet_hours" });
      expect(checkRoutineFired([quiet], DEV, refusedRun).status).toBe("pass");
      expect(checkRoutineFired([quiet, msgOut("cmd1", "say")], DEV, refusedRun).status).toBe(
        "fail",
      );
    });

    const storyStep = (over: Record<string, unknown> = {}): LogEntry =>
      at(0, {
        kind: "story_step",
        device_id: DEV,
        turn_id: TURN,
        content_id: SEEDED,
        step_id: "s1",
        choice_id: null,
        outcome: "started",
        ...over,
      });

    it("requires a story_step naming one of the seeded ids", () => {
      expect(checkStoryStep([storyStep()], DEV, TURN, [SEEDED]).status).toBe("pass");
      expect(checkStoryStep([], DEV, TURN, [SEEDED]).status).toBe("pending");
      expect(
        checkStoryStep([storyStep({ turn_id: "turn_other" })], DEV, TURN, [SEEDED]).status,
      ).toBe("pending");
      expect(checkStoryStep([storyStep({ content_id: "nope" })], DEV, TURN, [SEEDED]).status).toBe(
        "fail",
      );
    });
  });
});

describe("loopbackGet (the bounded stream read)", () => {
  let server: Server | undefined;
  const open: ServerResponse[] = [];

  afterEach(async () => {
    for (const res of open.splice(0)) res.destroy();
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  /** A test server on 127.0.0.1; `handle` gets each request. Resolves to its port. */
  async function serve(
    handle: (host: string | undefined, origin: string | undefined, res: ServerResponse) => void,
  ): Promise<number> {
    const s = createServer((req, res) => {
      open.push(res);
      handle(req.headers.host, req.headers.origin, res);
    });
    server = s;
    await new Promise<void>((done) => s.listen(0, LOOPBACK_HOST, done));
    return (s.address() as AddressInfo).port;
  }

  it("sends Host 127.0.0.1:<port> and no Origin, and stops after the first event", async () => {
    let seen: [string | undefined, string | undefined] | undefined;
    let closed = false;
    const port = await serve((host, origin, res) => {
      seen = [host, origin];
      res.on("close", () => {
        closed = true;
      });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write("event: devices\ndata: {}\n\n");
      // The stream stays open: only the client's destroy can end it.
    });
    const reply = await loopbackGet(port, "/v1/stream", 5_000, (b) => firstSseEvent(b) !== null);
    expect(reply).toEqual({ status: 200, body: "event: devices\ndata: {}\n\n" });
    expect(seen).toEqual([`${LOOPBACK_HOST}:${String(port)}`, undefined]);
    await expect.poll(() => closed).toBe(true);
  });

  it("returns a non-200 status without its body, and a 200 body read to its end", async () => {
    const port = await serve((_h, _o, res) => {
      if (open.length === 1) res.writeHead(403).end('{"ok":false}');
      else res.writeHead(200).end("<!doctype html>");
    });
    expect(await loopbackGet(port, "/v1/stream", 5_000, () => true)).toEqual({
      status: 403,
      body: "",
    });
    expect(await loopbackGet(port, "/", 5_000, () => false)).toEqual({
      status: 200,
      body: "<!doctype html>",
    });
  });

  it("rejects with timeout when no event arrives in time", async () => {
    const port = await serve((_h, _o, res) => {
      res.writeHead(200);
      res.write(": keep-alive\n\n");
    });
    await expect(
      loopbackGet(port, "/v1/stream", 200, (b) => firstSseEvent(b) !== null),
    ).rejects.toThrow("timeout");
  });

  it("rejects with error when nothing listens", async () => {
    const port = await serve(() => undefined);
    await new Promise<void>((done) => server?.close(() => done()));
    server = undefined;
    await expect(loopbackGet(port, "/", 5_000, () => false)).rejects.toThrow("error");
  });

  it("posts JSON with the loopback Host and no Origin, and reads the whole reply", async () => {
    let seen: [string | undefined, string | undefined, string | undefined] | undefined;
    let sent = "";
    const port = await serve((host, origin, res) => {
      const req = res.req;
      seen = [host, origin, req.headers["content-type"]];
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        sent += chunk;
      });
      req.on("end", () => res.writeHead(200).end('{"ok":true,"turn_id":"t1"}'));
    });
    const reply = await loopbackPost(port, "/api/audio-turn", '{"utterance":"story"}', 5_000);
    expect(reply).toEqual({ status: 200, body: '{"ok":true,"turn_id":"t1"}' });
    expect(sent).toBe('{"utterance":"story"}');
    expect(seen).toEqual([
      `${LOOPBACK_HOST}:${String(port)}`,
      undefined,
      "application/json; charset=utf-8",
    ]);
  });

  it("returns a refusal's status without its body, and times out on a silent server", async () => {
    const port = await serve((_h, _o, res) => {
      if (open.length === 1) res.writeHead(415).end('{"ok":false}');
      // The second request is never answered.
    });
    expect(await loopbackPost(port, "/api/audio-turn", "{}", 5_000)).toEqual({
      status: 415,
      body: "",
    });
    await expect(loopbackPost(port, "/api/audio-turn", "{}", 200)).rejects.toThrow("timeout");
  });
});

describe("gateway log parsing", () => {
  it("parses every non-blank line as a JSON object", () => {
    const parsed = parseLogLines('{"kind":"gateway"}\r\n\n{"kind":"auth"}\n');
    expect(parsed).toEqual({ ok: true, entries: [{ kind: "gateway" }, { kind: "auth" }] });
  });

  it("fails on the first line that is not a JSON object, by number only", () => {
    expect(parseLogLines('{"a":1}\nnot json\n')).toEqual({ ok: false, lineNo: 2 });
    expect(parseLogLines("[1]\n")).toEqual({ ok: false, lineNo: 1 });
  });
});

describe("budget arithmetic", () => {
  it("counts the 600 s budget down to zero, never below", () => {
    expect(BUDGET_MS).toBe(600_000);
    expect(remainingMs(1_000, 1_000)).toBe(600_000);
    expect(remainingMs(1_000, 501_000)).toBe(100_000);
    expect(remainingMs(1_000, 700_000)).toBe(0);
  });

  it("bounds each wait by its own limit and the budget left", () => {
    expect(waitLimitMs(10_000, 600_000)).toBe(10_000);
    expect(waitLimitMs(10_000, 4_000)).toBe(4_000);
    expect(waitLimitMs(10_000, -5)).toBe(0);
  });

  it("names the budget when the budget cut a wait short, else the criterion", () => {
    expect(timeoutLabel("23.5", 10_000, 600_000)).toBe("23.5");
    expect(timeoutLabel("23.5", 10_000, 10_000)).toBe("23.5");
    expect(timeoutLabel("23.5", 10_000, 9_999)).toBe("budget");
  });
});

describe("first-failure naming", () => {
  const CRITS: readonly Criterion[] = ["23.1", "23.2", "23.3"];

  function steps(failAt: Criterion | null, ran: Criterion[], thrown?: unknown): Step[] {
    return CRITS.map((criterion) => ({
      criterion,
      run: async () => {
        ran.push(criterion);
        if (criterion === failAt) throw thrown ?? new CheckFailure(criterion, "assertion");
      },
    }));
  }

  it("runs stream, conversation then content after 23.1, keeping the Phase 1.2 order", () => {
    expect(CRITERIA).toEqual([
      "23.1",
      "stream",
      "conversation",
      "content",
      "23.2",
      "23.3",
      "23.4",
      "23.5",
      "23.6",
      "23.7",
      "23.8",
    ]);
    expect(PASSED_LINE).toBe("PASSED 23.1–23.8 + stream + conversation + content");
    expect(resultLine({ ok: false, label: "stream", why: "x" })).toBe("FAILED stream");
    expect(resultLine({ ok: false, label: "conversation", why: "x" })).toBe("FAILED conversation");
    expect(resultLine({ ok: false, label: "content", why: "x" })).toBe("FAILED content");
  });

  it("passes when every step passes", async () => {
    const ran: Criterion[] = [];
    const result = await runInOrder(steps(null, ran), () => 1);
    expect(result).toEqual({ ok: true });
    expect(resultLine(result)).toBe(PASSED_LINE);
    expect(ran).toEqual(CRITS);
  });

  it("stops at the first failure and names it", async () => {
    const ran: Criterion[] = [];
    const result = await runInOrder(steps("23.2", ran), () => 1);
    expect(resultLine(result)).toBe("FAILED 23.2");
    expect(ran).toEqual(["23.1", "23.2"]);
  });

  it("names the step's own criterion for an unexpected error", async () => {
    const result = await runInOrder(steps("23.3", [], new Error("boom")), () => 1);
    expect(resultLine(result)).toBe("FAILED 23.3");
  });

  it("names the budget when a step reports it, or when it runs out between steps", async () => {
    const reported = await runInOrder(steps("23.1", [], new CheckFailure("budget", "x")), () => 1);
    expect(resultLine(reported)).toBe("FAILED budget");
    const ran: Criterion[] = [];
    let left = 2;
    const outOfTime = await runInOrder(steps(null, ran), () => --left);
    expect(resultLine(outOfTime)).toBe("FAILED budget");
    expect(ran).toEqual(["23.1"]);
  });
});

describe("token redaction", () => {
  it("replaces every occurrence of the token", () => {
    const token = newDeviceToken();
    const text = `a ${token} b ${token}${token}\n`;
    const out = redact(text, token);
    expect(out).not.toContain(token);
    expect(out).toBe(`a ${REDACTED} b ${REDACTED}${REDACTED}\n`);
    expect(redact("nothing here", token)).toBe("nothing here");
  });

  it("makes a 32-byte base64url token, new per call", () => {
    const a = newDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newDeviceToken()).not.toBe(a);
  });
});

describe(".env lines from tuples", () => {
  it("writes the Local_Mode values, one KEY=value line per tuple", () => {
    const token = newDeviceToken();
    const text = envFileText(localEnvEntries(token));
    expect(text.endsWith("\n")).toBe(true);
    // The sentinel leads, so an interrupted run's leftover file identifies itself.
    expect(text.split("\n")[0]).toBe(ROOT_ENV_SENTINEL);
    const record = new Map(
      text
        .trimEnd()
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .map((line) => {
          const sep = line.indexOf("=");
          return [line.slice(0, sep), line.slice(sep + 1)] as const;
        }),
    );
    expect([...record.keys()]).toEqual([
      "APP_ENV",
      "MQTT_BROKER_URL",
      "MQTT_USERNAME",
      "MQTT_PASSWORD",
      "AUDIO_WSS_URL",
      "DEVICE_ID",
      "DEVICE_TOKEN",
      "GATEWAY_OPERATOR_PORT",
      "SIMULATOR_PANEL_PORT",
    ]);
    expect(record.get("APP_ENV")).toBe("local");
    expect(record.get("MQTT_USERNAME")).toBe("");
    expect(record.get("MQTT_PASSWORD")).toBe("");
    expect(record.get("DEVICE_ID")).toBe(DEVICE_ID_VALUE);
    expect(record.get("DEVICE_TOKEN")).toBe(token);
    expect(record.get("GATEWAY_OPERATOR_PORT")).toBe("8090");
    expect(record.get("SIMULATOR_PANEL_PORT")).toBe("8091");
    // The stream criterion reaches the same ports that the .env sets.
    expect([OPERATOR_PORT, PANEL_PORT]).toEqual([8090, 8091]);
    const broker = new URL(record.get("MQTT_BROKER_URL") ?? "");
    expect([broker.protocol, broker.hostname, broker.port]).toEqual(["mqtt:", "emqx", "1883"]);
    const audio = new URL(record.get("AUDIO_WSS_URL") ?? "");
    expect([audio.protocol, audio.hostname, audio.port]).toEqual(["ws:", "gateway", "8081"]);
  });

  it("builds URLs from parts", () => {
    expect(new URL(urlFrom("ws", "gateway", 8081)).host).toBe("gateway:8081");
  });

  describe("the pre-existing root env file (Req 23.11)", () => {
    it("lets the check proceed when there is none", () => {
      expect(rootEnvRefusal(false)).toEqual([]);
    });

    it("refuses, names the file and says it was left untouched", () => {
      const lines = rootEnvRefusal(true);
      expect(lines[0]).toBe("FAILED 23.11");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(ROOT_ENV_FILE);
      expect(lines[1]).toMatch(/already exists/);
      expect(lines[1]).toMatch(/untouched/);
    });

    it("is a different message from the cannot-be-written case", () => {
      expect(ROOT_ENV_EXISTS_REASON).not.toBe(ROOT_ENV_UNWRITABLE_REASON);
      expect(ROOT_ENV_UNWRITABLE_REASON).toContain(ROOT_ENV_FILE);
    });

    it("carries no env value: the refusal is the same whatever the token is", () => {
      const token = newDeviceToken();
      const text = rootEnvRefusal(true).join("\n");
      expect(text).not.toContain(token);
      for (const [, value] of localEnvEntries(token)) {
        if (value !== "") expect(text).not.toContain(value);
      }
    });

    // The seam `main` itself calls, so the guard is tested where it is wired: at the real path,
    // against the real filesystem, before anything is written.
    describe("the seam main calls", () => {
      let dir: string;

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "xelulu-root-env-"));
      });

      afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
      });

      it("proceeds when the file is this check's own leftover, and leaves it to be replaced", () => {
        // A run killed before its cleanup leaves its scratch file behind. Refusing on that file
        // would block every later run because of a file the check itself wrote.
        const path = join(dir, ROOT_ENV_FILE);
        writeFileSync(path, envFileText(localEnvEntries(newDeviceToken())));
        expect(isOurScratchEnv(path)).toBe(true);
        expect(rootEnvRefusalFor(path)).toEqual([]);
        // Reading is all the predicate did; replacing is `main`'s job.
        expect(existsSync(path)).toBe(true);
      });

      it("still refuses a developer's file, which carries no sentinel", () => {
        const path = join(dir, ROOT_ENV_FILE);
        writeFileSync(path, "DEVICE_TOKEN=mine\n");
        expect(isOurScratchEnv(path)).toBe(false);
        expect(rootEnvRefusalFor(path)).toEqual(rootEnvRefusal(true));
        expect(readFileSync(path, "utf8")).toBe("DEVICE_TOKEN=mine\n");
      });

      it("treats a file whose sentinel is not first as a developer's", () => {
        const path = join(dir, ROOT_ENV_FILE);
        writeFileSync(path, `DEVICE_TOKEN=mine\n${ROOT_ENV_SENTINEL}\n`);
        expect(isOurScratchEnv(path)).toBe(false);
        expect(rootEnvRefusalFor(path)[0]).toBe("FAILED 23.11");
      });

      it("proceeds when the path holds no file", () => {
        expect(isOurScratchEnv(join(dir, ROOT_ENV_FILE))).toBe(false);
        expect(rootEnvRefusalFor(join(dir, ROOT_ENV_FILE))).toEqual([]);
      });

      it("refuses, and leaves a file that is already there exactly as it was", () => {
        const path = join(dir, ROOT_ENV_FILE);
        const before = "# the developer's own file\n";
        writeFileSync(path, before);

        expect(rootEnvRefusalFor(path)).toEqual(rootEnvRefusal(true));
        // Not overwritten, not deleted: refusing is all it did.
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, "utf8")).toBe(before);
      });

      it("refuses an empty file too, so a placeholder .env is not written over", () => {
        const path = join(dir, ROOT_ENV_FILE);
        writeFileSync(path, "");
        expect(rootEnvRefusalFor(path)[0]).toBe("FAILED 23.11");
        expect(readFileSync(path, "utf8")).toBe("");
      });
    });
  });

  it("refuses a bad key, a repeated key or a value with a line break", () => {
    expect(() => envFileText([["bad key", "x"]])).toThrow();
    expect(() =>
      envFileText([
        ["A", "1"],
        ["A", "2"],
      ]),
    ).toThrow();
    expect(() => envFileText([["A", "1\n2"]])).toThrow();
  });
});

describe("compose-acceptance.ts source", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  it("holds no scheme:// literal", () => {
    const literal = new RegExp(`(?<![A-Za-z0-9])(?:${URL_SCHEMES.join("|")}):\\/\\/`, "i");
    expect(source).not.toMatch(literal);
  });

  it("holds no Panel_Key assignment line, empty or not", () => {
    const keys = parsePanel(
      readFileSync(join(REPO_ROOT, "tooling", "fixtures", "approved-panel.txt"), "utf8"),
    ).flatMap((l) => (l.kind === "decl" ? [l.key] : []));
    expect(keys.length).toBeGreaterThan(0);
    const assignment = new RegExp(`^\\s*(?:export\\s+|-\\s+)?"?(?:${keys.join("|")})"?\\s*(?:=|:)`);
    const hits = source.split(/\r?\n/).flatMap((line, i) => (assignment.test(line) ? [i + 1] : []));
    expect(hits).toEqual([]);
  });
});
