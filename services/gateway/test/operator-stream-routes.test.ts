// The Operator_Stream route rules as pure functions (Phase 1.3 Req 1.5, 1.6): the unchanged guard
// applies to /v1/stream, any query key is refused without echoing its value, and the pure handler
// never serves the stream (the transport does). No sockets.
import { describe, expect, it } from "vitest";

import {
  checkStreamRequest,
  handleOperatorRequest,
  OPERATOR_ROUTES,
  OPERATOR_STREAM_PATH,
  preflightOperatorRequest,
  type HttpRequestIn,
  type OperatorRouteDeps,
} from "../src/operator/operator-routes.js";

const PORT = 8090;
const HOST = `127.0.0.1:${PORT}`;

function streamRequest(overrides: Partial<HttpRequestIn> = {}): HttpRequestIn {
  return {
    method: "GET",
    path: OPERATOR_STREAM_PATH,
    query: {},
    queryKeys: [],
    host: HOST,
    origin: undefined,
    contentType: undefined,
    body: "",
    ...overrides,
  };
}

function unreachable(): never {
  throw new Error("route dependency reached");
}

/** Deps whose data sources must never be read for the stream path. */
const deps: OperatorRouteDeps = {
  port: () => PORT,
  snapshot: unreachable,
  logSince: unreachable,
  sendCommand: unreachable,
  conversation: unreachable,
  brain: unreachable,
  deleteAllTranscripts: unreachable,
  // The Phase 4 content deps, every one of them equally unreachable on the stream path.
  contentAdmin: unreachable,
  contentSummaries: unreachable,
  contentItem: unreachable,
  contentCreate: unreachable,
  contentUpdate: unreachable,
  contentStatus: unreachable,
  grandmaSnapshot: unreachable,
  recordConsent: unreachable,
  addRecording: unreachable,
  scheduleRecording: unreachable,
  applyCall: unreachable,
  routinesSnapshot: unreachable,
  runRoutine: unreachable,
  reports: unreachable,
};

describe("Operator_Stream routes", () => {
  it("adds /v1/stream as a GET-only route", () => {
    expect(OPERATOR_STREAM_PATH).toBe("/v1/stream");
    expect(OPERATOR_ROUTES[OPERATOR_STREAM_PATH]).toEqual(["GET"]);
    expect(Object.isFrozen(OPERATOR_ROUTES)).toBe(true);
  });

  it("checkStreamRequest lets a request with no query go on", () => {
    expect(checkStreamRequest(streamRequest())).toBeNull();
  });

  it("checkStreamRequest refuses a query key with 400 invalid_fields and no value", () => {
    const value = "STREAM-QUERY-VALUE-SENTINEL";
    const out = checkStreamRequest(streamRequest({ query: { a: value } }));
    expect(out).toEqual({
      status: 400,
      body: {
        ok: false,
        error: { code: "invalid_fields", issues: [{ path: ["a"], kind: "unrecognized_keys" }] },
      },
    });
    expect(JSON.stringify(out?.body)).not.toContain(value);
  });

  it("checkStreamRequest makes an unsafe key safe", () => {
    const out = checkStreamRequest(streamRequest({ query: { ["k\u00e9y\n"]: "v" } }));
    expect(out?.body).toEqual({
      ok: false,
      error: { code: "invalid_fields", issues: [{ path: ["k?y?"], kind: "unrecognized_keys" }] },
    });
  });

  it("handleOperatorRequest answers the stream path with 404 unknown_route", () => {
    expect(handleOperatorRequest(deps, streamRequest())).toEqual({
      status: 404,
      body: { ok: false, error: { code: "unknown_route" } },
    });
  });

  it("preflight lets GET /v1/stream through and refuses POST with 405", () => {
    expect(preflightOperatorRequest(PORT, streamRequest())).toBeNull();
    expect(
      preflightOperatorRequest(
        PORT,
        streamRequest({ method: "POST", contentType: "application/json" }),
      ),
    ).toEqual({ status: 405, body: { ok: false, error: { code: "method_not_allowed" } } });
  });

  it("preflight refuses a foreign Origin with 403 forbidden_origin", () => {
    expect(
      preflightOperatorRequest(PORT, streamRequest({ origin: "http://evil.example" })),
    ).toEqual({ status: 403, body: { ok: false, error: { code: "forbidden_origin" } } });
  });

  it("preflight refuses a foreign Host with 403 forbidden_host", () => {
    expect(preflightOperatorRequest(PORT, streamRequest({ host: `gateway:${PORT}` }))).toEqual({
      status: 403,
      body: { ok: false, error: { code: "forbidden_host" } },
    });
  });
});
