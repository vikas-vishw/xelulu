// The Operator_Stream end to end (Phase 1.3 Req 10.1, 1.1–1.10, 2.1–2.4): the composed gateway
// from the harness (Local_Mode, real loopback Operator_Surface on port 0, the fake device on the
// memory broker), read over node:http by the SSE reader. Real timers; the 15 s keep-alive is the
// hub test's (operator-stream-hub.test.ts). Example-based (C15): Properties 1–3 of the design.
import { afterEach, describe, expect, it } from "vitest";

import type { DeviceSummary, GatewayLogEntry } from "@xelulu/shared";

import {
  OPERATOR_STREAM_HEADERS,
  OPERATOR_STREAM_PATH,
  type HttpRequestIn,
  type OperatorListen,
} from "../src/operator/operator-routes.js";
import { OPERATOR_STREAM_LIMITS, type StreamSink } from "../src/operator/operator-stream.js";
import { listenOperatorHttp } from "../src/operator/transport/http-listener.js";
import { sttSaying } from "./support/brain-harness.js";
import {
  HARNESS_DEVICE_ID,
  startHarness,
  type Harness,
  type HarnessOptions,
} from "./support/gateway-harness.js";
import { rawRequest } from "./support/operator-http.js";
import { createStubLlm, createStubTts, STUB_REPLY_TEXT } from "./support/stub-providers.js";
import {
  closeAllSseReaders,
  entrySeq,
  openSse,
  pollUntil,
  type SseEvent,
  type SseReader,
} from "./support/sse-reader.js";

// Sentinels of at least 8 characters (Property 3). The hello auth is a wrong token on purpose.
const TOKEN_SENTINEL = "SENTINEL-stream-device-token-5b9e";
const PASSWORD_SENTINEL = "SENTINEL-stream-mqtt-password-71c4";
const HELLO_AUTH_SENTINEL = "SENTINEL-stream-hello-auth-d02a";

const SUMMARY_FIELDS = [
  "battery_pct",
  "charging",
  "device_id",
  "events_accepted",
  "events_duplicate",
  "last_heartbeat_at",
  "presence",
];

const harnesses: Harness[] = [];

afterEach(async () => {
  closeAllSseReaders();
  for (const h of harnesses.splice(0)) await h.stop();
});

async function start(opts: HarnessOptions = {}): Promise<Harness> {
  const h = await startHarness({
    localMode: true,
    token: TOKEN_SENTINEL,
    password: PASSWORD_SENTINEL,
    ...opts,
  });
  harnesses.push(h);
  return h;
}

function port(h: Harness): number {
  const p = h.gateway.operatorPort();
  if (p === null) throw new Error("no Operator_Surface");
  return p;
}

function entryEvents(r: SseReader): SseEvent[] {
  return r.events().filter((e) => e.name === "entry");
}

function devicesOf(event: SseEvent | undefined): readonly DeviceSummary[] {
  if (event?.name !== "devices") throw new Error("expected a devices event");
  return (JSON.parse(event.data) as { devices: readonly DeviceSummary[] }).devices;
}

/** The event right after the first `entry` event whose entry matches. */
function after(r: SseReader, match: (e: GatewayLogEntry) => boolean): SseEvent | undefined {
  const events = r.events();
  const i = events.findIndex(
    (e) => e.name === "entry" && match(JSON.parse(e.data) as GatewayLogEntry),
  );
  if (i === -1) throw new Error("entry not on the stream");
  return events[i + 1];
}

/** True once every Log_Entry so far has reached the reader. */
function caughtUp(h: Harness, r: SseReader): boolean {
  return entryEvents(r).length === h.sink.lines.length;
}

/** The server sees a client's close asynchronously: retries while the answer is 503. */
async function openWhenFree(p: number, limitMs = 5_000): Promise<SseReader> {
  const deadline = performance.now() + limitMs;
  for (;;) {
    const r = await openSse(p);
    if (r.status !== 503 || performance.now() > deadline) return r;
    await r.waitForEnd();
    r.close();
  }
}

const SAY_BODY = JSON.stringify({
  device_id: HARNESS_DEVICE_ID,
  action: "say",
  data: { expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 800 },
});

// ---------------------------------------------------------------------------------------------
// The conversation channel (Phase 3 Req 18.2, 18.5, 18.7; task 10.3).

/**
 * The child's words for the turn tests. It opens with the stubs' greeting on purpose: the device
 * names no active child, so the most restrictive Child_Context applies and a topic outside its
 * allowed categories would be refused before the model. The sentinel tail is long enough to be
 * found anywhere it should not appear.
 */
const UTTERANCE_SENTINEL = "hello xelulu SENTINEL-stream-utterance-a7c3";

const TURN_ID = "t_operator_stream";
const TURN_REPLY_FRAMES = 5;

/** Providers that transcribe the sentinel and answer with the stubs' short safe reply. */
function sentinelProviders(): NonNullable<HarnessOptions["providers"]> {
  return {
    stt: sttSaying(UTTERANCE_SENTINEL),
    llm: createStubLlm(),
    tts: createStubTts(TURN_REPLY_FRAMES),
  };
}

type TurnEvent = Readonly<{ turn_id: string; state: string }>;

function turnEvents(r: SseReader): (TurnEvent & Record<string, unknown>)[] {
  return r
    .events()
    .filter((e) => e.name === "turn")
    .map((e) => JSON.parse(e.data) as TurnEvent & Record<string, unknown>);
}

/** Uploads one audio turn and waits until the brain has finished it. */
async function runTurn(h: Harness, turnId = TURN_ID): Promise<void> {
  const audio = await h.device.audioTurn(h.gateway.audioPort(), { turnId, frames: 3 });
  await pollUntil(() =>
    h.entries.some((e) => e.kind === "brain_turn" && e.turn_id === turnId && e.phase === "done"),
  );
  audio.close();
}

async function getJson(p: number, path: string): Promise<Record<string, unknown>> {
  const res = await rawRequest(p, { path });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
}

describe("Operator_Stream over the loopback Operator_Surface", () => {
  it("answers 200 with the stream headers and sends one devices event first (Req 1.1, 2.2)", async () => {
    const h = await start();
    const r = await openSse(port(h));

    expect(r.status).toBe(200);
    for (const [name, value] of Object.entries(OPERATOR_STREAM_HEADERS)) {
      expect(r.headers[name.toLowerCase()]).toBe(value);
    }
    await r.waitFor((events) => events.length >= 1);
    const devices = devicesOf(r.events()[0]);
    expect(devices).toEqual([
      {
        device_id: HARNESS_DEVICE_ID,
        presence: "unknown",
        last_heartbeat_at: null,
        battery_pct: null,
        charging: null,
        events_accepted: 0,
        events_duplicate: 0,
      },
    ]);
    expect(Object.keys(devices[0] ?? {}).sort()).toEqual(SUMMARY_FIELDS);
  });

  /** Property 1: Stream order and fidelity. **Validates: Requirements 1.2, 2.1** */
  it("sends the backlog then live entries in seq order, each equal to its stdout line", async () => {
    const h = await start();
    const backlog = h.sink.lines.length;
    const r = await openSse(port(h));

    await h.online();
    await h.device.event("touch", { data: { zone: "belly", gesture: "tap" } });
    await pollUntil(() => h.entries.some((e) => e.kind === "event_accepted") && caughtUp(h, r));

    expect(r.events()[0]?.name).toBe("devices");
    const entries = entryEvents(r);
    expect(backlog).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(backlog);
    expect(entries.map(entrySeq)).toEqual(entries.map((_, i) => i + 1));
    expect(entries.map((e) => e.data)).toEqual(h.sink.lines);
  });

  /** Property 2: Summaries follow device state. **Validates: Requirements 1.3, 2.2, 2.3** */
  it("sends a devices event after an entry that changed a summary, and none otherwise", async () => {
    const h = await start();
    const r = await openSse(port(h));

    await h.online();
    await h.device.status({ battery_pct: 64, charging: true });
    await h.device.event("touch", { data: { zone: "belly", gesture: "tap" } });
    await pollUntil(
      () =>
        h.entries.some((e) => e.kind === "event_accepted") &&
        caughtUp(h, r) &&
        r.events().at(-1)?.name === "devices",
    );
    // A refused hello marks the device auth_failed, so its next event is rejected (Phase 1.2).
    await h.device.hello({ auth: HELLO_AUTH_SENTINEL });
    await h.device.event("cry");
    await pollUntil(() => h.entries.some((e) => e.kind === "message_rejected") && caughtUp(h, r));

    // A successful hello: the auth entry changes nothing; presence online does.
    expect(after(r, (e) => e.kind === "auth" && e.outcome === "ok")?.name).toBe("entry");
    const online = devicesOf(after(r, (e) => e.kind === "presence" && e.state === "online"));
    expect(online[0]).toMatchObject({ presence: "online", battery_pct: null, charging: null });
    expect(online[0]?.last_heartbeat_at).not.toBeNull();

    // The accepted status carries its battery and charging into the summary (Req 2.3).
    const status = devicesOf(after(r, (e) => e.kind === "message_in" && e.variant === "status"));
    expect(status[0]).toMatchObject({ battery_pct: 64, charging: true });

    const accepted = devicesOf(after(r, (e) => e.kind === "event_accepted"));
    expect(accepted[0]).toMatchObject({ events_accepted: 1, events_duplicate: 0 });

    // A refused hello changes no summary: its auth entry is followed by no devices event.
    expect(after(r, (e) => e.kind === "auth" && e.outcome === "failed")?.name).toBe("entry");
    expect(after(r, (e) => e.kind === "message_rejected")).toBeUndefined();

    // The latest devices event equals the summaries now.
    const latest = r
      .events()
      .filter((e) => e.name === "devices")
      .at(-1);
    expect(latest?.data).toBe(JSON.stringify({ devices: h.gateway.summaries() }));
  });

  it("applies the guard and the query rule to /v1/stream (Req 1.5, 1.6)", async () => {
    const h = await start();
    const p = port(h);
    const value = "SENTINEL-stream-query-value";
    const cases = [
      { req: { headers: { Origin: "http" + "://" + "evil.invalid" } }, status: 403 },
      { req: { headers: { Host: `gateway:${p}` } }, status: 403 },
      { req: { method: "POST", body: "{}" }, status: 405 },
      { req: { path: `${OPERATOR_STREAM_PATH}?after=${value}` }, status: 400 },
    ] as const;
    const codes = ["forbidden_origin", "forbidden_host", "method_not_allowed", "invalid_fields"];

    const answers = [];
    for (const c of cases)
      answers.push(await rawRequest(p, { path: OPERATOR_STREAM_PATH, ...c.req }));

    expect(answers.map((a) => a.status)).toEqual(cases.map((c) => c.status));
    expect(
      answers.map((a) => (JSON.parse(a.body) as { error: { code: string } }).error.code),
    ).toEqual(codes);
    for (const a of answers) {
      expect(a.headers["content-type"]).toBe("application/json; charset=utf-8");
    }
    expect(JSON.parse(answers[3]?.body ?? "")).toEqual({
      ok: false,
      error: { code: "invalid_fields", issues: [{ path: ["after"], kind: "unrecognized_keys" }] },
    });
    expect(answers.map((a) => a.body).join("")).not.toContain(value);
  });

  it("refuses a fifth stream with 503, and a closed client frees its slot (Req 1.7, 1.9)", async () => {
    const h = await start();
    const p = port(h);
    const readers: SseReader[] = [];
    for (let i = 0; i < OPERATOR_STREAM_LIMITS.maxStreams; i++) readers.push(await openSse(p));
    expect(readers.map((r) => r.status)).toEqual([200, 200, 200, 200]);

    const fifth = await rawRequest(p, { path: OPERATOR_STREAM_PATH });
    expect(fifth.status).toBe(503);
    expect(JSON.parse(fifth.body)).toEqual({ ok: false, error: { code: "too_many_streams" } });

    readers[0]?.close();
    const again = await openWhenFree(p);
    expect(again.status).toBe(200);

    // The other streams keep receiving.
    await h.online();
    const kept = readers[1];
    if (kept === undefined) throw new Error("missing reader");
    await pollUntil(() => caughtUp(h, kept));
  });

  it("stop() ends every open stream after its last entry (Req 1.9)", async () => {
    const h = await start();
    const a = await openSse(port(h));
    const b = await openSse(port(h));
    await h.online();

    await h.stop();
    await a.waitForEnd();
    await b.waitForEnd();
    for (const r of [a, b]) {
      expect(entryEvents(r).map((e) => e.data)).toEqual(h.sink.lines);
    }
    expect(h.entries.some((e) => e.kind === "gateway" && e.state === "stopping")).toBe(true);
  });

  it("closes a stream with more than 1 MiB unsent and keeps serving the others (Req 1.8)", async () => {
    const hold: { opts?: Parameters<OperatorListen>[0] } = {};
    const h = await start({
      listenOperator: (o) => {
        hold.opts = o;
        return listenOperatorHttp(o);
      },
    });
    const p = port(h);

    // A fake sink on the gateway's own openStream: it reports whatever is pending.
    const slow = { chunks: [] as string[], pendingBytes: 0, ends: 0 };
    const sink: StreamSink = {
      write: (chunk) => {
        slow.chunks.push(chunk);
      },
      pending: () => slow.pendingBytes,
      end: () => {
        slow.ends += 1;
      },
    };
    const request: HttpRequestIn = {
      method: "GET",
      path: OPERATOR_STREAM_PATH,
      query: {},
      queryKeys: [],
      host: `127.0.0.1:${p}`,
      origin: undefined,
      contentType: undefined,
      body: "",
    };
    expect(hold.opts?.openStream(request, sink)).toBeNull();
    const other = await openSse(p);
    await h.online();

    slow.pendingBytes = OPERATOR_STREAM_LIMITS.maxPendingBytes + 1;
    await h.device.event("touch");
    await pollUntil(() => slow.ends === 1);
    const written = slow.chunks.length;

    await h.device.event("cry");
    await pollUntil(
      () => h.entries.filter((e) => e.kind === "event_accepted").length === 2 && caughtUp(h, other),
    );
    expect(slow.chunks.length).toBe(written);
    expect(slow.ends).toBe(1);

    // Its slot is free: with `other`, three more streams open.
    const more: SseReader[] = [];
    for (let i = 0; i < OPERATOR_STREAM_LIMITS.maxStreams - 1; i++) more.push(await openSse(p));
    expect(more.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  /** Property 3: No secret on the stream. **Validates: Requirements 2.4** */
  it("carries no token, password, hello auth or URL value anywhere in the stream text", async () => {
    const h = await start();
    const r = await openSse(port(h));

    await h.online();
    await h.device.status();
    await h.device.event("touch", { data: { zone: "belly", gesture: "tap" } });
    const say = await rawRequest(port(h), { method: "POST", path: "/v1/commands", body: SAY_BODY });
    expect(say.status).toBe(200);
    await pollUntil(() => h.entries.some((e) => e.kind === "ack_result" && e.outcome === "done"));

    await h.device.hello({ auth: HELLO_AUTH_SENTINEL });
    const audio = await h.device.openAudio(h.gateway.audioPort(), {
      authorization: `Bearer ${HELLO_AUTH_SENTINEL}`,
    });
    expect(audio.kind).toBe("refused");
    await pollUntil(() =>
      h.entries.some((e) => e.kind === "auth" && e.transport === "ws" && e.outcome === "failed"),
    );

    await h.stop();
    await r.waitForEnd();
    expect(entryEvents(r).map((e) => e.data)).toEqual(h.sink.lines);
    expect(h.entries.some((e) => e.kind === "auth" && e.outcome === "failed")).toBe(true);

    const text = r.text();
    expect(text).toContain(HARNESS_DEVICE_ID);
    for (const secret of [
      TOKEN_SENTINEL,
      PASSWORD_SENTINEL,
      HELLO_AUTH_SENTINEL,
      h.config.broker.url,
      h.config.audio.url,
    ]) {
      expect(secret.length).toBeGreaterThanOrEqual(8);
      expect(text).not.toContain(secret);
    }
  });
});

describe("the operator conversation channel", () => {
  it("sends a turn event to every open stream as the view changes (Req 18.2)", async () => {
    const h = await start({ providers: sentinelProviders(), operatorTranscripts: true });
    const a = await openSse(port(h));
    const b = await openSse(port(h));
    await h.online();

    await runTurn(h);
    for (const r of [a, b]) {
      await r.waitFor((events) =>
        events.some((e) => e.name === "turn" && e.data.includes('"state":"done"')),
      );
      expect(turnEvents(r).map((v) => [v.turn_id, v.state])).toEqual([
        [TURN_ID, "listening"],
        [TURN_ID, "thinking"],
        [TURN_ID, "speaking"],
        [TURN_ID, "done"],
      ]);
    }
    // The view is the only carrier: no Log_Entry and no stdout line holds either text (Req 18.6).
    expect(
      entryEvents(a)
        .map((e) => e.data)
        .join(""),
    ).not.toContain(UTTERANCE_SENTINEL);
    expect(h.sink.lines.join("")).not.toContain(UTTERANCE_SENTINEL);
  });

  it("replays devices, then the entry backlog, then one turn per retained view", async () => {
    const h = await start({ providers: sentinelProviders(), operatorTranscripts: true });
    await h.online();
    await runTurn(h);

    const r = await openSse(port(h));
    await r.waitFor((events) => events.some((e) => e.name === "turn"));
    const events = r.events();
    const firstTurn = events.findIndex((e) => e.name === "turn");

    expect(events[0]?.name).toBe("devices");
    expect(firstTurn).toBeGreaterThan(1);
    // Everything before the first turn event is the devices event and the entry backlog.
    expect([...new Set(events.slice(0, firstTurn).map((e) => e.name))].sort()).toEqual([
      "devices",
      "entry",
    ]);
    // One retained view per turn, the newest state of it.
    expect(turnEvents(r).map((v) => [v.turn_id, v.state])).toEqual([[TURN_ID, "done"]]);
  });

  it("serves the three new routes behind the guard (Req 18.5, 18.7)", async () => {
    const h = await start({ providers: sentinelProviders(), operatorTranscripts: true });
    const p = port(h);
    await h.online();
    await runTurn(h);

    const conversation = await getJson(p, "/v1/conversation");
    expect(conversation["ok"]).toBe(true);
    expect(conversation["turns"]).toEqual([
      expect.objectContaining({
        turn_id: TURN_ID,
        device_id: HARNESS_DEVICE_ID,
        state: "done",
        input_decision: "allow",
        output_decision: "allow",
        transcript_text: UTTERANCE_SENTINEL,
        reply_text: STUB_REPLY_TEXT,
        frames_out: TURN_REPLY_FRAMES,
      }),
    ]);

    // The brain snapshot reports counts, alerts, deferred questions and the gate's own rows.
    const brain = await getJson(p, "/v1/brain");
    expect(brain).toEqual({
      ok: true,
      transcripts: { total: 2, byDevice: { [HARNESS_DEVICE_ID]: 2 } },
      alerts: [],
      deferred: [],
      providers: [
        { capability: "stt", provider: "mock", retains: false, trains: false },
        { capability: "llm", provider: "mock", retains: false, trains: false },
        { capability: "tts", provider: "mock", retains: false, trains: false },
      ],
    });
    expect(JSON.stringify(brain)).not.toContain(UTTERANCE_SENTINEL);

    // delete-all really deletes, and says how many went.
    const first = await rawRequest(p, {
      method: "POST",
      path: "/v1/transcripts/delete-all",
      body: "{}",
    });
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ ok: true, removed: 2 });
    expect(h.gateway.brain.transcripts.counts()).toEqual({ total: 0, byDevice: {} });

    const again = await rawRequest(p, {
      method: "POST",
      path: "/v1/transcripts/delete-all",
      body: "{}",
    });
    expect(JSON.parse(again.body)).toEqual({ ok: true, removed: 0 });
    // A query key is refused without its value being echoed.
    const value = "SENTINEL-conversation-query-value";
    const refused = await rawRequest(p, { path: `/v1/conversation?after=${value}` });
    expect(refused.status).toBe(400);
    expect(refused.body).not.toContain(value);
  });

  it("refuses a foreign Host, any Origin, a wrong method and a non-JSON POST, deleting nothing", async () => {
    const h = await start({ providers: sentinelProviders(), operatorTranscripts: true });
    const p = port(h);
    await h.online();
    await runTurn(h);
    const held = h.gateway.brain.transcripts.counts().total;
    expect(held).toBe(2);

    const cases = [
      {
        name: "conversation host",
        req: { path: "/v1/conversation", headers: { Host: `gateway:${p}` } },
        status: 403,
        code: "forbidden_host",
      },
      {
        name: "conversation origin",
        req: { path: "/v1/conversation", headers: { Origin: "http" + "://" + "evil.invalid" } },
        status: 403,
        code: "forbidden_origin",
      },
      {
        name: "conversation method",
        req: { method: "POST", path: "/v1/conversation", body: "{}" },
        status: 405,
        code: "method_not_allowed",
      },
      {
        name: "brain host",
        req: { path: "/v1/brain", headers: { Host: `gateway:${p}` } },
        status: 403,
        code: "forbidden_host",
      },
      {
        name: "brain origin",
        req: { path: "/v1/brain", headers: { Origin: "http" + "://" + "evil.invalid" } },
        status: 403,
        code: "forbidden_origin",
      },
      {
        name: "brain method",
        req: { method: "POST", path: "/v1/brain", body: "{}" },
        status: 405,
        code: "method_not_allowed",
      },
      {
        name: "delete-all host",
        req: {
          method: "POST",
          path: "/v1/transcripts/delete-all",
          body: "{}",
          headers: { Host: `gateway:${p}` },
        },
        status: 403,
        code: "forbidden_host",
      },
      {
        name: "delete-all origin",
        req: {
          method: "POST",
          path: "/v1/transcripts/delete-all",
          body: "{}",
          headers: { Origin: "http" + "://" + "evil.invalid" },
        },
        status: 403,
        code: "forbidden_origin",
      },
      {
        name: "delete-all method",
        req: { path: "/v1/transcripts/delete-all" },
        status: 405,
        code: "method_not_allowed",
      },
      {
        name: "delete-all content type",
        req: {
          method: "POST",
          path: "/v1/transcripts/delete-all",
          body: "{}",
          headers: { "Content-Type": "text/plain" },
        },
        status: 415,
        code: "unsupported_media_type",
      },
    ] as const;

    const answers = [];
    for (const c of cases) answers.push(await rawRequest(p, c.req));

    expect(answers.map((a) => a.status)).toEqual(cases.map((c) => c.status));
    expect(
      answers.map((a) => (JSON.parse(a.body) as { error: { code: string } }).error.code),
    ).toEqual(cases.map((c) => c.code));
    // Not one refused delete-all removed a Transcript.
    expect(h.gateway.brain.transcripts.counts().total).toBe(held);
    expect(
      h.entries.some((e) => e.kind === "transcript_retention" && e.action === "deleted_all"),
    ).toBe(false);
  });

  it("carries no transcript or reply text anywhere without the Transcripts_Argument (Req 18.5)", async () => {
    const h = await start({ providers: sentinelProviders() });
    const p = port(h);
    const r = await openSse(p);
    await h.online();
    await runTurn(h);
    await r.waitFor((events) =>
      events.some((e) => e.name === "turn" && e.data.includes('"state":"done"')),
    );

    const done = turnEvents(r).at(-1);
    expect(done).toMatchObject({
      turn_id: TURN_ID,
      state: "done",
      transcript_text: null,
      reply_text: null,
      transcript_len: [...UTTERANCE_SENTINEL].length,
      reply_len: [...STUB_REPLY_TEXT].length,
    });

    const conversation = await getJson(p, "/v1/conversation");
    for (const text of [r.text(), JSON.stringify(conversation), h.sink.lines.join("")]) {
      expect(text).not.toContain(UTTERANCE_SENTINEL);
      expect(text).not.toContain(STUB_REPLY_TEXT);
    }
    // The lengths are still the real code-point counts, so a turn is still followable.
    expect(JSON.stringify(conversation)).toContain(
      `"transcript_len":${String(UTTERANCE_SENTINEL.length)}`,
    );
  });
});
