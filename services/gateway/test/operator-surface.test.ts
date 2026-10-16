// The Operator_Surface over real loopback HTTP (Req 13.1, 13.3–13.5, 13.7, 13.9, 13.10):
// Property 12 (no response and no operator CLI output leaks an env secret or a submitted value,
// and a refused request changes nothing) and the route, guard and body tables. The gateway runs in
// this process on the memory broker; the CLI is the built dist/cli.js, spawned asynchronously.
import fc from "fast-check";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CMD_ACTIONS, PLAY_SOURCES, type GatewayLogEntry } from "@xelulu/shared";

import { sentinelArb, SENTINEL_PREFIX, unknownKeyArb } from "./support/arbitraries.js";
import { pinnedEnv, type EnvEntry } from "./support/env-cases.js";
import {
  flush,
  HARNESS_DEVICE_ID,
  startHarness,
  until,
  type Harness,
} from "./support/gateway-harness.js";
import {
  rawRequest,
  requireBuiltCli,
  runCli,
  type RawRequest,
  type RawResponse,
} from "./support/operator-http.js";

beforeAll(() => {
  requireBuiltCli();
});

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
});

async function harness(opts: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  const h = await startHarness({ localMode: true, ...opts });
  running.push(h);
  return h;
}

function port(h: Harness): number {
  const p = h.gateway.operatorPort();
  if (p === null) throw new Error("no Operator_Surface");
  return p;
}

function cmdPublishes(h: Harness): number {
  return h.trace.filter((t) => t.op === "publish").length;
}

function json(res: RawResponse): unknown {
  return JSON.parse(res.body) as unknown;
}

/** The CLI's env: a valid Local_Mode Config pointing at the harness's operator port. */
function cliEnv(h: Harness, password: string | null): Record<string, string | undefined> {
  const entries: EnvEntry[] = [
    ["APP_ENV", "local"],
    ["MQTT_BROKER_URL", "mqtt" + "://" + "127.0.0.1:1"],
    ["AUDIO_WSS_URL", "ws" + "://" + "127.0.0.1:1"],
    ["DEVICE_ID", h.config.device.deviceId],
    ["DEVICE_TOKEN", h.config.device.token],
    ["GATEWAY_OPERATOR_PORT", String(port(h))],
  ];
  if (password !== null) entries.push(["MQTT_PASSWORD", password]);
  const env = pinnedEnv(entries);
  delete env["DEBUG"];
  return env;
}

// ---------------------------------------------------------------------------------------------
// Property 12.

type Spec =
  | {
      readonly kind: "send";
      readonly deviceId: string | null;
      readonly action: string;
      readonly data: unknown;
      readonly cli: boolean;
    }
  | { readonly kind: "devices"; readonly cli: boolean }
  | { readonly kind: "log"; readonly after: string | null; readonly cli: boolean }
  | { readonly kind: "raw"; readonly req: RawRequest };

/** Valid commands with sentinel free-text values. */
const validCommandArb = fc.oneof(
  sentinelArb.map((s) => ({
    action: "say",
    data: { expression: s, lang: "en-IN", voice: "xelulu", duration_hint_ms: 500 },
  })),
  fc.tuple(sentinelArb, sentinelArb).map(([a, b]) => ({
    action: "animate",
    data: { expression: a, eyes: b, loop: true },
  })),
  fc.tuple(sentinelArb, fc.constantFrom(...PLAY_SOURCES)).map(([s, source]) => ({
    action: "play",
    data: { content_id: s, source },
  })),
  sentinelArb.map((s) => ({ action: "config", data: { active_child_id: s } })),
  sentinelArb.map((s) => ({
    action: "ota",
    data: { manifest_url: "https" + "://" + "updates.invalid/" + s },
  })),
);

/** Sentinel strings anywhere in `data`, as keys and values, nested. */
const sentinelDataArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.oneof(sentinelArb, unknownKeyArb, fc.constantFrom("expression", "name", "manifest_url")),
  fc.oneof(
    sentinelArb,
    fc.array(sentinelArb, { maxLength: 3 }),
    fc.dictionary(sentinelArb, sentinelArb, { maxKeys: 3 }),
  ),
  { minKeys: 1, maxKeys: 4 },
);

const cliFlag = fc.nat({ max: 9 }).map((n) => n === 0);

const sendArb: fc.Arbitrary<Spec> = fc.oneof(
  fc
    .tuple(validCommandArb, cliFlag)
    .map(([c, cli]): Spec => ({ kind: "send", deviceId: null, ...c, cli })),
  fc
    .tuple(fc.constantFrom(...CMD_ACTIONS, "§not-an-action"), sentinelDataArb, cliFlag)
    .map(([action, data, cli]): Spec => ({ kind: "send", deviceId: null, action, data, cli })),
  fc
    .tuple(sentinelArb, validCommandArb, cliFlag)
    .map(([deviceId, c, cli]): Spec => ({ kind: "send", deviceId, ...c, cli })),
);

function rawArb(): fc.Arbitrary<Spec> {
  const post = (body: string | readonly string[], headers?: RawRequest["headers"]): Spec => ({
    kind: "raw",
    req: { method: "POST", path: "/v1/commands", body, ...(headers ? { headers } : {}) },
  });
  return fc.oneof(
    // Missing, extra or wrongly typed fields.
    fc.tuple(sentinelArb, sentinelArb, fc.nat({ max: 3 })).map(([s, t, shape]) => {
      const bodies: unknown[] = [
        { action: s, data: {} },
        { device_id: HARNESS_DEVICE_ID, action: "say", data: {}, [s]: t },
        { device_id: 7, action: s, data: [t] },
        { device_id: HARNESS_DEVICE_ID, action: s, data: t },
      ];
      return post(JSON.stringify(bodies[shape]));
    }),
    // Over the 8 KiB cap, declared or streamed.
    fc.tuple(sentinelArb, fc.boolean()).map(([s, chunked]) => {
      const body = JSON.stringify({
        device_id: HARNESS_DEVICE_ID,
        action: "say",
        data: { expression: s.repeat(Math.ceil(9_000 / s.length)) },
      });
      return post(chunked ? [body.slice(0, 4_000), body.slice(4_000)] : body);
    }),
    // Not JSON, not an object.
    sentinelArb.map((s) => post(`{"device_id":"${s}`)),
    sentinelArb.map((s) => post(JSON.stringify([s]))),
    // Unknown routes and methods.
    fc.tuple(fc.stringMatching(/^[a-z]{1,12}$/), sentinelArb).map(([seg, s]): Spec => ({
      kind: "raw",
      req: { method: "POST", path: `/v1/${seg}x`, body: JSON.stringify({ s }) },
    })),
    fc
      .constantFrom(
        ["GET", "/v1/commands"],
        ["DELETE", "/v1/devices"],
        ["PUT", "/v1/commands"],
        ["POST", "/v1/log"],
      )
      .map(([method, path]): Spec => ({ kind: "raw", req: { method, path } })),
    // Foreign Origin and Host, and a non-JSON content type.
    sentinelArb.map((s) =>
      post(JSON.stringify({ device_id: HARNESS_DEVICE_ID, action: "say", data: { s } }), {
        Origin: "http" + "://" + "evil.invalid",
      }),
    ),
    fc
      .constantFrom("evil.invalid", "127.0.0.1", "localhost:1", "0.0.0.0")
      .map((host) => post(JSON.stringify({ device_id: HARNESS_DEVICE_ID }), { Host: host })),
    sentinelArb.map((s) => post(JSON.stringify({ s }), { "Content-Type": "text/plain" })),
  );
}

const specArb: fc.Arbitrary<Spec> = fc.oneof(
  sendArb,
  cliFlag.map((cli): Spec => ({ kind: "devices", cli })),
  fc
    .tuple(
      fc.option(fc.oneof(fc.stringMatching(/^[0-9]{1,4}$/), sentinelArb), { nil: null }),
      cliFlag,
    )
    .map(([after, cli]): Spec => ({ kind: "log", after, cli })),
  rawArb(),
);

function toRequest(spec: Spec): RawRequest {
  switch (spec.kind) {
    case "send":
      return {
        method: "POST",
        path: "/v1/commands",
        body: JSON.stringify({
          device_id: spec.deviceId ?? HARNESS_DEVICE_ID,
          action: spec.action,
          data: spec.data,
        }),
      };
    case "devices":
      return { path: "/v1/devices" };
    case "log":
      return {
        path: spec.after === null ? "/v1/log" : `/v1/log?after=${encodeURIComponent(spec.after)}`,
      };
    case "raw":
      return spec.req;
  }
}

/** The CLI arguments for a spec the CLI can express, or null. */
function cliArgs(spec: Spec): string[] | null {
  switch (spec.kind) {
    case "send":
      return spec.cli
        ? ["send", spec.deviceId ?? HARNESS_DEVICE_ID, spec.action, JSON.stringify(spec.data)]
        : null;
    case "devices":
      return spec.cli ? ["devices"] : null;
    case "log":
      return spec.cli ? (spec.after === null ? ["log"] : ["log", "--after", spec.after]) : null;
    case "raw":
      return null;
  }
}

describe("operator surface leaks", () => {
  // Feature: phase-1-2-gateway-simulator, Property 12: Operator responses and CLI output leak nothing
  it("never puts an env secret or a submitted value in a response or CLI output", async () => {
    const examples: [string, string, Spec][] = [
      [
        "§tokenSentinel01",
        "§passwordSentinel1",
        {
          kind: "send",
          deviceId: null,
          action: "say",
          data: {
            expression: "§exprSentinel",
            lang: "en-IN",
            voice: "xelulu",
            duration_hint_ms: 1,
          },
          cli: true,
        },
      ],
      [
        "§tokenSentinel02",
        "§passwordSentinel2",
        { kind: "send", deviceId: "§unknownDevice", action: "say", data: {}, cli: true },
      ],
      ["§tokenSentinel03", "§passwordSentinel3", { kind: "devices", cli: true }],
      ["§tokenSentinel04", "§passwordSentinel4", { kind: "log", after: "§notANumber", cli: true }],
    ];
    await fc.assert(
      fc.asyncProperty(sentinelArb, sentinelArb, specArb, async (token, password, spec) => {
        const h = await startHarness({ localMode: true, token, password });
        const outputs: string[] = [];
        try {
          await h.online();
          await flush();
          const before = h.gateway.snapshot();
          const published = cmdPublishes(h);
          const entries = h.entries.length;

          const res = await rawRequest(port(h), toRequest(spec));
          outputs.push(res.body);
          const body = json(res) as { ok?: unknown };
          if (body.ok !== true) {
            expect(h.gateway.snapshot()).toEqual(before);
            expect(cmdPublishes(h)).toBe(published);
            expect(h.entries).toHaveLength(entries);
          }

          const args = cliArgs(spec);
          if (args !== null) {
            const cli = await runCli(args, cliEnv(h, password));
            outputs.push(cli.stdout, cli.stderr);
            expect([0, 1, 2]).toContain(cli.code);
          }
        } finally {
          await h.stop();
        }
        for (const text of outputs) {
          expect(text).not.toContain(SENTINEL_PREFIX);
          expect(text).not.toContain(token);
          expect(text).not.toContain(password);
        }
      }),
      { numRuns: 100, examples },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Tables.

describe("operator surface: listening", () => {
  it("listens on 127.0.0.1 in Local_Mode", async () => {
    const h = await harness();
    expect(h.operatorListens).toEqual([{ host: "127.0.0.1", port: 0 }]);
    const res = await rawRequest(port(h), { path: "/v1/devices" });
    expect(res.status).toBe(200);
  });

  it("opens no listener outside Local_Mode", async () => {
    const h = await startHarness({ localMode: false });
    running.push(h);
    expect(h.operatorListens).toEqual([]);
    expect(h.gateway.operatorPort()).toBeNull();
  });
});

describe("operator surface: routes", () => {
  it("returns a cmd_id within 1,000 ms without waiting for an ack", async () => {
    const h = await harness({ policy: { mode: "silent" } });
    await h.online();
    const started = performance.now();
    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({
        device_id: HARNESS_DEVICE_ID,
        action: "animate",
        data: { expression: "happy", eyes: "open", loop: false },
      }),
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(res.status).toBe(200);
    const body = json(res) as { ok: boolean; cmd_id: string };
    expect(Object.keys(body).sort()).toEqual(["cmd_id", "ok"]);
    expect(body.ok).toBe(true);
    expect(body.cmd_id.length).toBeGreaterThanOrEqual(16);
    expect(h.entries.some((e) => e.kind === "ack_result")).toBe(false);
    await until(() => h.device.commands.length === 1);
    expect(h.device.commands[0]?.cmd_id).toBe(body.cmd_id);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it.each([
    ["unknown_device", 404],
    ["device_offline", 409],
    ["broker_disconnected", 503],
    ["invalid_command", 422],
  ] as const)("maps the Command_Error %s to %i and publishes nothing", async (code, status) => {
    const h = await harness();
    let deviceId = HARNESS_DEVICE_ID;
    let data: unknown = { level: 10 };
    if (code === "unknown_device") deviceId = "xlu_999999";
    if (code !== "device_offline") await h.online();
    if (code === "broker_disconnected") {
      h.broker.drop(h.clientId());
      await until(() =>
        h.entries.some((e) => e.kind === "gateway" && e.state === "broker_disconnected"),
      );
    }
    if (code === "invalid_command") data = { level: "loud" };
    const before = h.gateway.snapshot();
    const published = cmdPublishes(h);

    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: deviceId, action: "volume", data }),
    });
    expect(res.status).toBe(status);
    const body = json(res) as { ok: boolean; error: { code: string; issues?: unknown[] } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(code);
    if (code === "invalid_command") {
      expect(body.error.issues).toEqual([{ path: ["data", "level"], kind: "invalid_type" }]);
    } else {
      expect(body.error).toEqual({ code });
    }
    expect(res.body).not.toContain("xlu_999999");
    expect(res.body).not.toContain("loud");
    expect(h.gateway.snapshot()).toEqual(before);
    expect(cmdPublishes(h)).toBe(published);
    expect(h.entries.some((e) => e.kind === "message_out")).toBe(false);
  });

  it("checks Command_Errors in order: an unknown device wins over invalid data", async () => {
    const h = await harness();
    const res = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: "xlu_999999", action: "bogus", data: {} }),
    });
    expect(res.status).toBe(404);
    expect(json(res)).toEqual({ ok: false, error: { code: "unknown_device" } });
  });

  it("reports each Registered_Device with exactly the snapshot fields", async () => {
    const h = await harness({ policy: { mode: "accept_only" } });
    await h.online();
    await h.device.event("touch");
    h.gateway.sendCommand({ device_id: HARNESS_DEVICE_ID, action: "volume", data: { level: 3 } });
    await until(() => h.entries.some((e) => e.kind === "ack_result"));

    const res = await rawRequest(port(h), { path: "/v1/devices" });
    expect(res.status).toBe(200);
    const body = json(res) as { ok: boolean; devices: Record<string, unknown>[] };
    expect(Object.keys(body).sort()).toEqual(["devices", "ok"]);
    expect(body.devices).toHaveLength(1);
    const device = body.devices[0] ?? {};
    expect(Object.keys(device).sort()).toEqual([
      "auth_failed",
      "commands",
      "device_id",
      "events_accepted",
      "events_duplicate",
      "last_heartbeat_at",
      "presence",
    ]);
    expect(device).toMatchObject({
      device_id: HARNESS_DEVICE_ID,
      presence: "online",
      auth_failed: false,
      events_accepted: 1,
      events_duplicate: 0,
    });
    expect(device["last_heartbeat_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const commands = device["commands"] as Record<string, unknown>[];
    expect(commands).toHaveLength(1);
    expect(Object.keys(commands[0] ?? {}).sort()).toEqual([
      "action",
      "cmd_id",
      "reason",
      "state",
      "timeout_cause",
    ]);
    expect(commands[0]).toMatchObject({
      action: "volume",
      state: "accepted",
      reason: null,
      timeout_cause: null,
    });
    expect(res.body).not.toContain(h.config.device.token);
  });

  it("returns the log in seq order, or only entries after `after`", async () => {
    const h = await harness();
    await h.online();
    const all = json(await rawRequest(port(h), { path: "/v1/log" })) as {
      ok: boolean;
      entries: GatewayLogEntry[];
    };
    expect(all.ok).toBe(true);
    const seqs = all.entries.map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(all.entries).toEqual(h.entries.slice(0, seqs.length));
    const latest = seqs.at(-1) ?? 0;

    const afterTwo = json(await rawRequest(port(h), { path: "/v1/log?after=2" })) as {
      entries: GatewayLogEntry[];
    };
    expect(afterTwo.entries.map((e) => e.seq)).toEqual(seqs.filter((s) => s > 2));
    for (const after of [latest, latest + 100]) {
      const res = json(await rawRequest(port(h), { path: `/v1/log?after=${after}` }));
      expect(res).toEqual({ ok: true, entries: [] });
    }
    for (const bad of ["-1", "abc", "1.5", ""]) {
      const res = await rawRequest(port(h), { path: `/v1/log?after=${bad}` });
      expect(res.status).toBe(400);
      expect(json(res)).toEqual({
        ok: false,
        error: { code: "invalid_fields", issues: [{ path: ["after"], kind: "invalid_type" }] },
      });
    }
  });
});

type GuardCase = Readonly<{
  name: string;
  req: (port: number) => RawRequest;
  status: number;
  code: string;
  issues?: unknown;
}>;

const VALID_SEND = JSON.stringify({
  device_id: HARNESS_DEVICE_ID,
  action: "volume",
  data: { level: 20 },
});
const OVERSIZE = JSON.stringify({
  device_id: HARNESS_DEVICE_ID,
  action: "say",
  data: { expression: "z".repeat(8_200) },
});

const GUARD_CASES: readonly GuardCase[] = [
  {
    name: "a foreign Host",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: VALID_SEND,
      headers: { Host: "evil.invalid" },
    }),
    status: 403,
    code: "forbidden_host",
  },
  {
    name: "a Host at another port",
    req: (p) => ({ path: "/v1/devices", headers: { Host: `127.0.0.1:${p + 1}` } }),
    status: 403,
    code: "forbidden_host",
  },
  {
    name: "an Origin header",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: VALID_SEND,
      headers: { Origin: "http" + "://" + "127.0.0.1" },
    }),
    status: 403,
    code: "forbidden_origin",
  },
  {
    name: "an unknown route",
    req: () => ({ path: "/v1/nope" }),
    status: 404,
    code: "unknown_route",
  },
  {
    name: "GET on /v1/commands",
    req: () => ({ method: "GET", path: "/v1/commands" }),
    status: 405,
    code: "method_not_allowed",
  },
  {
    name: "POST on /v1/devices",
    req: () => ({ method: "POST", path: "/v1/devices", body: "{}" }),
    status: 405,
    code: "method_not_allowed",
  },
  {
    name: "a text/plain body",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: VALID_SEND,
      headers: { "Content-Type": "text/plain" },
    }),
    status: 415,
    code: "unsupported_media_type",
  },
  {
    name: "no content type",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: VALID_SEND,
      headers: { "Content-Type": undefined },
    }),
    status: 415,
    code: "unsupported_media_type",
  },
  {
    name: "a declared body over 8 KiB",
    req: () => ({ method: "POST", path: "/v1/commands", body: OVERSIZE }),
    status: 413,
    code: "body_too_large",
  },
  {
    name: "a streamed body over 8 KiB",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: [OVERSIZE.slice(0, 5_000), OVERSIZE.slice(5_000)],
    }),
    status: 413,
    code: "body_too_large",
  },
  {
    name: "a body that is not JSON",
    req: () => ({ method: "POST", path: "/v1/commands", body: "{not json" }),
    status: 400,
    code: "invalid_json",
  },
  {
    name: "a body that is not an object",
    req: () => ({ method: "POST", path: "/v1/commands", body: "[1,2]" }),
    status: 400,
    code: "not_object",
  },
  {
    name: "a missing field",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: HARNESS_DEVICE_ID, action: "volume" }),
    }),
    status: 400,
    code: "invalid_fields",
    issues: [{ path: ["data"], kind: "invalid_type" }],
  },
  {
    name: "an extra field",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({
        device_id: HARNESS_DEVICE_ID,
        action: "volume",
        data: { level: 1 },
        extra: "value-that-must-not-echo",
      }),
    }),
    status: 400,
    code: "invalid_fields",
    issues: [{ path: ["extra"], kind: "unrecognized_keys" }],
  },
  {
    name: "wrongly typed fields",
    req: () => ({
      method: "POST",
      path: "/v1/commands",
      body: JSON.stringify({ device_id: 7, action: ["volume"], data: "level" }),
    }),
    status: 400,
    code: "invalid_fields",
    issues: [
      { path: ["device_id"], kind: "invalid_type" },
      { path: ["action"], kind: "invalid_type" },
      { path: ["data"], kind: "invalid_type" },
    ],
  },
];

describe("operator surface: guard and body errors", () => {
  it.each(GUARD_CASES)("refuses $name with $code, changes nothing and keeps serving", async (c) => {
    const h = await harness();
    await h.online();
    const before = h.gateway.snapshot();
    const published = cmdPublishes(h);
    const entries = h.entries.length;

    const res = await rawRequest(port(h), c.req(port(h)));
    expect(res.status).toBe(c.status);
    const body = json(res);
    expect(body).toEqual({
      ok: false,
      error: c.issues === undefined ? { code: c.code } : { code: c.code, issues: c.issues },
    });
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.body).not.toContain("value-that-must-not-echo");
    expect(res.body).not.toContain("zzzz");
    if (c.status === 413) expect(res.headers["connection"]).toBe("close");

    await flush();
    expect(h.gateway.snapshot()).toEqual(before);
    expect(cmdPublishes(h)).toBe(published);
    expect(h.entries).toHaveLength(entries);

    // Later requests still work.
    const later = await rawRequest(port(h), { path: "/v1/devices" });
    expect(later.status).toBe(200);
    const sent = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/commands",
      body: VALID_SEND,
    });
    expect(sent.status).toBe(200);
  });
});
