// The Conversation_Turn_View (Req 18, C4): what an operator sees for one turn.
//
// This is NOT a Log_Entry and is never written to stdout. It exists because safety.md §7 keeps
// transcripts out of the log, while an operator still has to be able to watch a conversation end
// to end. So the view travels on its own operator-only channel, and its text fields are filled
// ONLY when the Gateway was started with the Transcripts_Argument — Local_Mode, loopback, and off
// by default (Omar's ruling). Without it the view still carries every decision, tool, timing and
// a length, which is enough to follow a turn without reading a child's words.
//
// In Phase 3A nothing consumes the view yet: the operator `turn` event and the console page are
// Phase 3B. The Voice_Brain builds it per phase and hands it to a callback, so 3B is wiring.
import type {
  AgeStage,
  AllowListedTool,
  ConversationTurnState,
  ConversationTurnView,
  DeferralTopic,
  SafetyDecisionName,
  SafetyRule,
  SupportedLang,
  ToolOutcome,
} from "@xelulu/shared";

export type ViewSeed = Readonly<{
  turnId: string;
  deviceId: string;
  at: string;
  lang: SupportedLang;
  ageStage: AgeStage;
  /** Local_Mode plus the Transcripts_Argument (Req 18.4). */
  includeText: boolean;
}>;

export interface ConversationViewBuilder {
  state(next: ConversationTurnState): ConversationTurnView;
  lang(next: SupportedLang): void;
  ageStage(next: AgeStage): void;
  transcript(text: string): void;
  reply(text: string): void;
  inputVerdict(decision: SafetyDecisionName, rule: SafetyRule, topic: DeferralTopic | null): void;
  outputVerdict(decision: SafetyDecisionName, rule: SafetyRule): void;
  tool(tool: AllowListedTool | null, outcome: ToolOutcome): void;
  latency(ms: number | null): void;
  fillerSpoken(): void;
  framesOut(n: number): void;
  current(): ConversationTurnView;
}

/** Code points, so a surrogate pair counts once and both scripts are measured the same way. */
function codePoints(text: string): number {
  return [...text].length;
}

export function createConversationView(seed: ViewSeed): ConversationViewBuilder {
  let lang = seed.lang;
  let ageStage = seed.ageStage;
  let transcriptText = "";
  let replyText = "";
  let inputDecision: SafetyDecisionName | null = null;
  let inputRule: SafetyRule | null = null;
  let inputTopic: DeferralTopic | null = null;
  let outputDecision: SafetyDecisionName | null = null;
  let outputRule: SafetyRule | null = null;
  const tools: { tool: AllowListedTool | null; outcome: ToolOutcome }[] = [];
  let latencyMs: number | null = null;
  let filler = false;
  let frames = 0;
  let state: ConversationTurnState = "listening";

  function build(): ConversationTurnView {
    return {
      turn_id: seed.turnId,
      device_id: seed.deviceId,
      at: seed.at,
      state,
      lang,
      age_stage: ageStage,
      input_decision: inputDecision,
      input_rule: inputRule,
      input_topic: inputTopic,
      output_decision: outputDecision,
      output_rule: outputRule,
      tools: tools.map((call) => ({ tool: call.tool, outcome: call.outcome })),
      latency_ms: latencyMs,
      filler_spoken: filler,
      frames_out: frames,
      transcript_len: codePoints(transcriptText),
      reply_len: codePoints(replyText),
      // The one place the toggle is honoured, so no other module has to remember it.
      transcript_text: seed.includeText ? transcriptText : null,
      reply_text: seed.includeText ? replyText : null,
    };
  }

  return {
    state(next) {
      state = next;
      return build();
    },
    lang(next) {
      lang = next;
    },
    ageStage(next) {
      ageStage = next;
    },
    transcript(text) {
      transcriptText = text;
    },
    reply(text) {
      replyText = text;
    },
    inputVerdict(decision, rule, topic) {
      inputDecision = decision;
      inputRule = rule;
      inputTopic = topic;
    },
    outputVerdict(decision, rule) {
      outputDecision = decision;
      outputRule = rule;
    },
    tool(tool, outcome) {
      tools.push({ tool, outcome });
    },
    latency(ms) {
      latencyMs = ms;
    },
    fillerSpoken() {
      filler = true;
    },
    framesOut(n) {
      frames = n;
    },
    current: build,
  };
}
