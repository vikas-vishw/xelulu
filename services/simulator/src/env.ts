// Env_Module (Req 1.1, G2, G3): the only module in the simulator that reads the environment.
// Each of the eight G3 simulator keys is read once, by a static name, and handed to the pure parser.
import { parseSimulatorConfig, type ConfigResult, type SimulatorConfig } from "./config.js";

export function readSimulatorConfig(): ConfigResult<SimulatorConfig> {
  return parseSimulatorConfig(
    Object.fromEntries([
      ["APP_ENV", process.env.APP_ENV],
      ["MQTT_BROKER_URL", process.env.MQTT_BROKER_URL],
      ["MQTT_USERNAME", process.env.MQTT_USERNAME],
      ["MQTT_PASSWORD", process.env.MQTT_PASSWORD],
      ["AUDIO_WSS_URL", process.env.AUDIO_WSS_URL],
      ["DEVICE_ID", process.env.DEVICE_ID],
      ["DEVICE_TOKEN", process.env.DEVICE_TOKEN],
      ["SIMULATOR_PANEL_PORT", process.env.SIMULATOR_PANEL_PORT],
    ]),
  );
}
