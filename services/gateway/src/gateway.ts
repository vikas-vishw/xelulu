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
import { createContentLibrary } from "./brain/tools/content-library.js";
import { createDeviceActions } from "./brain/tools/device-action.js";
import { createRoutines } from "./brain/tools/routines.js";
import { createToolRouter } from "./brain/tools/tool-router.js";
import { createVoiceBrain } from "./brain/voice-brain.js";
import type { Clock } from "./clock.js";
import type { GatewayConfig } from "./config.js";
import { createContentStore } from "./content/content-store.js";
import { createDeadlines } from "./deadlines.js";
import { createDedupeStore } from "./devices/dedupe-store.js";
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
  const alerts = createAlerts({ clock, ids, log });
  const memory = createMemoryStore();
  const routines = createRoutines();
  // The curated library (Phase 4 C1): seeded from the Starter_Content, gated on the way in, and
  // in memory only — it writes no file, opens no socket and is gone on restart.
  //
  // The store seeds itself at construction and adds one `content_gate` entry per seeded item
  // (Req 2.5). Composition runs BEFORE start(), so those entries are held here and written when
  // the gateway is up: the log's first entries stay the lifecycle ones a reader expects —
  // `starting`, the provider checks, then `audio_listening` — and the seed report sits after
  // them rather than ahead of the gateway's own birth.
  const heldSeedEntries: LogEntryFields[] = [];
  const content = createContentStore({
    clock,
    log: {
      add: ((fields: LogEntryFields) => {
        heldSeedEntries.push(fields);
        return fields;
      }) as GatewayLog["add"],
    },
    seed: createStarterContent(),
  });
  const stories = createStorySessions({ clock, log, content });
  const tools = createToolRouter({
    log,
    content: createContentLibrary({ content, words: createStarterWords(), clock }),
    stories,
    routines,
    memory,
    context: childContext,
    device: createDeviceActions({
      sendCommand: sender.sendCommand,
      context: childContext,
      routines,
      // Local minutes past midnight, from the one Clock.
      nowMinutes: () => {
        const d = new Date(clock.now());
        return d.getHours() * 60 + d.getMinutes();
      },
    }),
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
      // up so it cannot precede the lifecycle entries above.
      for (const fields of heldSeedEntries.splice(0)) {
        log.add(fields as Parameters<GatewayLog["add"]>[0]);
      }

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
