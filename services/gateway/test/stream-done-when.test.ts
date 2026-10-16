// Done-when on the Operator_Stream (Phase 1.3 Req 10.2): what the admin console's Live_Log and
// Device Health table would show, read from `GET /v1/stream` over the real loopback
// Operator_Surface while the fake device drives the gateway on the memory broker, under Vitest
// fake timers (as done-when.test.ts). The SSE reader polls on setImmediate with a real-time
// limit, so waiting for loopback I/O never moves fake time. Example-based (C15).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import { HARNESS_DEVICE_ID, startHarness, type Harness } from "./support/gateway-harness.js";
import { rawRequest } from "./support/operator-http.js";
import {
  closeAllSseReaders,
  openSse,
  pollUntil,
  type SseEvent,
  type SseReader,
} from "./support/sse-reader.js";

const SAY_BODY = JSON.stringify({
  device_id: HARNESS_DEVICE_ID,
  action: "say",
  data: { expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 800 },
});

let h: Harness;
let r: SseReader;

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  h = await startHarness({ localMode: true });
  r = await openSse(port());
  expect(r.status).toBe(200);
});

afterEach(async () => {
  closeAllSseReaders();
  await h.stop();
  vi.useRealTimers();
});

function port(): number {
  const p = h.gateway.operatorPort();
  if (p === null) throw new Error("no Operator_Surface");
  return p;
}

/** The Log_Entries on the stream so far, parsed, in order. */
function streamEntries(): GatewayLogEntry[] {
  return r
    .events()
    .filter((e) => e.name === "entry")
    .map((e) => JSON.parse(e.data) as GatewayLogEntry);
}

function devicesOf(event: SseEvent | undefined): readonly DeviceSummary[] {
  if (event?.name !== "devices") throw new Error("expected a devices event");
  return (JSON.parse(event.data) as { devices: readonly DeviceSummary[] }).devices;
}

function latestDevices(): readonly DeviceSummary[] {
  return devicesOf(
    r
      .events()
      .filter((e) => e.name === "devices")
      .at(-1),
  );
}

/** Index in r.events() of the first `entry` event whose entry matches, or -1. */
function indexOfEntry(match: (e: GatewayLogEntry) => boolean): number {
  return r
    .events()
    .findIndex((e) => e.name === "entry" && match(JSON.parse(e.data) as GatewayLogEntry));
}

/** Waits until every Log_Entry so far (and any devices event after it) has reached the reader. */
async function caughtUp(extra: () => boolean = () => true): Promise<void> {
  await pollUntil(
    () =>
      streamEntries().length === h.sink.lines.length &&
      JSON.stringify({ devices: h.gateway.summaries() }) ===
        r
          .events()
          .filter((e) => e.name === "devices")
          .at(-1)?.data &&
      extra(),
  );
}

describe("Done-when on the Operator_Stream", () => {
  it("shows the device Online with its battery after hello and status", async () => {
    await h.online();
    await h.device.status({ battery_pct: 100, charging: false });
    await caughtUp(() =>
      streamEntries().some((e) => e.kind === "message_in" && e.variant === "status"),
    );

    expect(
      streamEntries()
        .filter((e) => e.kind === "presence")
        .map((e) => [e.state, e.cause]),
    ).toEqual([["online", "hello"]]);
    expect(latestDevices()).toEqual([
      expect.objectContaining({
        device_id: HARNESS_DEVICE_ID,
        presence: "online",
        battery_pct: 100,
        charging: false,
      }),
    ]);
  });

  it("shows a belly touch, a cry, and a say with its done ack", async () => {
    await h.online();
    const touch = await h.device.event("touch", { data: { zone: "belly", gesture: "tap" } });
    const cry = await h.device.event("cry");
    const answer = await rawRequest(port(), {
      method: "POST",
      path: "/v1/commands",
      body: SAY_BODY,
    });
    expect(answer.status).toBe(200);
    const sayId = (JSON.parse(answer.body) as { cmd_id: string }).cmd_id;
    await caughtUp(() =>
      streamEntries().some(
        (e) => e.kind === "ack_result" && e.cmd_id === sayId && e.outcome === "done",
      ),
    );

    const accepted = streamEntries().filter((e) => e.kind === "event_accepted");
    expect(accepted).toEqual([
      expect.objectContaining({
        event_id: touch,
        event: "touch",
        data: { zone: "belly", gesture: "tap" },
      }),
      expect.objectContaining({ event_id: cry, event: "cry" }),
    ]);

    const out = indexOfEntry(
      (e) => e.kind === "message_out" && e.variant === "say" && e.cmd_id === sayId,
    );
    const done = indexOfEntry(
      (e) => e.kind === "ack_result" && e.cmd_id === sayId && e.outcome === "done",
    );
    expect(out).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(out);
    expect(JSON.parse(r.events()[done]?.data ?? "")).toMatchObject({
      kind: "ack_result",
      device_id: HARNESS_DEVICE_ID,
      action: "say",
      outcome: "done",
      reason: "",
    });
    expect(latestDevices()[0]).toMatchObject({ events_accepted: 2, events_duplicate: 0 });
  });

  it("shows presence offline (silence) and an offline summary 45 s after the last heartbeat", async () => {
    await h.online();
    await caughtUp(() => streamEntries().some((e) => e.kind === "presence"));
    const hello = streamEntries().find((e) => e.kind === "message_in" && e.variant === "hello");
    const lastAt = Date.parse(hello?.at ?? "");

    // Offline toggle: the robot goes silent.
    await h.device.disconnect();
    await vi.advanceTimersByTimeAsync(lastAt + 44_999 - Date.now());
    await caughtUp();
    expect(streamEntries().filter((e) => e.kind === "presence" && e.state === "offline")).toEqual(
      [],
    );
    expect(latestDevices()[0]?.presence).toBe("online");

    await vi.advanceTimersByTimeAsync(1);
    await caughtUp(() =>
      streamEntries().some((e) => e.kind === "presence" && e.state === "offline"),
    );
    const offline = indexOfEntry((e) => e.kind === "presence" && e.state === "offline");
    expect(JSON.parse(r.events()[offline]?.data ?? "")).toMatchObject({
      kind: "presence",
      device_id: HARNESS_DEVICE_ID,
      state: "offline",
      cause: "silence",
    });
    expect(devicesOf(r.events()[offline + 1])).toEqual([
      expect.objectContaining({ device_id: HARNESS_DEVICE_ID, presence: "offline" }),
    ]);
  });
});
