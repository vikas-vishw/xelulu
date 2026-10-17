// The gateway composition root (design "Gateway / Composition"). createGateway wires the pure
// cores to the injected transports. Nothing opens a socket until start(), which runs in order:
// `gateway` `starting`; audio listen, then `audio_listening`; in Local_Mode only, the
// Operator_Surface on 127.0.0.1 (0.0.0.0 with the Listen_All_Argument); then the broker session. Before handling any inbound message or
// request, due deadlines fire first (D3, G49). Per inbound MQTT message: classify, `message_in`
// first, then hello auth, status Heartbeat, event dedupe (barge-in on a new `interrupt`) or ack
// tracking. The Fake_Reply is the Audio_Server's only TurnResponder (Req 14.2). The
// Operator_Surface's /v1/stream goes to the Operator_Stream hub, which stop() closes first.
import { createStarterContent, createStarterWords } from "@xelulu/shared";
import type {
  ConversationTurnView,
  DeviceSummary,
  GatewayLogEntryOf,
  ProviderCapability,
  ProviderId,
} from "@xelulu/shared";

import type { AudioListen, AudioSocket } from "./audio/audio-transport.js";
import { createAudioServer } from "./audio/audio-server.js";
import { NO_FILLER, prerenderFiller, type FillerAudio } from "./brain/filler.js";
import { createDefaultProviders } from "./brain/providers/default-providers.js";
import { createAlerts, type Alerts } from "./brain/state/alerts.js";
import { createChildContextTable, type ChildContextTable } from "./brain/state/child-context.js";
import { createTranscriptStore, type TranscriptStore } from "./brain/state/transcript-store.js";
import { createMemoryStore } from "./brain/state/memory-store.js";
import { checkProviders } from "./brain/providers/provider-gate.js";
import type { LlmProvider } from "./brain/providers/llm-provider.js";
import type { SttProvider } from "./brain/providers/stt-provider.js";
import type { TtsProvider } from "./brain/providers/tts-provider.js";
import { createStorySessions } from "./brain/story/story-session.js";
import { localMinutes } from "./brain/story/word-of-the-day.js";
import { createContentLibrary } from "./brain/tools/content-library.js";
import { createDeviceActions } from "./brain/tools/device-action.js";
import { createToolRouter } from "./brain/tools/tool-router.js";
import { createChargeReminders } from "./routines/charge-reminders.js";
import { createPlayTime } from "./routines/play-time.js";
import { createRoutineScheduler } from "./routines/routine-scheduler.js";
import { createRoutineStore } from "./routines/routine-store.js";
import { createActivityStore } from "./reports/activity-store.js";
import { createVoiceBrain } from "./brain/voice-brain.js";
import type { Clock } from "./clock.js";
import type { GatewayConfig } from "./config.js";
import { createContentStore } from "./content/content-store.js";
import { createDeadlines } from "./deadlines.js";
import { createDedupeStore } from "./devices/dedupe-store.js";
import { createConsentStore } from "./grandma/consent-store.js";
import { createGrandmaStore } from "./grandma/grandma-store.js";
import { grandmaPlaybackNarration } from "./routines/routine-behaviours.js";
import { createPresence, presenceDeadlineKey, type HeartbeatCause } from "./devices/presence.js";
import { createRegistry } from "./devices/registry.js";
import type { IdSource } from "./ids.js";
import { localSurfaceHost } from "./listen-host.js";
import { createGatewayLog, type GatewayLog, type LogEntryFields } from "./log/gateway-log.js";
import type { LineSink } from "./log/logger.js";
import { createAckTracker } from "./mqtt/ack-tracker.js";
import { createBrokerSession } from "./mqtt/broker-session.js";
import {
  createCommandSender,
  type CommandRequest,
  type CommandResult,
} from "./mqtt/command-sender.js";
import { classifyInbound, type InboundDecision } from "./mqtt/inbound-pipeline.js";
import type { MqttConnector } from "./mqtt/mqtt-transport.js";
import {
  checkStreamRequest,
  handleOperatorRequest,
  preflightOperatorRequest,
  type HttpRequestIn,
  type HttpResponseOut,
  type OperatorListen,
  type OperatorRouteDeps,
} from "./operator/operator-routes.js";
import { buildDeviceSummaries, createStatusMemory } from "./operator/device-summary.js";
import { createConversationLog } from "./operator/conversation-log.js";
import { createOperatorStreams, type StreamSink } from "./operator/operator-stream.js";
import {
  buildBrainSnapshot,
  buildDevicesSnapshot,
  type DevicesSnapshot,
  type ProviderSnapshot,
} from "./operator/snapshot.js";

export type GatewayDeps = Readonly<{
  clock: Clock;
  connectMqtt: MqttConnector;
  listenAudio: AudioListen;
  listenOperator: OperatorListen;
  sink: LineSink;
  ids: IdSource;
  /** Test only: listen on these ports instead of the Config's (0 = OS-assigned). */
  listenPorts?: Readonly<{ audio?: number; operator?: number }>;
  /** Started with the Listen_All_Argument (Req 3.1, C8); counts only in Local_Mode. Default false. */
  listenAllInterfaces?: boolean;
  /**
   * Started with the Transcripts_Argument (Phase 3 C4); counts only in Local_Mode. Default
   * false, so transcript text never reaches the operator channel unless it was asked for.
   */
  operatorTranscripts?: boolean;
  /** Test only: providers to use instead of the mocks. Production builds only the mocks (C7). */
  providers?: Readonly<{ stt: SttProvider; llm: LlmProvider; tts: TtsProvider }>;
  /** Phase 3B consumes this; in 3A nothing does (C4). */
  onTurnView?: (view: ConversationTurnView) => void;
}>;

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly log: GatewayLog;
  sendCommand(req: CommandRequest): CommandResult;
  snapshot(): DevicesSnapshot;
  /** The Operator_Stream's Device_Summaries, one per Registered_Device (Phase 1.3 Req 2.2). */
  summaries(): readonly DeviceSummary[];
  /** The audio port actually listened on (0 before start). */
  audioPort(): number;
  /** The Operator_Surface port actually listened on; null outside Local_Mode or before start. */
  operatorPort(): number | null;
  /**
   * The brain's in-process state (Phase 3 C10). Exposed so the Operator_Surface (Phase 3B) and
   * the tests can read it; it holds transcripts, alerts and the Child_Context table, all of
   * which are lost on restart.
   */
  readonly brain: Readonly<{
    transcripts: TranscriptStore;
    alerts: Alerts;
    context: ChildContextTable;
  }>;
}

/** start() rejects with this when the Operator_Surface cannot listen (Req 13.8). No message. */
export class OperatorListenError extends Error {
  constructor() {
    super();
    this.name = "OperatorListenError";
  }
}

/**
 * start() rejects with this when a provider's declaration is not "no retention, no training"
 * (Req 1.3, 1.4, C8). It carries the capability and the provider id and NO other value, because
 * those are the only two things the refusal line may name. There is no degraded mode: a gateway
 * that cannot run a turn safely opens no listener at all.
 */
export class ProviderRefusedError extends Error {
  readonly capability: ProviderCapability;
  readonly provider: ProviderId;

  constructor(capability: ProviderCapability, provider: ProviderId) {
    super();
    this.name = "ProviderRefusedError";
    this.capability = capability;
    this.provider = provider;
  }
}

type Listener = { readonly port: number; close(): Promise<void> };

/**
 * `GatewayLog.add`'s own parameter type: one Log_Entry's fields, before the log stamps them with
 * `log_ver`, `seq` and `at`. Used by the held seed buffer below, so what is held is exactly what
 * `add` takes and the flush needs no cast.
 */
type HeldLogEntry = Parameters<GatewayLog["add"]>[0];

const BEARER_PREFIX = "Bearer ";

/** The message_in entry for an accepted MQTT message (Req 4.6): identifiers, never values. */
function messageInEntry(
  d: Exclude<InboundDecision, { kind: "reject" }>,
): LogEntryFields<"message_in"> {
  const base = {
    kind: "message_in" as const,
    transport: "mqtt" as const,
    device_id: d.deviceId,
    event_id: null,
    cmd_id: null,
    turn_id: null,
    battery_pct: null,
    charging: null,
    mode: null,
  };
  switch (d.kind) {
    case "hello":
      return { ...base, topic_suffix: "status", variant: "hello" };
    case "status":
      return {
        ...base,
        topic_suffix: "status",
        variant: "status",
        battery_pct: d.message.battery_pct,
        charging: d.message.charging,
        mode: d.message.mode,
      };
    case "event":
      return {
        ...base,
        topic_suffix: "event",
        variant: d.message.event,
        event_id: d.message.event_id,
      };
    case "ack":
      return { ...base, topic_suffix: "ack", variant: "ack", cmd_id: d.message.cmd_id };
  }
}

export function createGateway(config: GatewayConfig, deps: GatewayDeps): Gateway {
  const { clock, ids } = deps;
  const deviceIds: readonly string[] = Object.freeze([config.device.deviceId]);
  const deadlines = createDeadlines(clock);
  const log = createGatewayLog(clock, deps.sink);
  const registry = createRegistry(config.device);
  const presence = createPresence({ deadlines, onSilence: (change) => log.add(change) });
  const dedupe = createDedupeStore();
  const statusMemory = createStatusMemory();
  const tracker = createAckTracker({ deadlines, log });

  let started = false;
  let stopped = false;
  let audioListener: Listener | null = null;
  let operatorListener: Listener | null = null;
  const requestedOperatorPort = deps.listenPorts?.operator ?? config.operatorPort;

  const fireDue = (): void => deadlines.fireDue(clock.now());

  function heartbeat(deviceId: string, cause: HeartbeatCause): void {
    const change = presence.heartbeat(deviceId, clock.now(), cause);
    if (change !== null) log.add(change);
  }

  function handleInbound(topic: string, payload: Uint8Array): void {
    if (stopped) return;
    fireDue();
    const d = classifyInbound(topic, payload, registry);
    if (d.kind === "reject") {
      log.add(d.entry);
      return;
    }
    // Recorded before its message_in entry, so a stream sees the new values with it (Req 2.3).
    if (d.kind === "status") {
      statusMemory.record(d.deviceId, d.message.battery_pct, d.message.charging);
      // The active child comes from the device's own status (Phase 3 C9). The id is a lookup
      // key and is never logged.
      childContext.setActiveChild(d.deviceId, d.message.active_child_id ?? null);
    }
    log.add(messageInEntry(d));
    switch (d.kind) {
      case "hello": {
        const outcome = registry.checkHello(d.deviceId, d.message.auth);
        log.add({ kind: "auth", transport: "mqtt", device_id: d.deviceId, outcome });
        if (outcome === "ok") heartbeat(d.deviceId, "hello");
        return;
      }
      case "status":
        heartbeat(d.deviceId, "status");
        // The charge reminder reads the battery only from an accepted `status`, after the
        // Child_Context update above so a reminder is gated against the right child (Req 11.1).
        scheduler.onStatus(d.deviceId, d.message.battery_pct, d.message.charging);
        return;
      case "event": {
        const entry = dedupe.process(d.deviceId, d.message, clock.now());
        log.add(entry);
        // Only a new interrupt barges in; a duplicate changes nothing (Req 11.1, 11.4).
        if (entry.kind === "event_accepted" && d.message.event === "interrupt") {
          audio.bargeIn(d.deviceId);
        }
        return;
      }
      case "ack":
        tracker.handleAck(d.deviceId, d.message);
        return;
    }
  }

  const session = createBrokerSession({
    broker: config.broker,
    deviceIds,
    connect: deps.connectMqtt,
    clock,
    deadlines,
    ids,
    log,
    onMessage: handleInbound,
  });
  const sender = createCommandSender({
    registry,
    presence,
    broker: session,
    ids,
    tracker,
    clock,
    log,
  });
  // The Voice_Brain replaces the Phase 1.2 Fake_Reply behind the unchanged TurnResponder seam
  // (Phase 3 C1). Only the mock providers are constructible in this phase (C7), so no key is
  // read and no socket is opened by any of them.
  const childContext = createChildContextTable();
  const transcripts = createTranscriptStore({ clock, deadlines, log });
  // The Activity_Store (Phase 4 Req 14.1): the counted things that happened, in memory, bounded
  // and lost on restart. Built here, ahead of its writers — the Parent_Alerts' cry path, the
  // Voice_Brain's turn path, the Routine_Scheduler and Play_Accrual — so all four share one.
  const activity = createActivityStore({ ids });
  const alerts = createAlerts({ clock, ids, log, activity });
  const memory = createMemoryStore();
  // One Routine_Store serves `routine_lookup`, the Device_Policy_Gate's `playMinutesUsed` read
  // and the Routine_Scheduler, seeded from the Starter_Content's six templates — the one source
  // of truth for the six routine times (Phase 4 Req 10.1a).
  const routines = createRoutineStore({ clock });
  /** The Word_Of_The_Day entries, shared by the turn path and the morning routine (C10). */
  const words = createStarterWords();
  // The curated library (Phase 4 C1): seeded from the Starter_Content, gated on the way in, and
  // in memory only — it writes no file, opens no socket and is gone on restart.
  //
  // The store seeds itself at construction and adds one `content_gate` entry per seeded item
  // (Req 2.5). Composition runs BEFORE start(), so those entries are held here and written when
  // the gateway is up: the log's first entries stay the lifecycle ones a reader expects —
  // `starting`, the provider checks, then `audio_listening` — and the seed report sits after
  // them rather than ahead of the gateway's own birth.
  const heldSeedEntries: HeldLogEntry[] = [];
  const content = createContentStore({
    clock,
    log: {
      // The buffer holds `add`'s own parameter type, so the fields are checked where they are
      // constructed and the flush below needs no cast. The one cast left is the function's
      // shape: `add` answers the stored entry, which carries a `seq` only the real log can
      // issue, and the seed path ignores the answer.
      add: ((fields: HeldLogEntry) => {
        heldSeedEntries.push(fields);
        return fields;
      }) as GatewayLog["add"],
    },
    seed: createStarterContent(),
  });
  const stories = createStorySessions({ clock, log, content });
  // The ONE policy gate (C16, safety.md §5). Every Phase 4 behaviour — routines, charge
  // reminders, the nap, Grandma playback and the Grandma call — goes through this object, and
  // nothing in `src/routines/` or `src/grandma/` calls `sendCommand`.
  const deviceActions = createDeviceActions({
    sendCommand: sender.sendCommand,
    context: childContext,
    routines,
    // Local minutes past midnight, from the one Clock and the one notion of "local".
    nowMinutes: () => localMinutes(clock.now()),
  });
  const tools = createToolRouter({
    log,
    content: createContentLibrary({ content, words, clock }),
    stories,
    routines,
    memory,
    context: childContext,
    device: deviceActions,
  });
  // Routines, reminders, the Grandma schedules and the play ledger. The pair below is bound in
  // one direction each: `createPlayTime` takes `fireNap` from the scheduler, and the scheduler
  // takes `accruePlay` from it, so neither module imports the other's factory (Req 13.5a).
  const consent = createConsentStore({ clock, ids });
  const grandma = createGrandmaStore({
    clock,
    ids,
    log,
    consent,
    narration: grandmaPlaybackNarration,
  });
  const playTime = createPlayTime({
    clock,
    routines,
    context: childContext,
    activity,
    fireNap: (deviceId) => scheduler.fireNap(deviceId),
  });
  const scheduler = createRoutineScheduler({
    clock,
    deadlines,
    log,
    actions: deviceActions,
    context: childContext,
    routines,
    grandma,
    reminders: createChargeReminders(),
    activity,
    play: playTime,
    words,
    // Scheduler_Devices (Req 10.13). The `Registry` holds per-device predicates only and
    // `createRegistry` takes exactly one device, so the list is a composition-root concern and
    // the interface gains no enumeration member. Called on every tick, never cached.
    devices: () =>
      registry.isRegistered(config.device.deviceId) && registry.helloSeen(config.device.deviceId)
        ? [config.device.deviceId]
        : [],
  });

  // The Filler is synthesised at start(); until then there is none, which only means a slow turn
  // waits in silence rather than failing (C15).
  let fillerAudio: FillerAudio = NO_FILLER;
  const filler: FillerAudio = { frames: (lang) => fillerAudio.frames(lang) };

  // One set of provider instances, shared by the start-up gate and the brain, so the gate
  // checks exactly what the turns will use.
  const providers = deps.providers ?? createDefaultProviders({ clock, deadlines });

  /** What `GET /v1/brain` reports per capability: the gate's own two booleans and the id (D3). */
  const providerRows: readonly ProviderSnapshot[] = Object.freeze(
    (
      [
        ["stt", providers.stt],
        ["llm", providers.llm],
        ["tts", providers.tts],
      ] as const
    ).map(([capability, provider]): ProviderSnapshot => ({
      capability,
      provider: provider.id,
      retains: provider.dataHandling.vendorRetainsRequestData,
      trains: provider.dataHandling.vendorMayTrainOnRequestData,
    })),
  );

  // The retained Conversation_Turn_Views: a new Operator_Stream's `turn` backlog and the body of
  // `GET /v1/conversation` (D1). Never written to stdout and never put in a Log_Entry (Req 18.6).
  const conversationLog = createConversationLog();

  /**
   * The view fan-out (D4), in order: hold it, send it to every open stream, then hand it to the
   * optional dep that Phase 3A's tests pass. The view's text fields were already decided by
   * `includeTranscriptText` below, so nothing here re-checks the Transcripts_Argument.
   */
  const onTurnView = (view: ConversationTurnView): void => {
    conversationLog.record(view);
    streams.publishTurn(view);
    deps.onTurnView?.(view);
  };

  const responder = createVoiceBrain({
    clock,
    deadlines,
    log,
    sendCommand: sender.sendCommand,
    stt: providers.stt,
    llm: providers.llm,
    tts: providers.tts,
    tools,
    stories,
    // Read for a finished story's `categories` only; the one play-minute writer; the one store.
    content,
    activity,
    play: playTime,
    context: childContext,
    transcripts,
    alerts,
    filler,
    includeTranscriptText: config.localMode && (deps.operatorTranscripts ?? false),
    onTurnView,
  });
  const audio = createAudioServer({
    clock,
    deadlines,
    log,
    responder,
    openStt: responder.openStt,
    sendCommand: sender.sendCommand,
  });

  const snapshot = (): DevicesSnapshot =>
    buildDevicesSnapshot({ deviceIds, presence, registry, dedupe, tracker });

  const summaries = (): readonly DeviceSummary[] =>
    buildDeviceSummaries({ deviceIds, presence, dedupe, status: statusMemory });

  // The Operator_Stream hub only reads the Gateway_Log, the summaries and the retained views
  // (Phase 1.3 Req 1.10).
  const streams = createOperatorStreams({
    log,
    summaries,
    views: () => conversationLog.views(),
    clock,
  });

  /** Due deadlines first (D3), then the query check, then the hub: a refusal, or null once open. */
  function openStream(req: HttpRequestIn, sink: StreamSink): HttpResponseOut | null {
    fireDue();
    const refused = checkStreamRequest(req);
    if (refused !== null) return refused;
    const opened = streams.open(sink);
    return opened.ok ? null : opened.refusal;
  }

  const sendCommand = (req: CommandRequest): CommandResult => {
    fireDue();
    return sender.sendCommand(req);
  };

  /** The device for `Authorization: Bearer <token>`, compared in constant time; else null. */
  function authenticate(authorization: string | undefined): string | null {
    if (authorization === undefined || !authorization.startsWith(BEARER_PREFIX)) return null;
    const token = authorization.slice(BEARER_PREFIX.length);
    return token === "" ? null : registry.deviceForToken(token);
  }

  const routeDeps: OperatorRouteDeps = {
    port: () => operatorListener?.port ?? requestedOperatorPort,
    snapshot,
    logSince: (after) => log.since(after),
    sendCommand: sender.sendCommand,
    conversation: () => conversationLog.views(),
    brain: () => buildBrainSnapshot({ transcripts, alerts, providers: providerRows }),
    deleteAllTranscripts: () => transcripts.deleteAll(),
  };

  function stoppingEntry(): GatewayLogEntryOf<"gateway"> {
    return log.add({ kind: "gateway", state: "stopping" });
  }

  return {
    log,
    sendCommand,
    snapshot,
    summaries,
    audioPort: () => audioListener?.port ?? 0,
    operatorPort: () => operatorListener?.port ?? null,
    brain: { transcripts, alerts, context: childContext },

    async start() {
      if (started || stopped) return;
      started = true;
      log.add({ kind: "gateway", state: "starting" });

      // The provider gate runs before any listener opens (Req 1.3, 1.4). A provider that cannot
      // declare no retention and no training stops the gateway rather than being disabled, so a
      // safety failure can never hide behind a timeout.
      const gate = checkProviders({ log }, providers);
      if (!gate.ok) throw new ProviderRefusedError(gate.capability, gate.provider);

      // The Filler is Xelulu's own speech, synthesised once here and held in memory only (C15).
      fillerAudio = await prerenderFiller(providers.tts);

      audioListener = await deps.listenAudio({
        host: config.audio.listenHost,
        port: deps.listenPorts?.audio ?? config.audio.port,
        authenticate,
        onAuthFailed: () => {
          if (stopped) return;
          fireDue();
          log.add({ kind: "auth", transport: "ws", device_id: null, outcome: "failed" });
        },
        onTurn: (deviceId: string, socket: AudioSocket) => {
          fireDue();
          audio.openTurn(deviceId, socket);
        },
      });
      log.add({ kind: "gateway", state: "audio_listening" });

      // The curated library's seed report (Req 2.5), held from composition until the gateway is
      // up so it cannot precede the lifecycle entries above. A start that fails BEFORE this
      // point — a refused provider, a listener that cannot bind — drops the report, and that is
      // left as it is on purpose: moving the flush earlier, or adding one on the failure path,
      // would put `content_gate` entries inside the lifecycle prefix that four Phase 1.2 and
      // Phase 3 tests pin, including provider-gate's "the log stops at the gate". It is a
      // visible change to what a failed start prints, so it is recorded for Omar rather than
      // made here (Phase 4 wave-1 review finding 3).
      for (const fields of heldSeedEntries.splice(0)) log.add(fields);

      // The Operator_Surface exists only in Local_Mode (Req 13.2), on 127.0.0.1, or on 0.0.0.0
      // with the Listen_All_Argument (Phase 1.3 Req 3.1, superseding Req 13.1).
      if (config.localMode) {
        try {
          operatorListener = await deps.listenOperator({
            host: localSurfaceHost(config.localMode, deps.listenAllInterfaces ?? false),
            port: requestedOperatorPort,
            preflight: (head) => preflightOperatorRequest(routeDeps.port(), head),
            handle: (req) => {
              fireDue();
              return handleOperatorRequest(routeDeps, req);
            },
            openStream,
          });
        } catch {
          const listener = audioListener;
          audioListener = null;
          await listener.close();
          throw new OperatorListenError();
        }
      }

      // The minute tick starts with the broker session, so a routine can only fire once the
      // gateway is actually up (Req 10.3).
      scheduler.start();
      session.start();
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      stoppingEntry();
      // Every deadline goes: turns and replies, ack timeouts, presence, reconnect.
      audio.stop();
      // Every pipeline deadline is cancelled and every Stt_Session buffer released, so no audio
      // byte outlives the process (Req 13.5, 14.3). The retention sweep stops with it.
      responder.stop();
      transcripts.stop();
      tracker.stop();
      scheduler.stop();
      for (const id of deviceIds) deadlines.cancel(presenceDeadlineKey(id));
      await session.stop();
      // Every open stream ends before its listener closes (Phase 1.3 Req 1.9).
      streams.closeAll();
      const listeners = [audioListener, operatorListener];
      audioListener = null;
      operatorListener = null;
      await Promise.all(listeners.map((l) => l?.close()));
    },
  };
}
