// Test helper (not a test): a Voice_Brain with a fake ReplyTarget, so the filler, latency and
// retention tests can drive a whole turn without a socket. Every delay runs on the real
// Deadlines over the manual test Clock, so a test advances time rather than waiting.
import { createCaptureSink } from "./capture-sink.js";
import { createContentStack } from "./content-stack.js";
import { createTestClock, type TestClock } from "./test-clock.js";
import { createGatewayLog, type GatewayLog } from "../../src/log/gateway-log.js";
import { createDeadlines, type Deadlines } from "../../src/deadlines.js";
import { createVoiceBrain, type VoiceBrain } from "../../src/brain/voice-brain.js";
import { createAlerts, type Alerts } from "../../src/brain/state/alerts.js";
import {
  createTranscriptStore,
  type TranscriptStore,
} from "../../src/brain/state/transcript-store.js";
import { createMemoryStore } from "../../src/brain/state/memory-store.js";
import {
  MOST_RESTRICTIVE_CONTEXT,
  type ChildContext,
  type ChildContextTable,
} from "../../src/brain/state/child-context.js";
import { createRoutines } from "../../src/brain/tools/routines.js";
import { createDeviceActions } from "../../src/brain/tools/device-action.js";
import { createToolRouter } from "../../src/brain/tools/tool-router.js";
import { NO_FILLER, type FillerAudio } from "../../src/brain/filler.js";
import { NO_RETENTION_NO_TRAINING } from "../../src/brain/providers/provider-declaration.js";
import type { LlmProvider } from "../../src/brain/providers/llm-provider.js";
import type { SttProvider, SttSession } from "../../src/brain/providers/stt-provider.js";
import type { TtsProvider } from "../../src/brain/providers/tts-provider.js";
import type { ReplyTarget, ReplyRefusal } from "../../src/brain/turn-responder.js";
import { randomIds } from "../../src/ids.js";
import type { ConversationTurnView, GatewayLogEntry, SupportedLang } from "@xelulu/shared";

export const DEVICE = "xlu_000123";
export const TURN_ID = "t_brain";

/** A ReplyTarget that records what the brain did instead of writing to a socket. */
export interface FakeTarget extends ReplyTarget {
  readonly frames: Uint8Array[];
  finished(): boolean;
  aborted(): ReplyRefusal | null;
  /** Stops the turn, as a client close or barge-in would. */
  stop(): void;
}

/**
 * A target for one turn of `h`. It opens the turn's Stt_Session through the brain, exactly as the
 * Audio_Server does, and carries it on the target: that is how the real path hands the session to
 * `respond`, and a target without one would transcribe nothing.
 */
export function createFakeTarget(
  h: Pick<BrainHarness, "brain">,
  deviceId = DEVICE,
  turnId = TURN_ID,
): FakeTarget {
  const stt = h.brain.openStt(deviceId, turnId);
  const frames: Uint8Array[] = [];
  const onStop: (() => void)[] = [];
  let stopped = false;
  let finished = false;
  let aborted: ReplyRefusal | null = null;

  const fire = (): void => {
    stopped = true;
    for (const fn of onStop.splice(0)) fn();
  };

  return {
    deviceId,
    turnId,
    stt,
    frames,
    sendFrame(frame) {
      if (stopped) return false;
      frames.push(frame);
      return true;
    },
    finish() {
      finished = true;
      fire();
    },
    abort(cause) {
      aborted = cause;
      fire();
    },
    signal: {
      get stopped() {
        return stopped;
      },
      onStop(fn) {
        if (stopped) fn();
        else onStop.push(fn);
      },
    },
    finished: () => finished,
    aborted: () => aborted,
    stop: fire,
  };
}

/** An STT that transcribes a fixed text and reports what it still holds. */
export function sttSaying(text: string, lang = "en-IN", bytes = 0): SttProvider {
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    open({ turnId }) {
      let held = bytes;
      // `release` is permanent, matching the real Mock_Stt: a released session makes every later
      // frame a no-op, so a late frame cannot resurrect a freed buffer.
      let released = false;
      const session: SttSession = {
        turnId,
        pushFrame: (frame) => {
          if (!released) held += frame.byteLength;
        },
        release: () => {
          released = true;
          held = 0;
        },
        bytesHeld: () => held,
        finish: () => Promise.resolve({ ok: true, transcript: { text, lang } }),
      };
      return session;
    },
  };
}

export function llmSaying(
  text: string,
  delayMs = 0,
  deadlines?: Deadlines,
  clock?: TestClock,
): LlmProvider {
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    reply: () =>
      delayMs === 0 || deadlines === undefined || clock === undefined
        ? Promise.resolve({ ok: true, text, toolRequests: [] })
        : new Promise((resolve) => {
            deadlines.schedule(`llm:${String(clock.now())}`, clock.now() + delayMs, () =>
              resolve({ ok: true, text, toolRequests: [] }),
            );
          }),
  };
}

export function ttsFrames(count: number): TtsProvider {
  return {
    id: "mock",
    dataHandling: NO_RETENTION_NO_TRAINING,
    async *synthesise() {
      for (let i = 0; i < count; i += 1) yield new Uint8Array([i % 256]);
    },
  };
}

/** A Filler with `count` frames per language, so the filler path is observable. */
export function fillerOf(count: number, marker = 0xff): FillerAudio {
  const frames = Object.freeze(Array.from({ length: count }, () => new Uint8Array([marker])));
  return { frames: () => frames };
}

export type BrainHarness = Readonly<{
  clock: TestClock;
  deadlines: Deadlines;
  log: GatewayLog;
  brain: VoiceBrain;
  transcripts: TranscriptStore;
  alerts: Alerts;
  views: ConversationTurnView[];
  sent: { action: string }[];
  entries: () => readonly GatewayLogEntry[];
  context: ChildContext;
}>;

export function brainHarness(
  opts: Readonly<{
    stt?: SttProvider;
    llm?: LlmProvider;
    tts?: TtsProvider;
    filler?: FillerAudio;
    context?: Partial<ChildContext>;
    includeTranscriptText?: boolean;
    llmDelayMs?: number;
  }> = {},
): BrainHarness {
  const clock = createTestClock(1_760_000_000_000);
  const deadlines = createDeadlines(clock);
  const log = createGatewayLog(clock, createCaptureSink());
  const context: ChildContext = {
    ...MOST_RESTRICTIVE_CONTEXT,
    ageStage: "little",
    langs: ["en-IN", "hi-IN"],
    allowedCategories: ["stories", "animals"],
    policy: { quietHours: null, playLimitMinutes: null, movementOn: true },
    ...opts.context,
  };
  const table: ChildContextTable = {
    setActiveChild: () => undefined,
    forDevice: () => context,
    childKeyFor: () => "child:test",
  };
  const routines = createRoutines(undefined, { [DEVICE]: 0 });
  const sent: { action: string }[] = [];
  const stack = createContentStack({ clock, log });
  const tools = createToolRouter({
    log,
    content: stack.library,
    stories: stack.stories,
    routines,
    memory: createMemoryStore(),
    context: table,
    device: createDeviceActions({
      sendCommand: () => ({ ok: true, cmd_id: "cmd_tool" }),
      context: table,
      routines,
      nowMinutes: () => 12 * 60,
    }),
  });
  const transcripts = createTranscriptStore({ clock, deadlines, log });
  const alerts = createAlerts({ clock, ids: randomIds, log });
  const views: ConversationTurnView[] = [];

  const brain = createVoiceBrain({
    clock,
    deadlines,
    log,
    sendCommand: (request) => {
      sent.push({ action: request.action });
      return { ok: true, cmd_id: `cmd_${String(sent.length)}` };
    },
    stt: opts.stt ?? sttSaying("tell me about lions"),
    llm:
      opts.llm ?? llmSaying("Lions live in the grassland.", opts.llmDelayMs ?? 0, deadlines, clock),
    tts: opts.tts ?? ttsFrames(5),
    tools,
    context: table,
    transcripts,
    alerts,
    filler: opts.filler ?? NO_FILLER,
    includeTranscriptText: opts.includeTranscriptText ?? false,
    onTurnView: (view) => views.push(view),
  });

  return {
    clock,
    deadlines,
    log,
    brain,
    transcripts,
    alerts,
    views,
    sent,
    entries: () => log.since(0),
    context,
  };
}

/** Lets pending microtasks run, then fires every deadline due at `t`. */
export async function advanceTo(h: BrainHarness, t: number): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  h.clock.set(t);
  h.deadlines.fireDue(t);
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** Runs the turn to completion: settles the pipeline, then ticks the frame chain. */
export async function runTurn(h: BrainHarness, target: FakeTarget, steps = 60): Promise<void> {
  h.brain.respond(target);
  let t = h.clock.now();
  for (let i = 0; i < steps && !target.finished() && target.aborted() === null; i += 1) {
    t += 20;
    await advanceTo(h, t);
  }
}

export type { SupportedLang };
