// Event factory examples (Req 2.4, 16.4, 16.7). Refused requests carry Safe_Issues only and
// reach neither the broker nor the Offline_Queue; each default is a member of its contract
// constant; supplied values are kept unchanged. Property 13 fires generated requests through
// createSimulator and the Control_Surface routes, with the memory broker, under fake timers.
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BUTTONS,
  BUTTON_ACTIONS,
  EVENT_KINDS,
  MOTION_KINDS,
  SAFE_ISSUE_LIMITS,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  buildTopic,
  parseEventMessage,
} from "@xelulu/shared";

import { createWsAudioClient } from "../src/audio/transport/ws-audio-client.js";
import { createSystemClock } from "../src/clock.js";
import { listenControlHttp } from "../src/control/transport/http-listener.js";
import { buildEvent, EVENT_DATA_DEFAULTS, type EventRequest } from "../src/device/event-factory.js";
import { createOutbox } from "../src/device/outbox.js";
import { randomIds } from "../src/ids.js";
import { createSimLog } from "../src/log/logger.js";
import { createSimulator } from "../src/simulator.js";
import { eventRequestArb } from "./support/arbitraries.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createMemoryBroker } from "./support/memory-broker.js";
import { simConfig } from "./support/sim-harness.js";
import { createTestClock } from "./support/test-clock.js";

const DEVICE_ID = "sim-device-1";
const TS = 1_760_000_000;
const SECTION = "\u00a7";

async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** An outbox that is online on the memory broker, as the device link will drive it. */
async function onlineOutbox() {
  const broker = createMemoryBroker();
  const conn = await broker.peer(DEVICE_ID);
  const sink = createCaptureSink();
  const outbox = createOutbox({ log: createSimLog(createTestClock(TS * 1000), sink) });
  const topic = buildTopic(DEVICE_ID, "event");
  outbox.linkUp({ publishEvent: (p) => conn.publish(topic, p, 1) }, () => undefined);
  return { broker, outbox, sink };
}

describe("refused event requests", () => {
  const refused: [string, EventRequest][] = [
    ["an unknown kind", { event: SECTION + "not-a-kind" }],
    ["a kind in the wrong case", { event: "Touch" }],
    ["data that is not an object", { event: "touch", data: [] as unknown as EventRequest["data"] }],
    ["a zone outside TOUCH_ZONES", { event: "touch", data: { zone: SECTION + "zone-value" } }],
    ["a confidence above 1", { event: "cry", data: { confidence: 2 } }],
    ["a dir_deg of 360", { event: "wake", data: { dir_deg: 360 } }],
    ["an empty card_id", { event: "nfc", data: { card_id: "" } }],
    ["a non-finite motion value", { event: "motion", data: { value: Number.POSITIVE_INFINITY } }],
    ["interrupt data with a key", { event: "interrupt", data: { [SECTION + "k"]: 1 } }],
    ["an error code that is not a string", { event: "error", data: { code: 7 } }],
  ];

  it.each(refused)(
    "%s is refused with Safe_Issues and nothing published or queued",
    async (_n, req) => {
      const { broker, outbox, sink } = await onlineOutbox();
      const result = buildEvent(req, "ev_example", TS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.length).toBeLessThanOrEqual(SAFE_ISSUE_LIMITS.max_issues);
      expect(JSON.stringify(result.issues)).not.toContain(SECTION);
      // The caller only hands a built event to the outbox, so a refusal reaches neither.
      await flush();
      expect(broker.published).toEqual([]);
      expect(outbox.queueLength()).toBe(0);
      expect(sink.lines).toEqual([]);
    },
  );

  it("an unknown kind gives one invalid_value issue at event", () => {
    expect(buildEvent({ event: "dance" }, "ev_x", TS)).toEqual({
      ok: false,
      issues: [{ path: ["event"], kind: "invalid_value" }],
    });
  });

  it("long unknown data keys are cut to 32 printable characters, at most 20 issues", () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) data[SECTION + "\u0001".repeat(40) + String(i)] = SECTION;
    const result = buildEvent({ event: "touch", data }, "ev_x", TS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(SAFE_ISSUE_LIMITS.max_issues);
    for (const issue of result.issues) {
      expect(issue.kind).toBe("unrecognized_keys");
      const key = issue.path[1];
      expect(typeof key).toBe("string");
      expect([...(key as string)].length).toBeLessThanOrEqual(32);
      expect(key as string).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

describe("defaults", () => {
  it("each closed-list default is a member of its contract constant", () => {
    expect(TOUCH_ZONES).toContain(EVENT_DATA_DEFAULTS.touch["zone"]);
    expect(TOUCH_GESTURES).toContain(EVENT_DATA_DEFAULTS.touch["gesture"]);
    expect(WAKE_SOURCES).toContain(EVENT_DATA_DEFAULTS.wake["source"]);
    expect(MOTION_KINDS).toContain(EVENT_DATA_DEFAULTS.motion["event"]);
    expect(BUTTONS).toContain(EVENT_DATA_DEFAULTS.button["button"]);
    expect(BUTTON_ACTIONS).toContain(EVENT_DATA_DEFAULTS.button["action"]);
    expect(Object.keys(EVENT_DATA_DEFAULTS).sort()).toEqual([...EVENT_KINDS].sort());
  });

  it("an empty request gets exactly the Req 16.7 defaults for every kind", () => {
    const expected: Record<string, unknown> = {
      touch: { zone: "belly", gesture: "tap" },
      wake: { source: "hey_lulu" },
      cry: { confidence: 0.9, duration_s: 6 },
      motion: { event: "pickup", value: 0 },
      button: { button: "belly_talk", action: "press" },
      nfc: { card_id: "sim-card-1" },
      interrupt: {},
      error: { code: "sim_error", detail: "" },
    };
    for (const kind of EVENT_KINDS) {
      const result = buildEvent({ event: kind }, "ev_" + kind, TS);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.message.data).toEqual(expected[kind]);
      expect(Object.hasOwn(result.message, "time_uncertain")).toBe(false);
      expect(result.message).toMatchObject({ proto_ver: 2, ts: TS, type: "event", event: kind });
      expect(result.message.event_id).toBe("ev_" + kind);
      const parsed = parseEventMessage(result.payload);
      expect(parsed.ok && parsed.value).toEqual(result.message);
    }
  });

  it("supplied values are kept and only omitted fields are filled", () => {
    const cases: [EventRequest, Record<string, unknown>][] = [
      [
        { event: "touch", data: { zone: "left_ear" } },
        { zone: "left_ear", gesture: "tap" },
      ],
      [
        { event: "touch", data: { gesture: "hold" } },
        { zone: "belly", gesture: "hold" },
      ],
      [
        { event: "wake", data: { dir_deg: 90 } },
        { source: "hey_lulu", dir_deg: 90 },
      ],
      [{ event: "wake", data: { source: "touch" } }, { source: "touch" }],
      [
        { event: "cry", data: { duration_s: 0 } },
        { confidence: 0.9, duration_s: 0 },
      ],
      [
        { event: "motion", data: { value: -2.5 } },
        { event: "pickup", value: -2.5 },
      ],
      [
        { event: "button", data: { action: "release" } },
        { button: "belly_talk", action: "release" },
      ],
      [{ event: "nfc", data: { card_id: SECTION + "card" } }, { card_id: SECTION + "card" }],
      [
        { event: "error", data: { detail: "x" } },
        { code: "sim_error", detail: "x" },
      ],
      [
        { event: "error", data: { code: "" } },
        { code: "", detail: "" },
      ],
    ];
    for (const [req, data] of cases) {
      const result = buildEvent(req, "ev_case", TS);
      expect(result.ok, JSON.stringify(req)).toBe(true);
      if (result.ok) expect(result.message.data).toEqual(data);
    }
  });
});

/** The Req 16.7 defaults, written here as the oracle (not read from the source). */
const REQ_16_7_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  touch: { zone: "belly", gesture: "tap" },
  wake: { source: "hey_lulu" },
  cry: { confidence: 0.9, duration_s: 6 },
  motion: { event: "pickup", value: 0 },
  button: { button: "belly_talk", action: "press" },
  nfc: { card_id: "sim-card-1" },
  interrupt: {},
  error: { code: "sim_error", detail: "" },
};

describe("fired events through the simulator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trip with the Req 16.7 defaults for exactly the omitted fields", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const config = simConfig({ deviceId: DEVICE_ID });
    const eventTopic = buildTopic(DEVICE_ID, "event");
    const seenIds = new Set<string>();

    // Feature: phase-1-2-gateway-simulator, Property 13: Fired events round-trip with defaults
    await fc.assert(
      fc.asyncProperty(
        eventRequestArb,
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        async (req, at) => {
          vi.setSystemTime(at);
          const broker = createMemoryBroker();
          const sim = createSimulator(config, {
            clock: createSystemClock(),
            connectMqtt: broker.connector,
            openAudio: createWsAudioClient(),
            listenControl: listenControlHttp,
            sink: createCaptureSink(),
            ids: randomIds,
            listenPorts: { control: 0 },
          });
          try {
            await sim.start();
            await flush(5);
            expect(sim.connected()).toBe(true);
            const out = sim.handleControl({
              method: "POST",
              path: "/api/events",
              query: {},
              host: "127.0.0.1:" + String(sim.controlPort()),
              origin: undefined,
              contentType: "application/json",
              body: JSON.stringify(
                req.data === undefined
                  ? { event: req.event }
                  : { event: req.event, data: req.data },
              ),
            });
            expect(out.status).toBe(200);
            const response = JSON.parse(out.body) as {
              ok: boolean;
              event_id: string;
              ts: number;
              queued: boolean;
            };
            expect(response.ok).toBe(true);
            expect(response.queued).toBe(false);
            await flush(5);

            const events = broker.published.filter((p) => p.topic === eventTopic);
            expect(events).toHaveLength(1);
            const published = events[0];
            expect(published).toMatchObject({ clientId: DEVICE_ID, qos: 1, retain: false });
            const parsed = parseEventMessage(published?.payload ?? "");
            expect(parsed.ok).toBe(true);
            if (!parsed.ok) return;
            const message = parsed.value;
            expect(message.event).toBe(req.event);
            const defaults = REQ_16_7_DEFAULTS[req.event] ?? {};
            const expected: Record<string, unknown> = { ...(req.data ?? {}) };
            for (const field of req.omitted) {
              if (Object.hasOwn(defaults, field)) expected[field] = defaults[field];
            }
            expect(message.data).toEqual(expected);
            expect(message.event_id).toBe(response.event_id);
            expect(message.ts).toBe(response.ts);
            expect(message.ts).toBe(Math.floor(at / 1000));
            expect(Object.hasOwn(message, "time_uncertain")).toBe(false);
            expect(seenIds.has(message.event_id)).toBe(false);
            seenIds.add(message.event_id);
          } finally {
            await sim.stop();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
