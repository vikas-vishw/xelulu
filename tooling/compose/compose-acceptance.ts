// Compose_Acceptance_Check (Req 23.1–23.8, 23.11–23.13; design D13 and "Compose and CI";
// Phase 1.3 Req 10.5 and C14 for the `stream` criterion; Phase 3B Req 22.1 and design
// "Compose and tooling" for the `conversation` criterion).
// Run from the repo root, after `docker compose build gateway simulator`:
//   node tooling/compose/compose-acceptance.ts
// Self-contained: `node:` imports only and erasable TypeScript syntax only, so Node 24 runs it
// with its built-in type stripping. The pure helpers are exported for
// tooling/test/compose-acceptance.test.ts; the CLI entry runs only when this file is the script.
//
// It writes a temporary Local_Mode `.env` (refusing to start if one exists), brings the stack up,
// runs steps 23.1, stream, conversation, 23.2–23.8 in order against the gateway log, both CLIs
// and (for `stream` and `conversation`) the two host-loopback published ports, polling every
// 500 ms inside a 600 s budget, and prints `PASSED 23.1–23.8 + stream + conversation` or
// `FAILED <criterion>` (or `FAILED budget`) followed by the token-redacted logs. It always stops
// the stack and deletes the `.env` it wrote, also on SIGINT and SIGTERM. It prints no env value
// except DEVICE_ID, and never prints stream text or a Conversation_Turn_View field.
//
// Every `.env` line is built at runtime from a [key, value] tuple and every URL from its parts,
// so this source holds no Panel_Key assignment line and no URL literal. The `stream` requests go
// to the loopback address only, with `node:http` request options rather than a URL.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/**
 * Every criterion, in run order: `stream` (Phase 1.3 C14) runs right after 23.1, and
 * `conversation` (Phase 3B) right after it, while the gateway log is still short.
 */
export const CRITERIA = [
  "23.1",
  "stream",
  "conversation",
  "23.2",
  "23.3",
  "23.4",
  "23.5",
  "23.6",
  "23.7",
  "23.8",
] as const;
export type Criterion = (typeof CRITERIA)[number];
/** What a failure is named after: the first failed criterion, or the time budget. */
export type FailureLabel = Criterion | "budget";

/** The whole run, from `docker compose up` starting (Req 23.12). */
export const BUDGET_MS = 600_000;
/** Every wait polls at this interval (design step list). */
export const POLL_MS = 500;
/** One CLI or Compose call may take at most this long (bounded by the budget too). */
export const CALL_TIMEOUT_MS = 30_000;

export const STARTUP_LIMIT_MS = 120_000;
export const STATUS_AFTER_HELLO_MS = 30_000;
export const EVENT_LIMIT_MS = 5_000;
export const COMMAND_LIMIT_MS = 10_000;
export const REJECT_HOLD_MS = 15_000;
export const SILENCE_MIN_MS = 45_000;
export const SILENCE_MAX_MS = 46_000;
/** How long step 23.7 waits for the silence entry. */
export const SILENCE_LIMIT_MS = 60_000;
/** Inbound and reply frames of one fake audio turn (Req 23.5). */
export const TURN_FRAMES = 50;
/** Pre-offline events re-published by duplicate replay (Req 23.6). */
export const REPLAYED_EVENTS = 5;

export const DEVICE_ID_VALUE = "xlu_ci_sim";
export const PASSED_LINE = "PASSED 23.1–23.8 + stream + conversation";
export const REDACTED = "[redacted]";

/** The host address both local surfaces are published on (Phase 1.3 C8). */
export const LOOPBACK_HOST = "127.0.0.1";
/** The Operator_Surface port written to the `.env`; Compose publishes it as P:P on loopback. */
export const OPERATOR_PORT = 8090;
/** The Control_Surface port written to the `.env`; Compose publishes it as Q:Q on loopback. */
export const PANEL_PORT = 8091;
/** The Operator_Stream route (Phase 1.3 Req 1.1). */
export const OPERATOR_STREAM_PATH = "/v1/stream";
/** Each host-side HTTP request of the `stream` criterion may take at most this long. */
export const STREAM_LIMIT_MS = 10_000;
/** The most response text the `stream` criterion reads from one request. */
export const STREAM_READ_MAX_CHARS = 65_536;

/** The Control_Surface operation the `conversation` criterion posts to (Req 19.1). */
export const AUDIO_TURN_PATH = "/api/audio-turn";
/** The Test_Utterance name the criterion speaks: the one that needs `content_lookup`. */
export const CONVERSATION_UTTERANCE = "story";
/**
 * The Child_Context the criterion runs under. The Gateway reads the active child from the
 * device's own `status` (Phase 3 C9), so the criterion sets it with a `config` command first:
 * with no active child the most restrictive context applies, which allows no content category
 * and so refuses a story request at the input stage with no output decision at all.
 */
export const CONVERSATION_CHILD_ID = "child_mock_1";
/** How long the criterion waits for the status that carries the active child (15 s heartbeat). */
export const ACTIVE_CHILD_LIMIT_MS = 35_000;
/** How long the criterion waits for the turn's Gateway_Log entries after the stream read. */
export const CONVERSATION_LIMIT_MS = 15_000;
/** Conversation_Turn_View states a turn does not move on from. */
export const TERMINAL_TURN_STATES = Object.freeze(["done", "interrupted", "failed"] as const);

/** Contract-valid command data for step 23.3 and 23.4. */
const SAY_DATA = Object.freeze({
  expression: "happy",
  lang: "en-IN",
  voice: "xelulu",
  duration_hint_ms: 1000,
});
const ANIMATE_DATA = Object.freeze({ expression: "curious", eyes: "blink", loop: false });
const REJECT_REASON = "picked_up";
/** The one `config` delta the `conversation` criterion sends. */
const ACTIVE_CHILD_DATA = Object.freeze({ active_child_id: CONVERSATION_CHILD_ID });

// ---------------------------------------------------------------------------------------------
// The temporary .env
// ---------------------------------------------------------------------------------------------

export type EnvEntry = readonly [key: string, value: string];

/** A URL from its parts, so no URL literal appears in this source. */
export function urlFrom(scheme: string, host: string, port: number): string {
  return scheme + "://" + host + ":" + String(port);
}

/** A new per-run DEVICE_TOKEN: 32 random bytes in base64url. */
export function newDeviceToken(bytes: Uint8Array = randomBytes(32)): string {
  return Buffer.from(bytes).toString("base64url");
}

/** The Local_Mode values of G36, with Compose service host names and empty broker credentials. */
export function localEnvEntries(token: string): readonly EnvEntry[] {
  return [
    ["APP_ENV", "local"],
    ["MQTT_BROKER_URL", urlFrom("mqtt", "emqx", 1883)],
    ["MQTT_USERNAME", ""],
    ["MQTT_PASSWORD", ""],
    ["AUDIO_WSS_URL", urlFrom("ws", "gateway", 8081)],
    ["DEVICE_ID", DEVICE_ID_VALUE],
    ["DEVICE_TOKEN", token],
    ["GATEWAY_OPERATOR_PORT", String(OPERATOR_PORT)],
    ["SIMULATOR_PANEL_PORT", String(PANEL_PORT)],
  ];
}

const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;

/** The `.env` text: one line per tuple, key and value joined with "=". Throws on a bad tuple. */
export function envFileText(entries: readonly EnvEntry[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const [key, value] of entries) {
    if (!ENV_KEY.test(key)) throw new Error("invalid env key");
    if (seen.has(key)) throw new Error("duplicate env key");
    if (/[\r\n]/.test(value)) throw new Error("env value holds a line break");
    seen.add(key);
    lines.push([key, value].join("="));
  }
  // The sentinel leads, so this file is self-identifying even after the run that wrote it died.
  return [ROOT_ENV_SENTINEL, ...lines].map((line) => line + "\n").join("");
}

/** Every occurrence of `secret` in `text` replaced by `[redacted]`. */
export function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join(REDACTED);
}

/** The name of the root file this check writes and then deletes. */
export const ROOT_ENV_FILE = ".env";

/**
 * The first line of the scratch file this check writes, so a later run can recognise its own
 * leftovers. A developer's `.env` never carries it.
 */
export const ROOT_ENV_SENTINEL = "# xelulu compose-acceptance scratch file: safe to delete";

/** Printed when an interrupted earlier run's scratch file is replaced. Fixed text, no values. */
export const ROOT_ENV_RECLAIMED_NOTE =
  "note: a scratch " + ROOT_ENV_FILE + " left by an interrupted run was replaced.";

/** The second line of the refusal when a root env file is already there. */
export const ROOT_ENV_EXISTS_REASON =
  "reason: a root " +
  ROOT_ENV_FILE +
  " already exists and was left untouched. Move it aside, then run this check again.";

/** The second line of the refusal when the file cannot be created at all. */
export const ROOT_ENV_UNWRITABLE_REASON =
  "reason: the temporary root " + ROOT_ENV_FILE + " could not be written.";

/**
 * Req 23.11: the developer's own root env file is never overwritten and never deleted. `main`
 * checks for it BEFORE writing, so the refusal happens while nothing has been touched, and the
 * "already there" case is told apart from the "cannot be written" case. Empty when the check may
 * proceed. Fixed text only: no env key, no env value.
 */
export function rootEnvRefusal(exists: boolean): readonly string[] {
  return exists ? Object.freeze(["FAILED 23.11", ROOT_ENV_EXISTS_REASON]) : Object.freeze([]);
}

/**
 * The seam `main` uses: the same refusal, decided by the real filesystem at the path `main`
 * passes. Reads only; it never creates, writes or removes anything, so a test can call it with a
 * file in place and assert that file is still there afterwards.
 */
export function rootEnvRefusalFor(envPath: string): readonly string[] {
  return rootEnvRefusal(existsSync(envPath) && !isOurScratchEnv(envPath));
}

/**
 * True when `envPath` is the scratch file THIS check writes, recognised by its sentinel first
 * line.
 *
 * Without this, the refusal above is a one-way door: a run killed mid-flight — Ctrl-C, a closed
 * shell, a CI timeout — leaves its own scratch file behind, and every later run then refuses
 * because of a file the check itself created. That happened on the first live run. A developer's
 * own `.env` carries no sentinel, so it is still never read for its values, never overwritten
 * and never deleted.
 */
export function isOurScratchEnv(envPath: string): boolean {
  try {
    return readFileSync(envPath, "utf8").startsWith(ROOT_ENV_SENTINEL);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Budget and failure naming
// ---------------------------------------------------------------------------------------------

/** Milliseconds left of the budget at `nowMs` (never negative). */
export function remainingMs(startMs: number, nowMs: number, budgetMs: number = BUDGET_MS): number {
  return Math.max(0, startMs + budgetMs - nowMs);
}

/** A wait's effective limit: its own limit or the budget left, whichever is smaller. */
export function waitLimitMs(limitMs: number, leftMs: number): number {
  return Math.max(0, Math.min(limitMs, leftMs));
}

/** What a wait that ran out is named after: the budget if the budget cut it short. */
export function timeoutLabel(criterion: Criterion, limitMs: number, leftMs: number): FailureLabel {
  return leftMs < limitMs ? "budget" : criterion;
}

/** A failed assertion. `why` holds fixed text and ids only, never an env value. */
export class CheckFailure extends Error {
  readonly label: FailureLabel;
  readonly why: string;

  constructor(label: FailureLabel, why: string) {
    super("FAILED " + label);
    this.name = "CheckFailure";
    this.label = label;
    this.why = why;
  }
}

export type Step = Readonly<{ criterion: Criterion; run: () => Promise<void> }>;

export type RunResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly label: FailureLabel; readonly why: string };

/**
 * Runs the steps in order and stops at the first failure, naming it. A step that throws
 * anything but a CheckFailure fails under its own criterion. The budget is checked before each
 * step and at the end.
 */
export async function runInOrder(
  steps: readonly Step[],
  budgetLeftMs: () => number,
): Promise<RunResult> {
  for (const step of steps) {
    if (budgetLeftMs() <= 0) {
      return { ok: false, label: "budget", why: "the budget ran out before " + step.criterion };
    }
    try {
      await step.run();
    } catch (error) {
      if (error instanceof CheckFailure) return { ok: false, label: error.label, why: error.why };
      return { ok: false, label: step.criterion, why: "unexpected error" };
    }
  }
  if (budgetLeftMs() <= 0) return { ok: false, label: "budget", why: "the run took too long" };
  return { ok: true };
}

export function resultLine(result: RunResult): string {
  return result.ok ? PASSED_LINE : "FAILED " + result.label;
}

// ---------------------------------------------------------------------------------------------
// Gateway log parsing
// ---------------------------------------------------------------------------------------------

export type LogEntry = Readonly<Record<string, unknown>>;

export type ParsedLog =
  | { readonly ok: true; readonly entries: readonly LogEntry[] }
  | { readonly ok: false; readonly lineNo: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** One JSON object, or null. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Every non-blank line as a JSON object (Req 12.8). The first line that is not one fails the
 * parse, reported by its 1-based number only, never its text.
 */
export function parseLogLines(text: string): ParsedLog {
  const entries: LogEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const entry = parseJsonObject(line);
    if (entry === null) return { ok: false, lineNo: i + 1 };
    entries.push(entry);
  }
  return { ok: true, entries };
}

// ---------------------------------------------------------------------------------------------
// Step predicates (pure). Each returns pass, pending (keep polling) or fail (stop now).
// ---------------------------------------------------------------------------------------------

export type Verdict =
  | { readonly status: "pass" }
  | { readonly status: "pending"; readonly why: string }
  | { readonly status: "fail"; readonly why: string };

const PASS: Verdict = Object.freeze({ status: "pass" });

function pending(why: string): Verdict {
  return { status: "pending", why };
}

function fail(why: string): Verdict {
  return { status: "fail", why };
}

/** An entry's `at` in epoch milliseconds, or NaN. */
export function atMs(entry: LogEntry): number {
  return typeof entry["at"] === "string" ? Date.parse(entry["at"]) : Number.NaN;
}

function isMessageIn(entry: LogEntry, deviceId: string, variant: string): boolean {
  return (
    entry["kind"] === "message_in" &&
    entry["device_id"] === deviceId &&
    entry["variant"] === variant
  );
}

function isHeartbeatIn(entry: LogEntry, deviceId: string): boolean {
  return isMessageIn(entry, deviceId, "hello") || isMessageIn(entry, deviceId, "status");
}

function isPresence(entry: LogEntry, deviceId: string, state: string): boolean {
  return (
    entry["kind"] === "presence" && entry["device_id"] === deviceId && entry["state"] === state
  );
}

function ackResults(window: readonly LogEntry[], cmdId: string): LogEntry[] {
  return window.filter((e) => e["kind"] === "ack_result" && e["cmd_id"] === cmdId);
}

function messageOuts(window: readonly LogEntry[], cmdId: string): LogEntry[] {
  return window.filter((e) => e["kind"] === "message_out" && e["cmd_id"] === cmdId);
}

/**
 * Req 23.1: `broker_connected`, a hello from the device, `auth ok`, `presence online hello`, and
 * two status entries after the hello whose `at` is no more than 30 s after the hello's.
 */
export function checkStartup(entries: readonly LogEntry[], deviceId: string): Verdict {
  if (
    entries.some(
      (e) => e["kind"] === "auth" && e["device_id"] === deviceId && e["outcome"] === "failed",
    )
  ) {
    return fail("auth failed for the device");
  }
  const missing: string[] = [];
  if (!entries.some((e) => e["kind"] === "gateway" && e["state"] === "broker_connected")) {
    missing.push("broker_connected");
  }
  if (
    !entries.some(
      (e) => e["kind"] === "auth" && e["device_id"] === deviceId && e["outcome"] === "ok",
    )
  ) {
    missing.push("auth ok");
  }
  if (!entries.some((e) => isPresence(e, deviceId, "online") && e["cause"] === "hello")) {
    missing.push("presence online hello");
  }
  const helloIndex = entries.findIndex((e) => isMessageIn(e, deviceId, "hello"));
  const hello = entries[helloIndex];
  if (hello === undefined) {
    missing.push("hello");
  } else {
    const helloAt = atMs(hello);
    const statuses = entries.filter((e, i) => {
      const delta = atMs(e) - helloAt;
      return (
        i > helloIndex &&
        isMessageIn(e, deviceId, "status") &&
        delta >= 0 &&
        delta <= STATUS_AFTER_HELLO_MS
      );
    }).length;
    if (statuses < 2) missing.push("two status entries within 30 s of the hello");
  }
  return missing.length === 0 ? PASS : pending("waiting for " + missing.join(", "));
}

/** Req 23.2, per firing: exactly one `message_in` and one `event_accepted` for the event. */
export function checkEventLogged(
  window: readonly LogEntry[],
  deviceId: string,
  eventId: string,
): Verdict {
  const ins = window.filter(
    (e) => e["kind"] === "message_in" && e["device_id"] === deviceId && e["event_id"] === eventId,
  ).length;
  const accepted = window.filter(
    (e) => e["kind"] === "event_accepted" && e["event_id"] === eventId,
  ).length;
  if (ins > 1) return fail("more than one message_in for event " + eventId);
  if (accepted > 1) return fail("more than one event_accepted for event " + eventId);
  return ins === 1 && accepted === 1 ? PASS : pending("waiting for event " + eventId);
}

/** Req 23.2, across the step: no `message_rejected`, `event_duplicate` or `stop_audio` out. */
export function checkEventStepClean(window: readonly LogEntry[]): Verdict {
  if (window.some((e) => e["kind"] === "message_rejected")) return fail("message_rejected logged");
  if (window.some((e) => e["kind"] === "event_duplicate")) return fail("event_duplicate logged");
  if (window.some((e) => e["kind"] === "message_out" && e["variant"] === "stop_audio")) {
    return fail("stop_audio message_out logged");
  }
  return PASS;
}

/**
 * Req 23.3: one `message_out`, an `accepted` and then exactly one `done ""` for the command,
 * with no `timed_out` (nor any other terminal outcome).
 */
export function checkCommandDone(window: readonly LogEntry[], cmdId: string): Verdict {
  if (messageOuts(window, cmdId).length > 1) return fail("more than one message_out for " + cmdId);
  const results = ackResults(window, cmdId);
  for (const r of results) {
    const outcome = r["outcome"];
    if (outcome === "timed_out" || outcome === "rejected" || outcome === "failed") {
      return fail(String(outcome) + " logged for " + cmdId);
    }
  }
  const acceptedIndex = results.findIndex((r) => r["outcome"] === "accepted");
  const doneIndexes = results.flatMap((r, i) => (r["outcome"] === "done" ? [i] : []));
  if (doneIndexes.length > 1) return fail("more than one done for " + cmdId);
  const doneIndex = doneIndexes[0];
  if (doneIndex !== undefined) {
    if (results[doneIndex]?.["reason"] !== "") return fail("done reason is not empty for " + cmdId);
    if (acceptedIndex === -1 || acceptedIndex > doneIndex) {
      return fail("done logged before accepted for " + cmdId);
    }
  }
  const ready =
    messageOuts(window, cmdId).length === 1 && acceptedIndex !== -1 && doneIndex !== undefined;
  return ready ? PASS : pending("waiting for the acks of " + cmdId);
}

/**
 * Req 23.4: exactly one `rejected picked_up` for the command; no `accepted`, `done`, `failed` or
 * `timed_out`, and no second `message_out`, at any time (the runner keeps checking to 15 s).
 */
export function checkRejectedOnly(window: readonly LogEntry[], cmdId: string): Verdict {
  const outs = messageOuts(window, cmdId).length;
  if (outs > 1) return fail("more than one message_out for " + cmdId);
  const results = ackResults(window, cmdId);
  for (const r of results) {
    const outcome = r["outcome"];
    if (
      outcome === "accepted" ||
      outcome === "done" ||
      outcome === "failed" ||
      outcome === "timed_out"
    ) {
      return fail(String(outcome) + " logged for " + cmdId);
    }
  }
  const rejected = results.filter((r) => r["outcome"] === "rejected");
  if (rejected.length > 1) return fail("more than one rejected for " + cmdId);
  const first = rejected[0];
  if (first !== undefined && first["reason"] !== REJECT_REASON) {
    return fail("rejected reason is not " + REJECT_REASON + " for " + cmdId);
  }
  return outs === 1 && first !== undefined
    ? PASS
    : pending("waiting for the rejection of " + cmdId);
}

const TURN_PHASES = ["started", "ended", "reply_started", "reply_ended"] as const;

/**
 * Req 23.5: for the turn, phases started, ended (50 in), reply_started, reply_ended in order with
 * no aborted (or interrupted) phase; exactly one `say` `message_out` between started and
 * reply_started; and `done` for that say.
 *
 * The UPLOAD is still exactly 50 frames: a turn started with no `utterance` sends the Phase 1.2
 * synthetic frames unchanged (Req 19.3). The REPLY is no longer a fixed 50. Phase 3 C1 deleted
 * the Fake_Reply, so this turn now runs the real pipeline: synthetic frames are not
 * Utterance_Frames, the Mock_Stt reports `no_speech`, and the brain speaks a Safe_Redirect whose
 * frame count is a function of that text's length. Asserting 50 here would fail on every live
 * run, so what is checked is the invariant that survived: a reply was streamed at all, and it
 * ended with one say that the device acked `done`.
 */
export function checkAudioTurn(
  window: readonly LogEntry[],
  deviceId: string,
  turnId: string,
): Verdict {
  const turn = window.flatMap((e, i) =>
    e["kind"] === "audio_turn" && e["device_id"] === deviceId && e["turn_id"] === turnId
      ? [{ entry: e, index: i }]
      : [],
  );
  if (turn.length > TURN_PHASES.length) return fail("too many audio_turn phases for " + turnId);
  for (let k = 0; k < turn.length; k++) {
    const phase = turn[k]?.entry["phase"];
    if (phase !== TURN_PHASES[k])
      return fail("audio_turn phase " + String(phase) + " out of order");
  }
  const ended = turn[1]?.entry;
  if (ended !== undefined && ended["frames_in"] !== TURN_FRAMES) return fail("frames_in is not 50");
  const replyEnded = turn[3]?.entry;
  const framesOut = replyEnded?.["frames_out"];
  if (replyEnded !== undefined && (typeof framesOut !== "number" || framesOut < 1)) {
    return fail("the reply streamed no frame");
  }
  const started = turn[0];
  const replyStarted = turn[2];
  if (started === undefined || replyStarted === undefined || replyEnded === undefined) {
    return pending("waiting for the phases of " + turnId);
  }
  const says = window.filter(
    (e, i) =>
      i > started.index &&
      i < replyStarted.index &&
      e["kind"] === "message_out" &&
      e["device_id"] === deviceId &&
      e["variant"] === "say",
  );
  const say = says[0];
  if (says.length !== 1 || say === undefined || typeof say["cmd_id"] !== "string") {
    return fail("expected one say message_out before reply_started");
  }
  const sayId = say["cmd_id"];
  const results = ackResults(window, sayId);
  for (const r of results) {
    const outcome = r["outcome"];
    if (outcome === "timed_out" || outcome === "rejected" || outcome === "failed") {
      return fail(String(outcome) + " logged for the say " + sayId);
    }
  }
  return results.some((r) => r["outcome"] === "done")
    ? PASS
    : pending("waiting for done of the say " + sayId);
}

/**
 * Req 23.5, simulator side: `last_turn` for the turn is `complete` and received a reply.
 *
 * A count rather than a fixed 50, for the reason `checkAudioTurn` gives: the reply is the brain's
 * now, so its length follows the text it speaks (Phase 3 C1).
 */
export function checkLastTurn(state: Readonly<Record<string, unknown>>, turnId: string): Verdict {
  const last = state["last_turn"];
  if (!isPlainObject(last) || last["turn_id"] !== turnId) return pending("waiting for last_turn");
  const outcome = last["outcome"];
  if (outcome === "in_progress") return pending("the turn is in progress");
  if (outcome !== "complete") return fail("the simulator turn ended " + String(outcome));
  const received = last["frames_received"];
  return typeof received === "number" && received > 0
    ? PASS
    : fail("the simulator received no reply frame");
}

/** Whether the simulator state lists `cmdId` among its received commands (Req 23.3, 23.4). */
export function stateHasCommand(state: Readonly<Record<string, unknown>>, cmdId: string): boolean {
  const list = state["received_commands"];
  return Array.isArray(list) && list.some((c) => isPlainObject(c) && c["cmd_id"] === cmdId);
}

export type EventCounts = Readonly<{ accepted: number; duplicate: number }>;

/** The device's event counts from a `devices` response, or null. */
export function deviceCounts(
  devices: Readonly<Record<string, unknown>>,
  deviceId: string,
): EventCounts | null {
  const list = devices["devices"];
  if (!Array.isArray(list)) return null;
  const device: unknown = list.find((d) => isPlainObject(d) && d["device_id"] === deviceId);
  if (!isPlainObject(device)) return null;
  const accepted = device["events_accepted"];
  const duplicate = device["events_duplicate"];
  return typeof accepted === "number" && typeof duplicate === "number"
    ? { accepted, duplicate }
    : null;
}

export type ReplayInput = Readonly<{
  queuedId: string;
  /** The last 5 event ids fired before the offline toggle. */
  priorIds: readonly string[];
  before: EventCounts;
  after: EventCounts | null;
}>;

/**
 * Req 23.6: exactly one `event_accepted` (time_uncertain, approximate) for the queued event,
 * exactly one `event_duplicate` for each prior id, and counts of +1 accepted and +5 duplicates.
 */
export function checkReplay(window: readonly LogEntry[], input: ReplayInput): Verdict {
  const accepted = window.filter(
    (e) => e["kind"] === "event_accepted" && e["event_id"] === input.queuedId,
  );
  if (accepted.length > 1) return fail("more than one event_accepted for the queued event");
  const queued = accepted[0];
  if (
    queued !== undefined &&
    (queued["time_uncertain"] !== true || queued["ordering"] !== "approximate")
  ) {
    return fail("the queued event is not time_uncertain with ordering approximate");
  }
  let duplicates = 0;
  for (const id of input.priorIds) {
    if (window.some((e) => e["kind"] === "event_accepted" && e["event_id"] === id)) {
      return fail("event_accepted logged again for " + id);
    }
    const n = window.filter((e) => e["kind"] === "event_duplicate" && e["event_id"] === id).length;
    if (n > 1) return fail("more than one event_duplicate for " + id);
    duplicates += n;
  }
  const after = input.after;
  if (after === null) return pending("waiting for the device counts");
  const dAccepted = after.accepted - input.before.accepted;
  const dDuplicate = after.duplicate - input.before.duplicate;
  if (dAccepted > 1) return fail("accepted count rose by more than 1");
  if (dDuplicate > input.priorIds.length) return fail("duplicate count rose by more than 5");
  const ready =
    queued !== undefined &&
    duplicates === input.priorIds.length &&
    dAccepted === 1 &&
    dDuplicate === input.priorIds.length;
  return ready ? PASS : pending("waiting for the replay");
}

/**
 * Req 23.7: the first `presence offline` for the device at or after `fromIndex` has cause
 * `silence`, comes 45.0–46.0 s after the last hello or status before it, and no other
 * `presence offline` lies between that heartbeat and it.
 */
export function checkSilence(
  entries: readonly LogEntry[],
  deviceId: string,
  fromIndex: number,
): Verdict {
  let offIndex = -1;
  for (let i = Math.max(0, fromIndex); i < entries.length; i++) {
    const e = entries[i];
    if (e !== undefined && isPresence(e, deviceId, "offline")) {
      offIndex = i;
      break;
    }
  }
  const off = entries[offIndex];
  if (off === undefined) return pending("waiting for presence offline");
  if (off["cause"] !== "silence") return fail("presence offline cause is not silence");
  let beatIndex = -1;
  for (let i = offIndex - 1; i >= 0; i--) {
    const e = entries[i];
    if (e !== undefined && isHeartbeatIn(e, deviceId)) {
      beatIndex = i;
      break;
    }
  }
  const beat = entries[beatIndex];
  if (beat === undefined) return fail("no hello or status before presence offline");
  for (let i = beatIndex + 1; i < offIndex; i++) {
    const e = entries[i];
    if (e !== undefined && isPresence(e, deviceId, "offline")) {
      return fail("an earlier presence offline was logged");
    }
  }
  const gap = atMs(off) - atMs(beat);
  if (!(gap >= SILENCE_MIN_MS && gap <= SILENCE_MAX_MS)) {
    return fail("presence offline came " + String(gap) + " ms after the last heartbeat");
  }
  return PASS;
}

/** Req 23.8: a hello `message_in` and `presence online hello`, with no new `presence offline`. */
export function checkReconnect(window: readonly LogEntry[], deviceId: string): Verdict {
  if (window.some((e) => isPresence(e, deviceId, "offline"))) {
    return fail("presence offline logged after the online toggle");
  }
  const hello = window.some((e) => isMessageIn(e, deviceId, "hello"));
  const online = window.some((e) => isPresence(e, deviceId, "online") && e["cause"] === "hello");
  return hello && online ? PASS : pending("waiting for hello and presence online");
}

/**
 * Phase 1.3 C14: `docker compose port <service> <port>` printed exactly one binding, the host
 * loopback address at the same port (never `0.0.0.0` or another host port).
 */
export function checkPublishedPort(stdout: string, port: number): Verdict {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length !== 1) return fail("expected exactly one published binding");
  return lines[0] === LOOPBACK_HOST + ":" + String(port)
    ? PASS
    : fail("the port is not published on " + LOOPBACK_HOST + " at " + String(port));
}

export type SseEvent = Readonly<{ event: string; data: string }>;

/**
 * Every event dispatched by complete SSE text, in order (WHATWG event-stream rules): comment
 * lines are skipped, a blank line ends a block, and a block with no `data` line dispatches
 * nothing. A trailing partial line is ignored, so a half-arrived event is never dispatched.
 */
export function sseEvents(text: string): readonly SseEvent[] {
  const events: SseEvent[] = [];
  let event = "";
  let data: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n").slice(0, -1)) {
    if (line === "") {
      if (data.length > 0) {
        events.push({ event: event === "" ? "message" : event, data: data.join("\n") });
      }
      event = "";
      data = [];
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return events;
}

/**
 * The first event dispatched by complete SSE text. Null while no complete event has arrived.
 */
export function firstSseEvent(text: string): SseEvent | null {
  return sseEvents(text)[0] ?? null;
}

/**
 * Phase 1.3 C14: the stream's first event is a `devices` event whose data is exactly
 * `{ devices: [...] }` with one Device_Summary, for `deviceId`. Pending until an event arrives.
 */
export function checkFirstDevicesEvent(text: string, deviceId: string): Verdict {
  const first = firstSseEvent(text);
  if (first === null) return pending("waiting for the first stream event");
  if (first.event !== "devices") return fail("the first stream event is not devices");
  const body = parseJsonObject(first.data);
  if (body === null || Object.keys(body).length !== 1) {
    return fail("the devices event data is not a devices object");
  }
  const list = body["devices"];
  if (!Array.isArray(list)) return fail("the devices event has no devices list");
  const only: unknown = list[0];
  return list.length === 1 && isPlainObject(only) && only["device_id"] === deviceId
    ? PASS
    : fail("the devices event does not name only the device");
}

/**
 * The newest `state` an operator `turn` event reported for `turnId`, or null when the stream
 * text carries none yet. The view's other fields are never read here and never printed: the
 * state is a Closed_Enum value, so no transcript or reply text can leave this helper.
 */
export function turnViewState(text: string, turnId: string): string | null {
  let state: string | null = null;
  for (const event of sseEvents(text)) {
    if (event.event !== "turn") continue;
    const view = parseJsonObject(event.data);
    if (view === null || view["turn_id"] !== turnId) continue;
    if (typeof view["state"] === "string") state = view["state"];
  }
  return state;
}

/** Whether a turn in this state has stopped moving (Req 18.2). */
export function isTerminalTurnState(state: string | null): boolean {
  return state !== null && (TERMINAL_TURN_STATES as readonly string[]).includes(state);
}

/**
 * Phase 3B (Req 22.1, design "Compose and tooling"): one conversation turn ran end to end. Over
 * the gateway log window it needs a `brain_turn` `transcribed` entry for the turn,
 * `safety_decision` entries for both stages, exactly one `say` `message_out` and an `ack_result`
 * with outcome `done` for that command; and from the operator stream, a `turn` event for the
 * same `turn_id` whose state reached `done`.
 *
 * It asserts no reply frame count: the reply's length is the Voice_Brain's business, not the
 * criterion's (phase-3b-plan R1).
 */
export function checkConversation(
  window: readonly LogEntry[],
  streamText: string,
  deviceId: string,
  turnId: string,
): Verdict {
  const forTurn = (kind: string): LogEntry[] =>
    window.filter(
      (e) => e["kind"] === kind && e["device_id"] === deviceId && e["turn_id"] === turnId,
    );

  const brainTurns = forTurn("brain_turn");
  const aborted = brainTurns.find((e) => e["phase"] === "aborted" || e["cause"] !== null);
  if (aborted !== undefined) return fail("the pipeline stopped for turn " + turnId);

  const turnState = turnViewState(streamText, turnId);
  if (turnState !== null && turnState !== "done" && isTerminalTurnState(turnState)) {
    return fail("the turn event state is " + turnState + " for " + turnId);
  }

  const says = window.filter(
    (e) => e["kind"] === "message_out" && e["device_id"] === deviceId && e["variant"] === "say",
  );
  if (says.length > 1) return fail("more than one say message_out for turn " + turnId);
  const say = says[0];
  if (say !== undefined && typeof say["cmd_id"] === "string") {
    const sayId = say["cmd_id"];
    for (const r of ackResults(window, sayId)) {
      const outcome = r["outcome"];
      if (outcome === "timed_out" || outcome === "rejected" || outcome === "failed") {
        return fail(String(outcome) + " logged for the say " + sayId);
      }
    }
  }

  const missing: string[] = [];
  if (!brainTurns.some((e) => e["phase"] === "transcribed")) missing.push("a transcribed entry");
  const decisions = forTurn("safety_decision");
  for (const stage of ["input", "output"] as const) {
    if (!decisions.some((e) => e["stage"] === stage)) {
      missing.push("a " + stage + " safety_decision");
    }
  }
  if (say === undefined || typeof say["cmd_id"] !== "string") {
    missing.push("a say message_out");
  } else if (!ackResults(window, say["cmd_id"]).some((r) => r["outcome"] === "done")) {
    missing.push("done for the say");
  }
  if (turnState !== "done") missing.push("a done turn event");
  return missing.length === 0 ? PASS : pending("waiting for " + missing.join(", "));
}

// ---------------------------------------------------------------------------------------------
// The Compose run (impure)
// ---------------------------------------------------------------------------------------------

type CallResult = Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

/** `docker compose <args>` with an argument array (no shell). */
function compose(root: string, args: readonly string[], timeoutMs: number): CallResult {
  const r = spawnSync("docker", ["compose", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: Math.max(1, Math.floor(timeoutMs)),
    windowsHide: true,
  });
  return {
    status: r.status,
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" ? r.stderr : "",
    timedOut: r.error !== undefined,
  };
}

type Service = "gateway" | "simulator";
type Json = Readonly<Record<string, unknown>>;

/** What one loopback GET read: its status and at most STREAM_READ_MAX_CHARS of its body. */
export type LoopbackReply = Readonly<{ status: number; body: string }>;

/**
 * One `node:http` GET to LOOPBACK_HOST at `port`, with `Host: 127.0.0.1:<port>` and no
 * `Origin`. It settles at the first of: a non-200 status, `enough(body)` turning true, the read
 * cap, the end of the body, an error, or `limitMs`. The request is destroyed once it settles,
 * so an open stream is never left reading. Rejects with "timeout" or "error" only.
 */
export function loopbackGet(
  port: number,
  path: string,
  limitMs: number,
  enough: (body: string) => boolean,
): Promise<LoopbackReply> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let body = "";
    const req = request({
      host: LOOPBACK_HOST,
      port,
      path,
      method: "GET",
      headers: { host: LOOPBACK_HOST + ":" + String(port) },
      agent: false,
    });
    const settle = (outcome: LoopbackReply | "timeout" | "error"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      if (typeof outcome === "string") rejectPromise(new Error(outcome));
      else resolvePromise(outcome);
    };
    // Every settle runs from an event or this timer, so `timer` is set before any settle reads it.
    const timer = setTimeout(() => settle("timeout"), Math.max(1, Math.floor(limitMs)));
    req.on("error", () => settle("error"));
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      res.on("error", () => settle("error"));
      if (status !== 200) {
        settle({ status, body: "" });
        return;
      }
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body = (body + chunk).slice(0, STREAM_READ_MAX_CHARS);
        if (enough(body) || body.length >= STREAM_READ_MAX_CHARS) settle({ status, body });
      });
      res.on("end", () => settle({ status, body }));
    });
    req.end();
  });
}

/**
 * One `node:http` POST to LOOPBACK_HOST at `port` with a JSON body, the loopback `Host` header
 * and no `Origin` (phase-3b-plan D6). Same settle, destroy and timeout shape as loopbackGet: it
 * settles at the first of a non-200 status, the end of the body, the read cap, an error or
 * `limitMs`, and the request is destroyed once it settles. Rejects with "timeout" or "error"
 * only, and never carries the submitted body into an error.
 */
export function loopbackPost(
  port: number,
  path: string,
  body: string,
  limitMs: number,
): Promise<LoopbackReply> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let text = "";
    const payload = Buffer.from(body, "utf8");
    const req = request({
      host: LOOPBACK_HOST,
      port,
      path,
      method: "POST",
      headers: {
        host: LOOPBACK_HOST + ":" + String(port),
        "content-type": "application/json; charset=utf-8",
        "content-length": String(payload.byteLength),
      },
      agent: false,
    });
    const settle = (outcome: LoopbackReply | "timeout" | "error"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      if (typeof outcome === "string") rejectPromise(new Error(outcome));
      else resolvePromise(outcome);
    };
    // Every settle runs from an event or this timer, so `timer` is set before any settle reads it.
    const timer = setTimeout(() => settle("timeout"), Math.max(1, Math.floor(limitMs)));
    req.on("error", () => settle("error"));
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      res.on("error", () => settle("error"));
      if (status !== 200) {
        settle({ status, body: "" });
        return;
      }
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text = (text + chunk).slice(0, STREAM_READ_MAX_CHARS);
        if (text.length >= STREAM_READ_MAX_CHARS) settle({ status, body: text });
      });
      res.on("end", () => settle({ status, body: text }));
    });
    req.end(payload);
  });
}

interface Harness {
  readonly left: () => number;
  /** Parsed gateway log; an unparsable line fails `criterion`. */
  logs(criterion: Criterion): readonly LogEntry[];
  /** One CLI call; exit 0 and a JSON object on stdout, else `criterion` fails. */
  cli(criterion: Criterion, service: Service, args: readonly string[]): Json;
  /** `docker compose <args>` that must exit 0, else `criterion` fails. */
  composeOk(criterion: Criterion, args: readonly string[]): void;
  /** `docker compose <args>` that must exit 0; its stdout. */
  composeText(criterion: Criterion, args: readonly string[]): string;
  /** One bounded loopback GET (see loopbackGet); a timeout or error fails `criterion`. */
  get(
    criterion: Criterion,
    port: number,
    path: string,
    enough: (body: string) => boolean,
  ): Promise<LoopbackReply>;
  /** One bounded loopback JSON POST (see loopbackPost); a timeout or error fails `criterion`. */
  post(criterion: Criterion, port: number, path: string, body: string): Promise<LoopbackReply>;
  /** Polls `check` until it passes; fails on a fail verdict or at the limit. */
  waitFor(criterion: Criterion, limitMs: number, check: () => Verdict): Promise<void>;
  /** Polls `check` until `untilMs` (epoch); fails on a fail verdict. */
  holdUntil(criterion: Criterion, untilMs: number, check: () => Verdict): Promise<void>;
}

function createHarness(root: string, startMs: number): Harness {
  const left = (): number => remainingMs(startMs, Date.now());

  function call(criterion: Criterion, args: readonly string[], what: string): CallResult {
    const limit = waitLimitMs(CALL_TIMEOUT_MS, left());
    if (limit <= 0) throw new CheckFailure("budget", "the budget ran out before " + what);
    const r = compose(root, args, limit);
    if (r.timedOut) {
      throw new CheckFailure(timeoutLabel(criterion, CALL_TIMEOUT_MS, limit), what + " timed out");
    }
    if (r.status !== 0) throw new CheckFailure(criterion, what + " exited " + String(r.status));
    return r;
  }

  /** One bounded host-loopback request: the limit, the naming and the failure mapping. */
  async function bounded(
    criterion: Criterion,
    what: string,
    run: (limitMs: number) => Promise<LoopbackReply>,
  ): Promise<LoopbackReply> {
    const leftAtStart = left();
    const limit = waitLimitMs(STREAM_LIMIT_MS, leftAtStart);
    if (limit <= 0) throw new CheckFailure("budget", "the budget ran out before " + what);
    try {
      return await run(limit);
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        throw new CheckFailure(
          timeoutLabel(criterion, STREAM_LIMIT_MS, leftAtStart),
          what + " timed out",
        );
      }
      throw new CheckFailure(criterion, what + " failed to connect or read");
    }
  }

  const harness: Harness = {
    left,

    logs(criterion) {
      const r = call(
        criterion,
        ["logs", "--no-color", "--no-log-prefix", "gateway"],
        "reading the gateway log",
      );
      const parsed = parseLogLines(r.stdout);
      if (!parsed.ok) {
        throw new CheckFailure(
          criterion,
          "gateway log line " + String(parsed.lineNo) + " is not JSON",
        );
      }
      return parsed.entries;
    },

    cli(criterion, service, args) {
      const what = service + " cli " + (args[0] ?? "");
      const r = call(criterion, ["exec", "-T", service, "node", "dist/cli.js", ...args], what);
      const body = parseJsonObject(r.stdout.trim());
      if (body === null || body["ok"] !== true) {
        throw new CheckFailure(criterion, what + " gave no ok response");
      }
      return body;
    },

    composeOk(criterion, args) {
      call(criterion, args, "docker compose " + (args[0] ?? ""));
    },

    composeText(criterion, args) {
      return call(criterion, args, "docker compose " + (args[0] ?? "")).stdout;
    },

    async get(criterion, port, path, enough) {
      return await bounded(criterion, "GET " + path + " on port " + String(port), (limit) =>
        loopbackGet(port, path, limit, enough),
      );
    },

    async post(criterion, port, path, body) {
      return await bounded(criterion, "POST " + path + " on port " + String(port), (limit) =>
        loopbackPost(port, path, body, limit),
      );
    },

    async waitFor(criterion, limitMs, check) {
      const leftAtStart = left();
      const limit = waitLimitMs(limitMs, leftAtStart);
      const deadline = Date.now() + limit;
      for (;;) {
        const verdict = check();
        if (verdict.status === "pass") return;
        if (verdict.status === "fail") throw new CheckFailure(criterion, verdict.why);
        if (Date.now() >= deadline) {
          throw new CheckFailure(timeoutLabel(criterion, limitMs, leftAtStart), verdict.why);
        }
        await sleep(POLL_MS);
      }
    },

    async holdUntil(criterion, untilMs, check) {
      for (;;) {
        const verdict = check();
        if (verdict.status === "fail") throw new CheckFailure(criterion, verdict.why);
        if (Date.now() >= untilMs) return;
        if (left() <= 0) throw new CheckFailure("budget", "the budget ran out during " + criterion);
        await sleep(POLL_MS);
      }
    },
  };
  return harness;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : [];
}

function stringField(body: Json, key: string, criterion: Criterion): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") {
    throw new CheckFailure(criterion, "response has no " + key);
  }
  return value;
}

/** Steps 23.1–23.8 against one running stack, sharing ids between steps. */
function acceptanceSteps(h: Harness): readonly Step[] {
  const deviceId = DEVICE_ID_VALUE;
  /** Event ids fired in step 23.2, in firing order. */
  const fired: string[] = [];

  const windowFrom = (entries: readonly LogEntry[], from: number): readonly LogEntry[] =>
    entries.slice(from);

  async function sendAndWaitDone(action: string, data: Json): Promise<void> {
    const c: Criterion = "23.3";
    const from = h.logs(c).length;
    const sent = h.cli(c, "gateway", ["send", deviceId, action, JSON.stringify(data)]);
    const cmdId = stringField(sent, "cmd_id", c);
    await h.waitFor(c, COMMAND_LIMIT_MS, () => {
      const verdict = checkCommandDone(windowFrom(h.logs(c), from), cmdId);
      if (verdict.status !== "pass") return verdict;
      const state = h.cli(c, "simulator", ["state"]);
      return stateHasCommand(state, cmdId) ? verdict : pending("waiting for the simulator state");
    });
  }

  return [
    {
      criterion: "23.1",
      async run() {
        const c: Criterion = "23.1";
        // The gateway starts first and subscribes before the simulator's hello goes out, so the
        // hello cannot be lost to a not-yet-subscribed gateway.
        h.composeOk(c, ["up", "-d", "emqx", "gateway"]);
        const upReturned = Date.now();
        const sinceUp = (): number => Date.now() - upReturned;
        await h.waitFor(c, STARTUP_LIMIT_MS, () =>
          h.logs(c).some((e) => e["kind"] === "gateway" && e["state"] === "broker_connected")
            ? PASS
            : pending("waiting for broker_connected"),
        );
        h.composeOk(c, ["up", "-d", "simulator"]);
        await h.waitFor(c, Math.max(0, STARTUP_LIMIT_MS - sinceUp()), () =>
          checkStartup(h.logs(c), deviceId),
        );
      },
    },
    {
      // Phase 1.3 C14: both surfaces are published on host loopback only, and the published
      // port reaches the Operator_Stream through the unchanged Host guard.
      criterion: "stream",
      async run() {
        const c: Criterion = "stream";
        const published: readonly (readonly [Service, number])[] = [
          ["gateway", OPERATOR_PORT],
          ["simulator", PANEL_PORT],
        ];
        for (const [service, port] of published) {
          const verdict = checkPublishedPort(
            h.composeText(c, ["port", service, String(port)]),
            port,
          );
          if (verdict.status !== "pass") throw new CheckFailure(c, service + ": " + verdict.why);
        }
        const stream = await h.get(
          c,
          OPERATOR_PORT,
          OPERATOR_STREAM_PATH,
          (body) => firstSseEvent(body) !== null,
        );
        if (stream.status !== 200) {
          throw new CheckFailure(c, "the stream answered " + String(stream.status));
        }
        const devices = checkFirstDevicesEvent(stream.body, deviceId);
        if (devices.status !== "pass") throw new CheckFailure(c, devices.why);
        const panel = await h.get(c, PANEL_PORT, "/", () => false);
        if (panel.status !== 200) {
          throw new CheckFailure(c, "the simulator panel answered " + String(panel.status));
        }
      },
    },
    {
      // Phase 3B (Req 22.1): one conversation turn end to end, from a named Test_Utterance on
      // the published panel port to a spoken reply, watched on the gateway log and the
      // operator stream. It runs here, while the log is still short, so the stream's entry
      // backlog cannot crowd the bounded read.
      criterion: "conversation",
      async run() {
        const c: Criterion = "conversation";
        // The active child first: the Gateway takes it from the device's own `status`, so a
        // `config` command sets it and the next status carries it to the Gateway.
        const beforeConfig = h.logs(c).length;
        const configured = h.cli(c, "gateway", [
          "send",
          deviceId,
          "config",
          JSON.stringify(ACTIVE_CHILD_DATA),
        ]);
        const configId = stringField(configured, "cmd_id", c);
        await h.waitFor(c, COMMAND_LIMIT_MS, () =>
          checkCommandDone(windowFrom(h.logs(c), beforeConfig), configId),
        );
        const beforeStatus = h.logs(c).length;
        await h.waitFor(c, ACTIVE_CHILD_LIMIT_MS, () =>
          windowFrom(h.logs(c), beforeStatus).some((e) => isMessageIn(e, deviceId, "status"))
            ? PASS
            : pending("waiting for the status that carries the active child"),
        );

        const from = h.logs(c).length;
        const posted = await h.post(
          c,
          PANEL_PORT,
          AUDIO_TURN_PATH,
          JSON.stringify({ utterance: CONVERSATION_UTTERANCE }),
        );
        if (posted.status !== 200) {
          throw new CheckFailure(c, "the audio turn answered " + String(posted.status));
        }
        const body = parseJsonObject(posted.body);
        if (body === null || body["ok"] !== true) {
          throw new CheckFailure(c, "the audio turn gave no ok response");
        }
        const turnId = stringField(body, "turn_id", c);
        // One bounded stream read that settles as soon as the turn stops moving, so a turn that
        // ends `interrupted` or `failed` is named by the verdict instead of by a timeout.
        const stream = await h.get(c, OPERATOR_PORT, OPERATOR_STREAM_PATH, (text) =>
          isTerminalTurnState(turnViewState(text, turnId)),
        );
        if (stream.status !== 200) {
          throw new CheckFailure(c, "the stream answered " + String(stream.status));
        }
        await h.waitFor(c, CONVERSATION_LIMIT_MS, () =>
          checkConversation(windowFrom(h.logs(c), from), stream.body, deviceId, turnId),
        );
      },
    },
    {
      criterion: "23.2",
      async run() {
        const c: Criterion = "23.2";
        const choices = h.cli(c, "simulator", ["state"])["choices"];
        const zones = isPlainObject(choices) ? stringList(choices["touch_zones"]) : [];
        const kinds = isPlainObject(choices) ? stringList(choices["event_kinds"]) : [];
        if (zones.length === 0 || !kinds.includes("touch")) {
          throw new CheckFailure(c, "the simulator state lists no choices");
        }
        const firings: { kind: string; data?: Json }[] = [
          ...zones.map((zone) => ({ kind: "touch", data: { zone } })),
          ...kinds.filter((k) => k !== "touch").map((kind) => ({ kind })),
        ];
        const from = h.logs(c).length;
        for (const firing of firings) {
          const args = ["event", firing.kind];
          if (firing.data !== undefined) args.push(JSON.stringify(firing.data));
          const result = h.cli(c, "simulator", args);
          if (result["queued"] !== false) throw new CheckFailure(c, "an event was queued");
          const eventId = stringField(result, "event_id", c);
          fired.push(eventId);
          await h.waitFor(c, EVENT_LIMIT_MS, () => {
            const window = windowFrom(h.logs(c), from);
            const clean = checkEventStepClean(window);
            return clean.status === "fail" ? clean : checkEventLogged(window, deviceId, eventId);
          });
        }
        if (new Set(fired).size !== firings.length) throw new CheckFailure(c, "event ids repeat");
        const window = windowFrom(h.logs(c), from);
        for (const verdict of [
          checkEventStepClean(window),
          ...fired.map((id) => checkEventLogged(window, deviceId, id)),
        ]) {
          if (verdict.status !== "pass") {
            throw new CheckFailure(
              c,
              verdict.status === "fail" ? verdict.why : "an event is missing",
            );
          }
        }
      },
    },
    {
      criterion: "23.3",
      async run() {
        await sendAndWaitDone("say", SAY_DATA);
        await sendAndWaitDone("animate", ANIMATE_DATA);
      },
    },
    {
      criterion: "23.4",
      async run() {
        const c: Criterion = "23.4";
        h.cli(c, "simulator", ["ack-policy", "set", "animate", "reject", REJECT_REASON]);
        const from = h.logs(c).length;
        const sent = h.cli(c, "gateway", [
          "send",
          deviceId,
          "animate",
          JSON.stringify(ANIMATE_DATA),
        ]);
        const sentAt = Date.now();
        const cmdId = stringField(sent, "cmd_id", c);
        const check = (): Verdict => checkRejectedOnly(windowFrom(h.logs(c), from), cmdId);
        await h.waitFor(c, COMMAND_LIMIT_MS, () => {
          const verdict = check();
          if (verdict.status !== "pass") return verdict;
          const state = h.cli(c, "simulator", ["state"]);
          return stateHasCommand(state, cmdId)
            ? verdict
            : pending("waiting for the simulator state");
        });
        await h.holdUntil(c, sentAt + REJECT_HOLD_MS, check);
        h.cli(c, "simulator", ["ack-policy", "clear", "animate"]);
      },
    },
    {
      criterion: "23.5",
      async run() {
        const c: Criterion = "23.5";
        const from = h.logs(c).length;
        const turnId = stringField(h.cli(c, "simulator", ["audio-turn"]), "turn_id", c);
        await h.waitFor(c, COMMAND_LIMIT_MS, () => {
          const verdict = checkAudioTurn(windowFrom(h.logs(c), from), deviceId, turnId);
          if (verdict.status !== "pass") return verdict;
          return checkLastTurn(h.cli(c, "simulator", ["state"]), turnId);
        });
      },
    },
    {
      criterion: "23.6",
      async run() {
        const c: Criterion = "23.6";
        const priorIds = fired.slice(-REPLAYED_EVENTS);
        if (priorIds.length !== REPLAYED_EVENTS) throw new CheckFailure(c, "too few prior events");
        h.cli(c, "simulator", ["duplicate-replay", "on"]);
        const before = deviceCounts(h.cli(c, "gateway", ["devices"]), deviceId);
        if (before === null) throw new CheckFailure(c, "the devices snapshot has no counts");
        const from = h.logs(c).length;
        h.cli(c, "simulator", ["offline"]);
        const queuedEvent = h.cli(c, "simulator", ["event", "touch"]);
        if (queuedEvent["queued"] !== true) throw new CheckFailure(c, "the event was not queued");
        const queuedId = stringField(queuedEvent, "event_id", c);
        h.cli(c, "simulator", ["online"]);
        await h.waitFor(c, COMMAND_LIMIT_MS, () =>
          checkReplay(windowFrom(h.logs(c), from), {
            queuedId,
            priorIds,
            before,
            after: deviceCounts(h.cli(c, "gateway", ["devices"]), deviceId),
          }),
        );
        h.cli(c, "simulator", ["duplicate-replay", "off"]);
      },
    },
    {
      criterion: "23.7",
      async run() {
        const c: Criterion = "23.7";
        const from = h.logs(c).length;
        h.cli(c, "simulator", ["offline"]);
        await h.waitFor(c, SILENCE_LIMIT_MS, () => checkSilence(h.logs(c), deviceId, from));
      },
    },
    {
      criterion: "23.8",
      async run() {
        const c: Criterion = "23.8";
        const from = h.logs(c).length;
        h.cli(c, "simulator", ["online"]);
        await h.waitFor(c, COMMAND_LIMIT_MS, () =>
          checkReconnect(windowFrom(h.logs(c), from), deviceId),
        );
      },
    },
  ];
}

function write(line: string): void {
  process.stdout.write(line + "\n");
}

/** The gateway and simulator logs, token-redacted (defence in depth; neither logs it). */
function printLogs(root: string, token: string): void {
  for (const service of ["gateway", "simulator"] as const) {
    const r = compose(root, ["logs", "--no-color", "--no-log-prefix", service], CALL_TIMEOUT_MS);
    write("--- " + service + " log ---");
    process.stdout.write(redact(r.stdout + r.stderr, token));
  }
}

async function main(): Promise<number> {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const envPath = join(root, ".env");
  const token = newDeviceToken();

  // Req 23.11: refuse explicitly, before anything is written, when the developer already has a
  // root env file. It is never overwritten and never deleted; `cleanup` below can only remove
  // the file this process itself created.
  const refusal = rootEnvRefusalFor(envPath);
  if (refusal.length > 0) {
    for (const line of refusal) write(line);
    return 1;
  }

  // Past the refusal with a file still there means it is this check's own, by its sentinel: an
  // earlier run was killed before its cleanup. Replace it rather than refusing forever.
  if (existsSync(envPath)) {
    write(ROOT_ENV_RECLAIMED_NOTE);
    rmSync(envPath, { force: true });
  }

  try {
    writeFileSync(envPath, envFileText(localEnvEntries(token)), { flag: "wx", mode: 0o600 });
  } catch {
    // The `wx` flag still guards the race between the check above and this write.
    write("FAILED 23.11");
    write(ROOT_ENV_UNWRITABLE_REASON);
    return 1;
  }

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    compose(root, ["down", "-v"], 120_000);
    rmSync(envPath, { force: true });
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    write("Compose_Acceptance_Check: DEVICE_ID " + DEVICE_ID_VALUE);
    const startMs = Date.now();
    const harness = createHarness(root, startMs);
    const steps = acceptanceSteps(harness).map((step): Step => ({
      criterion: step.criterion,
      async run() {
        await step.run();
        write("ok " + step.criterion);
      },
    }));
    const result = await runInOrder(steps, harness.left);
    write(resultLine(result));
    if (result.ok) return 0;
    write("reason: " + redact(result.why, token));
    printLogs(root, token);
    return 1;
  } finally {
    cleanup();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function isEntryPoint(): boolean {
  const arg = process.argv[1];
  if (arg === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  const given = resolve(arg);
  return process.platform === "win32" ? given.toLowerCase() === self.toLowerCase() : given === self;
}

if (isEntryPoint()) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // Only cleanup can get here (runInOrder catches every step error).
      write("FAILED 23.11");
      process.exitCode = 1;
    },
  );
}
