// The simulator composition root (design "Runtime shape", Req 15.1, 16.3, 16.5, 18.1, 19.2, 20.1,
// 21.5). createSimulator wires the pure cores to the injected transports: device state, heartbeat
// (inside the device link), event factory, Outbox, Ack_Policy, command handler, device link,
// audio turn client and Control_Surface routes. Nothing opens a socket until start(), which runs
// in order: `simulator` `starting`; the panel files are read; the Control_Surface listens (on
// 127.0.0.1 in every mode, except 0.0.0.0 in Local_Mode with the Listen_All_Argument, Phase 1.3
// Req 3.2), then `control_listening`; the device link's first broker attempt.
// Before handling any inbound message or request, due deadlines fire first (D3, G49): the device
// link and the audio turn client do it for MQTT and WebSocket input, this module for every
// Control_Surface request.
//
// Outbound connections go only to the Config's broker URL (device link) and `AUDIO_WSS_URL`
// (audio turn client); no command value (an `ota` `manifest_url`, say) is ever connected to.
// Events go through the one Outbox, which publishes on `buildTopic(deviceId, "event")` at QoS 1,
// unretained, through the device link.
import { createAudioTurnClient, type AudioTurnClient } from "./audio/audio-turn-client.js";
import type { OpenAudioSocket } from "./audio/audio-transport.js";
import { unixSeconds, type Clock } from "./clock.js";
import type { SimulatorConfig } from "./config.js";
import {
  createControlRoutes,
  type ControlListen,
  type ControlRequestIn,
  type ControlResponseOut,
  type ControlRoutes,
  type FireEventResult,
  type SimulatorStateView,
} from "./control/control-routes.js";
import { loadPanelAssets, type PanelFileReader } from "./control/panel-assets.js";
import type { GuardHead } from "./control/request-guard.js";
import { createDeadlines } from "./deadlines.js";
import { EMPTY_ACK_POLICY, type AckPolicy } from "./device/ack-policy.js";
import { createCommandHandler } from "./device/command-handler.js";
import { copyDeviceState, createDeviceState, type DeviceState } from "./device/device-state.js";
import { buildEvent, type EventRequest } from "./device/event-factory.js";
import { createOutbox } from "./device/outbox.js";
import type { IdSource } from "./ids.js";
import { localSurfaceHost } from "./listen-host.js";
import { createSimLog, type LineSink, type SimLog } from "./log/logger.js";
import { createDeviceLink, type ToggleResult } from "./mqtt/device-link.js";
import type { MqttConnector } from "./mqtt/mqtt-transport.js";

export type SimulatorDeps = Readonly<{
  clock: Clock;
  connectMqtt: MqttConnector;
  openAudio: OpenAudioSocket;
  listenControl: ControlListen;
  sink: LineSink;
  ids: IdSource;
  /** Reads one panel file; defaults to the files in services/simulator/panel/. */
  readPanel?: PanelFileReader | undefined;
  /** Test only: listen on this port instead of the Config's (0 = OS-assigned). */
  listenPorts?: Readonly<{ control?: number }> | undefined;
  /**
   * True when the process was started with the Listen_All_Argument (Phase 1.3 C8); defaults to
   * false. It has effect only in Local_Mode.
   */
  listenAllInterfaces?: boolean | undefined;
}>;

/** The simulator's state as /api/state reports it, without `ok` and the panel's `choices`. */
export type SimulatorSnapshot = Readonly<
  SimulatorStateView & {
    device_id: string;
    ack_policy: AckPolicy;
    battery_pct: number;
    charging: boolean;
    mode: DeviceState["mode"];
  }
>;

export interface Simulator {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly log: SimLog;
  /** The Control_Surface port actually listened on; null before start and after stop. */
  controlPort(): number | null;
  /** True while the broker connection holds its `cmd` subscription. */
  connected(): boolean;
  state(): SimulatorSnapshot;
  /** A copy of the device state. */
  deviceState(): DeviceState;
  /** One Control_Surface request handled in-process, exactly as the listener would. */
  handleControl(request: ControlRequestIn): ControlResponseOut;
}

type Listener = { readonly port: number; close(): Promise<void> };

export function createSimulator(config: SimulatorConfig, deps: SimulatorDeps): Simulator {
  const { clock, ids } = deps;
  const deviceId = config.device.deviceId;
  const deadlines = createDeadlines(clock);
  const log = createSimLog(clock, deps.sink);
  const state = createDeviceState();
  const outbox = createOutbox({ log });
  let policy: AckPolicy = EMPTY_ACK_POLICY;

  let started = false;
  let stopped = false;
  let listener: Listener | null = null;
  let routes: ControlRoutes | null = null;
  const requestedControlPort = deps.listenPorts?.control ?? config.panelPort;

  const fireDue = (): void => deadlines.fireDue(clock.now());

  // The three cores refer to each other only through these closures, so construction order is
  // free: the turn client reads the link's toggle, the handler publishes through the link and
  // the link hands commands to the handler.
  const turnClient: AudioTurnClient = createAudioTurnClient({
    url: config.audio.url,
    token: config.device.token,
    clock,
    deadlines,
    ids,
    log,
    open: deps.openAudio,
    isOnline: () => link.online(),
    onEnded: (outcome) => commands.turnEnded(outcome),
  });

  const commands = createCommandHandler({
    deviceId,
    clock,
    state,
    log,
    policy: () => policy,
    publish: (topic, payload, qos) => link.publish(topic, payload, qos),
    turn: turnClient,
  });

  const link = createDeviceLink({
    broker: config.broker,
    device: config.device,
    connect: deps.connectMqtt,
    clock,
    deadlines,
    log,
    state,
    outbox,
    onCommand: (text) => {
      if (!stopped) commands.handle(text);
    },
    onToggledOffline: () => turnClient.abort("toggled_offline"),
  });

  /** Builds, validates and publishes (or queues) one newly fired event (Req 16, 19.2). */
  function fireEvent(request: EventRequest): FireEventResult {
    const eventId = ids.next("ev_");
    const ts = unixSeconds(clock.now());
    const built = buildEvent(request, eventId, ts);
    if (!built.ok) return { ok: false, issues: built.issues };
    const message = built.message;
    const { queued } = outbox.fire({
      event_id: message.event_id,
      event: message.event,
      data: message.data as Readonly<Record<string, unknown>>,
      ts: message.ts,
    });
    // Req 18.9: an interrupt during a turn marks the turn; the turn client decides if it counts.
    if (message.event === "interrupt" && turnClient.inProgress()) turnClient.noteInterrupt();
    return { ok: true, event_id: message.event_id, ts: message.ts, queued };
  }

  function view(): SimulatorStateView {
    return {
      online: link.online(),
      queue_length: outbox.queueLength(),
      duplicate_replay: outbox.duplicateReplay(),
      received_commands: commands.receivedCommands(),
      last_turn: turnClient.lastTurn(),
    };
  }

  function setOnline(online: boolean): ToggleResult {
    return link.setOnline(online);
  }

  /** The routes, made once when start() has read the panel files. */
  function controlRoutes(): ControlRoutes {
    if (routes === null) {
      routes = createControlRoutes({
        deviceId,
        clock,
        log,
        port: () => listener?.port ?? requestedControlPort,
        assets: loadPanelAssets(deps.readPanel),
        state,
        view,
        fireEvent,
        startAudioTurn: (utterance) => turnClient.request(utterance),
        setOnline,
        setDuplicateReplay: (on) => outbox.setDuplicateReplay(on),
        ackPolicy: () => policy,
        setAckPolicy: (next) => {
          policy = next;
        },
      });
    }
    return routes;
  }

  function preflight(head: GuardHead): ControlResponseOut | null {
    fireDue();
    return controlRoutes().preflight(head);
  }

  function handleControl(request: ControlRequestIn): ControlResponseOut {
    fireDue();
    return controlRoutes().handle(request);
  }

  return {
    log,
    controlPort: () => listener?.port ?? null,
    connected: () => link.connected(),
    state: () => ({
      ...view(),
      device_id: deviceId,
      ack_policy: policy,
      battery_pct: state.battery_pct,
      charging: state.charging,
      mode: state.mode,
    }),
    deviceState: () => copyDeviceState(state),
    handleControl,

    async start() {
      if (started || stopped) return;
      started = true;
      log.add({ kind: "simulator", state: "starting" });
      const r = controlRoutes();
      // The Control_Surface listens on 127.0.0.1 in every mode, except 0.0.0.0 in Local_Mode with
      // the Listen_All_Argument (Phase 1.3 Req 3.2, superseding Req 20.1; G46). A failure
      // rejects start(), which the entry point treats as a crash.
      listener = await deps.listenControl({
        host: localSurfaceHost(config.localMode, deps.listenAllInterfaces ?? false),
        port: requestedControlPort,
        preflight,
        bodyTooLarge: () => r.bodyTooLarge(),
        handle: handleControl,
      });
      if (stopped) {
        const l = listener;
        listener = null;
        await l.close();
        return;
      }
      log.add({ kind: "simulator", state: "control_listening" });
      link.start();
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      log.add({ kind: "simulator", state: "stopping" });
      // Every deadline goes: the turn's frames and reply timeout, heartbeats, reconnect.
      turnClient.stop();
      await link.stop();
      const l = listener;
      listener = null;
      await l?.close();
    },
  };
}
