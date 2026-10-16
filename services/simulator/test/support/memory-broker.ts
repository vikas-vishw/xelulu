// Test helper (not a test): the in-memory broker double (design "In-memory broker double"),
// copied from the gateway's test support (services and their tests never import each other).
// It implements the simulator's MqttConnector shape. Routing is exact topic match only (the services
// never use wildcards); delivery and acknowledgements are asynchronous through queueMicrotask,
// like a real socket. Every publish is recorded with `retain: false` from the call site, so a test
// can assert nothing is retained. It is not an MQTT 5 broker: protocol-level behaviour is covered
// by the Compose_Acceptance_Check against real EMQX.
import type {
  MqttConnection,
  MqttConnectOptions,
  MqttConnector,
} from "../../src/mqtt/mqtt-transport.js";

export type PublishedMessage = {
  readonly clientId: string;
  readonly topic: string;
  readonly payload: string;
  readonly qos: 0 | 1;
  readonly retain: false;
};

export type ConnectAttempt = { readonly at: number; readonly options: MqttConnectOptions };

export interface MemoryBroker {
  /** Pass to createGateway / createSimulator. */
  connector: MqttConnector;
  /** A fake device or fake gateway on the same broker. Not counted as a connect attempt. */
  peer(clientId: string): Promise<MqttConnection>;
  published: ReadonlyArray<PublishedMessage>;
  subscriptions(clientId: string): ReadonlyArray<{ topic: string; qos: 0 | 1 }>;
  /** The next n connector attempts reject. */
  failNextConnects(n: number): void;
  /** Ends a live connection (onClose fires). */
  drop(clientId: string): void;
  /** QoS 1 publishes stay pending until released. */
  holdPubacks(clientId: string, on: boolean): void;
  releasePubacks(clientId: string): void;
  connectAttempts: ReadonlyArray<ConnectAttempt>;
}

type PendingAck = { readonly resolve: () => void; readonly reject: (err: Error) => void };

type Session = {
  readonly clientId: string;
  open: boolean;
  readonly subs: Map<string, 0 | 1>;
  readonly messageHandlers: ((topic: string, payload: Uint8Array) => void)[];
  readonly closeHandlers: (() => void)[];
  readonly pendingAcks: PendingAck[];
  readonly connection: MqttConnection;
};

const encoder = new TextEncoder();

/** A rejection with no message, as the real adapter gives. */
function closedError(): Error {
  return new Error();
}

export function createMemoryBroker(now: () => number = () => Date.now()): MemoryBroker {
  const sessions = new Map<string, Session>();
  const published: PublishedMessage[] = [];
  const connectAttempts: ConnectAttempt[] = [];
  const holding = new Set<string>();
  let failures = 0;

  function close(session: Session): void {
    if (!session.open) return;
    session.open = false;
    if (sessions.get(session.clientId) === session) sessions.delete(session.clientId);
    for (const ack of session.pendingAcks.splice(0)) ack.reject(closedError());
    queueMicrotask(() => {
      for (const fn of session.closeHandlers) fn();
    });
  }

  function route(topic: string, payload: string): void {
    for (const s of sessions.values()) {
      if (!s.open || !s.subs.has(topic)) continue;
      const bytes = encoder.encode(payload);
      queueMicrotask(() => {
        if (!s.open) return;
        for (const fn of s.messageHandlers) fn(topic, bytes);
      });
    }
  }

  function open(clientId: string): MqttConnection {
    // A second connection with the same client id takes the session over, as on a real broker.
    const previous = sessions.get(clientId);
    if (previous !== undefined) close(previous);

    const session: Session = {
      clientId,
      open: true,
      subs: new Map(),
      messageHandlers: [],
      closeHandlers: [],
      pendingAcks: [],
      connection: {
        subscribe(topics, qos) {
          if (!session.open) return Promise.reject(closedError());
          for (const t of topics) session.subs.set(t, qos);
          return new Promise((resolve, reject) => {
            queueMicrotask(() => (session.open ? resolve() : reject(closedError())));
          });
        },
        publish(topic, payload, qos) {
          if (!session.open) return Promise.reject(closedError());
          published.push({ clientId, topic, payload, qos, retain: false });
          route(topic, payload);
          return new Promise((resolve, reject) => {
            if (qos === 1 && holding.has(clientId)) {
              session.pendingAcks.push({ resolve, reject });
              return;
            }
            queueMicrotask(() => (session.open ? resolve() : reject(closedError())));
          });
        },
        onMessage(fn) {
          session.messageHandlers.push(fn);
        },
        onClose(fn) {
          session.closeHandlers.push(fn);
        },
        end() {
          close(session);
          return Promise.resolve();
        },
      },
    };
    sessions.set(clientId, session);
    return session.connection;
  }

  const connector: MqttConnector = (options) => {
    connectAttempts.push({ at: now(), options });
    if (failures > 0) {
      failures -= 1;
      return new Promise((_, reject) => queueMicrotask(() => reject(closedError())));
    }
    return new Promise((resolve) => queueMicrotask(() => resolve(open(options.clientId))));
  };

  return {
    connector,
    peer: (clientId) => new Promise((resolve) => queueMicrotask(() => resolve(open(clientId)))),
    published,
    subscriptions(clientId) {
      const s = sessions.get(clientId);
      return s === undefined ? [] : [...s.subs].map(([topic, qos]) => ({ topic, qos }));
    },
    failNextConnects(n) {
      failures = n;
    },
    drop(clientId) {
      const s = sessions.get(clientId);
      if (s !== undefined) close(s);
    },
    holdPubacks(clientId, on) {
      if (on) holding.add(clientId);
      else holding.delete(clientId);
    },
    releasePubacks(clientId) {
      const s = sessions.get(clientId);
      if (s === undefined) return;
      for (const ack of s.pendingAcks.splice(0)) ack.resolve();
    },
    connectAttempts,
  };
}
