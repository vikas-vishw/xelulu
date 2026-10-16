// Stream_Client: opens the Operator_Stream at the console's own origin and reconnects it with
// its own backoff (Req 7.2, 7.4, 8.2). The browser's built-in EventSource retry is stopped by
// closing the source on every error. No env read, no other request, no DOM access beyond the
// injected source factory and timers.
import {
  AGE_STAGES,
  ALLOW_LISTED_TOOLS,
  DEFERRAL_TOPICS,
  GATEWAY_LOG_KINDS,
  SAFETY_DECISIONS,
  SAFETY_RULES,
  SUPPORTED_LANGS,
  TOOL_OUTCOMES,
} from "@xelulu/shared";
import type {
  ConversationTurnState,
  ConversationTurnView,
  GatewayLogEntry,
  OperatorStreamDevices,
} from "@xelulu/shared";

import type { StreamState } from "./console-state";

/** Relative path at the console's own origin; the Dev_Proxy forwards it (Req 8.2, C5). */
export const STREAM_URL = "/v1/stream";

/** The part of the browser EventSource the client uses (a fake in tests). */
export type EventSourceLike = {
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void;
  close(): void;
};

export type StreamClientOptions = Readonly<{
  createSource: (url: string) => EventSourceLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onState: (state: StreamState) => void;
  /** Called on every successful open, before the state turns `live` (reducer reset, Req 6.6). */
  onOpen: () => void;
  onDevices: (payload: OperatorStreamDevices) => void;
  onEntry: (entry: GatewayLogEntry) => void;
  onTurn: (view: ConversationTurnView) => void;
}>;

export type StreamClient = Readonly<{ stop(): void }>;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;

/** 1,000, 2,000, 4,000, 8,000, then 10,000 ms (failures counted from 1). Property 7. */
export function reconnectDelayMs(failures: number): number {
  const n = Number.isSafeInteger(failures) && failures >= 1 ? failures : 1;
  // 2^4 * 1,000 already exceeds the cap, so the exponent never needs to grow past 4.
  return Math.min(BASE_DELAY_MS * 2 ** Math.min(n - 1, 4), MAX_DELAY_MS);
}

const KINDS: ReadonlySet<string> = new Set<string>(GATEWAY_LOG_KINDS);
const PRESENCES: ReadonlySet<string> = new Set<string>(["unknown", "online", "offline"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Small shape guard: enough for the console to key, sort and label an entry safely. */
function isEntry(v: unknown): v is GatewayLogEntry {
  if (!isPlainObject(v)) return false;
  const { kind, seq, at } = v;
  return (
    typeof kind === "string" &&
    KINDS.has(kind) &&
    typeof seq === "number" &&
    Number.isSafeInteger(seq) &&
    seq >= 1 &&
    typeof at === "string"
  );
}

function isDeviceSummary(v: unknown): boolean {
  return (
    isPlainObject(v) &&
    typeof v["device_id"] === "string" &&
    typeof v["presence"] === "string" &&
    PRESENCES.has(v["presence"])
  );
}

/** Small shape guard: an object with a `devices` array of summary-like objects. */
function isDevices(v: unknown): v is OperatorStreamDevices {
  if (!isPlainObject(v)) return false;
  const devices = v["devices"];
  return Array.isArray(devices) && devices.every(isDeviceSummary);
}

/**
 * The six Conversation_Turn_States. The shared package exports the type but no runtime list, so
 * the names are written here and typed against it: dropping one from the type breaks this line.
 */
const TURN_STATE_NAMES: readonly ConversationTurnState[] = Object.freeze([
  "listening",
  "thinking",
  "speaking",
  "done",
  "interrupted",
  "failed",
] as const);

const TURN_STATES: ReadonlySet<string> = new Set<string>(TURN_STATE_NAMES);
const LANGS: ReadonlySet<string> = new Set<string>(SUPPORTED_LANGS);
const AGE_STAGE_NAMES: ReadonlySet<string> = new Set<string>(AGE_STAGES);
const DECISIONS: ReadonlySet<string> = new Set<string>(SAFETY_DECISIONS);
const RULES: ReadonlySet<string> = new Set<string>(SAFETY_RULES);
const TOPICS: ReadonlySet<string> = new Set<string>(DEFERRAL_TOPICS);
const TOOLS: ReadonlySet<string> = new Set<string>(ALLOW_LISTED_TOOLS);
const OUTCOMES: ReadonlySet<string> = new Set<string>(TOOL_OUTCOMES);

/** A Closed_Enum field that the view may also leave null. */
function isNullOrMember(v: unknown, members: ReadonlySet<string>): boolean {
  return v === null || (typeof v === "string" && members.has(v));
}

function isNullOrString(v: unknown): boolean {
  return v === null || typeof v === "string";
}

function isCount(v: unknown): boolean {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isTurnTool(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const outcome = v["outcome"];
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return false;
  return isNullOrMember(v["tool"], TOOLS);
}

/**
 * Small shape guard: every field of a Conversation_Turn_View, with each Closed_Enum checked
 * against the shared list, so nothing the page renders can be a value the Gateway never sends.
 */
function isTurnView(v: unknown): v is ConversationTurnView {
  if (!isPlainObject(v)) return false;
  if (typeof v["turn_id"] !== "string" || typeof v["device_id"] !== "string") return false;
  if (typeof v["at"] !== "string") return false;
  const state = v["state"];
  if (typeof state !== "string" || !TURN_STATES.has(state)) return false;
  const lang = v["lang"];
  if (typeof lang !== "string" || !LANGS.has(lang)) return false;
  const ageStage = v["age_stage"];
  if (typeof ageStage !== "string" || !AGE_STAGE_NAMES.has(ageStage)) return false;
  if (!isNullOrMember(v["input_decision"], DECISIONS)) return false;
  if (!isNullOrMember(v["input_rule"], RULES)) return false;
  if (!isNullOrMember(v["input_topic"], TOPICS)) return false;
  if (!isNullOrMember(v["output_decision"], DECISIONS)) return false;
  if (!isNullOrMember(v["output_rule"], RULES)) return false;
  const tools = v["tools"];
  if (!Array.isArray(tools) || !tools.every(isTurnTool)) return false;
  const latency = v["latency_ms"];
  if (latency !== null && typeof latency !== "number") return false;
  if (typeof v["filler_spoken"] !== "boolean") return false;
  if (!isCount(v["frames_out"])) return false;
  if (!isCount(v["transcript_len"]) || !isCount(v["reply_len"])) return false;
  return isNullOrString(v["transcript_text"]) && isNullOrString(v["reply_text"]);
}

/** JSON.parse that yields undefined instead of throwing. */
function parseData(ev: MessageEvent<string>): unknown {
  if (typeof ev.data !== "string") return undefined;
  try {
    return JSON.parse(ev.data) as unknown;
  } catch {
    return undefined;
  }
}

export function createStreamClient(opts: StreamClientOptions): StreamClient {
  let source: EventSourceLike | null = null;
  let timer: unknown = null;
  let timerArmed = false;
  let failures = 0;
  let stopped = false;

  function closeSource(): void {
    const s = source;
    source = null;
    if (s === null) return;
    s.onopen = null;
    s.onerror = null;
    s.close();
  }

  function cancelTimer(): void {
    if (!timerArmed) return;
    timerArmed = false;
    const handle = timer;
    timer = null;
    opts.clearTimer(handle);
  }

  function fail(): void {
    if (stopped) return;
    closeSource();
    failures += 1;
    opts.onState("reconnecting");
    cancelTimer();
    timerArmed = true;
    timer = opts.setTimer(() => {
      timerArmed = false;
      timer = null;
      connect();
    }, reconnectDelayMs(failures));
  }

  function connect(): void {
    if (stopped) return;
    let s: EventSourceLike;
    try {
      s = opts.createSource(STREAM_URL);
    } catch {
      fail();
      return;
    }
    source = s;
    // Events from a source that was already replaced or closed are ignored.
    const current = (): boolean => !stopped && source === s;

    s.onopen = () => {
      if (!current()) return;
      failures = 0;
      opts.onOpen();
      opts.onState("live");
    };
    s.onerror = () => {
      if (!current()) return;
      fail();
    };
    s.addEventListener("devices", (ev) => {
      if (!current()) return;
      const payload = parseData(ev);
      if (isDevices(payload)) opts.onDevices(payload);
    });
    s.addEventListener("entry", (ev) => {
      if (!current()) return;
      const entry = parseData(ev);
      if (isEntry(entry)) opts.onEntry(entry);
    });
    s.addEventListener("turn", (ev) => {
      if (!current()) return;
      const view = parseData(ev);
      if (isTurnView(view)) opts.onTurn(view);
    });
  }

  opts.onState("connecting");
  connect();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      cancelTimer();
      closeSource();
    },
  };
}
