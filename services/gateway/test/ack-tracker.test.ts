// Commands and ack tracking: Property 8 (model-based), the refusal-order table (Req 3.7, 8.2) and
// the 1,000-command retention example (Req 8.13). The pure sender and tracker run on the manual
// test clock with the real deadline scheduler; `fireDue(t)` runs before every input, exactly as the
// gateway does before handling an inbound message or request.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ACK_REASONS,
  ACK_STATUSES,
  type AckMessage,
  type AckReason,
  type AckResultLogEntry,
  type AckStatus,
  type CmdAction,
  type GatewayLogEntry,
  type TimeoutCause,
} from "@xelulu/shared";

import { createDeadlines } from "../src/deadlines.js";
import type { PresenceState } from "../src/devices/presence.js";
import { createRegistry } from "../src/devices/registry.js";
import { randomIds, type IdSource } from "../src/ids.js";
import { createGatewayLog } from "../src/log/gateway-log.js";
import {
  createAckTracker,
  NO_ACK_TIMEOUT_MS,
  NO_COMPLETION_TIMEOUT_MS,
  RETAINED_COMMANDS_PER_DEVICE,
} from "../src/mqtt/ack-tracker.js";
import { createBrokerSession } from "../src/mqtt/broker-session.js";
import { createCommandSender, type CommandResult } from "../src/mqtt/command-sender.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker } from "./support/memory-broker.js";
import { createTestClock, type TestClock } from "./support/test-clock.js";

const T0 = 1_760_000_000_000;
const DEVICES = ["xlu_000001", "xlu_000002"] as const;
const SAY_DATA = { expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 1000 };
const COMMANDS: readonly { readonly action: CmdAction; readonly data: unknown }[] = [
  { action: "say", data: SAY_DATA },
  { action: "stop_audio", data: {} },
  { action: "set_mode", data: { mode: "play" } },
];

type Published = { readonly deviceId: string; readonly payload: string };

/** A sender and tracker over stubbed sources, with every publish recorded. */
function rig(opts: {
  clock: TestClock;
  devices?: readonly string[];
  presence?: () => PresenceState;
  connected?: () => boolean;
  ids?: IdSource;
}) {
  const deadlines = createDeadlines(opts.clock);
  const log = createGatewayLog(opts.clock, createCaptureSink());
  const entries: GatewayLogEntry[] = [];
  log.subscribe((e) => entries.push(e));
  const tracker = createAckTracker({ deadlines, log });
  const published: Published[] = [];
  const devices = opts.devices ?? DEVICES;
  const sender = createCommandSender({
    registry: { isRegistered: (id) => devices.includes(id) },
    presence: { state: opts.presence ?? (() => "online") },
    broker: {
      connected: opts.connected ?? (() => true),
      publishCmd: (deviceId, payload) => published.push({ deviceId, payload }),
    },
    ids: opts.ids ?? randomIds,
    tracker,
    clock: opts.clock,
    log,
  });
  return { deadlines, log, entries, tracker, sender, published };
}

type AckFields = Pick<
  AckResultLogEntry,
  "device_id" | "cmd_id" | "action" | "outcome" | "reason" | "timeout_cause"
>;

function ackResults(entries: readonly GatewayLogEntry[]): AckFields[] {
  return entries.flatMap((e) =>
    e.kind === "ack_result"
      ? [
          {
            device_id: e.device_id,
            cmd_id: e.cmd_id,
            action: e.action,
            outcome: e.outcome,
            reason: e.reason,
            timeout_cause: e.timeout_cause,
          },
        ]
      : [],
  );
}

function ack(cmdId: string, status: AckStatus, reason: "" | AckReason): AckMessage {
  return { proto_ver: 2, ts: 1_760_000_000, type: "ack", cmd_id: cmdId, status, reason };
}

// ---------------------------------------------------------------------------------------------
// Property 8 generators.

type SendSpec = { readonly gap: number; readonly device: 0 | 1; readonly command: number };
type AckSpec = {
  readonly target: number;
  readonly mode: "own" | "other_device" | "unknown_id";
  readonly offset: number;
  readonly status: AckStatus;
  readonly reason: "" | AckReason;
  readonly unknownId: string;
};

const boundaryOffset = fc.oneof(
  fc.constantFrom(0, 1, 9_999, 10_000, 10_001, 30_000, 59_999, 60_000, 60_001),
  fc.integer({ min: 0, max: 75_000 }),
);

const sendArb: fc.Arbitrary<SendSpec> = fc.record({
  gap: fc.oneof(fc.constantFrom(0, 10_000, 50_000, 60_000), fc.integer({ min: 0, max: 30_000 })),
  device: fc.constantFrom(0 as const, 1 as const),
  command: fc.nat({ max: COMMANDS.length - 1 }),
});

const ackSpecArb: fc.Arbitrary<AckSpec> = fc
  .record({
    target: fc.nat(),
    mode: fc.oneof(
      { weight: 8, arbitrary: fc.constant("own" as const) },
      { weight: 1, arbitrary: fc.constant("other_device" as const) },
      { weight: 1, arbitrary: fc.constant("unknown_id" as const) },
    ),
    offset: boundaryOffset,
    status: fc.constantFrom(...ACK_STATUSES),
    reason: fc.constantFrom<"" | AckReason>("", ...ACK_REASONS),
    unknownId: fc.stringMatching(/^unknown-[a-z0-9]{1,8}$/),
  })
  .map((a) => (a.status === "rejected" && a.reason === "" ? { ...a, reason: "busy" as const } : a));

const scenarioArb = fc.tuple(
  fc.array(sendArb, { minLength: 1, maxLength: 12 }),
  fc.array(ackSpecArb, { maxLength: 40 }),
);

type Input =
  | { readonly kind: "send"; readonly at: number; readonly index: number }
  | { readonly kind: "ack"; readonly at: number; readonly spec: AckSpec; readonly order: number };

type ModelCommand = {
  readonly cmdId: string;
  readonly deviceId: string;
  readonly action: CmdAction;
  readonly publishedAt: number;
  readonly index: number;
  accepted: boolean;
  outcome: null | {
    status: Exclude<AckStatus, "accepted"> | "timed_out";
    reason: "" | AckReason | null;
    cause: TimeoutCause | null;
  };
};

/** Requirement 8.10, stated directly over one command's own acks (in processing order). */
function definitionalOutcome(
  publishedAt: number,
  acks: readonly { at: number; status: AckStatus; reason: "" | AckReason }[],
): { state: string; reason: "" | AckReason | null; cause: TimeoutCause | null } {
  const firstTerminal = acks.find((a) => a.status !== "accepted");
  const terminalIndex = firstTerminal === undefined ? -1 : acks.indexOf(firstTerminal);
  const acceptedInTime = acks.some(
    (a, i) =>
      a.status === "accepted" &&
      a.at < publishedAt + NO_ACK_TIMEOUT_MS &&
      (terminalIndex === -1 || i < terminalIndex),
  );
  const window = acceptedInTime ? NO_COMPLETION_TIMEOUT_MS : NO_ACK_TIMEOUT_MS;
  if (firstTerminal !== undefined && firstTerminal.at < publishedAt + window) {
    return { state: firstTerminal.status, reason: firstTerminal.reason, cause: null };
  }
  return { state: "timed_out", reason: null, cause: acceptedInTime ? "no_completion" : "no_ack" };
}

describe("ack tracking", () => {
  // Feature: phase-1-2-gateway-simulator, Property 8: Ack tracking agrees with the timeout model
  // **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12**
  it("agrees with the timeout model in every entry and every final state", () => {
    fc.assert(
      fc.property(scenarioArb, ([sends, ackSpecs]) => {
        const clock = createTestClock(T0);
        const r = rig({ clock });

        // Absolute times: sends from their gaps, acks relative to their target's publish time.
        const sendTimes: number[] = [];
        let t = T0;
        for (const s of sends) {
          t += s.gap;
          sendTimes.push(t);
        }
        const lastSend = t;
        const inputs: Input[] = [
          ...sends.map((_, index): Input => ({ kind: "send", at: sendTimes[index] ?? T0, index })),
          ...ackSpecs.map((spec, order): Input => {
            const target = spec.target % sends.length;
            const at =
              spec.mode === "unknown_id"
                ? T0 + (spec.offset % (lastSend - T0 + 75_001))
                : (sendTimes[target] ?? T0) + spec.offset;
            return { kind: "ack", at, spec: { ...spec, target }, order };
          }),
        ];
        // Stable: at equal times sends come first, then acks in generation order.
        inputs.sort((a, b) => a.at - b.at);

        const model: ModelCommand[] = [];
        const expected: AckFields[] = [];
        const ownAcks = new Map<
          string,
          { at: number; status: AckStatus; reason: "" | AckReason }[]
        >();

        /** Model timeouts due at or before `now`, in (due time, publish order). */
        function modelTimeouts(now: number): void {
          const due = model
            .filter((m) => m.outcome === null)
            .map((m) => ({
              m,
              dueAt: m.publishedAt + (m.accepted ? NO_COMPLETION_TIMEOUT_MS : NO_ACK_TIMEOUT_MS),
            }))
            .filter(({ dueAt }) => dueAt <= now)
            .sort((a, b) => a.dueAt - b.dueAt || a.m.index - b.m.index);
          for (const { m } of due) {
            const cause: TimeoutCause = m.accepted ? "no_completion" : "no_ack";
            m.outcome = { status: "timed_out", reason: null, cause };
            expected.push({
              device_id: m.deviceId,
              cmd_id: m.cmdId,
              action: m.action,
              outcome: "timed_out",
              reason: null,
              timeout_cause: cause,
            });
          }
        }

        for (const input of inputs) {
          clock.set(input.at);
          r.deadlines.fireDue(input.at);
          modelTimeouts(input.at);

          if (input.kind === "send") {
            const spec = sends[input.index];
            const command = COMMANDS[spec?.command ?? 0] ?? COMMANDS[0];
            const deviceId = DEVICES[spec?.device ?? 0];
            if (spec === undefined || command === undefined) continue;
            const res = r.sender.sendCommand({
              device_id: deviceId,
              action: command.action,
              data: command.data,
            });
            expect(res.ok).toBe(true);
            if (!res.ok) continue;
            model.push({
              cmdId: res.cmd_id,
              deviceId,
              action: command.action,
              publishedAt: input.at,
              index: input.index,
              accepted: false,
              outcome: null,
            });
            ownAcks.set(res.cmd_id, []);
            continue;
          }

          const spec = input.spec;
          const target = model[spec.target];
          let cmdId: string;
          let deviceId: string;
          if (spec.mode === "unknown_id") {
            cmdId = spec.unknownId;
            deviceId = DEVICES[spec.target % DEVICES.length] ?? DEVICES[0];
          } else {
            // The target was sent at or before this ack's time, so it is already in the model.
            if (target === undefined) throw new Error("ack before its command");
            cmdId = target.cmdId;
            deviceId =
              spec.mode === "other_device"
                ? (DEVICES.find((d) => d !== target.deviceId) ?? DEVICES[0])
                : target.deviceId;
          }
          r.tracker.handleAck(deviceId, ack(cmdId, spec.status, spec.reason));

          const m = model.find((c) => c.cmdId === cmdId && c.deviceId === deviceId);
          if (m === undefined) {
            expected.push({
              device_id: deviceId,
              cmd_id: cmdId,
              action: null,
              outcome: "unmatched",
              reason: spec.reason,
              timeout_cause: null,
            });
            continue;
          }
          ownAcks.get(m.cmdId)?.push({ at: input.at, status: spec.status, reason: spec.reason });
          let outcome: AckFields["outcome"];
          if (m.outcome !== null) {
            outcome =
              m.outcome.status !== "timed_out" && m.outcome.status === spec.status
                ? "duplicate"
                : "late";
          } else if (spec.status === "accepted") {
            outcome = m.accepted ? "duplicate" : "accepted";
            m.accepted = true;
          } else {
            outcome = spec.status;
            m.outcome = { status: spec.status, reason: spec.reason, cause: null };
          }
          expected.push({
            device_id: deviceId,
            cmd_id: m.cmdId,
            action: m.action,
            outcome,
            reason: spec.reason,
            timeout_cause: null,
          });
        }

        // Let every remaining deadline fire.
        const end = (inputs.at(-1)?.at ?? T0) + NO_COMPLETION_TIMEOUT_MS + 1;
        clock.set(end);
        r.deadlines.fireDue(end);
        modelTimeouts(end);

        expect(ackResults(r.entries)).toEqual(expected);

        // Final states equal Requirement 8.10's definition.
        for (const m of model) {
          const view = r.tracker.commands(m.deviceId).find((c) => c.cmd_id === m.cmdId);
          const def = definitionalOutcome(m.publishedAt, ownAcks.get(m.cmdId) ?? []);
          expect(view?.state).toBe(def.state);
          expect(view?.reason).toBe(def.reason);
          expect(view?.timeout_cause).toBe(def.cause);
        }

        // Every cmd_id is unique and published exactly once; no outcome published anything.
        expect(r.published).toHaveLength(sends.length);
        const ids = r.published.map((p) => (JSON.parse(p.payload) as { cmd_id: string }).cmd_id);
        expect(new Set(ids).size).toBe(sends.length);
        expect(ids).toEqual(model.map((m) => m.cmdId));
        expect(r.entries.filter((e) => e.kind === "message_out")).toHaveLength(sends.length);
      }),
      { numRuns: 300 },
    );
  });

  it("refuses in the order of Requirement 8.2 and leaves no trace", () => {
    const registered = "xlu_000001";
    const unregistered = "xlu_999999";
    let rows = 0;
    for (let mask = 0; mask < 16; mask++) {
      const unknownDevice = (mask & 8) !== 0;
      const notOnline = (mask & 4) !== 0;
      const disconnected = (mask & 2) !== 0;
      const invalid = (mask & 1) !== 0;
      const variants: PresenceState[] = notOnline ? ["unknown", "offline"] : ["online"];
      for (const presence of variants) {
        rows += 1;
        const clock = createTestClock(T0);
        let drawn = 0;
        const r = rig({
          clock,
          devices: [registered],
          presence: () => presence,
          connected: () => !disconnected,
          ids: {
            next(prefix) {
              drawn += 1;
              return randomIds.next(prefix);
            },
          },
        });
        const result: CommandResult = r.sender.sendCommand({
          device_id: unknownDevice ? unregistered : registered,
          action: "say",
          data: invalid ? { expression: "§not-a-valid-say" } : SAY_DATA,
        });

        const expectedCode = unknownDevice
          ? "unknown_device"
          : notOnline
            ? "device_offline"
            : disconnected
              ? "broker_disconnected"
              : invalid
                ? "invalid_command"
                : null;
        const where = `mask ${mask} presence ${presence}`;
        if (expectedCode === null) {
          expect(result.ok, where).toBe(true);
          expect(r.published, where).toHaveLength(1);
          continue;
        }
        expect(result.ok, where).toBe(false);
        if (result.ok) continue;
        expect(result.error.code, where).toBe(expectedCode);
        expect(r.published, where).toEqual([]);
        expect(r.tracker.commands(registered), where).toEqual([]);
        expect(r.tracker.commands(unregistered), where).toEqual([]);
        expect(r.entries, where).toEqual([]);
        // A cmd_id is drawn only once the first three checks pass (design: Commands and acks).
        expect(drawn, where).toBe(expectedCode === "invalid_command" ? 1 : 0);
        if (result.error.code === "invalid_command") {
          expect(result.error.issues.length, where).toBeGreaterThan(0);
          expect(JSON.stringify(result.error), where).not.toContain("§");
        }
      }
    }
    expect(rows).toBe(24);
  });

  it("does not publish a command refused while disconnected after a later reconnect", async () => {
    const clock = createTestClock(T0);
    const deadlines = createDeadlines(clock);
    const log = createGatewayLog(clock, createCaptureSink());
    const broker = createMemoryBroker(() => clock.now());
    const session = createBrokerSession({
      broker: { url: "", username: null, password: null },
      deviceIds: ["xlu_000001"],
      connect: broker.connector,
      clock,
      deadlines,
      ids: randomIds,
      log,
      onMessage: () => undefined,
    });
    const sender = createCommandSender({
      registry: createRegistry({ deviceId: "xlu_000001", token: "device-token-0123456789" }),
      presence: { state: () => "online" },
      broker: session,
      ids: randomIds,
      tracker: createAckTracker({ deadlines, log }),
      clock,
      log,
    });

    const refused = sender.sendCommand({ device_id: "xlu_000001", action: "say", data: SAY_DATA });
    expect(refused).toEqual({ ok: false, error: { code: "broker_disconnected" } });

    session.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(session.connected()).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(broker.published.filter((p) => p.clientId === session.clientId)).toEqual([]);
    await session.stop();
  });

  it("keeps the 1,000 latest commands per device and forgets the oldest with its deadlines", () => {
    const clock = createTestClock(T0);
    const r = rig({ clock, devices: ["xlu_000001"] });
    const ids: string[] = [];
    for (let i = 0; i <= RETAINED_COMMANDS_PER_DEVICE; i++) {
      const res = r.sender.sendCommand({ device_id: "xlu_000001", action: "stop_audio", data: {} });
      if (!res.ok) throw new Error("send refused");
      ids.push(res.cmd_id);
    }
    const kept = r.tracker.commands("xlu_000001");
    expect(kept).toHaveLength(RETAINED_COMMANDS_PER_DEVICE);
    expect(kept[0]?.cmd_id).toBe(ids[1]);
    expect(kept.at(-1)?.cmd_id).toBe(ids[RETAINED_COMMANDS_PER_DEVICE]);
    // Eviction adds no entry.
    expect(ackResults(r.entries)).toEqual([]);

    // The evicted command's deadlines were cancelled: only the kept ones time out.
    clock.set(T0 + NO_ACK_TIMEOUT_MS);
    r.deadlines.fireDue(clock.now());
    const timedOut = ackResults(r.entries);
    expect(timedOut).toHaveLength(RETAINED_COMMANDS_PER_DEVICE);
    expect(timedOut.some((e) => e.cmd_id === ids[0])).toBe(false);

    // A later ack for the evicted command is unmatched.
    r.tracker.handleAck("xlu_000001", ack(ids[0] ?? "", "done", ""));
    expect(ackResults(r.entries).at(-1)).toEqual({
      device_id: "xlu_000001",
      cmd_id: ids[0],
      action: null,
      outcome: "unmatched",
      reason: "",
      timeout_cause: null,
    });
  });
});
