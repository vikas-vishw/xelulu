// Screen 16a of the Reference: Notifications. Mock data and local state only, no network call
// and no environment read (Req 18.1-18.3, 22.1, 22.2).
//
// The rows are not pressable: nothing opens yet, and a dead control is worse than none.
//
// One deviation from the frozen Reference, reported: each row's relative time moves from under
// its detail line into the row's trailing slot, which is what `ListRow.trailingText` provides
// (D21). No chevron is dropped here, because the Reference draws none on a notification row.

import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { Card } from "../../components/card";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { ScreenHeader } from "../../components/screen-header";
import { SegmentedTabs, type SegmentedOption } from "../../components/segmented-tabs";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_NOTIFICATIONS, type NotificationsData } from "./mock-notifications";
import { NOTIFICATION_STRINGS } from "./strings";

const SEGMENT_KEYS = ["all", "device", "activity"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: NOTIFICATION_STRINGS.segments[key],
}));

export type NotificationsScreenProps = Readonly<{ data?: NotificationsData }>;

export function NotificationsScreen({
  data = MOCK_NOTIFICATIONS,
}: NotificationsScreenProps): React.JSX.Element {
  const [kind, setKind] = useState<SegmentKey>("all");

  const onSegmentChange = (key: string): void => {
    const next = SEGMENT_KEYS.find((candidate) => candidate === key);
    if (next !== undefined) setKind(next);
  };

  const rows = kind === "all" ? data.rows : data.rows.filter((row) => row.kind === kind);

  return (
    <Screen scroll>
      <ScreenHeader title={SCREEN_HEADER_NAME.notifications} back />

      <View className="mt-4">
        <SegmentedTabs
          options={SEGMENTS}
          value={kind}
          onChange={onSegmentChange}
          accessibilityLabel={NOTIFICATION_STRINGS.segmentsLabel}
        />
      </View>

      {rows.length === 0 ? (
        <AppText variant="body" tone="muted" className="mt-6">
          {NOTIFICATION_STRINGS.nothingHere}
        </AppText>
      ) : (
        <Card className="mt-4" padded={false}>
          {rows.map((row, index) => (
            <View
              key={row.notification_id}
              className={index === 0 ? undefined : "border-t border-hairline"}
            >
              <ListRow
                icon={row.icon}
                iconTone={row.icon_tone}
                title={row.title}
                subtitle={row.detail}
                trailingText={row.time_label}
                trailing="none"
              />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
