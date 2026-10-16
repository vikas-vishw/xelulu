// MQTT.js 5 adapter for the MqttConnector interface (design D4, Req 1.6, 1.9, 15.1). A copy of the
// gateway's adapter (services never import each other). One call is one connection attempt:
// MQTT.js auto-reconnect is off and the device link runs its own backoff on the Clock. The attempt
// resolves on the first `connect` and rejects, with no detail, on `error` or `close` before it.
// After that, messages are forwarded and the first `close` maps to onClose. Every publish is
// unretained. Pending subscribes and publishes reject when the connection closes, which is what
// lets the Outbox keep unacknowledged events. The adapter never logs.
//
// TLS: MQTT.js defaults over node:tls, so the certificate chain and host name are always verified.
// The only trust option is extra trust anchors (`ca`), passed by the composition root or a test,
// never from the Config; nothing here can turn verification off. A failed handshake ends the
// attempt before any MQTT packet, so no credential, token or Document B message is sent (Req 1.9).
import { connect, type IClientOptions, type MqttClient } from "mqtt";

import type { MqttConnection, MqttConnectOptions, MqttConnector } from "../mqtt-transport.js";

/** Extra trust anchors (PEM). Adds trust; never weakens verification. Not a Config field. */
export type MqttTrust = Readonly<{ ca?: string }>;

/** The MQTT.js client options for one attempt (design D4). */
export function mqttJsOptions(options: MqttConnectOptions, trust: MqttTrust = {}): IClientOptions {
  return {
    protocolVersion: 5,
    clean: true,
    properties: { sessionExpiryInterval: 0 },
    clientId: options.clientId,
    ...(options.username === null ? {} : { username: options.username }),
    ...(options.password === null ? {} : { password: options.password }),
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    keepalive: 30,
    queueQoSZero: false,
    resubscribe: false,
    ...(trust.ca === undefined ? {} : { ca: trust.ca }),
  };
}

/** A rejection with no message, stack detail or cause from the library. */
function plainError(): Error {
  return new Error();
}

type Pending = { readonly reject: (err: Error) => void };

function wrap(client: MqttClient): MqttConnection {
  const pending = new Set<Pending>();
  const messageHandlers: ((topic: string, payload: Uint8Array) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  let closed = false;

  client.on("message", (topic: string, payload: Uint8Array) => {
    if (closed) return;
    for (const fn of messageHandlers) fn(topic, payload);
  });
  client.on("close", () => {
    if (closed) return;
    closed = true;
    for (const p of [...pending]) p.reject(plainError());
    pending.clear();
    for (const fn of closeHandlers) fn();
  });

  /** Runs one request; it rejects if the connection closes before the library answers. */
  function track(start: (done: (failed: boolean) => void) => void): Promise<void> {
    if (closed) return Promise.reject(plainError());
    return new Promise<void>((resolve, reject) => {
      const p: Pending = { reject };
      pending.add(p);
      start((failed) => {
        if (!pending.delete(p)) return;
        if (failed) reject(plainError());
        else resolve();
      });
    });
  }

  return {
    subscribe(topics, qos) {
      return track((done) => {
        client.subscribe([...topics], { qos }, (err, granted) => {
          // A SUBACK failure code (128 and above) counts as a failed subscribe.
          const refused = (granted ?? []).some((g) => g.qos >= 128);
          done(err !== null && err !== undefined ? true : refused);
        });
      });
    },
    publish(topic, payload, qos) {
      return track((done) => {
        client.publish(topic, payload, { qos, retain: false }, (err) => {
          done(err !== null && err !== undefined);
        });
      });
    },
    onMessage(fn) {
      messageHandlers.push(fn);
    },
    onClose(fn) {
      closeHandlers.push(fn);
    },
    end() {
      return new Promise<void>((resolve) => {
        client.end(true, {}, () => resolve());
      });
    },
  };
}

/** A connector over MQTT.js. `trust` is a test hook for extra trust anchors only. */
export function createMqttJsConnector(trust: MqttTrust = {}): MqttConnector {
  return (options) =>
    new Promise<MqttConnection>((resolve, reject) => {
      const client = connect(options.url, mqttJsOptions(options, trust));
      let settled = false;

      const fail = (): void => {
        if (settled) return;
        settled = true;
        client.end(true);
        reject(plainError());
      };

      // An `error` listener stays attached for the client's life, so a later error never
      // becomes an uncaught exception; its value is never read.
      client.on("error", () => fail());
      client.on("close", () => fail());
      client.once("connect", () => {
        if (settled) return;
        settled = true;
        resolve(wrap(client));
      });
    });
}

/** The process's connector: MQTT.js defaults, no extra trust anchors. */
export const mqttJsConnector: MqttConnector = createMqttJsConnector();
