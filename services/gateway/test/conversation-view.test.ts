// The Conversation_Turn_View and the retained-view log (Phase 3 Req 18.2–18.5, task 10.3).
// Two subjects, both pure or in-process: the view builder per turn phase, driven directly and
// then through the composed brain on the brain harness, and `conversation-log.ts`'s replace,
// cap and order. Example-based (C25 covers the properties elsewhere).
import { describe, expect, it } from "vitest";

import type { ConversationTurnView } from "@xelulu/shared";

import { createConversationView, type ViewSeed } from "../src/brain/state/conversation-view.js";
import { CONVERSATION_VIEW_CAP, createConversationLog } from "../src/operator/conversation-log.js";
import {
  brainHarness,
  createFakeTarget,
  DEVICE,
  llmSaying,
  runTurn,
  sttSaying,
  TURN_ID,
} from "./support/brain-harness.js";

const AT = "2026-10-20T10:00:00.000Z";

const CHILD_TEXT = "tell me about lions";
const REPLY_TEXT = "Lions live in the grassland.";
const HINDI_TEXT =
  "\u0936\u0947\u0930 \u0915\u0939\u093e\u0901 \u0930\u0939\u0924\u0947 \u0939\u0948\u0902";
/**
 * A text whose code-point count is below its UTF-16 length. The builder is handed text directly,
 * so the guards' readable-character rule does not apply to it and the pair can be measured here.
 */
const WIDE_TEXT = "a lion \u{1f642}";

function seed(overrides: Partial<ViewSeed> = {}): ViewSeed {
  return {
    turnId: TURN_ID,
    deviceId: DEVICE,
    at: AT,
    lang: "en-IN",
    ageStage: "little",
    includeText: true,
    ...overrides,
  };
}

function codePoints(text: string): number {
  return [...text].length;
}

/** A view with just enough fields to be distinguishable, for the conversation-log cases. */
function view(turnId: string, overrides: Partial<ConversationTurnView> = {}): ConversationTurnView {
  return {
    turn_id: turnId,
    device_id: DEVICE,
    at: AT,
    state: "listening",
    lang: "en-IN",
    age_stage: "little",
    input_decision: null,
    input_rule: null,
    input_topic: null,
    output_decision: null,
    output_rule: null,
    tools: [],
    latency_ms: null,
    filler_spoken: false,
    frames_out: 0,
    transcript_len: 0,
    reply_len: 0,
    transcript_text: null,
    reply_text: null,
    ...overrides,
  };
}

describe("the Conversation_Turn_View per phase", () => {
  it("starts in listening with the seed's ids, language and stage and nothing decided", () => {
    const builder = createConversationView(seed());

    expect(builder.state("listening")).toEqual(
      view(TURN_ID, { transcript_text: "", reply_text: "" }),
    );
  });

  it("carries the decisions, tools, timing and counts by the thinking phase", () => {
    const builder = createConversationView(seed());

    builder.transcript(CHILD_TEXT);
    builder.reply(REPLY_TEXT);
    builder.inputVerdict("allow", "none", null);
    builder.outputVerdict("allow", "none");
    builder.tool("content_lookup", "ok");
    builder.tool(null, "denied");
    const thinking = builder.state("thinking");

    expect(thinking).toMatchObject({
      state: "thinking",
      input_decision: "allow",
      input_rule: "none",
      input_topic: null,
      output_decision: "allow",
      output_rule: "none",
      tools: [
        { tool: "content_lookup", outcome: "ok" },
        { tool: null, outcome: "denied" },
      ],
      transcript_len: codePoints(CHILD_TEXT),
      reply_len: codePoints(REPLY_TEXT),
      transcript_text: CHILD_TEXT,
      reply_text: REPLY_TEXT,
    });
  });

  it("reaches speaking then done with the filler mark, the frame count and the latency", () => {
    const builder = createConversationView(seed());

    builder.latency(320);
    builder.fillerSpoken();
    builder.framesOut(44);

    expect(builder.state("speaking")).toMatchObject({
      state: "speaking",
      latency_ms: 320,
      filler_spoken: true,
      frames_out: 44,
    });
    expect(builder.state("done")).toMatchObject({ state: "done", frames_out: 44 });
  });

  it("reports interrupted and failed with whatever the turn had reached", () => {
    const builder = createConversationView(seed());

    builder.framesOut(3);
    expect(builder.state("interrupted")).toMatchObject({ state: "interrupted", frames_out: 3 });

    const failing = createConversationView(seed({ turnId: "t_failed" }));
    failing.inputVerdict("refuse", "uncertain", null);
    expect(failing.state("failed")).toMatchObject({
      turn_id: "t_failed",
      state: "failed",
      input_decision: "refuse",
      input_rule: "uncertain",
      latency_ms: null,
    });
  });

  it("follows the language and stage the pipeline resolved", () => {
    const builder = createConversationView(seed());

    builder.lang("hi-IN");
    builder.ageStage("maker");
    builder.transcript(HINDI_TEXT);

    expect(builder.state("thinking")).toMatchObject({
      lang: "hi-IN",
      age_stage: "maker",
      transcript_len: codePoints(HINDI_TEXT),
      transcript_text: HINDI_TEXT,
    });
  });

  it("fills the text fields only with includeText, and the lengths either way (Req 18.4, 18.5)", () => {
    for (const includeText of [true, false]) {
      const builder = createConversationView(seed({ includeText }));
      builder.transcript(HINDI_TEXT);
      builder.reply(REPLY_TEXT);
      const current = builder.state("done");

      expect(current.transcript_len).toBe(codePoints(HINDI_TEXT));
      expect(current.reply_len).toBe(codePoints(REPLY_TEXT));
      expect(current.transcript_text).toBe(includeText ? HINDI_TEXT : null);
      expect(current.reply_text).toBe(includeText ? REPLY_TEXT : null);
    }
  });

  it("counts code points, so a surrogate pair counts once", () => {
    const builder = createConversationView(seed());
    builder.transcript(WIDE_TEXT);

    expect(codePoints(WIDE_TEXT)).toBeLessThan(WIDE_TEXT.length);
    expect(builder.state("thinking").transcript_len).toBe(codePoints(WIDE_TEXT));
  });
});

describe("the view the composed brain emits", () => {
  it("runs listening to done, with the text under the toggle and the lengths without it", async () => {
    for (const includeTranscriptText of [true, false]) {
      const h = brainHarness({
        stt: sttSaying(CHILD_TEXT),
        llm: llmSaying(REPLY_TEXT),
        includeTranscriptText,
      });
      const target = createFakeTarget(h);
      await runTurn(h, target);

      expect(h.views.map((v) => v.state)).toEqual(["listening", "thinking", "speaking", "done"]);
      const last = h.views.at(-1);
      expect(last).toMatchObject({
        turn_id: TURN_ID,
        device_id: DEVICE,
        state: "done",
        lang: "en-IN",
        age_stage: "little",
        input_decision: "allow",
        output_decision: "allow",
        transcript_len: codePoints(CHILD_TEXT),
        reply_len: codePoints(REPLY_TEXT),
      });
      expect(last?.frames_out).toBeGreaterThan(0);
      expect(last?.latency_ms).not.toBeNull();
      expect(last?.transcript_text).toBe(includeTranscriptText ? CHILD_TEXT : null);
      expect(last?.reply_text).toBe(includeTranscriptText ? REPLY_TEXT : null);

      // Whatever the toggle says, the log carries neither text (safety.md §7, Omar ruling 1).
      const entries = JSON.stringify(h.entries());
      expect(entries).not.toContain(CHILD_TEXT);
      expect(entries).not.toContain(REPLY_TEXT);
    }
  });

  it("ends a stopped turn as interrupted", async () => {
    const h = brainHarness({ stt: sttSaying(CHILD_TEXT), llm: llmSaying(REPLY_TEXT) });
    const target = createFakeTarget(h);
    h.brain.respond(target);
    target.stop();

    expect(h.views.at(-1)?.state).toBe("interrupted");
  });
});

describe("the retained Conversation_Turn_Views", () => {
  it("appends new turns and returns them oldest first, as a copy", () => {
    const log = createConversationLog();
    log.record(view("t_1"));
    log.record(view("t_2"));

    expect(log.views().map((v) => v.turn_id)).toEqual(["t_1", "t_2"]);
    const taken = log.views();
    expect(taken).not.toBe(log.views());
    log.record(view("t_3"));
    expect(taken.map((v) => v.turn_id)).toEqual(["t_1", "t_2"]);
  });

  it("replaces a turn in place rather than appending it again", () => {
    const log = createConversationLog();
    log.record(view("t_1"));
    log.record(view("t_2", { state: "listening" }));
    log.record(view("t_1", { state: "done", frames_out: 44 }));

    expect(log.views().map((v) => [v.turn_id, v.state])).toEqual([
      ["t_1", "done"],
      ["t_2", "listening"],
    ]);
    expect(log.views()[0]?.frames_out).toBe(44);
  });

  it("drops the oldest past the cap", () => {
    const log = createConversationLog();
    const total = CONVERSATION_VIEW_CAP + 10;
    for (let i = 0; i < total; i += 1) log.record(view(`t_${String(i)}`));

    const ids = log.views().map((v) => v.turn_id);
    expect(ids).toHaveLength(CONVERSATION_VIEW_CAP);
    expect(ids[0]).toBe("t_10");
    expect(ids.at(-1)).toBe(`t_${String(total - 1)}`);
  });

  it("a replacement does not age a turn out of the cap", () => {
    const log = createConversationLog();
    for (let i = 0; i < CONVERSATION_VIEW_CAP; i += 1) log.record(view(`t_${String(i)}`));
    log.record(view("t_0", { state: "done" }));

    expect(log.views()).toHaveLength(CONVERSATION_VIEW_CAP);
    expect(log.views()[0]).toMatchObject({ turn_id: "t_0", state: "done" });
  });
});
