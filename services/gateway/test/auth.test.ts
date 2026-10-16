// Device registry and hello auth through the composed gateway (Req 5.1–5.7): Property 4 (no part
// of a token or a hello `auth` ever reaches output) and the auth examples. The memory broker
// carries MQTT; audio upgrades and Operator_Surface calls use real loopback sockets.
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTopic, serialiseStatusMessage, type GatewayLogEntry } from "@xelulu/shared";

import { callOperator } from "../src/operator/transport/http-client.js";
import { printableChar } from "./support/arbitraries.js";
import { nowTs } from "./support/fake-device.js";
import {
  flush,
  HARNESS_DEVICE_ID,
  startHarness,
  stringsIn,
  type Harness,
} from "./support/gateway-harness.js";

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  vi.restoreAllMocks();
});

async function harness(opts: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  const h = await startHarness(opts);
  running.push(h);
  return h;
}

/** Entries added after `mark`. */
function after(h: Harness, mark: number): GatewayLogEntry[] {
  return h.entries.slice(mark);
}

// ---------------------------------------------------------------------------------------------
// Property 4.

/** Printable ASCII or a non-ASCII scalar value from U+00A0 up (no control, no surrogate). */
const secretUnit: fc.Arbitrary<string> = fc.oneof(
  printableChar,
  fc
    .integer({ min: 0xa0, max: 0x10ffff })
    .filter((c) => c < 0xd800 || c > 0xdfff)
    .map((c) => String.fromCodePoint(c)),
);
const secretArb = fc.string({ unit: secretUnit, minLength: 16, maxLength: 40 });

/** Every 8-code-point window of `value`. */
function windows(value: string): string[] {
  const cps = Array.from(value);
  const out: string[] = [];
  for (let i = 0; i + 8 <= cps.length; i++) out.push(cps.slice(i, i + 8).join(""));
  return out;
}

/** True when `text` holds a window of a secret, raw or JSON-escaped. */
function leaks(text: string, secrets: readonly string[]): boolean {
  return secrets.some((s) =>
    windows(s).some((w) => text.includes(w) || text.includes(JSON.stringify(w).slice(1, -1))),
  );
}

/** The header value as UTF-8 bytes read as latin1, so any secret can travel in a header. */
function headerValue(secret: string): string {
  return "Bearer " + Buffer.from(secret, "utf8").toString("latin1");
}

describe("hello auth and device tokens", () => {
  // Feature: phase-1-2-gateway-simulator, Property 4: Hello auth and device tokens never appear in output
  it("never put any 8-character part of a token or an auth value in any output", async () => {
    await fc.assert(
      fc.asyncProperty(secretArb, fc.option(secretArb, { nil: null }), async (token, other) => {
        const auth = other ?? token;
        const stderr: string[] = [];
        const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
          stderr.push(String(chunk));
          return true;
        });
        const h = await startHarness({ localMode: true, token });
        const outputs: string[] = [];
        try {
          await h.device.connect();
          await h.device.hello({ auth });
          await flush();
          expect(h.entries).toContainEqual(
            expect.objectContaining({
              kind: "auth",
              transport: "mqtt",
              outcome: auth === token ? "ok" : "failed",
            }),
          );

          for (const secret of [auth, token]) {
            const terminal = h.entries.filter(
              (e) => e.kind === "audio_turn" && e.phase === "aborted",
            ).length;
            const result = await h.device.openAudio(h.gateway.audioPort(), {
              authorization: headerValue(secret),
            });
            // A header-safe matching token must open a turn, so both paths are exercised.
            if (secret === token && /^[\x20-\x7e]+$/.test(token) && token.trim() === token) {
              expect(result.kind).toBe("open");
            }
            if (result.kind === "open") {
              result.audio.close();
              await result.audio.closed;
              await vi.waitFor(() => {
                expect(
                  h.entries.filter((e) => e.kind === "audio_turn" && e.phase === "aborted"),
                ).toHaveLength(terminal + 1);
              });
            }
          }

          const port = h.gateway.operatorPort() ?? 0;
          for (const path of ["/v1/devices", "/v1/log"]) {
            outputs.push((await callOperator({ port, method: "GET", path })).body);
          }
        } finally {
          await h.stop();
          spy.mockRestore();
        }

        outputs.push(...h.sink.lines, ...stderr, ...stringsIn(h.entries));
        for (const text of outputs) expect(leaks(text, [token, auth])).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Examples.

describe("registry and auth examples", () => {
  it("treats only DEVICE_ID as a Registered_Device", async () => {
    const h = await harness();
    expect(h.gateway.snapshot().devices.map((d) => d.device_id)).toEqual([HARNESS_DEVICE_ID]);

    const mark = h.entries.length;
    h.inject(
      buildTopic("xlu_999999", "status"),
      serialiseStatusMessage({
        proto_ver: 2,
        ts: nowTs(),
        type: "status",
        battery_pct: 80,
        charging: false,
        mode: "idle",
        wifi_rssi: -50,
        fault: [],
        active_child_id: null,
        temp_c: 30,
      }),
    );
    expect(after(h, mark)).toEqual([
      expect.objectContaining({
        kind: "message_rejected",
        device_id: null,
        topic_suffix: "status",
        issues: [{ path: [], kind: "unknown_device" }],
      }),
    ]);
    expect(
      h.gateway.sendCommand({ device_id: "xlu_999999", action: "volume", data: { level: 1 } }),
    ).toEqual({ ok: false, error: { code: "unknown_device" } });
  });

  it("starts unmarked and processes status, event and ack normally before any hello", async () => {
    const h = await harness();
    await h.device.connect();
    expect(h.gateway.snapshot().devices[0]?.auth_failed).toBe(false);

    await h.device.status();
    const eventId = await h.device.event("touch");
    await h.device.ack("c_unknown", "done");
    await flush();

    expect(h.entries).toContainEqual(
      expect.objectContaining({ kind: "presence", state: "online", cause: "status" }),
    );
    expect(h.entries).toContainEqual(
      expect.objectContaining({ kind: "event_accepted", event_id: eventId }),
    );
    expect(h.entries).toContainEqual(
      expect.objectContaining({ kind: "ack_result", cmd_id: "c_unknown", outcome: "unmatched" }),
    );
    expect(h.entries.some((e) => e.kind === "message_rejected")).toBe(false);
  });

  it("marks auth_failed on a wrong auth, also when already marked, with no Heartbeat", async () => {
    const h = await harness();
    await h.device.connect();

    for (let i = 0; i < 2; i++) {
      const mark = h.entries.length;
      await h.device.hello({ auth: "wrong-auth-value-0001" });
      await flush();
      expect(after(h, mark)).toEqual([
        expect.objectContaining({ kind: "message_in", variant: "hello" }),
        expect.objectContaining({
          kind: "auth",
          transport: "mqtt",
          device_id: HARNESS_DEVICE_ID,
          outcome: "failed",
        }),
      ]);
      const snap = h.gateway.snapshot().devices[0];
      expect(snap?.auth_failed).toBe(true);
      expect(snap?.presence).toBe("unknown");
      expect(snap?.last_heartbeat_at).toBeNull();
    }
    expect(h.entries.some((e) => e.kind === "presence")).toBe(false);
  });

  it("drops status, event and ack while marked, with one auth_failed rejection each", async () => {
    const h = await harness({ policy: { mode: "silent" } });
    await h.online();
    const sent = h.gateway.sendCommand({
      device_id: HARNESS_DEVICE_ID,
      action: "volume",
      data: { level: 5 },
    });
    if (!sent.ok) throw new Error("command refused");
    const acceptedBefore = h.gateway.snapshot();

    await h.device.hello({ auth: "wrong-auth-value-0002" });
    await flush();
    const before = h.gateway.snapshot();
    expect(before.devices[0]?.auth_failed).toBe(true);
    // A wrong hello is no Heartbeat: the last Heartbeat time is unchanged.
    expect(before.devices[0]?.last_heartbeat_at).toBe(acceptedBefore.devices[0]?.last_heartbeat_at);

    const inputs: [string, () => Promise<unknown>][] = [
      ["status", () => h.device.status()],
      ["event", () => h.device.event("interrupt")],
      ["ack", () => h.device.ack(sent.cmd_id, "done")],
    ];
    for (const [suffix, send] of inputs) {
      const mark = h.entries.length;
      await send();
      await flush();
      expect(after(h, mark)).toEqual([
        {
          log_ver: 2,
          seq: mark + 1,
          at: expect.any(String) as unknown,
          kind: "message_rejected",
          transport: "mqtt",
          device_id: HARNESS_DEVICE_ID,
          topic_suffix: suffix,
          issues: [{ path: [], kind: "auth_failed" }],
        },
      ]);
    }
    expect(h.gateway.snapshot()).toEqual(before);
    expect(h.gateway.snapshot().devices[0]?.commands[0]?.state).toBe("pending");
  });

  it("clears the mark on a matching auth and counts that hello as a Heartbeat", async () => {
    const h = await harness();
    await h.device.connect();
    await h.device.hello({ auth: "wrong-auth-value-0003" });
    await flush();
    expect(h.gateway.snapshot().devices[0]?.auth_failed).toBe(true);

    const mark = h.entries.length;
    await h.device.hello();
    await flush();
    expect(after(h, mark)).toEqual([
      expect.objectContaining({ kind: "message_in", variant: "hello" }),
      expect.objectContaining({ kind: "auth", device_id: HARNESS_DEVICE_ID, outcome: "ok" }),
      expect.objectContaining({ kind: "presence", state: "online", cause: "hello" }),
    ]);
    expect(h.gateway.snapshot().devices[0]?.auth_failed).toBe(false);

    const statusMark = h.entries.length;
    await h.device.status();
    await flush();
    expect(after(h, statusMark)).toEqual([
      expect.objectContaining({ kind: "message_in", variant: "status" }),
    ]);
  });
});
