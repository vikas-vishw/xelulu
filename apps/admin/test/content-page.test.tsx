// @vitest-environment jsdom
// The Content page through the console shell (Req 17.1–17.6, 17.8): App on `#/content` with a
// fake content client, so each read and write runs page → client seam exactly as in the browser.
// Smoke plus key interaction only: the table, the section filter, a gate refusal and a field
// refusal shown as text, the Grandma section's consent list and its labelled add-consent control
// with the "not verifiable parental consent" helper text, and no write control when writes are off.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContentItem } from "@xelulu/shared";

import { App } from "../src/app";
import { CONSENT_HELPER_TEXT } from "../src/components/grandma-list";
import type {
  ClientRefusal,
  ClientResult,
  ContentClient,
  ContentListBody,
  ContentSummaryView,
  GrandmaBody,
  ReportsBody,
  RoutinesBody,
  WriteBody,
} from "../src/content/content-client";
import { WRITES_OFF_TEXT } from "../src/pages/content-page";

import { fakeSources } from "./support/fake-event-source";

function item(over: Partial<ContentSummaryView> = {}): ContentSummaryView {
  return {
    content_id: "content_1",
    household_id: null,
    kind: "story",
    title: "The monkey and the drum",
    languages: ["en-IN"],
    age_stages: ["explorer"],
    categories: ["stories"],
    status: "active",
    licence_note: "Original retelling written for Xelulu.",
    source: "panchatantra",
    created_at: "2026-10-20T10:00:00.000Z",
    updated_at: "2026-10-20T10:00:00.000Z",
    step_count: 4,
    verdict: { ok: true },
    ...over,
  };
}

const SONG = item({
  content_id: "content_song",
  kind: "song",
  title: "Rain on the roof",
  categories: ["songs"],
  status: "draft",
  verdict: {
    ok: false,
    rule: "length",
    age_stage: "tiny",
    lang: "en-IN",
    step_id: "s2",
    field: "speech",
  },
});

const SUMMARY: ReportsBody["daily"] = {
  window: { from: "2026-10-19T10:00:00.000Z", to: "2026-10-20T10:00:00.000Z" },
  turns: 2,
  play_minutes: 7,
  play_sessions: 2,
  routines_completed: 1,
  stories_heard: 1,
  words_learned: 1,
  cry_moments: 0,
  categories_heard: ["stories"],
};

type Stub = Readonly<{
  client: ContentClient;
  writes: string[];
}>;

/** A fake client. Every read answers at once; every write records its name and answers `answer`. */
function stubClient(
  opts: Readonly<{
    writeEnabled?: boolean;
    items?: readonly ContentSummaryView[];
    grandma?: Partial<GrandmaBody>;
    answer?: ClientResult<WriteBody>;
  }> = {},
): Stub {
  const writeEnabled = opts.writeEnabled ?? true;
  const writes: string[] = [];
  const answer: ClientResult<WriteBody> = opts.answer ?? { ok: true, value: {} };

  const content: ContentListBody = {
    items: opts.items ?? [item(), SONG],
    write_enabled: writeEnabled,
  };
  const grandma: GrandmaBody = {
    recordings: [],
    consents: [
      {
        consent_id: "cns_dev_1",
        purpose: "grandma_recording",
        version: "dev-notice-1",
        verification_method: "identity_details",
        given_at: "2026-10-20T09:00:00.000Z",
        withdrawn_at: null,
      },
    ],
    call: null,
    write_enabled: writeEnabled,
    ...opts.grandma,
  };
  const routines: RoutinesBody = {
    routines: [
      {
        routine_id: "morning",
        name: "morning",
        at: "07:00",
        enabled: true,
        behaviour: "morning",
        actions: 4,
        fired_today: false,
      },
    ],
    play_minutes_used: 7,
    write_enabled: writeEnabled,
  };
  const reports: ReportsBody = {
    daily: SUMMARY,
    weekly: SUMMARY,
    write_enabled: writeEnabled,
  };

  function write(name: string): Promise<ClientResult<WriteBody>> {
    writes.push(name);
    return Promise.resolve(answer);
  }

  const client: ContentClient = {
    content: () => Promise.resolve({ ok: true, value: content }),
    contentItem: (contentId) => {
      const summary = item({ content_id: contentId });
      const full: ContentItem = {
        content_id: summary.content_id,
        household_id: null,
        kind: summary.kind,
        title: summary.title,
        languages: [...summary.languages],
        age_stages: [...summary.age_stages],
        categories: [...summary.categories],
        status: summary.status,
        licence_note: summary.licence_note,
        source: "panchatantra",
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        steps: [
          {
            step_id: "s1",
            text: { "en-IN": "A drum rolled by." },
            choices: [],
            next_step_id: null,
          },
        ],
      };
      return Promise.resolve({
        ok: true,
        value: { item: full, verdict: { ok: true }, write_enabled: writeEnabled },
      });
    },
    grandma: () => Promise.resolve({ ok: true, value: grandma }),
    routines: () => Promise.resolve({ ok: true, value: routines }),
    reports: () => Promise.resolve({ ok: true, value: reports }),
    createContent: () => write("createContent"),
    updateContent: () => write("updateContent"),
    setStatus: () => write("setStatus"),
    addConsent: () => write("addConsent"),
    addRecording: () => write("addRecording"),
    scheduleRecording: () => write("scheduleRecording"),
    call: () => write("call"),
    runRoutine: () => write("runRoutine"),
  };
  return { client, writes };
}

function renderContent(stub: Stub) {
  const fake = fakeSources();
  render(<App createSource={fake.createSource} contentClient={stub.client} />);
  return fake;
}

/** Picks a section in the page's labelled filter. */
function selectSection(section: string): void {
  fireEvent.change(screen.getByLabelText("Section"), { target: { value: section } });
}

describe("Content page", () => {
  beforeEach(() => {
    window.location.hash = "#/content";
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("lists the chosen section's items with their status and gate verdict", async () => {
    renderContent(stubClient());
    expect(await screen.findByRole("heading", { name: "Content and AI", level: 2 })).toBeTruthy();

    const table = await screen.findByRole("table", { name: "Stories" });
    const rows = within(table).getAllByRole("row");
    // The header row plus the one `story` item: the song belongs to another section.
    expect(rows).toHaveLength(2);
    expect(within(table).getByText("The monkey and the drum")).toBeTruthy();
    expect(within(table).getByText("Active")).toBeTruthy();
    expect(within(table).getByText("Passed")).toBeTruthy();
    expect(within(table).queryByText("Rain on the roof")).toBeNull();
  });

  it("switches section and shows the refused draft's verdict as text", async () => {
    renderContent(stubClient());
    await screen.findByRole("table", { name: "Stories" });

    selectSection("Songs");
    const table = await screen.findByRole("table", { name: "Songs" });
    expect(within(table).getByText("Rain on the roof")).toBeTruthy();
    expect(within(table).getByText("Draft")).toBeTruthy();
    expect(within(table).getByText("Refused: length at tiny en-IN (speech)")).toBeTruthy();
  });

  it("shows the Grandma consent list and the add-consent control with its helper text", async () => {
    const stub = stubClient();
    renderContent(stub);
    await screen.findByRole("table", { name: "Stories" });

    selectSection("Grandma");
    const consents = await screen.findByRole("table", { name: "Consent records" });
    expect(within(consents).getByText("cns_dev_1")).toBeTruthy();
    expect(screen.getByText(CONSENT_HELPER_TEXT)).toBeTruthy();
    expect(CONSENT_HELPER_TEXT).toContain("not verifiable parental consent");

    fireEvent.click(screen.getByRole("button", { name: "Record development consent" }));
    expect(stub.writes).toEqual(["addConsent"]);
    expect(await screen.findByText("Consent record created.")).toBeTruthy();
  });

  it("shows a field refusal's path as text and treats nothing as written", async () => {
    const refusal: ClientRefusal = {
      code: "invalid_fields",
      field: "steps.2.text.hi-IN",
      reason: null,
      verdict: null,
      gate: null,
    };
    renderContent(stubClient({ answer: { ok: false, refusal } }));
    await screen.findByRole("table", { name: "Stories" });

    fireEvent.click(screen.getByRole("button", { name: /Withdraw The monkey/ }));
    expect(
      await screen.findByText("Refused: invalid_fields · field steps.2.text.hi-IN"),
    ).toBeTruthy();
    expect(screen.queryByText(/set to/)).toBeNull();
  });

  it("shows proxy_disabled when a write answers with something that is not JSON", async () => {
    const refusal: ClientRefusal = {
      code: "proxy_disabled",
      field: null,
      reason: null,
      verdict: null,
      gate: null,
    };
    renderContent(stubClient({ answer: { ok: false, refusal } }));
    await screen.findByRole("table", { name: "Stories" });

    fireEvent.click(screen.getByRole("button", { name: /Withdraw The monkey/ }));
    expect(await screen.findByText("Refused: proxy_disabled")).toBeTruthy();
  });

  it("renders no write control and says writes are off when write_enabled is false", async () => {
    renderContent(stubClient({ writeEnabled: false }));
    await screen.findByRole("table", { name: "Stories" });

    expect(screen.getByText(WRITES_OFF_TEXT)).toBeTruthy();
    expect(WRITES_OFF_TEXT).toContain("--content-admin");
    expect(screen.queryByRole("button", { name: /Activate/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();

    selectSection("Grandma");
    await screen.findByRole("table", { name: "Consent records" });
    expect(screen.queryByRole("button", { name: "Record development consent" })).toBeNull();
    expect(screen.queryByText(CONSENT_HELPER_TEXT)).toBeNull();
  });

  it("opens one item in the editor and saves it as a draft", async () => {
    const stub = stubClient();
    renderContent(stub);
    await screen.findByRole("table", { name: "Stories" });

    fireEvent.click(screen.getByRole("button", { name: /Edit The monkey/ }));
    expect(await screen.findByRole("heading", { name: /Edit The monkey/, level: 3 })).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(stub.writes).toEqual(["updateContent"]);
    expect(await screen.findByText("Draft updated.")).toBeTruthy();
  });

  it("shows the routine rows and the report counts from the two reads", async () => {
    renderContent(stubClient());
    const routines = await screen.findByRole("table", { name: "Today" });
    expect(within(routines).getByText("morning")).toBeTruthy();
    expect(within(routines).getByText("07:00")).toBeTruthy();
    expect(screen.getByText("Play minutes used today: 7")).toBeTruthy();
    expect(screen.getByText("Turns today")).toBeTruthy();
    expect(screen.getByText(/summaries a parent asks for/)).toBeTruthy();
  });
});
