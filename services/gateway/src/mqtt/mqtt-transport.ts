// MQTT transport interface (types only). The MQTT.js adapter in transport/ implements it; tests use
// the in-memory broker double. Pure modules depend on this file, never on `mqtt`.

export type MqttConnectOptions = Readonly<{
  url: string;
  clientId: string;
  username: string | null;
  password: string | null;
}>;

export interface MqttConnection {
  /** Resolves on SUBACK. Rejects if the connection closes first. */
  subscribe(topics: readonly string[], qos: 0 | 1): Promise<void>;
  /** QoS 1 resolves on PUBACK; QoS 0 on write. Rejects if the connection closes first. retain is always false. */
  publish(topic: string, payload: string, qos: 0 | 1): Promise<void>;
  onMessage(fn: (topic: string, payload: Uint8Array) => void): void;
  /** Called once when an established connection ends for any reason. */
  onClose(fn: () => void): void;
  end(): Promise<void>;
}

/** One connection attempt. Rejects (with no detail) if the attempt fails. */
export type MqttConnector = (options: MqttConnectOptions) => Promise<MqttConnection>;
