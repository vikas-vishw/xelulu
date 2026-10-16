// The Operator_Stream transport (Phase 1.3 Req 1.1, 1.8, 1.9): the real node:http listener on a
// loopback port 0, the real hub over a real Gateway_Log and the manual test clock. It checks the
// listener's part only: the 200 and stream headers on the first write, a refusal sent as JSON, and
// a client that goes away closing its stream. Example-based (C15).
import { request, type IncomingMessage } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeviceSummary } from "@xelulu/shared";

import { createGatewayLog } from "../src/log/gateway-log.js";
import {
  checkStreamRequest,
  OPERATOR_STREAM_HEADERS,
  OPERATOR_STREAM_PATH,
  errorResponse,
  preflightOperatorRequest,
} from "../src/operator/operator-routes.js";
import {
  createOperatorStreams,
  sseEvent,
  type StreamSink,
} from "../src/operator/operator-stream.js";
import { listenOperatorHttp } from "../src/operator/transport/http-listener.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";

const SUMMARY: DeviceSummary = {
  device_id: "xlu_000123",
  presence: "unknown",
  last_heartbeat_at: null,
  battery_pct: null,
  charging: null,
  events_accepted: 0,
  events_duplicate: 0,
};

type Listener = Awaited<ReturnType<typeof listenOperatorHttp>>;
const listeners: Listener[] = [];

afterEach(async () => {
  for (const l of listeners.splice(0)) await l.close();
});

async function setup() {
  const clock = createTestClock(0);
  const log = createGatewayLog(clock, createCaptureSink());
  const streams = createOperatorStreams({
    log,
    summaries: () => [SUMMARY],
    views: () => [],
    clock,
  });
  let ended = 0;
  let port = 0;
  const listener = await listenOperatorHttp({
    host: "127.0.0.1",
    port: 0,
    preflight: (head) => preflightOperatorRequest(port, head),
    handle: () => errorResponse(404, "unknown_route"),
    openStream(req, sink) {
      const refused = checkStreamRequest(req);
      if (refused !== null) return refused;
      const counted: StreamSink = {
        ...sink,
        end() {
          ended += 1;
          sink.end();
        },
      };
      const opened = streams.open(counted);
      return opened.ok ? null : opened.refusal;
    },
  });
  port = listener.port;
  listeners.push(listener);
  return { log, streams, port, ended: () => ended };
}

/** Opens a GET and resolves with the response once its headers arrive. */
function get(port: number, path: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, resolve);
    req.on("error", reject);
    req.end();
  });
}

/** Reads the response text until `done` holds for it. */
function readUntil(res: IncomingMessage, done: (text: string) => boolean): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    res.setEncoding("utf8");
    const onData = (chunk: string): void => {
      text += chunk;
      if (done(text)) {
        res.off("data", onData);
        resolve(text);
      }
    };
    res.on("data", onData);
  });
}

describe("operator stream transport", () => {
  it("sends 200 with the stream headers, then the devices event and live entries", async () => {
    const h = await setup();
    const res = await get(h.port, OPERATOR_STREAM_PATH);

    expect(res.statusCode).toBe(200);
    for (const [name, value] of Object.entries(OPERATOR_STREAM_HEADERS)) {
      expect(res.headers[name.toLowerCase()]).toBe(value);
    }
    expect(res.headers["content-length"]).toBeUndefined();

    const first = sseEvent("devices", JSON.stringify({ devices: [SUMMARY] }));
    expect(await readUntil(res, (t) => t.length >= first.length)).toBe(first);

    const entry = h.log.add({ kind: "gateway", state: "starting" });
    const live = await readUntil(res, (t) => t.endsWith("\n\n"));
    expect(live).toBe(sseEvent("entry", JSON.stringify(entry)));
    res.destroy();
  });

  it("sends a refusal like any other response, with no stream opened", async () => {
    const h = await setup();
    const res = await get(h.port, `${OPERATOR_STREAM_PATH}?after=1`);

    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const body = await readUntil(res, (t) => t.endsWith("}"));
    expect(JSON.parse(body)).toEqual({
      ok: false,
      error: { code: "invalid_fields", issues: [{ path: ["after"], kind: "unrecognized_keys" }] },
    });
    expect(h.ended()).toBe(0);
  });

  it("closes the stream when the client goes away, freeing its slot", async () => {
    const h = await setup();
    const opened: IncomingMessage[] = [];
    for (let i = 0; i < 4; i += 1) opened.push(await get(h.port, OPERATOR_STREAM_PATH));
    expect(opened.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);

    const fifth = await get(h.port, OPERATOR_STREAM_PATH);
    expect(fifth.statusCode).toBe(503);
    fifth.resume();

    opened[0]?.destroy();
    await vi.waitFor(() => {
      expect(h.ended()).toBe(1);
    });

    const again = await get(h.port, OPERATOR_STREAM_PATH);
    expect(again.statusCode).toBe(200);
    for (const r of [...opened.slice(1), again]) r.destroy();
  });
});
