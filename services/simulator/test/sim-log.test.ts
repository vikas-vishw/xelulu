// Simulator output leaks nothing (Req 20.5, 21.4, 21.8). Each run builds a simulator whose
// DEVICE_TOKEN, MQTT_USERNAME and MQTT_PASSWORD are sentinels, then sends it generated commands
// (invalid ones, and valid ones with sentinel free-text, `manifest_url` and `active_child_id`
// values) over the memory broker, and generated Control_Surface requests in-process plus oversize
// bodies over real loopback HTTP. Every log line (stdout) and every response is scanned.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SAFE_ISSUE_LIMITS, buildTopic, type SafeIssue } from "@xelulu/shared";

import { createWsAudioClient } from "../src/audio/transport/ws-audio-client.js";
import { createSystemClock } from "../src/clock.js";
import { CONTROL_BODY_LIMIT_BYTES } from "../src/control/control-routes.js";
import { listenControlHttp } from "../src/control/transport/http-listener.js";
import { randomIds } from "../src/ids.js";
import type { SimLogEntry } from "../src/log/logger.js";
import { createSimulator } from "../src/simulator.js";
import {
  SENTINEL_PREFIX,
  cmdPayloadArb,
  controlRequestArb,
  invalidCmdArb,
  sentinelArb,
  type ControlRequestCase,
} from "./support/arbitraries.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { rawRequest } from "./support/control-http.js";
import { createMemoryBroker } from "./support/memory-broker.js";
import { flush, SIM_DEVICE_ID, simConfig } from "./support/sim-harness.js";

type Step =
  | { readonly kind: "cmd"; readonly payload: string }
  | { readonly kind: "control"; readonly req: ControlRequestCase }
  | { readonly kind: "oversize"; readonly path: string; readonly filler: string };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  invalidCmdArb.map((c): Step => ({ kind: "cmd", payload: c.payload })),
  cmdPayloadArb().map((c): Step => ({ kind: "cmd", payload: c.payload })),
  controlRequestArb.map((req): Step => ({ kind: "control", req })),
  fc
    .tuple(fc.constantFrom("/api/events", "/api/ack-policy", "/api/battery"), sentinelArb)
    .map(([path, filler]): Step => ({ kind: "oversize", path, filler })),
);

/** Every string (keys and values) inside a JSON-like value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...stringsIn(v)]);
  }
  return [];
}

function issuesOf(entry: SimLogEntry): readonly SafeIssue[] {
  return entry.kind === "message_rejected" || entry.kind === "control_rejected" ? entry.issues : [];
}

describe("simulator log and Control_Surface output", () => {
  it("never carry a sentinel, a secret or a long unknown key", async () => {
    const cmdTopic = buildTopic(SIM_DEVICE_ID, "cmd");

    // Feature: phase-1-2-gateway-simulator, Property 16: Simulator output leaks nothing
    await fc.assert(
      fc.asyncProperty(
        sentinelArb,
        sentinelArb,
        sentinelArb,
        fc.array(stepArb, { minLength: 1, maxLength: 6 }),
        async (token, password, username, steps) => {
          const config = simConfig({ localMode: false, token, password, username });
          const secrets = [token, password, username, config.broker.url, config.audio.url];
          const broker = createMemoryBroker();
          const sink = createCaptureSink();
          const sim = createSimulator(config, {
            clock: createSystemClock(),
            connectMqtt: broker.connector,
            openAudio: createWsAudioClient(),
            listenControl: listenControlHttp,
            sink,
            ids: randomIds,
            listenPorts: { control: 0 },
          });
          const peer = await broker.peer("xelulu-gw-leak-test");
          const responses: string[] = [];
          try {
            await sim.start();
            await flush();
            const port = sim.controlPort() ?? 0;
            const host = "127.0.0.1:" + String(port);
            const inProcess = (method: string, path: string, body: string): void => {
              const out = sim.handleControl({
                method,
                path,
                query: {},
                host,
                origin: undefined,
                contentType: method === "POST" ? "application/json" : undefined,
                body,
              });
              responses.push(out.body);
            };

            for (const step of steps) {
              switch (step.kind) {
                case "cmd":
                  await peer.publish(cmdTopic, step.payload, 1);
                  break;
                case "control":
                  inProcess(step.req.method, step.req.path, step.req.body);
                  break;
                case "oversize": {
                  const reps = Math.ceil((CONTROL_BODY_LIMIT_BYTES + 1) / step.filler.length) + 1;
                  const body = JSON.stringify({ event: "nfc", data: { card_id: "" } }).replace(
                    '""',
                    JSON.stringify(step.filler.repeat(reps)),
                  );
                  const res = await rawRequest(port, { method: "POST", path: step.path, body });
                  expect(res.status).toBe(413);
                  responses.push(res.body);
                  break;
                }
              }
              await flush(2);
            }
            inProcess("GET", "/api/state", "");
            inProcess("GET", "/", "");
            responses.push((await rawRequest(port, { path: "/api/state" })).body);
            await flush();
          } finally {
            await sim.stop();
            await peer.end();
          }

          // Log lines (stdout): no sentinel or secret, short strings, bounded Safe_Issues.
          const text = sink.text();
          expect(text).not.toContain(SENTINEL_PREFIX);
          for (const s of secrets) expect(text).not.toContain(s);
          for (const line of sink.lines) {
            const entry = JSON.parse(line) as SimLogEntry;
            for (const s of stringsIn(entry)) expect([...s].length).toBeLessThanOrEqual(32);
            const issues = issuesOf(entry);
            expect(issues.length).toBeLessThanOrEqual(SAFE_ISSUE_LIMITS.max_issues);
            for (const issue of issues) {
              for (const seg of issue.path) {
                if (typeof seg === "string") expect(seg).toMatch(/^[\x20-\x7e]{0,32}$/);
              }
            }
          }

          // Responses: no secret and no env value except DEVICE_ID, and no submitted value.
          for (const body of responses) {
            for (const s of secrets) expect(body).not.toContain(s);
            expect(body).not.toContain(SENTINEL_PREFIX);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
