// Example tests for the Content page's client (Req 16, 17.6, 17.6a). Node environment, no DOM:
// the injected fetch records each call's path, method and JSON body, and returns the shapes the
// surface and the dev server actually answer with.
import { describe, expect, it } from "vitest";

import {
  CONTENT_PATHS,
  PROXY_DISABLED,
  UNREACHABLE,
  createContentClient,
  type FetchLike,
} from "../src/content/content-client";

type Call = Readonly<{ path: string; method: string; body: unknown }>;

/** A fetch that records every call and answers with the given JSON text and status. */
function recording(
  answer: Readonly<{ text: string; status?: number }> = { text: '{"ok":true}' },
): Readonly<{ calls: Call[]; fetchImpl: FetchLike }> {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (path, init) => {
    const body = init?.body;
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: typeof body === "string" ? (JSON.parse(body) as unknown) : null,
    });
    return Promise.resolve(new Response(answer.text, { status: answer.status ?? 200 }));
  };
  return { calls, fetchImpl };
}

describe("content client paths and bodies", () => {
  it("sends each of the twelve routes with its method and JSON body", async () => {
    const { calls, fetchImpl } = recording();
    const client = createContentClient(fetchImpl);

    await client.content();
    await client.contentItem("content 1");
    await client.grandma();
    await client.routines();
    await client.reports();
    await client.createContent({ content_id: "content_2" });
    await client.updateContent("content_2", { title: "A kinder bird" });
    await client.setStatus("content_2", "active");
    await client.addConsent({
      purpose: "grandma_recording",
      version: "v1",
      verification_method: "identity_details",
    });
    await client.addRecording({
      consent_record_id: "cns_1",
      kind: "story",
      title: "Nani tells a tale",
      lang: "en-IN",
      duration_s: 120,
    });
    await client.scheduleRecording("gma_1", "19:30", true);
    await client.call("xlu_000123", "request");
    await client.runRoutine("xlu_000123", "morning");

    expect(calls.map((call) => call.path)).toEqual([
      CONTENT_PATHS.content,
      `${CONTENT_PATHS.content}?id=content%201`,
      CONTENT_PATHS.grandma,
      CONTENT_PATHS.routines,
      CONTENT_PATHS.reports,
      CONTENT_PATHS.contentCreate,
      CONTENT_PATHS.contentUpdate,
      CONTENT_PATHS.contentStatus,
      CONTENT_PATHS.grandmaConsent,
      CONTENT_PATHS.grandmaRecording,
      CONTENT_PATHS.grandmaSchedule,
      CONTENT_PATHS.grandmaCall,
      CONTENT_PATHS.routineRun,
    ]);
    expect(calls.slice(0, 5).map((call) => call.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
    ]);
    expect(calls.slice(5).every((call) => call.method === "POST")).toBe(true);

    expect(calls[6]?.body).toEqual({
      content_id: "content_2",
      patch: { title: "A kinder bird" },
    });
    expect(calls[7]?.body).toEqual({ content_id: "content_2", status: "active" });
    expect(calls[8]?.body).toEqual({
      purpose: "grandma_recording",
      version: "v1",
      verification_method: "identity_details",
    });
    expect(calls[10]?.body).toEqual({ asset_id: "gma_1", at: "19:30", enabled: true });
    expect(calls[11]?.body).toEqual({ device_id: "xlu_000123", op: "request" });
    expect(calls[12]?.body).toEqual({ device_id: "xlu_000123", routine: "morning" });
  });

  it("sends only the twelve route paths and `/v1/content?id=`", () => {
    expect(Object.keys(CONTENT_PATHS)).toHaveLength(12);
    for (const path of Object.values(CONTENT_PATHS)) expect(path.startsWith("/v1/")).toBe(true);
  });
});

describe("content client refusals", () => {
  it("turns a non-200 refusal into a typed result rather than throwing", async () => {
    const body = JSON.stringify({
      ok: false,
      error: {
        code: "invalid_fields",
        issues: [{ path: ["steps", "2", "text"], kind: "invalid_value" }],
      },
      reason: "gate_refused",
      gate: { rule: "forbidden_span", age_stage: "little", lang: "en-IN" },
    });
    const { fetchImpl } = recording({ text: body, status: 400 });
    const result = await createContentClient(fetchImpl).createContent({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("invalid_fields");
    expect(result.refusal.field).toBe("steps.2.text");
    expect(result.refusal.reason).toBe("gate_refused");
    expect(result.refusal.gate).toEqual({
      rule: "forbidden_span",
      age_stage: "little",
      lang: "en-IN",
    });
  });

  it("reads a gate verdict from a refusal body", async () => {
    const body = JSON.stringify({
      ok: false,
      error: { code: "invalid_fields", issues: [{ path: ["title"], kind: "invalid_value" }] },
      verdict: {
        ok: false,
        rule: "length",
        age_stage: "tiny",
        lang: "en-IN",
        step_id: "",
        field: "title",
      },
    });
    const { fetchImpl } = recording({ text: body, status: 400 });
    const result = await createContentClient(fetchImpl).setStatus("content_1", "active");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const verdict = result.refusal.verdict;
    expect(verdict?.ok).toBe(false);
    if (verdict === null || verdict.ok) return;
    expect(verdict.rule).toBe("length");
    expect(verdict.age_stage).toBe("tiny");
  });

  it.each([
    ["a non-JSON 404, as an unproxied POST answers", 404],
    ["a non-JSON 200, as the dev server's HTML fallback answers", 200],
  ])("reports proxy_disabled for %s", async (_name, status) => {
    const { fetchImpl } = recording({ text: "<!doctype html><title>x</title>", status });
    const result = await createContentClient(fetchImpl).createContent({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe(PROXY_DISABLED);
  });

  it("reports proxy_disabled for JSON without an ok field", async () => {
    const { fetchImpl } = recording({ text: '{"items":[]}' });
    const result = await createContentClient(fetchImpl).content();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe(PROXY_DISABLED);
  });

  it("reports unreachable when the request itself fails", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("refused"));
    const result = await createContentClient(fetchImpl).content();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe(UNREACHABLE);
  });
});
