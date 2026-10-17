// Activity_Records and reports (Phase 4 Req 13.1, 13.7, 14, 21.7).
//
// This file is where all six Activity_Record kinds are shown together, because that is what a
// report reads. Each kind has exactly one writer, named in the design's record-source table, and
// each writer is exercised here through the real path rather than by calling the store:
//
//   turn, word, story (the turn path)  — the Voice_Brain, over the real pipeline and guards
//   story (a Grandma playback), routine — the Routine_Scheduler, over the real policy gate
//   play                               — `accruePlay`, its ONLY writer (Req 13.1)
//   cry                                — the Parent_Alerts' cry path
//
// What the report may be is as much the point as what it counts (C20, safety.md §2): counts and
// a de-duplicated category list, computed only when asked, cached nowhere, carrying no transcript,
// no reply text, no title, no score, no rank, no average and no prediction. The DPDP s.9 review
// of parent-facing reports stays OPEN (F2); nothing here claims it closed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStarterContent,
  reportWindow,
  summariseActivity,
  type ActivityRecord,
  type ContentItem,
  type ReportSummary,
} from "@xelulu/shared";

import { isoAt } from "../src/clock.js";
import { WORD_OF_THE_DAY_CATEGORY } from "../src/brain/tools/content-library.js";
import { createReports, type Reports } from "../src/reports/report-builder.js";
import type { LlmProvider } from "../src/brain/providers/llm-provider.js";
import { NO_RETENTION_NO_TRAINING } from "../src/brain/providers/provider-declaration.js";
import {
  brainHarness,
  createFakeTarget,
  runTurn,
  sttSaying,
  type BrainHarness,
} from "./support/brain-harness.js";
import { installNoRemoteSockets, type SocketGuard } from "./support/no-remote-sockets.js";
import type { TestClock } from "./support/test-clock.js";
// The brain harness and the routine stack name the same single device, so one import serves both.
import {
  atLocal,
  createRoutineStack,
  DEVICE,
  seedRecording,
  type RoutineStack,
} from "./support/routine-stack.js";

let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

/** The six fields an Activity_Record carries, and the seventh it must never grow (Req 14.1). */
const RECORD_FIELDS = [
  "activity_id",
  "at",
  "categories",
  "device_id",
  "kind",
  "minutes",
  "ref_id",
] as const;

/** The nine members of a Report_Summary: the window plus eight counts, no tenth (Req 14.4). */
const SUMMARY_FIELDS = [
  "categories_heard",
  "cry_moments",
  "play_minutes",
  "play_sessions",
  "routines_completed",
  "stories_heard",
  "turns",
  "window",
  "words_learned",
] as const;

/** A linear retelling for the two narrow stages, in both languages: four plain steps. */
const LINEAR = "story_panchatantra_drum";

const SEEDED: readonly ContentItem[] = createStarterContent();

function seeded(contentId: string): ContentItem {
  const item = SEEDED.find((entry) => entry.content_id === contentId);
  if (item === undefined) throw new Error(`no seeded item ${contentId}`);
  return item;
}

/** An LLM that asks for the day's word on its first call, as a model would. */
function llmAskingForTheWord(): LlmProvider {
  let first = true;
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    reply: () => {
      const requests = first
        ? [{ name: "content_lookup", args: { word_of_the_day: true } } as const]
        : [];
      first = false;
      return Promise.resolve({ ok: true, text: "A model sentence.", toolRequests: requests });
    },
  };
}

function recordsOf(h: BrainHarness, kind: ActivityRecord["kind"]): readonly ActivityRecord[] {
  return h.activity.records(DEVICE).filter((row) => row.kind === kind);
}

/** One whole turn of `h`, with its own turn id and its `audio_start` at the Clock's now. */
async function oneTurn(h: BrainHarness, turnId: string): Promise<void> {
  await runTurn(h, createFakeTarget(h, DEVICE, turnId, h.clock.now()));
}

function reportsOver(stack: RoutineStack): Reports {
  return createReports({ clock: stack.clock, log: stack.log, activity: stack.activity });
}

/**
 * A report's window ends AT the requested instant and excludes it (Req 14.8, 14.9), so a report
 * asked for in the very millisecond a record was written does not count that record — it belongs
 * to the next window. A real request always arrives after the thing it reports on; one second of
 * Clock time stands in for that gap and is what keeps the counts below non-vacuous.
 */
function aMomentLater(clock: TestClock): void {
  clock.set(clock.now() + 1_000);
}

// ---------------------------------------------------------------------------------------------
// The record each path appends (Req 14.1, 14.2, 14.3, 13.1)

describe("the turn path's records (Req 14.1, 13.1)", () => {
  it("appends one turn record and one play record for a turn that was answered", async () => {
    const h = brainHarness();
    const start = h.clock.now();
    await oneTurn(h, "t_1");

    expect(recordsOf(h, "turn")).toHaveLength(1);
    expect(recordsOf(h, "turn")[0]).toMatchObject({
      device_id: DEVICE,
      ref_id: null,
      minutes: null,
      categories: [],
    });
    // A turn shorter than a minute still counts as one (Req 13.1).
    expect(recordsOf(h, "play")[0]).toMatchObject({ ref_id: null, minutes: 1, categories: [] });
    expect(h.clock.now() - start).toBeLessThan(60_000);
    // `accruePlay` is the one writer of both, so the ledger moved with the record.
    expect(recordsOf(h, "play")).toHaveLength(1);
    expect(h.naps()).toBe(0);
  });

  it("appends nothing at all for a turn that spoke a Safe_Redirect", async () => {
    // `maths` is outside this child's allowed categories, so the Input_Guard refuses the turn
    // and the Safe_Redirect is spoken instead of an answer.
    const h = brainHarness({ stt: sttSaying("can you count to ten with me") });
    await oneTurn(h, "t_refused");

    const refusal = h
      .entries()
      .find((entry) => entry.kind === "safety_decision" && entry.stage === "input");
    expect(refusal).toMatchObject({ decision: "refuse", rule: "blocked_category" });
    expect(h.activity.records(DEVICE)).toEqual([]);
    expect(h.activity.count()).toBe(0);
  });

  it("appends a story record only where the session reached a terminal step (Req 3.7)", async () => {
    const item = seeded(LINEAR);
    const h = brainHarness({ stt: sttSaying("yes please") });
    h.stack.stories.start({ deviceId: DEVICE, turnId: "t_open", item, lang: "en-IN" });

    // One turn per step: the last one finds a step with no choices and no `next_step_id`.
    for (let i = 0; i < item.steps.length; i += 1) await oneTurn(h, `t_step_${String(i)}`);

    const stories = recordsOf(h, "story");
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({
      ref_id: item.content_id,
      minutes: null,
      categories: item.categories,
    });
    // Every turn before it spoke a step and counted as a turn, and none counted as a listen.
    expect(recordsOf(h, "turn")).toHaveLength(item.steps.length);
    expect(h.stack.stories.inProgress(DEVICE)).toBe(false);
  });

  it("appends a word record for a turn whose spoken text was the word narration (Req 5.7)", async () => {
    const h = brainHarness({
      stt: sttSaying("what is the word today"),
      llm: llmAskingForTheWord(),
      // `world` is gated like every other category on both paths (Req 5.3a, C38), so the day's
      // word is only resolved for a child whose parent opened it.
      context: {
        allowedCategories: [
          "stories",
          "songs",
          "animals",
          WORD_OF_THE_DAY_CATEGORY,
          "games",
          "feelings",
          "manners",
        ],
      },
    });
    await oneTurn(h, "t_word");

    const words = recordsOf(h, "word");
    expect(words).toHaveLength(1);
    expect(words[0]?.ref_id).not.toBeNull();
    expect(words[0]).toMatchObject({
      minutes: null,
      categories: [WORD_OF_THE_DAY_CATEGORY],
    });
    expect(recordsOf(h, "turn")).toHaveLength(1);
  });
});

describe("the cry path's record (Req 14.1, 14.3)", () => {
  it("appends one cry record in the feelings category, carrying no number", () => {
    const h = brainHarness();
    h.alerts.raiseCryAlert({ deviceId: DEVICE, confidence: 0.82, durationS: 7 });

    const cries = recordsOf(h, "cry");
    expect(cries).toHaveLength(1);
    expect(cries[0]).toMatchObject({
      device_id: DEVICE,
      ref_id: null,
      minutes: null,
      categories: ["feelings"],
    });
    // The confidence and the duration stay on the Parent_Alert; the record counts the moment.
    expect(JSON.stringify(cries[0])).not.toContain("0.82");
    expect(h.alerts.parentAlerts()).toHaveLength(1);
  });
});

describe("the scheduled paths' records (Req 10.7, 8.6, 13.1)", () => {
  it("appends a routine record and a word record for a morning firing", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    stack.scheduler.run(DEVICE, "morning", "manual");

    const kinds = stack.activity.records(DEVICE).map((row) => row.kind);
    expect(kinds).toEqual(["routine", "word", "play"]);
    expect(stack.activity.records(DEVICE)[0]).toMatchObject({
      kind: "routine",
      ref_id: "morning",
      minutes: null,
      categories: [],
    });
    expect(stack.activity.records(DEVICE)[2]).toMatchObject({ kind: "play", minutes: 1 });
  });

  it("appends a story record for a Grandma playback, in the stories category", () => {
    const stack = createRoutineStack({ startMs: atLocal(14, 59) });
    const assetId = seedRecording(stack, "15:00", { durationS: 150 });
    stack.scheduler.start();
    stack.tickTo(atLocal(15, 0));
    stack.scheduler.stop();

    const story = stack.activity.records(DEVICE).find((row) => row.kind === "story");
    expect(story).toMatchObject({ ref_id: assetId, minutes: null, categories: ["stories"] });
    // 150 s of recording rounds up to three play minutes (Req 13.1).
    expect(stack.routines.playMinutesUsed(DEVICE)).toBe(3);
  });
});

describe("no Activity_Record carries text, a name or an audio value (Req 14.3)", () => {
  it("holds exactly the six fields, whichever path wrote the record", async () => {
    const h = brainHarness({ stt: sttSaying("yes please") });
    h.stack.stories.start({
      deviceId: DEVICE,
      turnId: "t_open",
      item: seeded(LINEAR),
      lang: "en-IN",
    });
    for (let i = 0; i < seeded(LINEAR).steps.length; i += 1) await oneTurn(h, `t_${String(i)}`);
    h.alerts.raiseCryAlert({ deviceId: DEVICE, confidence: 0.4, durationS: 6 });

    const records = h.activity.records(DEVICE);
    expect(records.length).toBeGreaterThan(4);
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual([...RECORD_FIELDS]);
      for (const category of record.categories) expect(typeof category).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The report (Req 14.4, 14.6, 14.7, 14.9, 21.7)

describe("build is the shared arithmetic over the period's window (Req 14.4, 14.9, C21)", () => {
  it("answers exactly summariseActivity over reportWindow, for both periods", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    stack.scheduler.run(DEVICE, "morning", "manual");
    stack.play.accruePlay(DEVICE, 4, "turn", null);
    const reports = reportsOver(stack);
    aMomentLater(stack.clock);

    for (const period of ["daily", "weekly"] as const) {
      const expected = summariseActivity(
        stack.activity.records(DEVICE),
        reportWindow(period, isoAt(stack.clock.now())),
      );
      const summary = reports.build(DEVICE, period);
      expect(summary).toEqual(expected);
      // Non-vacuous: the firing and the accrual are both inside both windows.
      expect(summary).toMatchObject({ routines_completed: 1, words_learned: 1, play_minutes: 5 });
    }
  });

  it("counts the day's records for daily and the week's for weekly", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    const now = stack.clock.now();
    // Three turns: one an hour ago, one 25 hours ago, one eight days ago.
    for (const hoursAgo of [1, 25, 8 * 24]) {
      stack.activity.add({
        device_id: DEVICE,
        kind: "turn",
        at: isoAt(now - hoursAgo * 3_600_000),
        ref_id: null,
        minutes: null,
        categories: [],
      });
    }
    const reports = reportsOver(stack);

    expect(reports.build(DEVICE, "daily").turns).toBe(1);
    expect(reports.build(DEVICE, "weekly").turns).toBe(2);
  });

  it("reads only the device asked for", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    stack.play.accruePlay(DEVICE, 3, "turn", null);
    stack.play.accruePlay("xlu_other", 9, "turn", null);
    const reports = reportsOver(stack);
    aMomentLater(stack.clock);

    expect(reports.build(DEVICE, "daily").play_minutes).toBe(3);
  });

  it("carries the window plus the eight counts and no tenth member (Req 14.4, 14.5)", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    const summary: ReportSummary = reportsOver(stack).build(DEVICE, "daily");

    expect(Object.keys(summary).sort()).toEqual([...SUMMARY_FIELDS]);
    expect(Object.keys(summary.window).sort()).toEqual(["from", "to"]);
    // No score, no rank, no average, no prediction, no trait and no free text (C20).
    for (const name of ["score", "rank", "average", "trend", "prediction", "favourite", "mood"]) {
      expect(Object.keys(summary)).not.toContain(name);
    }
  });
});

describe("a report is computed on request and cached nowhere (Req 14.6, 14.7, C20)", () => {
  it("writes one report_built entry per request, with the counts and the window length", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    stack.scheduler.run(DEVICE, "morning", "manual");
    const reports = reportsOver(stack);
    aMomentLater(stack.clock);

    const summary = reports.build(DEVICE, "weekly");
    const built = stack.entriesOf("report_built");
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({
      device_id: DEVICE,
      period: "weekly",
      window_days: 7,
      turns: summary.turns,
      play_minutes: 1,
      routines_completed: 1,
      stories_heard: 0,
      words_learned: 1,
      cry_moments: 0,
      // The SIZE of the category list, never the list: an entry names nothing a child heard.
      categories: summary.categories_heard.length,
    });
    expect(Object.keys(built[0] ?? {})).not.toContain("categories_heard");

    reports.build(DEVICE, "daily");
    expect(stack.entriesOf("report_built")).toHaveLength(2);
    expect(stack.entriesOf("report_built")[1]).toMatchObject({ period: "daily", window_days: 1 });
  });

  it("re-reads the records every time, so a new record shows in the next report", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    const reports = reportsOver(stack);

    expect(reports.build(DEVICE, "daily")).toMatchObject({ play_sessions: 0, play_minutes: 0 });
    stack.play.accruePlay(DEVICE, 7, "turn", null);
    aMomentLater(stack.clock);
    expect(reports.build(DEVICE, "daily")).toMatchObject({ play_sessions: 1, play_minutes: 7 });
  });

  it("computes nothing until it is asked", () => {
    const stack = createRoutineStack({ startMs: atLocal(12, 0) });
    reportsOver(stack);
    stack.scheduler.run(DEVICE, "morning", "manual");
    // Building the Reports object, and then a firing, write no `report_built` entry at all.
    expect(stack.entriesOf("report_built")).toEqual([]);
  });
});

describe("a report carries no child's words (Req 14.3, 14.5, safety.md §7)", () => {
  it("names nothing a child said or a model answered, in the summary or the entry", async () => {
    const sentinel = "zqfrog";
    const h = brainHarness({ stt: sttSaying(`tell me about ${sentinel} lions`) });
    await oneTurn(h, "t_sentinel");
    const reports = createReports({ clock: h.clock, log: h.log, activity: h.activity });
    aMomentLater(h.clock);

    const summary = reports.build(DEVICE, "daily");
    expect(summary.turns).toBe(1);
    expect(JSON.stringify(summary)).not.toContain(sentinel);
    const built = h.entries().filter((entry) => entry.kind === "report_built");
    expect(built).toHaveLength(1);
    expect(JSON.stringify(built)).not.toContain(sentinel);
    // The child's words live in the Transcript_Store and nowhere else (Omar ruling 1).
    expect(JSON.stringify(h.activity.records(DEVICE))).not.toContain(sentinel);
  });
});
