// Unit examples for the simulator's audio turn client core (Req 18.1–18.3, 18.5, 18.6, 18.8, 18.9)
// against a scripted in-memory socket, and for the Control_Surface cores: the request guard
// (Req 20.7), the route handler (Req 17.7, 20.2, 20.5, 20.6) and the panel assets (Req 20.3).
// The loopback end-to-end tests come with the transports (tasks 30.3 and 30.4).
import { describe, expect, it } from "vitest";

import {
  ACK_REASONS,
  BUTTONS,
  BUTTON_ACTIONS,
  CMD_ACTIONS,
  EVENT_KINDS,
  MOTION_KINDS,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  parseAudioStartMessage,
  parseAudioEndMessage,
  serialiseAudioEndMessage,
} from "@xelulu/shared";

import type { ClientAudioInbound, ClientAudioSocket } from "../src/audio/audio-transport.js";
import {
  createAudioTurnClient,
  TURN_REPLY_TIMEOUT_MS,
  type TurnFailureCause,
} from "../src/audio/audio-turn-client.js";
import { SYNTHETIC_FRAME_BYTES } from "../src/audio/synthetic-frame.js";
import { TEST_UTTERANCE_NAMES } from "../src/audio/test-utterances.js";
import {
  createControlRoutes,
  type ControlRequestIn,
  type FireEventResult,
} from "../src/control/control-routes.js";
import { loadPanelAssets, PANEL_CSP, type PanelAssetName } from "../src/control/panel-assets.js";
import { controlOrigins, createControlGuard } from "../src/control/request-guard.js";
import { createDeadlines } from "../src/deadlines.js";
import { EMPTY_ACK_POLICY, type AckPolicy } from "../src/device/ack-policy.js";
import { createDeviceState } from "../src/device/device-state.js";
import { randomIds } from "../src/ids.js";
import { createSimLog, type SimLogEntry } from "../src/log/logger.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";

const START_MS = 1_760_000_000_000;
const DEVICE_ID = "sim-device-1";
const TOKEN = "§sim-token-not-for-output";
const AUDIO_URL = "ws" + "://" + "127.0.0.1:8081";

async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

function scriptedSocket() {
  const texts: string[] = [];
  const frames: number[] = [];
  let closes = 0;
  let handler: ((m: ClientAudioInbound) => void) | null = null;
  const socket: ClientAudioSocket = {
    sendText: (t) => texts.push(t),
    sendBinary: (f) => frames.push(f.byteLength),
    close: () => {
      closes += 1;
    },
    onInbound: (fn) => {
      handler = fn;
    },
  };
  return {
    socket,
    texts,
    frames,
    closes: () => closes,
    push: (m: ClientAudioInbound) => handler?.(m),
  };
}

function turnSetup(open: () => Promise<ClientAudioSocket>, online = true) {
  const clock = createTestClock(START_MS);
  const deadlines = createDeadlines(clock);
  const sink = createCaptureSink();
  const ended: string[] = [];
  let opens = 0;
  const client = createAudioTurnClient({
    url: AUDIO_URL,
    token: TOKEN,
    clock,
    deadlines,
    ids: randomIds,
    log: createSimLog(clock, sink),
    open: (url, token) => {
      opens += 1;
      expect([url, token]).toEqual([AUDIO_URL, TOKEN]);
      return open();
    },
    isOnline: () => online,
    onEnded: (o) => ended.push(o),
  });
  const advance = (ms: number) => {
    clock.advance(ms);
    deadlines.fireDue(clock.now());
  };
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  return { clock, client, advance, ended, opens: () => opens, sink, entries };
}

/** Advances 20 ms at a time until all 50 frames and the own audio_end are out. */
function uploadAll(t: ReturnType<typeof turnSetup>): void {
  for (let i = 0; i < 49; i++) t.advance(20);
}

describe("audio turn client", () => {
  it("sends audio_start, 50 frames 20 ms apart and audio_end, then completes on the reply", async () => {
    const s = scriptedSocket();
    const t = turnSetup(() => Promise.resolve(s.socket));
    const req = t.client.request();
    if (!req.ok) throw new Error("refused");
    expect(req.turn_id.startsWith("t_")).toBe(true);
    expect(t.client.inProgress()).toBe(true);
    await flush();
    const start = parseAudioStartMessage(s.texts[0] ?? "");
    expect(start.ok && start.value).toEqual({
      proto_ver: 2,
      ts: Math.floor(START_MS / 1000),
      type: "audio_start",
      turn_id: req.turn_id,
    });
    expect(s.frames).toHaveLength(1);
    t.advance(19);
    expect(s.frames).toHaveLength(1);
    t.advance(1);
    expect(s.frames).toHaveLength(2);
    for (let i = 0; i < 48; i++) t.advance(20);
    expect(s.frames).toEqual(Array.from({ length: 50 }, () => SYNTHETIC_FRAME_BYTES));
    expect(s.texts).toHaveLength(2);
    const ownEnd = parseAudioEndMessage(s.texts[1] ?? "");
    expect(ownEnd.ok && ownEnd.value.turn_id).toBe(req.turn_id);

    t.advance(150);
    s.push({ kind: "binary" });
    t.advance(20);
    s.push({ kind: "binary" });
    s.push({
      kind: "text",
      text: serialiseAudioEndMessage({
        proto_ver: 2,
        ts: Math.floor(t.clock.now() / 1000),
        type: "audio_end",
        turn_id: req.turn_id,
      }),
    });
    expect(t.client.inProgress()).toBe(false);
    expect(t.client.lastTurn()).toEqual({
      turn_id: req.turn_id,
      outcome: "complete",
      cause: null,
      frames_received: 2,
      latency_ms: 150,
    });
    expect(t.ended).toEqual(["reply_ended"]);
    expect(s.closes()).toBe(1);
    expect(t.entries().filter((e) => e.kind === "audio_turn")).toEqual([
      expect.objectContaining({ phase: "started", frames_out: 0 }),
      expect.objectContaining({ phase: "complete", frames_out: 50, frames_in: 2, latency_ms: 150 }),
    ]);
    expect(t.sink.text()).not.toContain(TOKEN);
  });

  it("refuses offline and while a turn is in progress, opening nothing more", async () => {
    const off = turnSetup(() => Promise.reject(new Error()), false);
    expect(off.client.request()).toEqual({ ok: false, code: "offline" });
    expect(off.opens()).toBe(0);
    expect(off.client.lastTurn()).toBeNull();

    const s = scriptedSocket();
    const t = turnSetup(() => Promise.resolve(s.socket));
    const first = t.client.request();
    expect(first.ok).toBe(true);
    expect(t.client.request()).toEqual({ ok: false, code: "turn_in_progress" });
    expect(t.opens()).toBe(1);
    await flush();
    expect(t.client.lastTurn()).toMatchObject({ outcome: "in_progress", cause: null });
  });

  it("stop_audio stops reply counting; an interrupt during the reply ends it interrupted", async () => {
    const s = scriptedSocket();
    const t = turnSetup(() => Promise.resolve(s.socket));
    const req = t.client.request();
    if (!req.ok) throw new Error("refused");
    await flush();
    uploadAll(t);
    s.push({ kind: "binary" });
    t.client.noteInterrupt();
    t.client.stopReply();
    s.push({ kind: "binary" });
    s.push({
      kind: "text",
      text: serialiseAudioEndMessage({
        proto_ver: 2,
        ts: 1,
        type: "audio_end",
        turn_id: req.turn_id,
      }),
    });
    expect(t.client.lastTurn()).toMatchObject({ outcome: "interrupted", frames_received: 1 });
    expect(t.ended).toEqual(["reply_ended"]);
  });

  type FailCase = {
    readonly cause: TurnFailureCause;
    readonly open?: () => Promise<ClientAudioSocket>;
    readonly act?: (
      t: ReturnType<typeof turnSetup>,
      s: ReturnType<typeof scriptedSocket>,
      turnId: string,
    ) => void;
  };

  const failCases: readonly FailCase[] = [
    { cause: "upgrade_refused", open: () => Promise.reject("upgrade_refused") },
    { cause: "connect_failed", open: () => Promise.reject("connect_failed") },
    { cause: "socket_closed", act: (_t, s) => s.push({ kind: "closed" }) },
    { cause: "invalid_message", act: (_t, s) => s.push({ kind: "text", text: "{§not-json" }) },
    {
      cause: "turn_id_mismatch",
      act: (_t, s) =>
        s.push({
          kind: "text",
          text: serialiseAudioEndMessage({
            proto_ver: 2,
            ts: 1,
            type: "audio_end",
            turn_id: "t_other",
          }),
        }),
    },
    {
      cause: "reply_timeout",
      act: (t) => {
        uploadAll(t);
        t.advance(TURN_REPLY_TIMEOUT_MS - 1);
        expect(t.client.inProgress()).toBe(true);
        t.advance(1);
      },
    },
    { cause: "toggled_offline", act: (t) => t.client.abort("toggled_offline") },
  ];

  it.each(failCases)("fails with $cause, stops the frames and reports it", async (c) => {
    const s = scriptedSocket();
    const t = turnSetup(c.open ?? (() => Promise.resolve(s.socket)));
    const req = t.client.request();
    if (!req.ok) throw new Error("refused");
    await flush();
    c.act?.(t, s, req.turn_id);
    await flush();
    expect(t.client.inProgress()).toBe(false);
    expect(t.client.lastTurn()).toMatchObject({
      turn_id: req.turn_id,
      outcome: "failed",
      cause: c.cause,
    });
    expect(t.ended).toEqual(["failed"]);
    const sent = s.frames.length;
    t.advance(60_000);
    expect(s.frames).toHaveLength(sent);
    expect(t.sink.text()).not.toContain("§");
  });
});

// ---------------------------------------------------------------------------------------------
// Control_Surface cores.

const PORT = 8091;
const HOST = "127.0.0.1:" + String(PORT);

const ASSETS: Readonly<Record<PanelAssetName, string>> = {
  "index.html": "<!doctype html><title>panel</title>",
  "panel.css": "body { color: black; }",
  "panel.js": "export {};",
};

function routesSetup() {
  const clock = createTestClock(START_MS);
  const sink = createCaptureSink();
  const state = createDeviceState();
  let policy: AckPolicy = EMPTY_ACK_POLICY;
  const fired: unknown[] = [];
  /** The `utterance` of every turn the routes actually asked for, in order. */
  const turnsStarted: (string | undefined)[] = [];
  let online = true;
  const routes = createControlRoutes({
    deviceId: DEVICE_ID,
    clock,
    log: createSimLog(clock, sink),
    port: () => PORT,
    assets: loadPanelAssets((name) => ASSETS[name]),
    state,
    view: () => ({
      online,
      queue_length: 0,
      duplicate_replay: false,
      received_commands: [],
      last_turn: null,
    }),
    fireEvent: (request): FireEventResult => {
      fired.push(request);
      return request.event === "touch"
        ? { ok: true, event_id: "ev_1", ts: 1, queued: false }
        : { ok: false, issues: [{ path: ["data", "zone"], kind: "invalid_value" }] };
    },
    startAudioTurn: (utterance) => {
      turnsStarted.push(utterance);
      return online ? { ok: true, turn_id: "t_1" } : { ok: false, code: "offline" };
    },
    setOnline: (next) => {
      const changed = next !== online;
      online = next;
      return { online, changed };
    },
    setDuplicateReplay: () => undefined,
    ackPolicy: () => policy,
    setAckPolicy: (p) => {
      policy = p;
    },
  });
  const request = (over: Partial<ControlRequestIn>): ControlRequestIn => ({
    method: "POST",
    path: "/api/state",
    query: {},
    host: HOST,
    origin: undefined,
    contentType: "application/json",
    body: "{}",
    ...over,
  });
  const call = (over: Partial<ControlRequestIn>) => {
    const res = routes.handle(request(over));
    return {
      ...res,
      json: res.headers["Content-Type"]?.startsWith("application/json")
        ? (JSON.parse(res.body) as Record<string, unknown>)
        : null,
    };
  };
  const entries = () => sink.lines.map((l) => JSON.parse(l) as SimLogEntry);
  return {
    routes,
    call,
    state,
    fired,
    entries,
    sink,
    policy: () => policy,
    turnsStarted: () => turnsStarted,
  };
}

describe("Control_Surface request guard", () => {
  it("builds its own origins from parts and allows only them", () => {
    const guard = createControlGuard(PORT, { "/api/state": ["GET"] });
    expect(guard.origins).toEqual(controlOrigins(PORT));
    expect(guard.origins).toHaveLength(2);
    const head = { method: "GET", path: "/api/state", host: HOST, contentType: undefined };
    for (const origin of [undefined, ...guard.origins, guard.origins[1]?.toUpperCase()]) {
      expect(guard.check({ ...head, origin })).toBeNull();
    }
    expect(guard.check({ ...head, origin: "null" })).toEqual({
      status: 403,
      code: "forbidden_origin",
    });
    expect(guard.check({ ...head, origin: (guard.origins[0] ?? "") + "0" })).toMatchObject({
      code: "forbidden_origin",
    });
  });

  it.each([
    [{ host: "127.0.0.1:1" }, 403, "forbidden_host"],
    [{ host: undefined }, 403, "forbidden_host"],
    [{ host: "example.test:" + String(PORT) }, 403, "forbidden_host"],
    [{ path: "/api/nope" }, 404, "unknown_operation"],
    [{ method: "GET", path: "/api/events" }, 405, "method_not_allowed"],
    [{ method: "POST", path: "/api/state" }, 405, "method_not_allowed"],
    [{ path: "/api/connection", contentType: "text/plain" }, 415, "unsupported_media_type"],
    [{ path: "/api/connection", contentType: undefined }, 415, "unsupported_media_type"],
  ] as const)("refuses %o with %i %s", (over, status, code) => {
    const r = routesSetup();
    const res = r.call(over);
    expect(res.status).toBe(status);
    expect(res.json).toEqual({ ok: false, error: { code } });
    expect(r.entries()).toEqual([
      expect.objectContaining({ kind: "control_rejected", code, issues: [] }),
    ]);
  });
});

describe("Control_Surface routes", () => {
  it("serves the state with choices copied from the contract and no secret", () => {
    const r = routesSetup();
    const res = r.call({ method: "GET", path: "/api/state", contentType: undefined, body: "" });
    expect(res.status).toBe(200);
    expect(res.headers["Content-Security-Policy"]).toBe(PANEL_CSP);
    expect(res.json).toMatchObject({
      ok: true,
      device_id: DEVICE_ID,
      online: true,
      battery_pct: 100,
      charging: false,
      mode: "idle",
      ack_policy: { all: null, byAction: {} },
      choices: {
        event_kinds: [...EVENT_KINDS],
        touch_zones: [...TOUCH_ZONES],
        touch_gestures: [...TOUCH_GESTURES],
        wake_sources: [...WAKE_SOURCES],
        motion_kinds: [...MOTION_KINDS],
        buttons: [...BUTTONS],
        button_actions: [...BUTTON_ACTIONS],
        cmd_actions: [...CMD_ACTIONS],
        ack_reasons: [...ACK_REASONS],
        utterances: [...TEST_UTTERANCE_NAMES],
      },
    });
    expect(res.body).not.toContain(TOKEN);
  });

  it("serves the panel files with the CSP", () => {
    const r = routesSetup();
    for (const [path, name] of [
      ["/", "index.html"],
      ["/panel.css", "panel.css"],
      ["/panel.js", "panel.js"],
    ] as const) {
      const res = r.call({ method: "GET", path, contentType: undefined, body: "" });
      expect(res.status).toBe(200);
      expect(res.body).toBe(ASSETS[name]);
      expect(res.headers).toMatchObject({
        "Content-Security-Policy": PANEL_CSP,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }
  });

  it("fires events and refuses invalid ones with Safe_Issues and no echo", () => {
    const r = routesSetup();
    const ok = r.call({ path: "/api/events", body: JSON.stringify({ event: "touch" }) });
    expect(ok.json).toEqual({ ok: true, event_id: "ev_1", ts: 1, queued: false });
    const bad = r.call({
      path: "/api/events",
      body: JSON.stringify({ event: "wake", data: { zone: "§sentinel-value" } }),
    });
    expect(bad.status).toBe(422);
    expect(bad.json).toEqual({
      ok: false,
      error: { code: "invalid_event", issues: [{ path: ["data", "zone"], kind: "invalid_value" }] },
    });
    for (const body of ["{§x", JSON.stringify(["§y"]), JSON.stringify({ event: 1 })]) {
      const res = r.call({ path: "/api/events", body });
      expect(res.status).toBe(400);
      expect(res.body).not.toContain("§");
    }
    const longKey = "§" + "k".repeat(60);
    const extra = r.call({
      path: "/api/events",
      body: JSON.stringify({ event: "touch", [longKey]: 1 }),
    });
    expect(extra.json).toMatchObject({ error: { code: "invalid_fields" } });
    expect(extra.body).not.toContain(longKey);
    expect(r.sink.text()).not.toContain("§");
    expect(r.fired).toHaveLength(2);
  });

  it("refuses a reject override without a valid reason and leaves the policy unchanged", () => {
    const r = routesSetup();
    const cases = [
      [{ mode: "reject" }, 422, "reason_required"],
      [{ mode: "reject", reason: "" }, 422, "reason_required"],
      [{ mode: "reject", reason: "§nope" }, 422, "invalid_reason"],
      [{ mode: "fail", reason: "§nope" }, 422, "invalid_reason"],
      [{ mode: "§odd" }, 400, "invalid_fields"],
    ] as const;
    for (const [override, status, code] of cases) {
      const res = r.call({
        path: "/api/ack-policy",
        body: JSON.stringify({ scope: "move", override }),
      });
      expect([res.status, (res.json?.["error"] as { code: string }).code]).toEqual([status, code]);
      expect(res.body).not.toContain("§");
    }
    expect(r.policy()).toBe(EMPTY_ACK_POLICY);
    const set = r.call({
      path: "/api/ack-policy",
      body: JSON.stringify({ scope: "move", override: { mode: "reject", reason: "picked_up" } }),
    });
    expect(set.json).toEqual({
      ok: true,
      policy: { all: null, byAction: { move: { mode: "reject", reason: "picked_up" } } },
    });
    const cleared = r.call({
      path: "/api/ack-policy/clear",
      body: JSON.stringify({ scope: "move" }),
    });
    expect(cleared.json).toEqual({ ok: true, policy: { all: null, byAction: {} } });
  });

  it("sets the battery only within the contract's range", () => {
    const r = routesSetup();
    for (const pct of [-1, 101, 50.5]) {
      const res = r.call({
        path: "/api/battery",
        body: JSON.stringify({ battery_pct: pct, charging: true }),
      });
      expect(res.json).toEqual({ ok: false, error: { code: "battery_out_of_range" } });
    }
    expect([r.state.battery_pct, r.state.charging]).toEqual([100, false]);
    const ok = r.call({
      path: "/api/battery",
      body: JSON.stringify({ battery_pct: 20, charging: true }),
    });
    expect(ok.json).toEqual({ ok: true });
    expect([r.state.battery_pct, r.state.charging]).toEqual([20, true]);
  });

  it("toggles the connection, starts turns and refuses a turn while offline", () => {
    const r = routesSetup();
    expect(r.call({ path: "/api/audio-turn" }).json).toEqual({ ok: true, turn_id: "t_1" });
    expect(r.call({ path: "/api/connection", body: '{"online":false}' }).json).toEqual({
      ok: true,
      online: false,
    });
    const refused = r.call({ path: "/api/audio-turn" });
    expect([refused.status, refused.json]).toEqual([
      409,
      { ok: false, error: { code: "offline" } },
    ]);
    expect(r.call({ path: "/api/audio-turn", body: '{"x":1}' }).status).toBe(400);
    expect(r.routes.bodyTooLarge()).toMatchObject({ status: 413 });
  });

  it("passes a named utterance on and refuses an unknown or mistyped one without echo", () => {
    const r = routesSetup();
    const named = r.call({
      path: "/api/audio-turn",
      body: JSON.stringify({ utterance: "story" }),
    });
    expect(named.json).toEqual({ ok: true, turn_id: "t_1" });
    expect(r.turnsStarted()).toEqual(["story"]);

    const cases = [
      [{ utterance: "§no-such-utterance" }, "invalid_value"],
      [{ utterance: 7 }, "invalid_type"],
    ] as const;
    for (const [body, kind] of cases) {
      const res = r.call({ path: "/api/audio-turn", body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({
        ok: false,
        error: { code: "invalid_fields", issues: [{ path: ["utterance"], kind }] },
      });
      expect(res.body).not.toContain("§");
    }
    // Neither refusal started a turn, and nothing of the submitted value is logged.
    expect(r.turnsStarted()).toEqual(["story"]);
    expect(r.sink.text()).not.toContain("§");
  });
});

describe("panel assets", () => {
  it("reads each file once through the injected reader and hides read errors", () => {
    const reads: string[] = [];
    const assets = loadPanelAssets((name) => {
      reads.push(name);
      return ASSETS[name];
    });
    expect(reads).toEqual(["index.html", "panel.css", "panel.js"]);
    expect(assets["index.html"].contentType).toBe("text/html; charset=utf-8");
    let caught: unknown = null;
    try {
      loadPanelAssets(() => {
        throw new Error("§path-detail");
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("");
  });
});
