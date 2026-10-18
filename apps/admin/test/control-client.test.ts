// Example tests for the Device_Control_Route's client (Req 4.5, 5.1, 5.7). Node environment, no
// DOM: the injected fetch records the call's path, method, credentials and JSON body, and answers
// with the shapes the Operator_Surface, the Device_Action_Gate and the bare dev server really
// return. Every branch of THE PROXY RULE is exercised here, the same way
// `content-client.test.ts` covers its sibling.
import { describe, expect, it } from "vitest";

import { PROXY_DISABLED, UNREACHABLE, type FetchLike } from "../src/content/content-client";
import { DEVICE_CONTROL_PATH, createControlClient } from "../src/control/control-client";

type Call = Readonly<{
  path: string;
  method: string;
  credentials: string | undefined;
  body: unknown;
}>;

/** A fetch that records every call and answers with the given body text and status. */
function recording(
  answer: Readonly<{ text: string; status?: number }>,
): Readonly<{ calls: Call[]; fetchImpl: FetchLike }> {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (path, init) => {
    const body = init?.body;
    calls.push({
      path,
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      body: typeof body === "string" ? (JSON.parse(body) as unknown) : null,
    });
    return Promise.resolve(new Response(answer.text, { status: answer.status ?? 200 }));
  };
  return { calls, fetchImpl };
}

describe("control client request", () => {
  it("POSTs device_id, action and data to its own origin's one path", async () => {
    const { calls, fetchImpl } = recording({ text: '{"ok":true,"cmd_id":"cmd_1"}' });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "say", {
      text_id: "greet_1",
    });

    expect(result).toEqual({ ok: true, cmd_id: "cmd_1" });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    // Relative, so the browser resolves it against the console's own origin and nowhere else.
    expect(call?.path).toBe(DEVICE_CONTROL_PATH);
    expect(DEVICE_CONTROL_PATH.startsWith("/v1/")).toBe(true);
    expect(call?.method).toBe("POST");
    expect(call?.credentials).toBe("omit");
    // Exactly the three keys the route accepts; a fourth would be 400 `invalid_fields`.
    expect(call?.body).toEqual({
      device_id: "xlu_000123",
      action: "say",
      data: { text_id: "greet_1" },
    });
    expect(Object.keys(call?.body as Record<string, unknown>)).toEqual([
      "device_id",
      "action",
      "data",
    ]);
  });
});

describe("control client refusals", () => {
  it("passes the route's error code and the gate's Policy_Refusal through", async () => {
    const body = JSON.stringify({
      ok: false,
      error: { code: "refused" },
      refusal: "quiet_hours",
    });
    const { fetchImpl } = recording({ text: body, status: 409 });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "animate", {});
    expect(result).toEqual({ ok: false, code: "refused", refusal: "quiet_hours" });
  });

  it("passes a refusal with no Policy_Refusal through as a null refusal", async () => {
    const body = JSON.stringify({ ok: false, error: { code: "device_control_disabled" } });
    const { fetchImpl } = recording({ text: body, status: 403 });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "led", {});
    expect(result).toEqual({ ok: false, code: "device_control_disabled", refusal: null });
  });

  it("reports proxy_disabled for a refusal whose error carries no code", async () => {
    const { fetchImpl } = recording({ text: '{"ok":false}', status: 400 });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "play", {});
    expect(result).toEqual({ ok: false, code: PROXY_DISABLED, refusal: null });
  });

  it.each([
    ["a non-JSON 404, as an unproxied POST answers", 404],
    ["a non-JSON 200, as the dev server's HTML fallback answers", 200],
  ])("reports proxy_disabled for %s", async (_name, status) => {
    const { fetchImpl } = recording({ text: "<!doctype html><title>x</title>", status });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "say", {});
    expect(result).toEqual({ ok: false, code: PROXY_DISABLED, refusal: null });
  });

  it.each([
    ["an empty body, as a 404 with no content answers", ""],
    ["JSON with no ok field", '{"cmd_id":"cmd_1"}'],
    ["JSON whose ok is not a boolean", '{"ok":"yes","cmd_id":"cmd_1"}'],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
  ])("reports proxy_disabled for %s", async (_name, text) => {
    const { fetchImpl } = recording({ text });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "say", {});
    expect(result).toEqual({ ok: false, code: PROXY_DISABLED, refusal: null });
  });

  it.each([
    ["no cmd_id", '{"ok":true}'],
    ["an empty cmd_id", '{"ok":true,"cmd_id":""}'],
    ["a non-string cmd_id", '{"ok":true,"cmd_id":7}'],
  ])("reports proxy_disabled for an accepted answer with %s", async (_name, text) => {
    const { fetchImpl } = recording({ text });
    const result = await createControlClient(fetchImpl).send("xlu_000123", "gesture", {});
    expect(result).toEqual({ ok: false, code: PROXY_DISABLED, refusal: null });
  });

  it("reports unreachable when the request itself fails", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("refused"));
    const result = await createControlClient(fetchImpl).send("xlu_000123", "say", {});
    expect(result).toEqual({ ok: false, code: UNREACHABLE, refusal: null });
  });
});
