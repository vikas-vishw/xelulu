// The Voice_Brain (Req 4, 11, 12, 13, 18): the Audio_Server's only TurnResponder, replacing the
// Phase 1.2 Fake_Reply behind the unchanged `TurnResponder` seam (C1).
//
// The Turn_Pipeline decides what to say; this module does the speaking, which is everything with
// a side effect in it: the one `say` command, the 20 ms frame chain, the Filler on the slow path,
// the Transcript_Store, the Parent_Alerts, the Gateway_Log entries and the Conversation_Turn_View.
//
// The invariants it holds, each the reason a line of code looks the way it does:
//
//  - ONE `say` per spoken turn, published immediately before the first frame, whichever stream
//    that frame belongs to (C14). The device animates once and the ack machinery tracks one
//    command, and the Simulator answers `done` on the reply's `audio_end`, so a second command
//    would hang.
//  - NO transcript text in any Log_Entry (Omar ruling 1, safety.md §7). Text goes to the
//    Transcript_Store and, behind the off-by-default toggle, to the Conversation_Turn_View.
//  - The Filler is spoken only when the reply is not ready by the Filler_Deadline, never
//    alongside or after the reply's frames, and it stops with the turn on barge-in (C15).
//  - Every delay is scheduled on `Deadlines`, so a test drives the whole turn with fake timers.
//  - When the turn stops for any reason, the deadlines are cancelled and the Stt_Session's buffer
//    is released, so no audio byte outlives the turn (Req 13, 14.3).
//
// Phase 4 adds one more, on the one path where a turn is over (Phase 4 Req 13.1, 14.1): a turn
// that reached its reply ending appends its Activity_Records and accrues its play minutes. A turn
// that spoke a Safe_Redirect appends nothing and accrues nothing, so no report and no play ledger
// counts something the robot did not do.
import { isoAt, type Clock } from "../clock.js";
import type { Deadlines } from "../deadlines.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { CommandRequest, CommandResult } from "../mqtt/command-sender.js";
import type { FillerAudio } from "./filler.js";
import type { LlmProvider } from "./providers/llm-provider.js";
import type { SttProvider, SttSession } from "./providers/stt-provider.js";
import type { TtsProvider } from "./providers/tts-provider.js";
import { createConversationView } from "./state/conversation-view.js";
import type { Alerts } from "./state/alerts.js";
import type { ChildContextTable } from "./state/child-context.js";
import type { TranscriptStore } from "./state/transcript-store.js";
import type { StorySessions } from "./story/story-session.js";
import { WORD_OF_THE_DAY_CATEGORY } from "./tools/content-library.js";
import type { ToolRouter } from "./tools/tool-router.js";
import { decideTurn, type TurnDecision } from "./turn-pipeline.js";
import { SAFE_REDIRECT } from "./safety/safe-text.js";
import { startTurnLatency, type TurnLatency } from "./turn-latency.js";
import type { TurnResponder } from "./turn-responder.js";
import type { ContentStore } from "../content/content-store.js";
import type { PlayTime } from "../routines/play-time.js";
import type {
  ActivityRecord,
  AgeStage,
  BrainTurnCause,
  BrainTurnPhase,
  ConversationTurnView,
  SupportedLang,
} from "@xelulu/shared";

/** The reply cadence, matching Document B's 20 ms Opus frames. */
export const REPLY_FRAME_INTERVAL_MS = 20;

/** A `say`'s duration hint covers the filler plus the reply; it is a hint, not a contract. */
export const SAY_DURATION_HINT_MS = 2_000;

export type VoiceBrainDeps = Readonly<{
  clock: Clock;
  deadlines: Deadlines;
  log: Pick<GatewayLog, "add">;
  sendCommand: (request: CommandRequest) => CommandResult;
  stt: SttProvider;
  llm: LlmProvider;
  tts: TtsProvider;
  tools: ToolRouter;
  /** The curated-story state the pipeline reads; this module only logs what it decided. */
  stories: StorySessions;
  /**
   * Read for ONE thing: a finished story's `categories`, for its Activity_Record (Phase 4
   * Req 14.1). The item is resolved by the id the pipeline already carries, so nothing here
   * searches the library and no content text is read.
   */
  content: Pick<ContentStore, "get">;
  /** The Activity_Store. Ids, closed enums, counts and times — never text (Phase 4 Req 14.3). */
  activity: Readonly<{ add(input: Omit<ActivityRecord, "activity_id">): ActivityRecord }>;
  /**
   * Play_Accrual: the ONE writer of the play ledger and of the `play` Activity_Record (Phase 4
   * Req 13.1). This module is one of its three callers and does no arithmetic of its own beyond
   * the turn's elapsed minutes.
   */
  play: Pick<PlayTime, "accruePlay">;
  context: ChildContextTable;
  transcripts: TranscriptStore;
  alerts: Alerts;
  filler: FillerAudio;
  /** Local_Mode plus the Transcripts_Argument (Req 18.4). */
  includeTranscriptText: boolean;
  /** Called on every Conversation_Turn_View change (Req 18.2). Phase 3B consumes it. */
  onTurnView?: (view: ConversationTurnView) => void;
}>;

export interface VoiceBrain extends TurnResponder {
  /** One Stt_Session per Audio_Turn, handed to the Audio_Turn when it opens. */
  openStt(deviceId: string, turnId: string): SttSession;
  /** Cancels every pipeline deadline and releases every session (Req 13.5). */
  stop(): void;
}

export function createVoiceBrain(deps: VoiceBrainDeps): VoiceBrain {
  /**
   * The live Stt_Sessions, by identity rather than by any id (Req 13.5). The Audio_Server opens a
   * session under its own socket key, before the device's `audio_start` has named the turn, so
   * there is no id both sides agree on: the session reaches `respond` on the ReplyTarget, and
   * this set exists only so `stop()` can release whatever is still open.
   */
  const sessions = new Set<SttSession>();
  const keys = new Set<string>();
  let stopped = false;

  const emit = (view: ConversationTurnView): void => deps.onTurnView?.(view);

  return {
    openStt(deviceId, turnId) {
      const session = deps.stt.open({ deviceId, turnId });
      sessions.add(session);
      return session;
    },

    respond(target) {
      if (stopped) return;
      const context = deps.context.forDevice(target.deviceId);
      const latency = startTurnLatency(deps.clock);
      const at = isoAt(deps.clock.now());
      const view = createConversationView({
        turnId: target.turnId,
        deviceId: target.deviceId,
        at,
        lang: context.langs[0] ?? "en-IN",
        ageStage: context.ageStage,
        includeText: deps.includeTranscriptText,
      });

      const frameKey = `brain:frames:${target.turnId}`;
      const fillerKey = `brain:filler:${target.turnId}`;
      keys.add(frameKey);
      keys.add(fillerKey);

      let saySent = false;
      let framesOut = 0;
      let playing: "none" | "filler" | "reply" = "none";
      let index = 0;
      let replyFrames: readonly Uint8Array[] | null = null;
      let decided: TurnDecision | null = null;
      let ended = false;

      const release = (): void => {
        target.stt.release();
        sessions.delete(target.stt);
        deps.tools.endTurn(target.turnId);
      };

      const cleanup = (): void => {
        deps.deadlines.cancel(frameKey);
        deps.deadlines.cancel(fillerKey);
        keys.delete(frameKey);
        keys.delete(fillerKey);
        release();
      };

      target.signal.onStop(() => {
        if (ended) return;
        ended = true;
        cleanup();
        view.framesOut(framesOut);
        view.latency(latency.firstFrameMs());
        emit(view.state("interrupted"));
        deps.log.add(
          brainEntryFields(
            "aborted",
            target.deviceId,
            target.turnId,
            view.current().lang,
            view.current().age_stage,
            latency,
            "interrupted",
            framesOut,
          ),
        );
      });

      emit(view.state("listening"));
      deps.log.add(
        brainEntryFields(
          "started",
          target.deviceId,
          target.turnId,
          view.current().lang,
          view.current().age_stage,
          latency,
          null,
          0,
        ),
      );

      /** Publishes the turn's single `say`, immediately before the first frame (C14). */
      function publishSay(lang: ConversationTurnView["lang"]): boolean {
        if (saySent) return true;
        const result = deps.sendCommand({
          device_id: target.deviceId,
          action: "say",
          data: {
            expression: "happy",
            lang,
            voice: "xelulu",
            duration_hint_ms: SAY_DURATION_HINT_MS,
          },
        });
        if (!result.ok) {
          ended = true;
          cleanup();
          const cause =
            result.error.code === "broker_disconnected" ? "broker_disconnected" : "device_offline";
          deps.log.add(
            brainEntryFields(
              "aborted",
              target.deviceId,
              target.turnId,
              lang,
              view.current().age_stage,
              latency,
              cause,
              0,
            ),
          );
          emit(view.state("failed"));
          target.abort(cause);
          return false;
        }
        saySent = true;
        return true;
      }

      /**
       * The turn's Activity_Records and its play minutes, on the one path where the turn is over
       * (Phase 4 Req 13.1, 14.1, and the design's record-source table). Ids, closed enums, counts
       * and times: no transcript, no reply text, no step text and no title can reach an
       * Activity_Record, because the record has no text field at all (Req 14.3).
       *
       * A turn that spoke a Safe_Redirect — refused on the way in, or refused on the way out —
       * appends NOTHING and accrues NOTHING, so neither a report nor the play ledger counts
       * something the robot did not do. A deferral and a comfort reply are genuine answers to the
       * child and do count.
       */
      function recordTurnActivity(decision: TurnDecision): void {
        const spokeSafeRedirect =
          decision.input.decision === "refuse" ||
          (decision.output !== null && decision.output.decision !== "allow");
        if (spokeSafeRedirect) return;

        const recordedAt = isoAt(deps.clock.now());
        const add = (
          kind: ActivityRecord["kind"],
          refId: string | null,
          categories: readonly string[],
        ): void => {
          deps.activity.add({
            device_id: target.deviceId,
            kind,
            at: recordedAt,
            ref_id: refId,
            minutes: null,
            categories: [...categories],
          });
        };

        add("turn", null, []);
        // A story counts where the session reached a terminal step and the closing line was
        // spoken (Req 3.7). A step merely spoken, left unresolved or refused is not a listen.
        if (decision.story !== null && decision.story.outcome === "ended") {
          const item = deps.content.get(decision.story.content_id);
          add("story", decision.story.content_id, item?.categories ?? []);
        }
        // `word_id` is non-null exactly when the spoken text WAS the word narration (Req 5.7).
        if (decision.word_id !== null) add("word", decision.word_id, [WORD_OF_THE_DAY_CATEGORY]);
        // The ledger, through the one accrual function (Req 13.1): whole minutes from the turn's
        // accepted `audio_start` to here, at least one. Measured from `audio_start` rather than
        // from the latency record's `audio_end`, because narrowing a child's play time to the
        // reply window would under-count it.
        deps.play.accruePlay(
          target.deviceId,
          Math.max(1, Math.ceil((deps.clock.now() - target.audioStartMs) / 60_000)),
          "turn",
          null,
        );
      }

      /** Sends one frame and schedules the next, anchored so the cadence does not drift. */
      function tick(): void {
        if (stopped || ended || target.signal.stopped) return;

        // The reply always wins: a switch happens at a frame boundary, never mid-frame.
        if (replyFrames !== null && playing !== "reply") {
          playing = "reply";
          index = 0;
        }

        const source =
          playing === "reply"
            ? replyFrames
            : playing === "filler"
              ? deps.filler.frames(view.current().lang)
              : null;

        if (source !== null && index < source.length) {
          const frame = source[index];
          if (frame === undefined) return;
          if (!publishSay(view.current().lang)) return;
          if (!target.sendFrame(frame)) return;
          if (framesOut === 0) {
            latency.markFirstFrame();
            view.latency(latency.firstFrameMs());
            emit(view.state("speaking"));
          }
          framesOut += 1;
          index += 1;
          view.framesOut(framesOut);
        } else if (playing === "reply") {
          // The reply is spoken: end the turn.
          ended = true;
          cleanup();
          view.latency(latency.firstFrameMs());
          emit(view.state("done"));
          deps.log.add(
            brainEntryFields(
              "done",
              target.deviceId,
              target.turnId,
              view.current().lang,
              view.current().age_stage,
              latency,
              null,
              framesOut,
            ),
          );
          // The one reply-ending path, so the one place a turn's Activity_Records are appended
          // (Phase 4 Req 13.1, 14.1). `decided` is non-null here: frames only exist because the
          // pipeline answered.
          if (decided !== null) recordTurnActivity(decided);
          target.finish();
          return;
        }
        // Filler exhausted with no reply yet, or nothing to play: keep the turn alive and
        // re-check on the next tick.
        deps.deadlines.schedule(frameKey, deps.clock.now() + REPLY_FRAME_INTERVAL_MS, tick);
      }

      // The Filler becomes due 600 ms after `audio_end`; if the reply is already streaming by
      // then this does nothing (C15).
      deps.deadlines.schedule(fillerKey, latency.fillerDueAt(), () => {
        if (stopped || ended || target.signal.stopped) return;
        if (replyFrames !== null || playing === "reply") return;
        if (deps.filler.frames(view.current().lang).length === 0) return;
        playing = "filler";
        index = 0;
        view.fillerSpoken();
        deps.log.add(
          brainEntryFields(
            "filler",
            target.deviceId,
            target.turnId,
            view.current().lang,
            view.current().age_stage,
            latency,
            null,
            framesOut,
          ),
        );
        tick();
      });

      // The decision runs async; every provider delay is on the Deadlines, so a test advances
      // the clock rather than waiting.
      void (async () => {
        const outcome = await decideTurn(
          { llm: deps.llm, tools: deps.tools, stories: deps.stories, clock: deps.clock },
          {
            deviceId: target.deviceId,
            turnId: target.turnId,
            stt: target.stt,
            context,
          },
        );

        if (stopped || ended || target.signal.stopped) return;

        if ("failed" in outcome) {
          // A provider failure still gets an answer if nothing has been spoken yet (Req 4.6).
          const lang = view.current().lang;
          const stage = view.current().age_stage;
          decided = {
            speak: SAFE_REDIRECT_FOR(lang, stage),
            lang,
            ageStage: stage,
            input: { decision: "refuse", rule: "uncertain", topic: null },
            output: null,
            tools: [],
            transcript: "",
            curated: false,
            story: null,
            word_id: null,
          };
          deps.log.add(
            brainEntryFields(
              "failed",
              target.deviceId,
              target.turnId,
              lang,
              stage,
              latency,
              outcome.failed,
              framesOut,
            ),
          );
        } else {
          decided = outcome;
        }

        view.lang(decided.lang);
        view.ageStage(decided.ageStage);
        view.transcript(decided.transcript);
        view.reply(decided.speak);
        view.inputVerdict(decided.input.decision, decided.input.rule, decided.input.topic);
        if (decided.output !== null) {
          view.outputVerdict(decided.output.decision, decided.output.rule);
        }
        for (const call of decided.tools) view.tool(call.tool, call.outcome);
        emit(view.state("thinking"));

        // The log carries the decisions as closed enums. The text goes to the store only.
        deps.log.add({
          kind: "safety_decision",
          device_id: target.deviceId,
          turn_id: target.turnId,
          stage: "input",
          decision: decided.input.decision,
          rule: decided.input.rule,
          topic: decided.input.topic,
        });
        if (decided.output !== null) {
          deps.log.add({
            kind: "safety_decision",
            device_id: target.deviceId,
            turn_id: target.turnId,
            stage: "output",
            decision: decided.output.decision,
            rule: decided.output.rule,
            topic: null,
          });
        }
        // One `story_step` entry per curated step this turn started, spoke, ended, left
        // unresolved or had refused — ids and a closed enum, and no step text, no choice prompt
        // and no part of the child's answer (Req 3.5, 3.7, safety.md §7). It sits after the
        // `safety_decision` entries so a refused step reads in the order it happened.
        if (decided.story !== null) {
          deps.log.add({
            kind: "story_step",
            device_id: target.deviceId,
            turn_id: target.turnId,
            content_id: decided.story.content_id,
            step_id: decided.story.step_id,
            choice_id: decided.story.choice_id,
            outcome: decided.story.outcome,
          });
        }
        deps.log.add(
          brainEntryFields(
            "transcribed",
            target.deviceId,
            target.turnId,
            decided.lang,
            decided.ageStage,
            latency,
            null,
            framesOut,
          ),
        );

        // Text only, held with its 30-day expiry (Req 15).
        if (decided.transcript !== "") {
          deps.transcripts.add({
            device_id: target.deviceId,
            turn_id: target.turnId,
            speaker: "child",
            text: decided.transcript,
            at,
          });
        }
        deps.transcripts.add({
          device_id: target.deviceId,
          turn_id: target.turnId,
          speaker: "xelulu",
          text: decided.speak,
          at: isoAt(deps.clock.now()),
        });

        // A grown-up hears about a deferral and about distress or harm (Req 7, 8).
        if (decided.input.decision === "defer" && decided.input.topic !== null) {
          deps.alerts.raiseDeferred(target.deviceId, target.turnId, decided.input.topic);
        }
        if (decided.input.decision === "comfort") {
          deps.alerts.raiseTurnAlert(
            target.deviceId,
            target.turnId,
            decided.input.rule === "harm_disclosure" ? "harm_disclosure" : "distress",
          );
        }

        // Synthesise, then stream. Collecting first is deliberate: the Filler is what covers the
        // synthesis wait, so a half-streamed reply buys nothing and complicates barge-in.
        const frames: Uint8Array[] = [];
        try {
          for await (const frame of deps.tts.synthesise({
            deviceId: target.deviceId,
            turnId: target.turnId,
            text: decided.speak,
            lang: decided.lang,
          })) {
            frames.push(frame);
          }
        } catch {
          if (!ended && !target.signal.stopped) {
            ended = true;
            cleanup();
            deps.log.add(
              brainEntryFields(
                "failed",
                target.deviceId,
                target.turnId,
                decided.lang,
                decided.ageStage,
                latency,
                "tts_failed",
                framesOut,
              ),
            );
            emit(view.state("failed"));
            target.finish();
          }
          return;
        }

        if (stopped || ended || target.signal.stopped) return;
        replyFrames = frames;
        deps.log.add(
          brainEntryFields(
            "replied",
            target.deviceId,
            target.turnId,
            decided.lang,
            decided.ageStage,
            latency,
            null,
            framesOut,
          ),
        );
        // Start (or switch to) the reply now.
        deps.deadlines.cancel(frameKey);
        tick();
      })();
    },

    stop() {
      stopped = true;
      for (const key of keys) deps.deadlines.cancel(key);
      keys.clear();
      for (const session of sessions) session.release();
      sessions.clear();
    },
  };
}

/** The Safe_Redirect for a stage and language, for the provider-failure path. */
function SAFE_REDIRECT_FOR(lang: SupportedLang, stage: AgeStage): string {
  return SAFE_REDIRECT[lang][stage];
}

/** One `brain_turn` entry's fields. Closed enums, ids, counts and times only (Req 17.3). */
function brainEntryFields(
  phase: BrainTurnPhase,
  deviceId: string,
  turnId: string,
  lang: SupportedLang,
  ageStage: AgeStage,
  latency: TurnLatency | null,
  cause: BrainTurnCause | null,
  framesOut: number,
) {
  return {
    kind: "brain_turn" as const,
    device_id: deviceId,
    turn_id: turnId,
    phase,
    lang,
    age_stage: ageStage,
    since_audio_end_ms: latency === null ? null : latency.sinceAudioEnd(),
    frames_out: framesOut,
    cause,
  };
}
