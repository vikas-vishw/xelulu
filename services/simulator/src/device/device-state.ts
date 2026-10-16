// The fake robot's state (G26, G27). Start values: battery 100, not charging, mode `idle`,
// wifi_rssi −50, no fault, no active child, 30 °C, volume 50, fw_ver `sim-0.1.0`. Commands change
// it only through the command handler (G27); the Control_Surface sets battery and charging.
// Nothing here is logged: `active_child_id`, `quiet_hours` and `language` never reach a log entry.
import type { Mode, QuietHours } from "@xelulu/shared";

/** The firmware version the hello reports (G26). */
export const SIM_FW_VER = "sim-0.1.0";

/** Settings a `config` command can change, beyond volume and the active child. */
export type DeviceSettings = {
  quiet_hours: QuietHours | null;
  movement_on: boolean | null;
  language: string | null;
};

export type DeviceState = {
  battery_pct: number;
  charging: boolean;
  mode: Mode;
  wifi_rssi: number;
  fault: string[];
  active_child_id: string | null;
  temp_c: number;
  volume: number;
  settings: DeviceSettings;
};

/** A fresh state with the G26 start values. */
export function createDeviceState(): DeviceState {
  return {
    battery_pct: 100,
    charging: false,
    mode: "idle",
    wifi_rssi: -50,
    fault: [],
    active_child_id: null,
    temp_c: 30,
    volume: 50,
    settings: { quiet_hours: null, movement_on: null, language: null },
  };
}

/** A deep copy, for comparisons and read-only views. */
export function copyDeviceState(state: DeviceState): DeviceState {
  return {
    ...state,
    fault: [...state.fault],
    settings: {
      ...state.settings,
      quiet_hours: state.settings.quiet_hours === null ? null : { ...state.settings.quiet_hours },
    },
  };
}
