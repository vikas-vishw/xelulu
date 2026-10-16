// Device link (Req 2.2, 15.1–15.5, 15.7, 19.1, 19.4, 19.8, G11, G32, G50). The fake robot's one
// MQTT connection, through the injected MqttConnector:
//
// - Client id `DEVICE_ID`, MQTT 5 and clean start (the connector's job), Config credentials.
// - On connect: subscribe to `buildTopic(deviceId, "cmd")` only, at QoS 1. After the SUBACK, the
//   hello at QoS 1 with exactly the contract hello keys. After the hello's PUBACK, the Outbox
//   replays its queue (and any duplicate replay); then the first status goes out at once (QoS 0)
//   and the 15 s heartbeat runs, anchored on that status, so the timer restarts from each hello.
// - Inbound `cmd` payloads go to `onCommand`, after any due deadline has fired.
// - An unplanned drop stops the heartbeat, hands unacknowledged events back to the Outbox and
//   reconnects on the 1, 2, 4, 8, 16, 30 s backoff (reset after a SUBACK). A failed attempt logs
//   nothing.
// - The offline toggle aborts any audio turn, stops the heartbeat, disables reconnect and ends the
//   connection at once; nothing is published until the online toggle, which reconnects now. A
//   toggle to the current state changes nothing and reports the state.
//
// Logs carry the hello and status as variants only: never `auth`, `fw_ver` or a status value.
import { buildTopic, serialiseHelloMessage } from "@xelulu/shared";

import { backoffDelayMs } from "../backoff.js";
import { unixSeconds, type Clock } from "../clock.js";
import type { SimulatorConfig } from "../config.js";
import type { Deadlines } from "../deadlines.js";
import { SIM_FW_VER, type DeviceState } from "../device/device-state.js";
import { createHeartbeat, serialiseStatus } from "../device/heartbeat.js";
import type { Outbox } from "../device/outbox.js";
import type { SimLog } from "../log/logger.js";
import type { MqttConnection, MqttConnector } from "./mqtt-transport.js";

/** The deadline key of the next connection attempt. */
export const LINK_RECONNECT_DEADLINE_KEY = "link:reconnect";

/** QoS of the hello (Req 15.2). */
const HELLO_QOS = 1;
/** QoS of every status (Req 15.3). */
const STATUS_QOS = 0;
/** QoS of every event (Req 16.5). */
const EVENT_QOS = 1;

export type DeviceLinkDeps = Readonly<{
  broker: Pick<SimulatorConfig["broker"], "url" | "username" | "password">;
  device: SimulatorConfig["device"];
  connect: MqttConnector;
  clock: Clock;
  deadlines: Deadlines;
  log: SimLog;
  /** The state each status is built from, read at send time. */
  state: DeviceState;
  outbox: Outbox;
  /** One payload received on the device's `cmd` topic, as text. */
  onCommand: (text: string) => void;
  /** The offline toggle: abort any audio turn (`toggled_offline`). Called before the link ends. */
  onToggledOffline?: (() => void) | undefined;
}>;

export type ToggleResult = Readonly<{ online: boolean; changed: boolean }>;

export interface DeviceLink {
  readonly clientId: string;
  /** Starts the first connection attempt if the link is toggled online. */
  start(): void;
  /** Ends the connection and cancels every link deadline. Logs nothing. */
  stop(): Promise<void>;
  /** The Control_Surface toggle (Req 19.1, 19.4, 19.8). */
  setOnline(online: boolean): ToggleResult;
  /** The toggle state: false only between an offline and an online toggle. */
  online(): boolean;
  /** True while a connection holds its `cmd` subscription. */
  connected(): boolean;
  /**
   * Publishes on the current connection at `qos`, not retained. Returns false, publishing
   * nothing, when no connection holds its subscription. A later PUBACK failure is ignored.
   */
  publish(topic: string, payload: string, qos: 0 | 1): boolean;
}

type Attempt = {
  readonly connection: MqttConnection;
  established: boolean;
  finished: boolean;
};

const decoder = new TextDecoder();

export function createDeviceLink(deps: DeviceLinkDeps): DeviceLink {
  const deviceId = deps.device.deviceId;
  const cmdTopic = buildTopic(deviceId, "cmd");
  const statusTopic = buildTopic(deviceId, "status");
  const eventTopic = buildTopic(deviceId, "event");

  let wantOnline = true;
  let started = false;
  let stopped = false;
  let failedAttempts = 0;
  let current: Attempt | null = null;
  /** Bumped on every toggle and stop, so a connect that resolves late is ended unused. */
  let generation = 0;

  const heartbeat = createHeartbeat({
    clock: deps.clock,
    deadlines: deps.deadlines,
    send: sendStatus,
  });

  function live(): Attempt | null {
    const a = current;
    return a !== null && a.established && !a.finished ? a : null;
  }

  function logOut(variant: "hello" | "status"): void {
    deps.log.add({
      kind: "message_out",
      variant,
      event_id: null,
      cmd_id: null,
      turn_id: null,
      ack_status: null,
      ack_reason: null,
      replay: false,
      time_uncertain: false,
    });
  }

  function sendStatus(): void {
    const a = live();
    if (a === null) return;
    let payload: string;
    try {
      payload = serialiseStatus(deps.state, deps.clock.now());
    } catch {
      // The Control_Surface validates battery values before they reach the state; a state the
      // contract refuses is never sent.
      return;
    }
    a.connection.publish(statusTopic, payload, STATUS_QOS).catch(() => undefined);
    logOut("status");
  }

  function endQuietly(connection: MqttConnection): void {
    connection.end().catch(() => undefined);
  }

  /** Marks the attempt finished once; returns false if it already was. */
  function finish(a: Attempt): boolean {
    if (a.finished) return false;
    a.finished = true;
    if (current === a) current = null;
    return true;
  }

  function scheduleNextAttempt(): void {
    if (stopped || !wantOnline) return;
    const delay = backoffDelayMs(failedAttempts);
    failedAttempts += 1;
    deps.deadlines.schedule(LINK_RECONNECT_DEADLINE_KEY, deps.clock.now() + delay, () => {
      void attempt();
    });
  }

  function hello(): string {
    return serialiseHelloMessage({
      proto_ver: 2,
      ts: unixSeconds(deps.clock.now()),
      type: "hello",
      device_id: deviceId,
      fw_ver: SIM_FW_VER,
      auth: deps.device.token,
      proto: 2,
    });
  }

  async function attempt(): Promise<void> {
    if (stopped || !wantOnline || current !== null) return;
    const myGeneration = generation;
    let connection: MqttConnection;
    try {
      connection = await deps.connect({
        url: deps.broker.url,
        clientId: deviceId,
        username: deps.broker.username,
        password: deps.broker.password,
      });
    } catch {
      // A failed attempt adds no entry (Req 15.7, G32).
      if (myGeneration === generation) scheduleNextAttempt();
      return;
    }
    if (stopped || !wantOnline || myGeneration !== generation || current !== null) {
      endQuietly(connection);
      return;
    }

    const a: Attempt = { connection, established: false, finished: false };
    current = a;
    connection.onMessage((topic, payload) => {
      if (a.finished || topic !== cmdTopic) return;
      deps.deadlines.fireDue(deps.clock.now());
      if (!a.finished) deps.onCommand(decoder.decode(payload));
    });
    connection.onClose(() => {
      if (!finish(a)) return;
      // An unplanned drop (Req 15.5): the toggle and stop paths finish the attempt themselves.
      heartbeat.stop();
      deps.outbox.linkDown("dropped");
      if (a.established) deps.log.add({ kind: "simulator", state: "broker_disconnected" });
      scheduleNextAttempt();
    });

    try {
      await connection.subscribe([cmdTopic], 1);
    } catch {
      // A failed subscribe ends the connection and counts as a failed attempt.
      if (finish(a)) {
        endQuietly(connection);
        scheduleNextAttempt();
      }
      return;
    }
    if (a.finished) return;
    a.established = true;
    failedAttempts = 0;
    deps.log.add({ kind: "simulator", state: "broker_connected" });

    // Req 15.2: the hello only after the SUBACK.
    const helloAcked = connection.publish(statusTopic, hello(), HELLO_QOS);
    logOut("hello");
    try {
      await helloAcked;
    } catch {
      // The connection closed first: the close handler has already handled it.
      return;
    }
    if (a.finished) return;
    deps.outbox.linkUp(
      { publishEvent: (payload) => connection.publish(eventTopic, payload, EVENT_QOS) },
      () => {
        // Req 15.3, 15.4, 19.4: the first status once replay is done, then every 15 s.
        if (live() === a) heartbeat.start();
      },
    );
  }

  function goOffline(): void {
    wantOnline = false;
    generation += 1;
    deps.log.add({ kind: "simulator", state: "toggled_offline" });
    deps.onToggledOffline?.();
    heartbeat.stop();
    deps.deadlines.cancel(LINK_RECONNECT_DEADLINE_KEY);
    deps.outbox.linkDown("toggled_offline");
    const a = current;
    if (a !== null && finish(a)) endQuietly(a.connection);
  }

  function goOnline(): void {
    wantOnline = true;
    generation += 1;
    failedAttempts = 0;
    deps.log.add({ kind: "simulator", state: "toggled_online" });
    if (started && !stopped) void attempt();
  }

  return {
    clientId: deviceId,
    start() {
      if (started || stopped) return;
      started = true;
      if (wantOnline) void attempt();
    },
    async stop() {
      stopped = true;
      generation += 1;
      heartbeat.stop();
      deps.deadlines.cancel(LINK_RECONNECT_DEADLINE_KEY);
      const a = current;
      if (a !== null && finish(a)) await a.connection.end().catch(() => undefined);
    },
    setOnline(online) {
      if (online === wantOnline || stopped) return { online: wantOnline, changed: false };
      if (online) goOnline();
      else goOffline();
      return { online: wantOnline, changed: true };
    },
    online: () => wantOnline,
    connected: () => live() !== null,
    publish(topic, payload, qos) {
      const a = live();
      if (a === null || !wantOnline) return false;
      a.connection.publish(topic, payload, qos).catch(() => undefined);
      return true;
    },
  };
}
