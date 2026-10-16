// Command handler: Property 14 and the Req 17.7 / 17.9 examples. Commands come from the shared
// serialiser and acks go through the in-memory broker double, so every check reads real payloads.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ACK_REASONS,
  CMD_ACTIONS,
  SAFE_ISSUE_LIMITS,
  buildTopic,
  parseAckMessage,
  serialiseCmdMessage,
  type CmdMessage,
} from "@xelulu/shared";

import {
  ackPlan,
  clearOverride,
  EMPTY_ACK_POLICY,
  parseAckOverride,
  resolveOverride,
  setOverride,
  type AckPolicy,
  type PlannedAck,
} from "../src/device/ack-policy.js";
import { createCommandHandler, type TurnView } from "../src/device/command-handler.js";
import { copyDeviceState, createDeviceState } from "../src/device/device-state.js";
import { createSimLog, type SimLogEntry } from "../src/log/logger.js";
import {
  ackPolicyArb,
  cmdArb,
  invalidCmdArb,
  SENTINEL_PREFIX,
  unknownKeyArb,
} from "./support/arbitraries.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker } from "./support/memory-broker.js";
import { createTestClock, type TestClock } from "./support/test-clock.js";

const DEVICE_ID = "sim-device-1";
const ACK_TOPIC = buildTopic(DEVICE_ID, "ack");
const START_MS = 1_760_000_000_000;

async function setup(opts: { policy?: () => AckPolicy; turn?: TurnView; clock?: TestClock } = {}) {
  const broker = createMemoryBroker();
  const conn = await broker.peer(DEVICE_ID);
  const clock = opts.clock ?? createTestClock(START_MS);
  const sink = createCaptureSink();
  const state = createDeviceState();
  let policy: AckPolicy = EMPTY_ACK_POLICY;
  const handler = createCommandHandler({
    deviceId: DEVICE_ID,
    clock,
    state,
    log: createSimLog(clock, sink),
    policy: opts.policy ?? (() => policy),
    publish: (topic, payload, qos) => {
      conn.publish(topic, payload, qos).catch(() => undefined);
      return true;
    },
    turn: opts.turn,
  });
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  return {
    broker,
    clock,
    sink,
    state,
    handler,
    entries,
    setPolicy: (p: AckPolicy) => (policy = p),
  };
}

type Step =
  | { readonly kind: "cmd"; readonly message: CmdMessage }
  | { readonly kind: "policy"; readonly policy: AckPolicy }
  | { readonly kind: "advance"; readonly ms: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: cmdArb({ cmdId: fc.constantFrom("c-1", "c-2", "c-3", "c-4", "c-5", "c-6") }).map(
      (message): Step => ({ kind: "cmd", message }),
    ),
  },
  { weight: 1, arbitrary: ackPolicyArb.map((policy): Step => ({ kind: "policy", policy })) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 1, max: 5_000 }).map((ms): Step => ({ kind: "advance", ms })),
  },
);

type ExpectedAck = PlannedAck & { readonly cmd_id: string; readonly ts: number };

/** Runs the steps on a fresh handler and returns what the model expects next to what happened. */
async function run(steps: readonly Step[]) {
  const s = await setup();
  const expected: ExpectedAck[] = [];
  const model = new Map<string, readonly PlannedAck[]>();
  let policy: AckPolicy = EMPTY_ACK_POLICY;
  for (const step of steps) {
    if (step.kind === "advance") {
      s.clock.advance(step.ms);
      continue;
    }
    if (step.kind === "policy") {
      policy = step.policy;
      s.setPolicy(policy);
      continue;
    }
    const ts = Math.floor(s.clock.now() / 1000);
    const known = model.get(step.message.cmd_id);
    const acks = known ?? ackPlan(resolveOverride(policy, step.message.action)).acks;
    if (known === undefined) model.set(step.message.cmd_id, acks);
    for (const a of acks) expected.push({ ...a, cmd_id: step.message.cmd_id, ts });
    s.handler.handle(serialiseCmdMessage(step.message));
  }
  return { s, expected };
}

describe("acks", () => {
  it("follow the Ack_Policy, and repeats change nothing", async () => {
    // Feature: phase-1-2-gateway-simulator, Property 14: Acks follow the Ack_Policy and repeats change nothing
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 30 }), async (steps) => {
        const once = await run(steps);
        const published = once.s.broker.published;
        for (const p of published) {
          expect(p).toMatchObject({ clientId: DEVICE_ID, topic: ACK_TOPIC, qos: 1, retain: false });
        }
        const acks = published.map((p) => {
          const parsed = parseAckMessage(p.payload);
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) throw new Error("ack did not parse");
          if (parsed.value.status === "rejected") {
            expect(ACK_REASONS as readonly string[]).toContain(parsed.value.reason);
          }
          return parsed.value;
        });
        expect(
          acks.map((a) => ({ cmd_id: a.cmd_id, status: a.status, reason: a.reason, ts: a.ts })),
        ).toEqual(
          once.expected.map((e) => ({
            cmd_id: e.cmd_id,
            status: e.status,
            reason: e.reason,
            ts: e.ts,
          })),
        );

        // Every command delivered twice in a row leaves the state equal to delivering it once.
        const doubled = steps.flatMap((st): Step[] => (st.kind === "cmd" ? [st, st] : [st]));
        const twice = await run(doubled);
        expect(copyDeviceState(twice.s.state)).toEqual(copyDeviceState(once.s.state));
        expect(twice.s.handler.receivedCommands()).toEqual(once.s.handler.receivedCommands());
        expect(twice.s.broker.published.map((p) => parseAckMessage(p.payload))).toEqual(
          twice.expected.map((e) => ({
            ok: true,
            value: {
              proto_ver: 2,
              ts: e.ts,
              type: "ack",
              cmd_id: e.cmd_id,
              status: e.status,
              reason: e.reason,
            },
          })),
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe("G27 and the Ack_Policy table", () => {
  const send = (s: Awaited<ReturnType<typeof setup>>, m: CmdMessage) =>
    s.handler.handle(serialiseCmdMessage(m));
  const statuses = (s: Awaited<ReturnType<typeof setup>>) =>
    s.broker.published.map((p) => {
      const r = parseAckMessage(p.payload);
      return r.ok ? r.value.status + ":" + r.value.reason : "invalid";
    });

  it("applies set_mode, volume and config, and a reject override applies nothing", async () => {
    const s = await setup();
    send(s, { proto_ver: 2, cmd_id: "m1", action: "set_mode", data: { mode: "story" } });
    send(s, { proto_ver: 2, cmd_id: "v1", action: "volume", data: { level: 20 } });
    send(s, {
      proto_ver: 2,
      cmd_id: "k1",
      action: "config",
      data: { volume: 70, active_child_id: "child-1", movement_on: false },
    });
    expect(s.state).toMatchObject({ mode: "story", volume: 70, active_child_id: "child-1" });
    expect(s.state.settings.movement_on).toBe(false);
    expect(statuses(s)).toEqual(["accepted:", "done:", "accepted:", "done:", "accepted:", "done:"]);

    s.setPolicy(setOverride(EMPTY_ACK_POLICY, "set_mode", { mode: "reject", reason: "busy" }));
    send(s, { proto_ver: 2, cmd_id: "m2", action: "set_mode", data: { mode: "sleep" } });
    expect(s.state.mode).toBe("story");
    expect(statuses(s).slice(-1)).toEqual(["rejected:busy"]);
  });

  it("a per-action override beats an all-actions one, and the plan is fixed at receipt", async () => {
    const s = await setup();
    let p = setOverride(EMPTY_ACK_POLICY, "all", { mode: "silent" });
    p = setOverride(p, "volume", { mode: "fail", reason: "low_battery" });
    s.setPolicy(p);
    send(s, { proto_ver: 2, cmd_id: "a1", action: "volume", data: { level: 5 } });
    send(s, {
      proto_ver: 2,
      cmd_id: "a2",
      action: "animate",
      data: { expression: "happy", eyes: "blink", loop: false },
    });
    expect(statuses(s)).toEqual(["accepted:", "failed:low_battery"]);
    expect(s.state.volume).toBe(5);
    // Clearing the policy later does not change what a repeat re-sends.
    s.setPolicy(clearOverride(clearOverride(p, "all"), "volume"));
    send(s, {
      proto_ver: 2,
      cmd_id: "a2",
      action: "animate",
      data: { expression: "happy", eyes: "blink", loop: false },
    });
    expect(statuses(s)).toEqual(["accepted:", "failed:low_battery"]);
    expect(s.handler.receivedCommands().map((c) => [c.cmd_id, c.acks.length])).toEqual([
      ["a1", 2],
      ["a2", 0],
    ]);
  });

  it("a say during a turn gets done on the reply audio_end, sent once even if repeated", async () => {
    let inProgress = true;
    let stopped = 0;
    const s = await setup({
      turn: { inProgress: () => inProgress, stopReply: () => (stopped += 1) },
    });
    const say: CmdMessage = {
      proto_ver: 2,
      cmd_id: "s1",
      action: "say",
      data: { expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 1000 },
    };
    send(s, say);
    send(s, say);
    expect(statuses(s)).toEqual(["accepted:", "accepted:"]);
    send(s, { proto_ver: 2, cmd_id: "x1", action: "stop_audio", data: {} });
    expect(stopped).toBe(1);
    inProgress = false;
    s.handler.turnEnded("reply_ended");
    s.handler.turnEnded("reply_ended");
    expect(statuses(s)).toEqual(["accepted:", "accepted:", "accepted:", "done:", "done:"]);
  });

  it("a say waiting on a turn that fails gets failed with an empty reason", async () => {
    const s = await setup({ turn: { inProgress: () => true, stopReply: () => undefined } });
    send(s, {
      proto_ver: 2,
      cmd_id: "s2",
      action: "say",
      data: { expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 1000 },
    });
    s.handler.turnEnded("failed");
    expect(statuses(s)).toEqual(["accepted:", "failed:"]);
  });

  it("logs no command data value", async () => {
    const s = await setup();
    const url = "https" + "://" + "updates.example/" + SENTINEL_PREFIX + "manifest";
    send(s, { proto_ver: 2, cmd_id: "o1", action: "ota", data: { manifest_url: url } });
    send(s, {
      proto_ver: 2,
      cmd_id: "k2",
      action: "config",
      data: { active_child_id: SENTINEL_PREFIX + "child", language: "hi-IN" },
    });
    expect(s.sink.text()).not.toContain(SENTINEL_PREFIX);
    expect(s.sink.text()).not.toContain("hi-IN");
    expect(s.entries().filter((e) => e.kind === "command_applied")).toHaveLength(2);
  });
});

describe("refusals", () => {
  it("a reject override without a reason or with an unknown reason is refused, policy unchanged", () => {
    const refused: unknown[] = [
      { mode: "reject" },
      { mode: "reject", reason: "" },
      { mode: "reject", reason: SENTINEL_PREFIX + "reason" },
      { mode: "reject", reason: "Picked_Up" },
      { mode: "fail", reason: SENTINEL_PREFIX + "reason" },
      { mode: "accept_only", reason: "busy" },
      { mode: SENTINEL_PREFIX + "mode" },
      null,
      [],
    ];
    const codes: string[] = [];
    for (const scope of ["all", ...CMD_ACTIONS] as const) {
      for (const value of refused) {
        let policy: AckPolicy = setOverride(EMPTY_ACK_POLICY, "say", { mode: "silent" });
        const before = JSON.stringify(policy);
        const check = parseAckOverride(value);
        if (check.ok) policy = setOverride(policy, scope, check.override);
        expect(check.ok).toBe(false);
        expect(JSON.stringify(policy)).toBe(before);
        if (!check.ok) codes.push(check.code);
      }
    }
    expect(new Set(codes)).toEqual(
      new Set(["reason_required", "invalid_reason", "invalid_override"]),
    );
    expect(parseAckOverride({ mode: "reject" })).toEqual({ ok: false, code: "reason_required" });
    expect(parseAckOverride({ mode: "reject", reason: "x" })).toEqual({
      ok: false,
      code: "invalid_reason",
    });
    expect(parseAckOverride({ mode: "reject", reason: "at_edge" })).toEqual({
      ok: true,
      override: { mode: "reject", reason: "at_edge" },
    });
    expect(parseAckOverride({ mode: "fail", reason: "" })).toEqual({
      ok: true,
      override: { mode: "fail", reason: "" },
    });
  });

  it("an invalid command gets no ack, applies and records nothing, and logs Safe_Issues only", async () => {
    const cases = fc.sample(invalidCmdArb, { numRuns: 60, seed: 14 });
    const longKey = fc.sample(unknownKeyArb, { numRuns: 1, seed: 7 })[0] ?? "k".repeat(40);
    const wrongVersion = JSON.stringify({
      proto_ver: 1,
      cmd_id: "w1",
      action: "set_mode",
      data: { mode: "sleep" },
    });
    const noVersion = JSON.stringify({ cmd_id: "w2", action: "volume", data: { level: 1 } });
    const extra = JSON.stringify({
      proto_ver: 2,
      cmd_id: "w3",
      action: "volume",
      data: { level: 1 },
      [longKey]: SENTINEL_PREFIX + "value",
    });
    const payloads = [
      { payload: wrongVersion, protoVer: true },
      { payload: noVersion, protoVer: true },
      { payload: extra, protoVer: false },
      ...cases,
    ];
    for (const { payload, protoVer } of payloads) {
      const s = await setup();
      const before = copyDeviceState(s.state);
      s.handler.handle(payload);
      expect(s.broker.published).toEqual([]);
      expect(s.state).toEqual(before);
      expect(s.handler.receivedCommands()).toEqual([]);
      const entries = s.entries();
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry?.kind).toBe("message_rejected");
      if (entry?.kind !== "message_rejected") continue;
      expect(entry.transport).toBe("mqtt");
      expect(entry.proto_ver_mismatch).toBe(protoVer);
      expect(entry.issues.length).toBeGreaterThan(0);
      expect(entry.issues.length).toBeLessThanOrEqual(SAFE_ISSUE_LIMITS.max_issues);
      expect(Object.keys(entry).sort()).toEqual([
        "at",
        "issues",
        "kind",
        "proto_ver_mismatch",
        "seq",
        "transport",
      ]);
      for (const issue of entry.issues) {
        expect(Object.keys(issue).sort()).toEqual(["kind", "path"]);
        for (const seg of issue.path) {
          if (typeof seg === "string") {
            expect([...seg].length).toBeLessThanOrEqual(32);
            expect(seg).toMatch(/^[\x20-\x7e]*$/);
          }
        }
      }
      expect(s.sink.text()).not.toContain(SENTINEL_PREFIX);
      expect(s.sink.text()).not.toContain(longKey);
    }
  });
});
