// Screen 16a's mock alerts (Req 19.1, 19.5, 19.6). Display labels, glyph names, relative time
// labels and the two kind values only: no raw sensor reading and no stored value of any kind.

import type { IconName } from "../../components/icon";
import type { IconTileTone } from "../../components/icon-tile";
import { MOCK_IDENTITY } from "../../lib/mock-identity";

import { NOTIFICATION_STRINGS } from "./strings";

export type NotificationKind = "device" | "activity";

export type NotificationRow = Readonly<{
  notification_id: string;
  icon: IconName;
  /** The row's tile colour, as the Reference draws screen 16a's five alerts. */
  icon_tone: IconTileTone;
  title: string;
  detail: string;
  time_label: string;
  kind: NotificationKind;
}>;

export type NotificationsData = Readonly<{ rows: readonly NotificationRow[] }>;

const ROWS = NOTIFICATION_STRINGS.rows;

export const MOCK_NOTIFICATIONS: NotificationsData = {
  rows: [
    {
      notification_id: "notification_mock_1",
      icon: "battery-charging-outline",
      icon_tone: "mint",
      title: ROWS.charging.title,
      detail: ROWS.charging.detail,
      time_label: ROWS.charging.timeLabel,
      kind: "device",
    },
    {
      notification_id: "notification_mock_2",
      icon: "time-outline",
      icon_tone: "amber",
      title: ROWS.playTime.title,
      detail: ROWS.playTime.detail,
      time_label: ROWS.playTime.timeLabel,
      kind: "activity",
    },
    {
      notification_id: "notification_mock_3",
      icon: "bulb-outline",
      icon_tone: "sky",
      title: ROWS.memory.title,
      detail: ROWS.memory.detail(MOCK_IDENTITY.child),
      time_label: ROWS.memory.timeLabel,
      kind: "activity",
    },
    {
      notification_id: "notification_mock_4",
      icon: "moon-outline",
      icon_tone: "lavender",
      title: ROWS.bedtime.title,
      detail: ROWS.bedtime.detail,
      time_label: ROWS.bedtime.timeLabel,
      kind: "activity",
    },
    {
      notification_id: "notification_mock_5",
      icon: "cloud-download-outline",
      icon_tone: "lavender",
      title: ROWS.software.title,
      detail: ROWS.software.detail,
      time_label: ROWS.software.timeLabel,
      kind: "device",
    },
  ],
};
