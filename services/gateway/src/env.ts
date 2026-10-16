// Env_Module (Req 1.1, G2, G3): the only module in the gateway that reads the environment.
// Each of the eight G3 gateway keys is read once, by a static name, and handed to the pure parser.
import { parseGatewayConfig, type ConfigResult, type GatewayConfig } from "./config.js";

export function readGatewayConfig(): ConfigResult<GatewayConfig> {
  return parseGatewayConfig(
    Object.fromEntries([
      ["APP_ENV", process.env.APP_ENV],
      ["MQTT_BROKER_URL", process.env.MQTT_BROKER_URL],
      ["MQTT_USERNAME", process.env.MQTT_USERNAME],
      ["MQTT_PASSWORD", process.env.MQTT_PASSWORD],
      ["AUDIO_WSS_URL", process.env.AUDIO_WSS_URL],
      ["DEVICE_ID", process.env.DEVICE_ID],
      ["DEVICE_TOKEN", process.env.DEVICE_TOKEN],
      ["GATEWAY_OPERATOR_PORT", process.env.GATEWAY_OPERATOR_PORT],
    ]),
  );
}
