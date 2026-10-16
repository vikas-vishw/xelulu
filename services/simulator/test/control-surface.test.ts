// Simulator Control_Surface (Req 20.1, 20.2, 20.4, 20.6, 20.7) over real loopback HTTP, with the
// memory broker and the fake gateway, on real timers. The built simulator CLI (`dist/cli.js`) is
// spawned for every operation and its exit codes are checked; the Control_Surface under test runs
// in this process, so the CLI runner is asynchronous.
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { EVENT_KINDS, buildTopic, parseHelloMessage, parseStatusMessage } from "@xelulu/shared";

import { TEST_UTTERANCE_NAMES } from "../src/audio/test-utterances.js";
import { rawRequest, runCli, type RawResponse } from "./support/control-http.js";
import { pinnedEnv, type EnvEntry } from "./support/env-cases.js";
import {
  SIM_DEVICE_ID,
  SIM_TOKEN,
  startSimHarness,
  until,
  type SimHarness,
  type SimHarnessOptions,
} from "./support/sim-harness.js";

const SECTION = "\u00a7";

let harnesses: SimHarness[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const s of harnesses) await s.stop();
  harnesses = [];
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function harness(opts: SimHarnessOptions = {}): Promise<SimHarness> {
  const h = await startSimHarness(opts);
  harnesses.push(h);
  return h;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function port(h: SimHarness): number {
  return h.sim.controlPort() ?? 0;
}

function json(res: RawResponse): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

function post(h: SimHarness, operation: string, body: unknown): Promise<RawResponse> {
  return rawRequest(port(h), {
    method: "POST",
    path: "/api/" + operation,
    body: JSON.stringify(body),
  });
}

/** Everything that would show a state change: the state view and the device state. */
function stateSnapshot(h: SimHarness): string {
  return JSON.stringify({ state: h.sim.state(), device: h.sim.deviceState() });
}

/** The simulator's publications other than heartbeat statuses (which run on their own timer). */
function nonStatusPublications(h: SimHarness): string[] {
  return h
    .published()
    .filter((p) => !parseStatusMessage(p.payload).ok)
    .map((p) => p.topic + " " + p.payload);
}

describe("listening", () => {
  it.each([
    ["in Local_Mode", true],
    ["outside Local_Mode", false],
  ])("listens on 127.0.0.1 at SIMULATOR_PANEL_PORT only, %s", async (_name, localMode) => {
    const panelPort = await freePort();
    // Outside Local_Mode the audio URL must be wss; no turn is started here.
    const audioUrlOverride = localMode ? undefined : "wss" + "://" + "127.0.0.1:1";
    const h = await harness({ localMode, panelPort, usePanelPort: true, audioUrlOverride });
    expect(h.controlListens).toEqual([{ host: "127.0.0.1", port: panelPort }]);
    expect(h.sim.controlPort()).toBe(panelPort);
    const res = await rawRequest(panelPort);
    expect(res.status).toBe(200);
    expect(json(res)).toMatchObject({ ok: true, device_id: SIM_DEVICE_ID });
  });
});

describe("operations", () => {
  it("serves the panel and its two files with the CSP", async () => {
    const h = await harness();
    for (const [path, type] of [
      ["/", "text/html"],
      ["/panel.css", "text/css"],
      ["/panel.js", "text/javascript"],
    ] as const) {
      const res = await rawRequest(port(h), { path });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain(type);
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(res.body).not.toContain(SIM_TOKEN);
    }
  });

  it("fires every Event_Kind, one control per touch zone, and reports the published ids", async () => {
    const h = await harness();
    const state = json(await rawRequest(port(h)));
    const choices = state["choices"] as { touch_zones: string[]; event_kinds: string[] };
    expect(choices.event_kinds).toEqual([...EVENT_KINDS]);
    const ids: string[] = [];
    for (const zone of choices.touch_zones) {
      const body = json(await post(h, "events", { event: "touch", data: { zone } }));
      expect(body).toMatchObject({ ok: true, queued: false });
      ids.push(body["event_id"] as string);
    }
    for (const kind of EVENT_KINDS) {
      const body = json(await post(h, "events", { event: kind }));
      expect(body).toMatchObject({ ok: true, queued: false });
      ids.push(body["event_id"] as string);
    }
    await until(() => h.gateway.events().length === ids.length);
    expect(h.gateway.events().map((e) => e.event_id)).toEqual(ids);
  });

  it("starts an audio turn, toggles the connection and reports the last turn", async () => {
    const h = await harness();
    const turn = json(await post(h, "audio-turn", {}));
    expect(turn).toMatchObject({ ok: true });
    await until(() => {
      const last = h.sim.state().last_turn;
      return last !== null && last.outcome !== "in_progress";
    }, 10_000);
    expect(json(await rawRequest(port(h)))["last_turn"]).toMatchObject({
      turn_id: turn["turn_id"],
      outcome: "complete",
      frames_received: 50,
    });

    expect(json(await post(h, "connection", { online: false }))).toEqual({
      ok: true,
      online: false,
    });
    expect(json(await post(h, "connection", { online: false }))).toEqual({
      ok: true,
      online: false,
    });
    const queued = json(await post(h, "events", { event: "wake" }));
    expect(queued).toMatchObject({ ok: true, queued: true });
    expect(json(await rawRequest(port(h)))).toMatchObject({ online: false, queue_length: 1 });
    const hellos = h.gateway.hellos().length;
    expect(json(await post(h, "connection", { online: true }))).toEqual({ ok: true, online: true });
    await until(() => h.gateway.hellos().length === hellos + 1);
    await until(() => h.sim.state().queue_length === 0);
  });

  it("lists the Test_Utterances, starts a turn from one and refuses an unknown name", async () => {
    const h = await harness();
    const choices = json(await rawRequest(port(h)))["choices"] as { utterances: string[] };
    expect(choices.utterances).toEqual([...TEST_UTTERANCE_NAMES]);
    expect(choices.utterances).toHaveLength(8);

    const turn = json(await post(h, "audio-turn", { utterance: "story" }));
    expect(turn).toMatchObject({ ok: true });
    await until(() => {
      const last = h.sim.state().last_turn;
      return last !== null && last.outcome !== "in_progress";
    }, 10_000);
    expect(json(await rawRequest(port(h)))["last_turn"]).toMatchObject({
      turn_id: turn["turn_id"],
      outcome: "complete",
      frames_received: 50,
    });

    const refused = await post(h, "audio-turn", { utterance: "no-such-utterance" });
    expect(refused.status).toBe(400);
    expect(json(refused)).toEqual({
      ok: false,
      error: { code: "invalid_fields", issues: [{ path: ["utterance"], kind: "invalid_value" }] },
    });
    expect(refused.body).not.toContain("no-such-utterance");
  });

  it("sets duplicate replay, Ack_Policy overrides and the battery, and lists received commands", async () => {
    const h = await harness();
    expect(json(await post(h, "duplicate-replay", { enabled: true }))).toEqual({
      ok: true,
      enabled: true,
    });
    const set = json(
      await post(h, "ack-policy", {
        scope: "animate",
        override: { mode: "reject", reason: "picked_up" },
      }),
    );
    expect(set).toEqual({
      ok: true,
      policy: { all: null, byAction: { animate: { mode: "reject", reason: "picked_up" } } },
    });
    expect(
      json(await post(h, "ack-policy", { scope: "all", override: { mode: "silent" } })),
    ).toEqual({
      ok: true,
      policy: {
        all: { mode: "silent" },
        byAction: { animate: { mode: "reject", reason: "picked_up" } },
      },
    });
    expect(json(await post(h, "battery", { battery_pct: 42, charging: true }))).toEqual({
      ok: true,
    });

    const animate = await h.gateway.sendCommand("animate", {
      expression: "happy",
      eyes: "open",
      loop: false,
    });
    await until(() => h.gateway.acks(animate).length === 1);
    expect(json(await post(h, "ack-policy/clear", { scope: "animate" }))).toEqual({
      ok: true,
      policy: { all: { mode: "silent" }, byAction: {} },
    });
    expect(json(await post(h, "ack-policy/clear", { scope: "all" }))).toEqual({
      ok: true,
      policy: { all: null, byAction: {} },
    });

    const state = json(await rawRequest(port(h)));
    expect(state).toMatchObject({
      ok: true,
      device_id: SIM_DEVICE_ID,
      online: true,
      queue_length: 0,
      duplicate_replay: true,
      ack_policy: { all: null, byAction: {} },
      battery_pct: 42,
      charging: true,
    });
    expect(state["received_commands"]).toEqual([
      { cmd_id: animate, action: "animate", acks: [{ status: "rejected", reason: "picked_up" }] },
    ]);
    expect(JSON.stringify(state)).not.toContain(SIM_TOKEN);
  });
});

describe("refused requests", () => {
  const bad: [string, () => { path: string; body: string }, number, string][] = [
    [
      "a body over 16 KiB",
      () => ({
        path: "/api/events",
        body: JSON.stringify({ event: "nfc", data: { card_id: SECTION.repeat(17_000) } }),
      }),
      413,
      "body_too_large",
    ],
    [
      "a body that is not JSON",
      () => ({ path: "/api/events", body: "{" + SECTION }),
      400,
      "invalid_json",
    ],
    [
      "an unknown operation",
      () => ({ path: "/api/" + "dance", body: "{}" }),
      404,
      "unknown_operation",
    ],
    [
      "event data the contract rejects",
      () => ({
        path: "/api/events",
        body: JSON.stringify({ event: "touch", data: { zone: SECTION + "zone" } }),
      }),
      422,
      "invalid_event",
    ],
    [
      "an audio turn naming an unknown utterance",
      () => ({
        path: "/api/audio-turn",
        body: JSON.stringify({ utterance: SECTION + "no-such-utterance" }),
      }),
      400,
      "invalid_fields",
    ],
    [
      "a battery_pct outside the contract range",
      () => ({ path: "/api/battery", body: JSON.stringify({ battery_pct: 101, charging: false }) }),
      422,
      "battery_out_of_range",
    ],
    [
      "a reject override without a reason",
      () => ({
        path: "/api/ack-policy",
        body: JSON.stringify({ scope: "all", override: { mode: "reject" } }),
      }),
      422,
      "reason_required",
    ],
    [
      "a reject override with a reason outside the Ack_Reason list",
      () => ({
        path: "/api/ack-policy",
        body: JSON.stringify({ scope: "all", override: { mode: "reject", reason: SECTION + "r" } }),
      }),
      422,
      "invalid_reason",
    ],
    [
      "a fail override with a reason that is neither empty nor an Ack_Reason",
      () => ({
        path: "/api/ack-policy",
        body: JSON.stringify({ scope: "say", override: { mode: "fail", reason: SECTION + "r" } }),
      }),
      422,
      "invalid_reason",
    ],
  ];

  it.each(bad)(
    "%s is refused without echo, changes no state, publishes nothing and the surface keeps serving",
    async (_name, make, status, code) => {
      const h = await harness();
      const before = stateSnapshot(h);
      const published = nonStatusPublications(h);
      const { path, body } = make();
      const res = await rawRequest(port(h), { method: "POST", path, body });
      expect(res.status).toBe(status);
      expect((json(res)["error"] as { code: string }).code).toBe(code);
      expect(res.body).not.toContain(SECTION);
      expect(stateSnapshot(h)).toBe(before);
      expect(nonStatusPublications(h)).toEqual(published);
      expect(h.entries().at(-1)).toMatchObject({ kind: "control_rejected", code });

      // Later requests are still served.
      expect((await rawRequest(port(h))).status).toBe(200);
      expect(json(await post(h, "events", { event: "interrupt" }))).toMatchObject({ ok: true });
    },
  );

  it("refuses a foreign Host or Origin, a GET state change and a missing JSON content type", async () => {
    const h = await harness();
    const p = port(h);
    const ownOrigin = "http" + "://" + "127.0.0.1:" + String(p);
    const foreignOrigin = "http" + "://" + "127.0.0.1:" + String(p + 1);
    const event = JSON.stringify({ event: "touch" });
    const before = stateSnapshot(h);
    const published = nonStatusPublications(h);
    const cases: [Parameters<typeof rawRequest>[1], number, string][] = [
      [
        { path: "/api/state", headers: { Host: "example.invalid:" + String(p) } },
        403,
        "forbidden_host",
      ],
      [
        { path: "/api/state", headers: { Host: "127.0.0.1:" + String(p + 1) } },
        403,
        "forbidden_host",
      ],
      [
        { method: "POST", path: "/api/events", body: event, headers: { Origin: foreignOrigin } },
        403,
        "forbidden_origin",
      ],
      [{ method: "GET", path: "/api/events" }, 405, "method_not_allowed"],
      [{ method: "GET", path: "/api/connection" }, 405, "method_not_allowed"],
      [
        {
          method: "POST",
          path: "/api/events",
          body: event,
          headers: { "Content-Type": "text/plain" },
        },
        415,
        "unsupported_media_type",
      ],
      [
        {
          method: "POST",
          path: "/api/events",
          body: event,
          headers: { "Content-Type": undefined },
        },
        415,
        "unsupported_media_type",
      ],
    ];
    for (const [req, status, code] of cases) {
      const res = await rawRequest(p, req);
      expect(res.status, code).toBe(status);
      expect((json(res)["error"] as { code: string }).code).toBe(code);
    }
    expect(stateSnapshot(h)).toBe(before);
    expect(nonStatusPublications(h)).toEqual(published);

    // The panel's own origin is allowed.
    const own = await rawRequest(p, {
      method: "POST",
      path: "/api/events",
      body: event,
      headers: { Origin: ownOrigin },
    });
    expect(json(own)).toMatchObject({ ok: true });
  });
});

describe("the simulator CLI", () => {
  function cliEnv(panelPort: number): Record<string, string | undefined> {
    const entries: EnvEntry[] = [
      ["APP_ENV", "local"],
      ["MQTT_BROKER_URL", "mqtt" + "://" + "127.0.0.1:1"],
      ["AUDIO_WSS_URL", "ws" + "://" + "127.0.0.1:1"],
      ["DEVICE_ID", SIM_DEVICE_ID],
      ["DEVICE_TOKEN", SIM_TOKEN],
      ["SIMULATOR_PANEL_PORT", String(panelPort)],
    ];
    return pinnedEnv(entries);
  }

  it("calls the Control_Surface for every operation with the documented exit codes", async () => {
    const h = await harness();
    const env = cliEnv(port(h));
    const cases: [readonly string[], number, string | null][] = [
      [["state"], 0, null],
      [["event", "touch"], 0, null],
      [["event", "touch", JSON.stringify({ zone: "head", gesture: "hold" })], 0, null],
      [["event", "dance"], 1, "invalid_event"],
      [["duplicate-replay", "on"], 0, null],
      [["duplicate-replay", "off"], 0, null],
      [["ack-policy", "set", "animate", "reject", "picked_up"], 0, null],
      [["ack-policy", "set", "animate", "reject"], 1, "reason_required"],
      [["ack-policy", "set", "all", "accept_only"], 0, null],
      [["ack-policy", "clear", "animate"], 0, null],
      [["ack-policy", "clear", "all"], 0, null],
      [["battery", "55", "false"], 0, null],
      [["battery", "150", "false"], 1, "battery_out_of_range"],
      [["audio-turn"], 0, null],
      [["offline"], 0, null],
      [["audio-turn"], 1, "offline"],
      [["online"], 0, null],
      [[], 2, null],
      [["dance"], 2, null],
      [["battery", "x", "maybe"], 2, null],
      [["duplicate-replay", "sometimes"], 2, null],
    ];
    for (const [args, code, errorCode] of cases) {
      const result = await runCli(args, env);
      const label = args.join(" ");
      expect(result.code, label).toBe(code);
      expect(result.stdout + result.stderr, label).not.toContain(SIM_TOKEN);
      if (code === 0) {
        expect(result.stderr, label).toBe("");
        expect(JSON.parse(result.stdout), label).toMatchObject({ ok: true });
      } else if (code === 1) {
        expect(result.stdout, label).toBe("");
        expect(JSON.parse(result.stderr), label).toMatchObject({
          ok: false,
          error: { code: errorCode },
        });
      } else {
        expect(result.stdout, label).toBe("");
        expect(result.stderr, label).toMatch(/^usage: /);
      }
    }
    expect(h.sim.state()).toMatchObject({ battery_pct: 55, charging: false, online: true });
    expect(h.sim.state().ack_policy).toEqual({ all: null, byAction: {} });
  }, 60_000);

  it("exits 3 when the surface is not reachable or does not answer within 5 s", async () => {
    const closed = await runCli(["state"], cliEnv(await freePort()));
    expect(closed).toMatchObject({
      code: 3,
      stdout: "",
      stderr: "control surface not reachable\n",
    });
    expect(closed.durationMs).toBeLessThan(5_000);

    const silent = createServer((socket) => sockets.push(socket));
    servers.push(silent);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const silentPort = (silent.address() as AddressInfo).port;
    const hung = await runCli(["state"], cliEnv(silentPort));
    expect(hung).toMatchObject({ code: 3, stdout: "", stderr: "control surface not reachable\n" });
    expect(hung.durationMs).toBeGreaterThanOrEqual(4_900);
    expect(hung.durationMs).toBeLessThan(8_000);
  }, 30_000);

  it("exits 5 with the key names only on a config error", async () => {
    const env = pinnedEnv([["DEVICE_TOKEN", SIM_TOKEN]]);
    const result = await runCli(["state"], env);
    expect(result.code).toBe(5);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "simulator config error: MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD, AUDIO_WSS_URL, DEVICE_ID, SIMULATOR_PANEL_PORT\n",
    );
  });

  it("a CLI event reaches the broker on the device's event topic", async () => {
    const h = await harness();
    const result = await runCli(["event", "wake"], cliEnv(port(h)));
    expect(result.code).toBe(0);
    const id = (JSON.parse(result.stdout) as { event_id: string }).event_id;
    await until(() => h.gateway.events().some((e) => e.event_id === id));
    const published = h.published().filter((p) => p.topic === buildTopic(SIM_DEVICE_ID, "event"));
    expect(published.at(-1)).toMatchObject({ qos: 1, retain: false });
    expect(h.published().some((p) => parseHelloMessage(p.payload).ok)).toBe(true);
  });
});
