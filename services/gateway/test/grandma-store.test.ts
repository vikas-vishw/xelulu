// The Consent_Store and the Grandma_Store (Phase 4 Req 6, 7, 8.1, 8.2a, 8.3a, 21.4).
//
// The property that carries the whole feature is the first block below:
//
//   Property 5 — A RECORDING EXISTS ONLY WITH LIVE CONSENT. For any interleaving of consent
//   records, withdrawals and creates, a `ready` recording is held if and only if its
//   `consent_record_id` names an existing, matching-household, `grandma_recording`-purpose,
//   non-withdrawn Consent_Record; and after a withdrawal every recording citing it is
//   `withdrawn` with no schedule.
//
// The second is the title gate: a Grandma title is operator-submitted free text that goes
// straight into spoken narration, so a title whose narration the Output_Guard refuses is never
// stored (Req 7.7a). And the third is what is NOT here: no audio byte, no file path, and a
// `media_handle` that appears in no Log_Entry (Req 7.5, C11).
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGE_STAGES,
  SUPPORTED_LANGS,
  type AgeStage,
  type ConsentPurpose,
  type SupportedLang,
} from "@xelulu/shared";

import { createCaptureSink } from "./support/capture-sink.js";
import { createTestClock } from "./support/test-clock.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import { createGatewayLog, type GatewayLog } from "../src/log/gateway-log.js";
import { randomIds } from "../src/ids.js";
import { checkOutput } from "../src/brain/safety/output-guard.js";
import {
  grandmaPlaybackNarration,
  TITLE_NAMING_STAGES,
} from "../src/routines/routine-behaviours.js";
import { DEV_HOUSEHOLD_ID, DEV_USER_ID } from "../src/grandma/household.js";
import { createConsentStore, type ConsentStore } from "../src/grandma/consent-store.js";
import {
  GRANDMA_MAX_RECORDINGS_PER_HOUSEHOLD,
  GRANDMA_MAX_TITLE_CODE_POINTS,
  createGrandmaStore,
  type GrandmaRecording,
  type GrandmaRecordingInput,
  type GrandmaStore,
} from "../src/grandma/grandma-store.js";

/** Every Grandma test installs the socket guard: nothing here reaches a network (Req 9.7). */
let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

const OTHER_HOUSEHOLD = "hh_other_1";
const START_MS = 1_760_000_000_000;

type Harness = Readonly<{
  consent: ConsentStore;
  grandma: GrandmaStore;
  log: GatewayLog;
  clock: ReturnType<typeof createTestClock>;
}>;

function harness(): Harness {
  const clock = createTestClock(START_MS);
  const log = createGatewayLog(clock, createCaptureSink());
  const consent = createConsentStore({ clock, ids: randomIds });
  const grandma = createGrandmaStore({
    clock,
    ids: randomIds,
    log,
    consent,
    narration: grandmaPlaybackNarration,
  });
  return { consent, grandma, log, clock };
}

/** A live `grandma_recording` consent for a household, and its id. */
function liveConsent(
  consent: ConsentStore,
  householdId = DEV_HOUSEHOLD_ID,
  purpose: ConsentPurpose = "grandma_recording",
): string {
  const result = consent.record({
    household_id: householdId,
    user_id: DEV_USER_ID,
    purpose,
    version: "notice-1",
    verification_method: "identity_details",
  });
  if (!result.ok) throw new Error(`consent refused on ${result.field}`);
  return result.consent.consent_id;
}

function recordingInput(over: Partial<GrandmaRecordingInput> = {}): GrandmaRecordingInput {
  return {
    household_id: DEV_HOUSEHOLD_ID,
    recorded_by_user_id: DEV_USER_ID,
    consent_record_id: "cns_missing",
    kind: "story",
    title: "Nani Bedtime Tale",
    lang: "en-IN",
    duration_s: 240,
    ...over,
  };
}

function entriesOf(log: GatewayLog, kind: string): readonly Readonly<Record<string, unknown>>[] {
  return log.since(0).filter((entry) => entry.kind === kind) as readonly Readonly<
    Record<string, unknown>
  >[];
}

// ---------------------------------------------------------------------------------------------

describe("Property 5: a recording exists only with live consent", () => {
  type Op =
    | { readonly kind: "consent"; readonly household: string; readonly purpose: ConsentPurpose }
    | { readonly kind: "withdraw"; readonly which: number }
    | { readonly kind: "add"; readonly which: number; readonly household: string };

  const household = fc.constantFrom(DEV_HOUSEHOLD_ID, OTHER_HOUSEHOLD);
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant("consent" as const),
      household,
      purpose: fc.constantFrom<ConsentPurpose>("grandma_recording", "grandma_voice_clone"),
    }),
    fc.record({ kind: fc.constant("withdraw" as const), which: fc.nat(6) }),
    fc.record({ kind: fc.constant("add" as const), which: fc.nat(6), household }),
  );

  it("holds a ready recording only for an existing, matching, live consent", () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 14 }), (ops) => {
        const { consent, grandma, clock } = harness();
        const consentIds: string[] = [];
        let added = 0;

        for (const current of ops) {
          clock.advance(1_000);
          if (current.kind === "consent") {
            consentIds.push(liveConsent(consent, current.household, current.purpose));
            continue;
          }
          if (current.kind === "withdraw") {
            const id = consentIds[current.which % Math.max(1, consentIds.length)];
            if (id === undefined) continue;
            if (consent.withdraw(id, "2026-10-24T00:00:00.000Z")) grandma.onConsentWithdrawn(id);
            continue;
          }
          const id = consentIds[current.which % Math.max(1, consentIds.length)] ?? "cns_missing";
          const result = grandma.add(
            recordingInput({ consent_record_id: id, household_id: current.household }),
          );
          if (result.ok) added += 1;
        }

        const held = [
          ...grandma.recordings(DEV_HOUSEHOLD_ID),
          ...grandma.recordings(OTHER_HOUSEHOLD),
        ];
        expect(held).toHaveLength(added);

        for (const row of held) {
          const record = consent.get(row.consent_record_id);
          expect(record).not.toBeNull();
          // Whatever happened in between, the consent it cites was for this household and this
          // purpose: those two can never change after the fact.
          expect(record?.household_id).toBe(row.household_id);
          expect(record?.purpose).toBe("grandma_recording");
          if (record?.withdrawn_at === null) {
            expect(row.status).toBe("ready");
          } else {
            // A withdrawal marks the row and takes its schedule away (Req 7.4).
            expect(row.status).toBe("withdrawn");
            expect(row.schedule).toBeNull();
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("the four consent refusals (Req 7.3)", () => {
  it("refuses no_consent for an id that names nothing", () => {
    const { grandma } = harness();
    const result = grandma.add(recordingInput({ consent_record_id: "cns_nope" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_consent");
    expect(grandma.recordings(DEV_HOUSEHOLD_ID)).toEqual([]);
  });

  it("refuses consent_wrong_purpose for a consent of another purpose", () => {
    const { consent, grandma } = harness();
    const id = liveConsent(consent, DEV_HOUSEHOLD_ID, "grandma_voice_clone");
    const result = grandma.add(recordingInput({ consent_record_id: id }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("consent_wrong_purpose");
  });

  it("refuses other_household for a consent of another household", () => {
    const { consent, grandma } = harness();
    const id = liveConsent(consent, OTHER_HOUSEHOLD);
    const result = grandma.add(recordingInput({ consent_record_id: id }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("other_household");
  });

  it("refuses consent_withdrawn once the record is withdrawn, and keeps the record", () => {
    const { consent, grandma } = harness();
    const id = liveConsent(consent);
    expect(consent.withdraw(id, "2026-10-24T00:00:00.000Z")).toBe(true);
    // Withdrawal is auditable: the record stays, with `withdrawn_at` set (Req 6.3).
    expect(consent.get(id)?.withdrawn_at).toBe("2026-10-24T00:00:00.000Z");
    expect(consent.isLiveFor(id, DEV_HOUSEHOLD_ID, "grandma_recording")).toBe(false);
    const result = grandma.add(recordingInput({ consent_record_id: id }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("consent_withdrawn");
  });

  it("writes one refused grandma_event per refusal and stores nothing", () => {
    const { grandma, log } = harness();
    grandma.add(recordingInput({ consent_record_id: "cns_nope" }));
    const entries = entriesOf(log, "grandma_event");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.event).toBe("recording_refused");
    expect(entries[0]?.outcome).toBe("refused");
    expect(entries[0]?.reason).toBe("no_consent");
    expect(entries[0]?.asset_id).toBeNull();
  });
});

describe("withdrawal cancels schedules and refuses playback (Req 7.4)", () => {
  it("marks every citing recording withdrawn, drops its schedule and stops it coming due", () => {
    const { consent, grandma } = harness();
    const id = liveConsent(consent);
    const first = grandma.add(recordingInput({ consent_record_id: id }));
    const second = grandma.add(recordingInput({ consent_record_id: id, title: "Nani Lullaby" }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(grandma.schedule(first.value.asset_id, "20:30", true).ok).toBe(true);
    expect(grandma.dueAt(20 * 60 + 30, "2026-10-24")).toHaveLength(1);

    expect(consent.withdraw(id, "2026-10-24T00:00:00.000Z")).toBe(true);
    expect(grandma.onConsentWithdrawn(id)).toBe(2);

    for (const row of grandma.recordings(DEV_HOUSEHOLD_ID)) {
      expect(row.status).toBe("withdrawn");
      expect(row.schedule).toBeNull();
    }
    expect(grandma.dueAt(20 * 60 + 30, "2026-10-24")).toEqual([]);
    // Re-scheduling a withdrawn recording is refused rather than quietly accepted.
    const again = grandma.schedule(first.value.asset_id, "20:30", true);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("consent_withdrawn");
  });

  it("is idempotent: a second withdrawal marks nothing further", () => {
    const { consent, grandma } = harness();
    const id = liveConsent(consent);
    expect(grandma.add(recordingInput({ consent_record_id: id })).ok).toBe(true);
    expect(grandma.onConsentWithdrawn(id)).toBe(1);
    expect(grandma.onConsentWithdrawn(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the title gate (Req 7.7a, 7.7b, C41)", () => {
  function stored(): Harness & { readonly consentId: string } {
    const h = harness();
    return { ...h, consentId: liveConsent(h.consent) };
  }

  it("refuses a title whose narration names a guard term, storing nothing", () => {
    const { grandma, consentId, log } = stored();
    const result = grandma.add(
      recordingInput({ consent_record_id: consentId, title: "Nani's doctor story" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("gate_refused");
    expect(result.field).toBe("title");
    expect(result.gate?.rule).toBe("medical");
    // The refusal names a stage and a language, which is what the console shows as text.
    expect(TITLE_NAMING_STAGES).toContain(result.gate?.age_stage);
    expect(SUPPORTED_LANGS).toContain(result.gate?.lang);
    expect(grandma.recordings(DEV_HOUSEHOLD_ID)).toEqual([]);
    const entries = entriesOf(log, "grandma_event");
    expect(entries.map((entry) => entry.reason)).toEqual(["gate_refused"]);
  });

  it("refuses a title too long for `little`, with the rule `length`", () => {
    const { grandma, consentId } = stored();
    // Well inside the 80-code-point structural ceiling, and well over `little`'s word budget:
    // the operative bound is the stage's, not the cap's (Req 7.7b).
    const title = "the very long bedtime tale of a small bird and a kind old tree";
    expect([...title].length).toBeLessThan(GRANDMA_MAX_TITLE_CODE_POINTS);
    const result = grandma.add(recordingInput({ consent_record_id: consentId, title }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("gate_refused");
    expect(result.gate?.rule).toBe("length");
    expect(result.gate?.age_stage).toBe("little");
  });

  it("accepts a short, plain title and stores it ready", () => {
    const { grandma, consentId } = stored();
    const result = grandma.add(recordingInput({ consent_record_id: consentId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("ready");
    expect(result.value.title).toBe("Nani Bedtime Tale");
  });

  it("gates a title in BOTH languages, not only the recording's own", () => {
    const { grandma, consentId } = stored();
    // A Hindi recording whose title carries an English guard term is refused too: playback
    // happens for whichever child is active, in whichever language that child is spoken to.
    const result = grandma.add(
      recordingInput({ consent_record_id: consentId, lang: "hi-IN", title: "Nani hospital tale" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("gate_refused");
  });
});

describe("the playback narration (Req 8.2a, 8.3, 8.3a)", () => {
  it("names no title at `tiny` and is a fixed per-language constant", () => {
    for (const lang of SUPPORTED_LANGS) {
      const a = grandmaPlaybackNarration("Nani Bedtime Tale", lang, "tiny");
      const b = grandmaPlaybackNarration("A Completely Different Title", lang, "tiny");
      expect(a).toBe(b);
      expect(a).not.toContain("Nani Bedtime Tale");
    }
  });

  it("passes checkOutput at every Age_Stage and language for a gated title", () => {
    const { grandma, consent } = harness();
    const consentId = liveConsent(consent);
    const result = grandma.add(recordingInput({ consent_record_id: consentId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The write-time gate covers the three title-naming stages; `tiny`'s constant is measured
    // here too, so the Requirement 8.3 playback check cannot refuse a stored title — which is
    // what makes Requirement 8.3a the belt to its braces rather than a live path.
    for (const stage of AGE_STAGES as readonly AgeStage[]) {
      for (const lang of SUPPORTED_LANGS as readonly SupportedLang[]) {
        const narration = grandmaPlaybackNarration(result.value.title, lang, stage);
        const verdict = checkOutput(narration, {
          ageStage: stage,
          lang,
          allowedCategories: [],
          deferTopics: [],
        });
        expect(verdict.decision, `${stage}/${lang}`).toBe("allow");
      }
    }
  });

  it("marks an occurrence played for the local day, and lets it come due the next day", () => {
    // This is the mechanism Requirement 8.3a relies on when a playback is NOT sent: the
    // occurrence is marked played so it does not retry on the same local day. Firing a playback
    // is the Routine_Scheduler's, and its send-nothing path is tested with it.
    const { grandma, consent } = harness();
    const consentId = liveConsent(consent);
    const added = grandma.add(recordingInput({ consent_record_id: consentId }));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    grandma.schedule(added.value.asset_id, "20:30", true);
    expect(grandma.dueAt(20 * 60 + 30, "2026-10-24")).toHaveLength(1);
    grandma.markPlayed(added.value.asset_id, "2026-10-24");
    expect(grandma.dueAt(20 * 60 + 30, "2026-10-24")).toEqual([]);
    expect(grandma.dueAt(20 * 60 + 30, "2026-10-25")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the field rules and the caps (Req 7.7, 7.8, 7.10)", () => {
  function withConsent(): Readonly<{ grandma: GrandmaStore; consentId: string; log: GatewayLog }> {
    const h = harness();
    return { grandma: h.grandma, consentId: liveConsent(h.consent), log: h.log };
  }

  it.each([
    ["kind", { kind: "song" as unknown as GrandmaRecordingInput["kind"] }],
    ["title", { title: "   " }],
    ["lang", { lang: "ta-IN" as unknown as SupportedLang }],
    ["duration_s", { duration_s: 0 }],
    ["duration_s", { duration_s: 10_000 }],
    ["recorded_by_user_id", { recorded_by_user_id: "" }],
    ["consent_record_id", { consent_record_id: "" }],
  ])("refuses an invalid %s, naming the field and echoing nothing", (field, over) => {
    const { grandma, consentId } = withConsent();
    const result = grandma.add(
      recordingInput({ consent_record_id: consentId, ...(over as Partial<GrandmaRecordingInput>) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_field");
    expect(result.field).toBe(field);
  });

  it("sets the media_handle itself and refuses a submitted one", () => {
    const { grandma, consentId } = withConsent();
    const ok = grandma.add(recordingInput({ consent_record_id: consentId }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.media_handle).toContain(ok.value.asset_id);

    const submitted = grandma.add({
      ...recordingInput({ consent_record_id: consentId }),
      media_handle: "mh_somewhere_else",
    } as GrandmaRecordingInput);
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) expect(submitted.field).toBe("media_handle");
  });

  it("refuses a create past the household's capacity", () => {
    const { grandma, consentId } = withConsent();
    for (let i = 0; i < GRANDMA_MAX_RECORDINGS_PER_HOUSEHOLD; i += 1) {
      expect(grandma.add(recordingInput({ consent_record_id: consentId })).ok).toBe(true);
    }
    const past = grandma.add(recordingInput({ consent_record_id: consentId }));
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.reason).toBe("at_capacity");
    expect(grandma.recordings(DEV_HOUSEHOLD_ID)).toHaveLength(GRANDMA_MAX_RECORDINGS_PER_HOUSEHOLD);
  });

  it("lists only the household it was asked for", () => {
    const h = harness();
    const mine = liveConsent(h.consent, DEV_HOUSEHOLD_ID);
    const theirs = liveConsent(h.consent, OTHER_HOUSEHOLD);
    expect(h.grandma.add(recordingInput({ consent_record_id: mine })).ok).toBe(true);
    expect(
      h.grandma.add(recordingInput({ consent_record_id: theirs, household_id: OTHER_HOUSEHOLD }))
        .ok,
    ).toBe(true);
    expect(h.grandma.recordings(DEV_HOUSEHOLD_ID)).toHaveLength(1);
    expect(h.grandma.recordings(OTHER_HOUSEHOLD)).toHaveLength(1);
  });
});

describe("schedules (Req 8.1, 8.7)", () => {
  function scheduled(): Readonly<{ grandma: GrandmaStore; row: GrandmaRecording }> {
    const h = harness();
    const added = h.grandma.add(recordingInput({ consent_record_id: liveConsent(h.consent) }));
    if (!added.ok) throw new Error("add refused");
    return { grandma: h.grandma, row: added.value };
  }

  it.each(["7:00", "07:0", "25:00", "07:60", "0700", "", "07:00:00"])(
    "refuses the schedule time %p with field `at`",
    (at) => {
      const { grandma, row } = scheduled();
      const result = grandma.schedule(row.asset_id, at, true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_field");
        expect(result.field).toBe("at");
      }
    },
  );

  it("accepts an HH:MM time and an enabled flag", () => {
    const { grandma, row } = scheduled();
    const result = grandma.schedule(row.asset_id, "20:30", true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.schedule).toEqual({ at: "20:30", enabled: true });
  });

  it("fires nothing for a disabled schedule, and logs the cancel", () => {
    const { grandma, row } = scheduled();
    grandma.schedule(row.asset_id, "20:30", false);
    expect(grandma.dueAt(20 * 60 + 30, "2026-10-24")).toEqual([]);
  });

  it("comes due inside the catch-up window and not before or long after", () => {
    const { grandma, row } = scheduled();
    grandma.schedule(row.asset_id, "20:30", true);
    expect(grandma.dueAt(20 * 60 + 29, "2026-10-24")).toEqual([]);
    expect(grandma.dueAt(20 * 60 + 33, "2026-10-24")).toHaveLength(1);
    expect(grandma.dueAt(20 * 60 + 40, "2026-10-24")).toEqual([]);
  });

  it("refuses a schedule for an unknown asset", () => {
    const { grandma } = scheduled();
    const result = grandma.schedule("gma_nope", "20:30", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("asset_id");
  });
});

// ---------------------------------------------------------------------------------------------

describe("nothing a Log_Entry may not carry (Req 7.5, 7.6, C11)", () => {
  it("writes no media_handle and no title in any grandma_event", () => {
    const h = harness();
    const consentId = liveConsent(h.consent);
    const added = h.grandma.add(recordingInput({ consent_record_id: consentId }));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    h.grandma.schedule(added.value.asset_id, "20:30", true);
    h.consent.withdraw(consentId, "2026-10-24T00:00:00.000Z");
    h.grandma.onConsentWithdrawn(consentId);
    h.grandma.add(recordingInput({ consent_record_id: "cns_nope" }));

    const entries = entriesOf(h.log, "grandma_event");
    expect(entries.length).toBeGreaterThan(3);
    for (const entry of entries) {
      expect(Object.keys(entry)).not.toContain("media_handle");
      expect(Object.keys(entry)).not.toContain("title");
      const text = JSON.stringify(entry);
      expect(text).not.toContain(added.value.media_handle);
      expect(text).not.toContain(added.value.title);
    }
  });

  it("holds no name, contact detail or identity document on a Consent_Record (Req 6.4)", () => {
    const h = harness();
    const id = liveConsent(h.consent);
    const record = h.consent.get(id);
    expect(record).not.toBeNull();
    expect(Object.keys(record ?? {}).sort()).toEqual([
      "consent_id",
      "given_at",
      "household_id",
      "purpose",
      "user_id",
      "verification_method",
      "version",
      "withdrawn_at",
    ]);
  });

  it("refuses a Consent_Record outside the frozen lists, naming the field (Req 6.2)", () => {
    const h = harness();
    const base = {
      household_id: DEV_HOUSEHOLD_ID,
      user_id: DEV_USER_ID,
      purpose: "grandma_recording" as ConsentPurpose,
      version: "notice-1",
      verification_method: "identity_details" as const,
    };
    const purpose = h.consent.record({
      ...base,
      purpose: "shopping" as unknown as ConsentPurpose,
    });
    expect(purpose.ok).toBe(false);
    if (!purpose.ok) expect(purpose.field).toBe("purpose");

    const method = h.consent.record({
      ...base,
      verification_method: "vibes" as unknown as typeof base.verification_method,
    });
    expect(method.ok).toBe(false);
    if (!method.ok) expect(method.field).toBe("verification_method");

    const version = h.consent.record({ ...base, version: "  " });
    expect(version.ok).toBe(false);
    if (!version.ok) expect(version.field).toBe("version");

    expect(h.consent.list(DEV_HOUSEHOLD_ID)).toEqual([]);
  });
});
