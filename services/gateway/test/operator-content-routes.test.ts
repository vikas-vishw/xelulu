// The twelve Operator_Content_Routes over real loopback HTTP (Phase 4 Req 16, 21.8, 21.8a,
// 21.8d): Property 10 (every write refuses without the Content_Admin_Argument), the unchanged
// request guard on all twelve, the query rules, the refusal shape, and the consent route end to
// end on the surface — which is the one thing Requirement 21.4's store-level test cannot catch.
//
// The gateway runs in this process on the memory broker; the surface is the real HTTP listener on
// 127.0.0.1 with an OS-assigned port.
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import {
  OPERATOR_CONTENT_READ_PATHS,
  OPERATOR_CONTENT_ROUTES,
  OPERATOR_CONTENT_WRITE_PATHS,
} from "../src/operator/operator-routes.js";

import { HARNESS_DEVICE_ID, startHarness, type Harness } from "./support/gateway-harness.js";
import { rawRequest, type RawResponse } from "./support/operator-http.js";

const running: Harness[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
});

async function harness(contentAdmin: boolean): Promise<Harness> {
  const h = await startHarness({ localMode: true, contentAdmin });
  running.push(h);
  return h;
}

function port(h: Harness): number {
  const p = h.gateway.operatorPort();
  if (p === null) throw new Error("no Operator_Surface");
  return p;
}

function json(res: RawResponse): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

function errorOf(res: RawResponse): Record<string, unknown> {
  const body = json(res);
  return (body["error"] ?? {}) as Record<string, unknown>;
}

function issues(res: RawResponse): readonly Record<string, unknown>[] {
  const list = errorOf(res)["issues"];
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

function firstPath(res: RawResponse): string {
  const path = issues(res)[0]?.["path"];
  return Array.isArray(path) ? path.map((s) => String(s)).join(".") : "";
}

function post(path: string, body: unknown): Parameters<typeof rawRequest>[1] {
  return { method: "POST", path, body: JSON.stringify(body) };
}

/** A minimal draft the store's validation accepts: one linear step, English, `little`. */
function draft(contentId: string, over: Readonly<Record<string, unknown>> = {}) {
  return {
    content_id: contentId,
    kind: "story",
    title: "A kind little bird",
    languages: ["en-IN"],
    age_stages: ["little"],
    categories: ["stories"],
    licence_note: "Original retelling written for Xelulu.",
    source: "original",
    steps: [
      {
        step_id: "s1",
        text: { "en-IN": "A little bird found a seed. She shared it with her friend." },
        choices: [],
        next_step_id: null,
      },
    ],
    ...over,
  };
}

/** Records a development Consent_Record and answers its id. */
async function newConsent(h: Harness): Promise<string> {
  const res = await rawRequest(
    port(h),
    post("/v1/grandma/consent", {
      purpose: "grandma_recording",
      version: "dev-notice-1",
      verification_method: "identity_details",
    }),
  );
  expect(res.status).toBe(200);
  const consent = json(res)["consent"] as Record<string, unknown>;
  return String(consent["consent_id"]);
}

// ---------------------------------------------------------------------------------------------
// Property 10.

describe("content routes: writes refuse without the argument", () => {
  // Feature: phase-4-content-stories-grandma-routines, Property 10: Writes refuse without the argument
  it("answers 403 content_admin_disabled, changes nothing and publishes nothing", async () => {
    const h = await harness(false);
    await h.online();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...OPERATOR_CONTENT_WRITE_PATHS),
        fc.oneof(
          fc.constant({}),
          fc.constant(draft("content_property_1")),
          fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string({ maxLength: 8 }), {
            maxKeys: 3,
          }),
        ),
        async (path, body) => {
          const before = h.entries.length;
          const publishes = h.trace.filter((t) => t.op === "publish").length;
          const res = await rawRequest(port(h), post(path, body));
          expect(res.status).toBe(403);
          expect(json(res)).toEqual({ ok: false, error: { code: "content_admin_disabled" } });
          expect(h.entries).toHaveLength(before);
          expect(h.trace.filter((t) => t.op === "publish")).toHaveLength(publishes);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reports write_enabled false on every read, and true with the argument", async () => {
    const off = await harness(false);
    for (const path of OPERATOR_CONTENT_READ_PATHS) {
      const res = await rawRequest(port(off), { path });
      expect(res.status).toBe(200);
      expect(json(res)["write_enabled"]).toBe(false);
    }
    const on = await harness(true);
    for (const path of OPERATOR_CONTENT_READ_PATHS) {
      const res = await rawRequest(port(on), { path });
      expect(res.status).toBe(200);
      expect(json(res)["write_enabled"]).toBe(true);
    }
  });

  it("refuses before any body parse, and the 413 cap lands ahead of that check", async () => {
    const h = await harness(false);
    // Body that is not even JSON: the argument check answers first (Req 16.3).
    const notJson = await rawRequest(h.gateway.operatorPort() ?? 0, {
      method: "POST",
      path: "/v1/content/create",
      body: "{not json",
    });
    expect(notJson.status).toBe(403);
    expect(errorOf(notJson)["code"]).toBe("content_admin_disabled");
    // Over the unchanged 8 KiB transport cap: 413, which is earlier still (Req 16.13).
    const oversize = JSON.stringify(draft("content_big", { title: "z".repeat(8_300) }));
    const tooLarge = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/content/create",
      body: oversize,
    });
    expect(tooLarge.status).toBe(413);
    expect(errorOf(tooLarge)["code"]).toBe("body_too_large");
    expect(tooLarge.body).not.toContain("zzzz");
  });
});

// ---------------------------------------------------------------------------------------------
// The unchanged guard, on all twelve.

describe("content routes: the unchanged request guard", () => {
  it("refuses a foreign Host, any Origin, an unknown route and a wrong method", async () => {
    const h = await harness(true);
    expect(OPERATOR_CONTENT_ROUTES).toHaveLength(12);

    for (const path of OPERATOR_CONTENT_ROUTES) {
      const foreignHost = await rawRequest(port(h), { path, headers: { Host: "evil.invalid" } });
      expect(foreignHost.status).toBe(403);
      expect(errorOf(foreignHost)["code"]).toBe("forbidden_host");

      const origin = await rawRequest(port(h), {
        path,
        headers: { Origin: "http" + "://" + "evil.invalid" },
      });
      expect(origin.status).toBe(403);
      expect(errorOf(origin)["code"]).toBe("forbidden_origin");
    }

    const unknown = await rawRequest(port(h), { path: "/v1/content/nope" });
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown)["code"]).toBe("unknown_route");

    const wrongMethod = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/content",
      body: "{}",
    });
    expect(wrongMethod.status).toBe(405);

    const getWrite = await rawRequest(port(h), { path: "/v1/content/create" });
    expect(getWrite.status).toBe(405);

    const textBody = await rawRequest(port(h), {
      method: "POST",
      path: "/v1/content/create",
      body: "{}",
      headers: { "Content-Type": "text/plain" },
    });
    expect(textBody.status).toBe(415);
  });

  it("refuses a query key on the three noQuery reads, and on /v1/content", async () => {
    const h = await harness(true);
    for (const path of ["/v1/grandma", "/v1/routines", "/v1/reports"]) {
      const res = await rawRequest(port(h), { path: `${path}?who=must-not-echo` });
      expect(res.status).toBe(400);
      expect(errorOf(res)["code"]).toBe("invalid_fields");
      expect(firstPath(res)).toBe("who");
      expect(res.body).not.toContain("must-not-echo");
    }
    const foo = await rawRequest(port(h), { path: "/v1/content?foo=must-not-echo" });
    expect(foo.status).toBe(400);
    expect(firstPath(foo)).toBe("foo");
    expect(foo.body).not.toContain("must-not-echo");
  });

  it("refuses a repeated id rather than resolving it to either value", async () => {
    const h = await harness(true);
    const res = await rawRequest(port(h), { path: "/v1/content?id=a&id=b" });
    expect(res.status).toBe(400);
    expect(errorOf(res)["code"]).toBe("invalid_fields");
    expect(firstPath(res)).toBe("id");
  });
});

// ---------------------------------------------------------------------------------------------
// The reads.

describe("content routes: the reads", () => {
  it("lists summaries with no step text, and one full item under ?id=", async () => {
    const h = await harness(true);
    const list = await rawRequest(port(h), { path: "/v1/content" });
    expect(list.status).toBe(200);
    const items = json(list)["items"] as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(0);
    const first = items[0] ?? {};
    expect(Object.keys(first).sort()).toEqual([
      "age_stages",
      "categories",
      "content_id",
      "created_at",
      "household_id",
      "kind",
      "languages",
      "licence_note",
      "source",
      "status",
      "step_count",
      "title",
      "updated_at",
      "verdict",
    ]);
    expect(list.body).not.toContain('"steps"');
    expect(list.body).not.toContain('"prompt"');
    expect(items.some((item) => item["status"] === "active")).toBe(true);

    const id = String(first["content_id"]);
    const one = await rawRequest(port(h), { path: `/v1/content?id=${encodeURIComponent(id)}` });
    expect(one.status).toBe(200);
    const item = json(one)["item"] as Record<string, unknown>;
    // A ContentItem, so `household_id` survives the editor's round trip (Req 16.5).
    expect(Object.hasOwn(item, "household_id")).toBe(true);
    expect(Array.isArray(item["steps"])).toBe(true);
    expect(json(one)["write_enabled"]).toBe(true);
  });

  it("answers 404 unknown_content for an id it does not hold", async () => {
    const h = await harness(true);
    const res = await rawRequest(port(h), { path: "/v1/content?id=content_not_here" });
    expect(res.status).toBe(404);
    expect(json(res)).toEqual({ ok: false, error: { code: "unknown_content" } });
    expect(res.body).not.toContain("content_not_here");
  });

  it("reports the six routines, the play ledger, and both report periods", async () => {
    const h = await harness(true);
    const routines = await rawRequest(port(h), { path: "/v1/routines" });
    expect(routines.status).toBe(200);
    const rows = json(routines)["routines"] as Record<string, unknown>[];
    expect(rows.map((row) => row["routine_id"])).toEqual([
      "morning",
      "brushing",
      "meals",
      "play_time",
      "wind_down",
      "bedtime",
    ]);
    expect(rows.every((row) => typeof row["actions"] === "number")).toBe(true);
    expect(rows.every((row) => row["fired_today"] === false)).toBe(true);
    expect(json(routines)["play_minutes_used"]).toBe(0);

    const before = h.entries.filter((e) => e.kind === "report_built").length;
    const reports = await rawRequest(port(h), { path: "/v1/reports" });
    expect(reports.status).toBe(200);
    const daily = json(reports)["daily"] as Record<string, unknown>;
    // Counts and a window, and nothing else: no score, no rank, no prediction (Req 14.5, 16.10).
    expect(Object.keys(daily).sort()).toEqual([
      "categories_heard",
      "cry_moments",
      "play_minutes",
      "play_sessions",
      "routines_completed",
      "stories_heard",
      "turns",
      "window",
      "words_learned",
    ]);
    // One `report_built` entry per period, computed on this request (Req 16.9).
    expect(h.entries.filter((e) => e.kind === "report_built")).toHaveLength(before + 2);
  });

  it("answers the Grandma read with no recordings, no consents and no call at first", async () => {
    const h = await harness(true);
    const res = await rawRequest(port(h), { path: "/v1/grandma" });
    expect(res.status).toBe(200);
    expect(json(res)).toMatchObject({
      ok: true,
      recordings: [],
      consents: [],
      call: null,
      write_enabled: true,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The writes.

describe("content routes: the content writes", () => {
  it("creates a draft, keeps it draft, then activates it through the gate", async () => {
    const h = await harness(true);
    const created = await rawRequest(port(h), post("/v1/content/create", draft("content_route_1")));
    expect(created.status).toBe(200);
    const item = json(created)["item"] as Record<string, unknown>;
    expect(item["status"]).toBe("draft");

    const activated = await rawRequest(
      port(h),
      post("/v1/content/status", { content_id: "content_route_1", status: "active" }),
    );
    expect(activated.status).toBe(200);
    expect((json(activated)["item"] as Record<string, unknown>)["status"]).toBe("active");

    // Repeating the same status succeeds and changes nothing (Req 16.14).
    const again = await rawRequest(
      port(h),
      post("/v1/content/status", { content_id: "content_route_1", status: "active" }),
    );
    expect(again.status).toBe(200);
    expect((json(again)["item"] as Record<string, unknown>)["status"]).toBe("active");
  });

  it("refuses a gate-refused activation with the verdict and leaves the item draft", async () => {
    const h = await harness(true);
    // `tiny` allows one sentence of eight words, so this two-sentence step is refused `length`.
    const refusedDraft = draft("content_route_long", {
      age_stages: ["tiny"],
      title: "A kind bird",
    });
    const created = await rawRequest(port(h), post("/v1/content/create", refusedDraft));
    expect(created.status).toBe(400);
    expect(errorOf(created)["code"]).toBe("invalid_fields");
    const verdict = json(created)["verdict"] as Record<string, unknown>;
    expect(verdict["ok"]).toBe(false);
    expect(verdict["age_stage"]).toBe("tiny");
    expect(typeof verdict["rule"]).toBe("string");
    // The draft is kept, so an operator can read its verdict — but it cannot be activated.
    const activate = await rawRequest(
      port(h),
      post("/v1/content/status", { content_id: "content_route_long", status: "active" }),
    );
    expect(activate.status).toBe(400);
    const one = await rawRequest(port(h), { path: "/v1/content?id=content_route_long" });
    expect((json(one)["item"] as Record<string, unknown>)["status"]).toBe("draft");
  });

  it("refuses a forbidden key with unrecognized_keys and no field member in the body", async () => {
    const h = await harness(true);
    const cases: readonly [string, unknown, string][] = [
      [
        "/v1/content/create",
        { ...draft("content_route_2"), household_id: "hh_other" },
        "household_id",
      ],
      ["/v1/content/create", { ...draft("content_route_3"), status: "active" }, "status"],
      [
        "/v1/grandma/recording",
        {
          consent_record_id: "cns_1",
          kind: "story",
          title: "T",
          lang: "en-IN",
          duration_s: 30,
          media_handle: "mh_1",
        },
        "media_handle",
      ],
      [
        "/v1/grandma/consent",
        {
          purpose: "grandma_recording",
          version: "v1",
          verification_method: "identity_details",
          user_id: "user_other",
        },
        "user_id",
      ],
    ];
    for (const [path, body, key] of cases) {
      const res = await rawRequest(port(h), post(path, body));
      expect(res.status).toBe(400);
      expect(errorOf(res)["code"]).toBe("invalid_fields");
      expect(issues(res)[0]).toEqual({ path: [key], kind: "unrecognized_keys" });
      expect(Object.hasOwn(json(res), "field")).toBe(false);
      expect(Object.hasOwn(errorOf(res), "field")).toBe(false);
    }
  });

  it("names the dotted field path of a store refusal, and echoes no value", async () => {
    const h = await harness(true);
    const res = await rawRequest(
      port(h),
      post(
        "/v1/content/create",
        draft("content_route_4", {
          steps: [
            {
              step_id: "s1",
              text: { "en-IN": "" },
              choices: [],
              next_step_id: null,
            },
          ],
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(firstPath(res)).toBe("steps.0.text.en-IN");
    expect(issues(res)[0]?.["kind"]).toBe("invalid_value");
  });

  it("refuses a draft over the route's step cap with too_big", async () => {
    const h = await harness(true);
    const steps = Array.from({ length: 7 }, (_, i) => ({
      step_id: `s${String(i)}`,
      text: { "en-IN": "A little bird sang." },
      choices: [],
      next_step_id: i === 6 ? null : `s${String(i + 1)}`,
    }));
    const res = await rawRequest(
      port(h),
      post("/v1/content/create", draft("content_route_5", { steps })),
    );
    expect(res.status).toBe(400);
    expect(issues(res)[0]).toEqual({ path: ["steps"], kind: "too_big" });
  });

  it("refuses an update whose patch names a forbidden key", async () => {
    const h = await harness(true);
    const res = await rawRequest(
      port(h),
      post("/v1/content/update", {
        content_id: "content_route_6",
        patch: { status: "active" },
      }),
    );
    expect(res.status).toBe(400);
    expect(issues(res)[0]).toEqual({ path: ["patch", "status"], kind: "unrecognized_keys" });
  });
});

describe("content routes: the Grandma writes", () => {
  it("records consent, lists it, and accepts it for a recording", async () => {
    const h = await harness(true);
    const consentId = await newConsent(h);
    expect(consentId.startsWith("cns_")).toBe(true);

    // Ids, closed enums and times only: no household and no user (Req 16.2, 21.4b).
    const listed = await rawRequest(port(h), { path: "/v1/grandma" });
    const consents = json(listed)["consents"] as Record<string, unknown>[];
    expect(consents).toHaveLength(1);
    expect(Object.keys(consents[0] ?? {}).sort()).toEqual([
      "consent_id",
      "given_at",
      "purpose",
      "verification_method",
      "version",
      "withdrawn_at",
    ]);
    expect(consents[0]?.["consent_id"]).toBe(consentId);

    const added = await rawRequest(
      port(h),
      post("/v1/grandma/recording", {
        consent_record_id: consentId,
        kind: "story",
        title: "Nani tells about the clever crow",
        lang: "en-IN",
        duration_s: 180,
      }),
    );
    expect(added.status).toBe(200);
    const recording = json(added)["recording"] as Record<string, unknown>;
    expect(Object.hasOwn(recording, "media_handle")).toBe(false);
    expect(added.body).not.toContain("mh_");

    const scheduled = await rawRequest(
      port(h),
      post("/v1/grandma/schedule", {
        asset_id: String(recording["asset_id"]),
        at: "19:30",
        enabled: true,
      }),
    );
    expect(scheduled.status).toBe(200);
    expect((json(scheduled)["recording"] as Record<string, unknown>)["schedule"]).toEqual({
      at: "19:30",
      enabled: true,
    });

    const after = await rawRequest(port(h), { path: "/v1/grandma" });
    const rows = json(after)["recordings"] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["consent_live"]).toBe(true);
    expect(after.body).not.toContain("mh_");
  });

  it("refuses a recording whose consent id names nothing, with the reason", async () => {
    const h = await harness(true);
    const res = await rawRequest(
      port(h),
      post("/v1/grandma/recording", {
        consent_record_id: "cns_nothing",
        kind: "story",
        title: "Nani tells a story",
        lang: "en-IN",
        duration_s: 60,
      }),
    );
    expect(res.status).toBe(400);
    expect(errorOf(res)["code"]).toBe("invalid_fields");
    expect(firstPath(res)).toBe("consent_record_id");
    expect(json(res)["reason"]).toBe("no_consent");
    expect(res.body).not.toContain("cns_nothing");
  });

  it("refuses a title the playback narration guard will not speak", async () => {
    const h = await harness(true);
    const consentId = await newConsent(h);
    const res = await rawRequest(
      port(h),
      post("/v1/grandma/recording", {
        consent_record_id: consentId,
        kind: "story",
        title: "Nani's doctor story",
        lang: "en-IN",
        duration_s: 60,
      }),
    );
    expect(res.status).toBe(400);
    expect(json(res)["reason"]).toBe("gate_refused");
    const gate = json(res)["gate"] as Record<string, unknown>;
    expect(typeof gate["rule"]).toBe("string");
    expect(typeof gate["age_stage"]).toBe("string");
    const after = await rawRequest(port(h), { path: "/v1/grandma" });
    expect(json(after)["recordings"]).toEqual([]);
  });

  it("refuses a malformed schedule time naming `at`", async () => {
    const h = await harness(true);
    const consentId = await newConsent(h);
    const added = await rawRequest(
      port(h),
      post("/v1/grandma/recording", {
        consent_record_id: consentId,
        kind: "lullaby",
        title: "Nani hums a sleepy tune",
        lang: "en-IN",
        duration_s: 120,
      }),
    );
    const assetId = String((json(added)["recording"] as Record<string, unknown>)["asset_id"]);
    const res = await rawRequest(
      port(h),
      post("/v1/grandma/schedule", { asset_id: assetId, at: "half past seven", enabled: true }),
    );
    expect(res.status).toBe(400);
    expect(firstPath(res)).toBe("at");
    expect(res.body).not.toContain("half past");
  });

  it("applies a legal call transition and refuses an illegal one with 409", async () => {
    const h = await harness(true);
    await h.online();
    const requested = await rawRequest(
      port(h),
      post("/v1/grandma/call", { device_id: HARNESS_DEVICE_ID, op: "request" }),
    );
    expect(requested.status).toBe(200);
    const call = json(requested)["call"] as Record<string, unknown>;
    expect(["requested", "ringing"]).toContain(call["state"]);

    const illegal = await rawRequest(
      port(h),
      post("/v1/grandma/call", { device_id: HARNESS_DEVICE_ID, op: "request" }),
    );
    expect(illegal.status).toBe(409);
    expect(json(illegal)).toEqual({ ok: false, error: { code: "invalid_transition" } });

    const badOp = await rawRequest(
      port(h),
      post("/v1/grandma/call", { device_id: HARNESS_DEVICE_ID, op: "shout" }),
    );
    expect(badOp.status).toBe(400);
    expect(firstPath(badOp)).toBe("op");
    expect(badOp.body).not.toContain("shout");

    const unknownDevice = await rawRequest(
      port(h),
      post("/v1/grandma/call", { device_id: "xlu_999999", op: "request" }),
    );
    expect(unknownDevice.status).toBe(400);
    expect(firstPath(unknownDevice)).toBe("device_id");
    expect(unknownDevice.body).not.toContain("xlu_999999");
  });
});

describe("content routes: the manual routine run", () => {
  it("answers the gate's counts, writes one routine_fired entry and sets no day mark", async () => {
    const h = await harness(true);
    await h.online();
    const res = await rawRequest(
      port(h),
      post("/v1/routines/run", { device_id: HARNESS_DEVICE_ID, routine: "morning" }),
    );
    expect(res.status).toBe(200);
    const body = json(res);
    expect(Object.keys(body).sort()).toEqual(["actions", "ok", "refusal", "refused", "sent"]);
    expect(body["actions"]).toBe(4);
    // Either the gate allowed every action, or it refused one with a Policy_Refusal — both are
    // the gate deciding, which is what this route proves (Req 16.7).
    expect(typeof body["sent"]).toBe("number");
    const fired = h.entries.filter((e) => e.kind === "routine_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ trigger: "manual", ref_id: "morning" });

    // No day mark: the routine is still reported as not fired today (Req 16.7).
    const routines = await rawRequest(port(h), { path: "/v1/routines" });
    const rows = json(routines)["routines"] as Record<string, unknown>[];
    expect(rows.find((row) => row["routine_id"] === "morning")?.["fired_today"]).toBe(false);
  });

  it("refuses an unknown routine id and an unknown device id, firing nothing", async () => {
    const h = await harness(true);
    await h.online();
    const unknownRoutine = await rawRequest(
      port(h),
      post("/v1/routines/run", { device_id: HARNESS_DEVICE_ID, routine: "teatime" }),
    );
    expect(unknownRoutine.status).toBe(400);
    expect(firstPath(unknownRoutine)).toBe("routine");
    expect(unknownRoutine.body).not.toContain("teatime");

    const unknownDevice = await rawRequest(
      port(h),
      post("/v1/routines/run", { device_id: "xlu_999999", routine: "morning" }),
    );
    expect(unknownDevice.status).toBe(400);
    expect(firstPath(unknownDevice)).toBe("device_id");
    expect(h.entries.filter((e) => e.kind === "routine_fired")).toHaveLength(0);
  });
});
