// Screen 11's mock device (Req 19.1, 19.5, 19.6). Display names, labels and two numbers: no
// credential, no address, no firmware payload and no sensor reading.

import type { Device } from "@xelulu/shared";

import { MOCK_IDENTITY } from "../../lib/mock-identity";

import { DEVICE_STRINGS } from "./strings";

/** The three rows that open an inline detail panel. The camera row is not one of them (D3). */
export type DevicePanelKey = "quiet-hours" | "sleep-wake" | "software";

export type DeviceData = Pick<Device, "device_id" | "display_name"> &
  Readonly<{
    room_label: string;
    online: boolean;
    /** 78 by default; the tests inject 20, 19, 10 and 9 (Req 14.8). */
    battery_pct: number;
    movement_enabled: boolean;
    volume_pct: number;
    quiet_hours_label: string;
    software_label: string;
    panels: Readonly<Record<DevicePanelKey, readonly string[]>>;
  }>;

export const MOCK_DEVICE: DeviceData = {
  device_id: MOCK_IDENTITY.deviceId,
  display_name: MOCK_IDENTITY.device,
  room_label: MOCK_IDENTITY.room,
  online: true,
  battery_pct: 78,
  movement_enabled: true,
  volume_pct: 60,
  quiet_hours_label: DEVICE_STRINGS.quietHoursLabel,
  software_label: DEVICE_STRINGS.softwareLabel,
  panels: {
    "quiet-hours": DEVICE_STRINGS.panels.quietHours,
    "sleep-wake": DEVICE_STRINGS.panels.sleepWake,
    software: DEVICE_STRINGS.panels.software,
  },
};
