// Broker session (Req 2.2, 3.1–3.6, D4, G10, G32). One MQTT connection at a time through the
// injected MqttConnector. On each established connection it subscribes once, at QoS 1, to the
// exact `status`, `event` and `ack` topics of every Registered_Device (no wildcard, never `cmd`),
// then logs `broker_connected`. A dropped connection logs `broker_disconnected`; a failed attempt
// logs nothing. Reconnects use the 1, 2, 4, 8, 16, 30 s backoff on the Clock, reset after a
// success. `publishCmd` is the gateway's only publish: the device's `cmd` topic, QoS 1, unretained.
import { buildTopic, TOPIC_SUFFIXES, type TopicSuffix } from "@xelulu/shared";

import { backoffDelayMs } from "../backoff.js";
import type { Clock } from "../clock.js";
import type { GatewayConfig } from "../config.js";
import type { Deadlines } from "../deadlines.js";
import type { IdSource } from "../ids.js";
import type { GatewayLog } from "../log/gateway-log.js";
import type { MqttConnection, MqttConnector } from "./mqtt-transport.js";

/** Prefix of the gateway's MQTT client id; the rest is random per process (G10). */
export const GATEWAY_CLIENT_ID_PREFIX = "xelulu-gw-";

/** The deadline key of the next connection attempt. */
export const RECONNECT_DEADLINE_KEY = "broker:reconnect";

/** The suffixes the gateway subscribes to: every device-to-cloud topic, never `cmd`. */
const SUBSCRIBED_SUFFIXES: readonly Exclude<TopicSuffix, "cmd">[] = TOPIC_SUFFIXES.filter(
  (s): s is Exclude<TopicSuffix, "cmd"> => s !== "cmd",
);

export type BrokerSessionDeps = Readonly<{
  broker: Pick<GatewayConfig["broker"], "url" | "username" | "password">;
  /** The Registered_Devices, whose topics are subscribed on every connection. */
  deviceIds: readonly string[];
  connect: MqttConnector;
  clock: Clock;
  deadlines: Deadlines;
  ids: IdSource;
  log: Pick<GatewayLog, "add">;
  /** Every message received on an established connection. */
  onMessage: (topic: string, payload: Uint8Array) => void;
}>;

export interface BrokerSession {
  readonly clientId: string;
  /** Starts the first connection attempt. Later attempts follow the backoff on the Clock. */
  start(): void;
  /** Ends the connection and cancels any pending attempt. Logs nothing. */
  stop(): Promise<void>;
  /** True while an established connection holds its subscriptions. */
  connected(): boolean;
  /** Publishes on the device's `cmd` topic at QoS 1, unretained. Fire and forget. */
  publishCmd(deviceId: string, payload: string): void;
}

/** The exact topics the gateway holds for its Registered_Devices (Req 3.2). */
export function subscribedTopics(deviceIds: readonly string[]): string[] {
  return deviceIds.flatMap((id) => SUBSCRIBED_SUFFIXES.map((suffix) => buildTopic(id, suffix)));
}

type Attempt = {
  readonly connection: MqttConnection;
  established: boolean;
  finished: boolean;
};

export function createBrokerSession(deps: BrokerSessionDeps): BrokerSession {
  const clientId = GATEWAY_CLIENT_ID_PREFIX + deps.ids.next("");
  const topics = subscribedTopics(deps.deviceIds);
  let failedAttempts = 0;
  let started = false;
  let stopped = false;
  let current: Attempt | null = null;

  function scheduleNextAttempt(): void {
    if (stopped) return;
    const delay = backoffDelayMs(failedAttempts);
    failedAttempts += 1;
    deps.deadlines.schedule(RECONNECT_DEADLINE_KEY, deps.clock.now() + delay, () => {
      void attempt();
    });
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

  async function attempt(): Promise<void> {
    if (stopped) return;
    let connection: MqttConnection;
    try {
      connection = await deps.connect({
        url: deps.broker.url,
        clientId,
        username: deps.broker.username,
        password: deps.broker.password,
      });
    } catch {
      // A failed attempt adds no entry (Req 3.5).
      scheduleNextAttempt();
      return;
    }
    if (stopped) {
      endQuietly(connection);
      return;
    }

    const a: Attempt = { connection, established: false, finished: false };
    current = a;
    connection.onMessage((topic, payload) => {
      if (!a.finished) deps.onMessage(topic, payload);
    });
    connection.onClose(() => {
      if (!finish(a) || stopped) return;
      if (a.established) deps.log.add({ kind: "gateway", state: "broker_disconnected" });
      scheduleNextAttempt();
    });

    try {
      await connection.subscribe(topics, 1);
    } catch {
      // A failed subscribe ends the connection and counts as a failed attempt.
      if (finish(a)) {
        endQuietly(connection);
        scheduleNextAttempt();
      }
      return;
    }
    if (a.finished) return;
    if (stopped) {
      finish(a);
      endQuietly(connection);
      return;
    }
    a.established = true;
    failedAttempts = 0;
    deps.log.add({ kind: "gateway", state: "broker_connected" });
  }

  return {
    clientId,
    start() {
      if (started || stopped) return;
      started = true;
      void attempt();
    },
    async stop() {
      stopped = true;
      deps.deadlines.cancel(RECONNECT_DEADLINE_KEY);
      const a = current;
      if (a !== null && finish(a)) await a.connection.end().catch(() => undefined);
    },
    connected: () => current !== null && current.established && !current.finished,
    publishCmd(deviceId, payload) {
      const a = current;
      if (a === null || !a.established || a.finished) return;
      // A publish that fails later is decided by the ack timeouts; nothing is retried.
      a.connection.publish(buildTopic(deviceId, "cmd"), payload, 1).catch(() => undefined);
    },
  };
}
