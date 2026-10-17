// Screen 15 of the Reference: Reports. The four numbers and the interests line come from the
// reports In_App_Store (Phase 4 Req 19.4) — counts out of the shared `summariseActivity`,
// computed on request, in memory: no network call and no environment read (Phase 2.2 Req
// 12.1-12.4, 22.1, 22.2).
//
// A report is a summary a parent asked for (safety.md s.2): nothing on this screen profiles a
// child, and nothing is used for advertising. No code infers, scores or ranks.
//
// One deviation from the frozen Reference, reported: the interests block is wrapped in a `Card`
// the Reference draws without one (D24d).

import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { Card } from "../../components/card";
import { MetricTile } from "../../components/metric-tile";
import { Screen } from "../../components/screen";
import { SegmentedTabs, type SegmentedOption } from "../../components/segmented-tabs";
import { Illustration } from "../../illustrations/illustration";
import { MOCK_IDENTITY } from "../../lib/mock-identity";
import { APP_REPORT_STORE, type AppReportStore } from "../../lib/stores/report-store";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { type ReportPeriodKey } from "./mock-reports";
import { REPORTS_STRINGS } from "./strings";

const SEGMENT_KEYS = ["week", "month"] as const;

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: REPORTS_STRINGS.segments[key],
}));

const ART = { width: 80, height: 72 } as const;

export type ReportsScreenProps = Readonly<{ store?: AppReportStore }>;

export function ReportsScreen({ store = APP_REPORT_STORE }: ReportsScreenProps): React.JSX.Element {
  const [period, setPeriod] = useState<ReportPeriodKey>("week");

  const onSegmentChange = (key: string): void => {
    const next = SEGMENT_KEYS.find((candidate) => candidate === key);
    if (next !== undefined) setPeriod(next);
  };

  const tiles = store.reportTiles(period);
  const interestsLabel = store.interestsLabel(period);

  return (
    <Screen scroll>
      <ScreenTitle back name={SCREEN_HEADER_NAME.reports}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME.reports}
        </AppText>
      </ScreenTitle>
      <AppText variant="body" tone="secondary" className="mt-1">
        {REPORTS_STRINGS.subheader}
      </AppText>

      <View className="mt-4">
        <SegmentedTabs
          options={SEGMENTS}
          value={period}
          onChange={onSegmentChange}
          accessibilityLabel={REPORTS_STRINGS.segmentsLabel}
        />
      </View>

      {/* One Card per tile, with a visible gap, as the Reference draws them. */}
      {tiles.map((tile) => (
        <Card key={tile.key} className="mt-3">
          <MetricTile
            icon={tile.icon}
            iconTone={tile.icon_tone}
            value={tile.value}
            label={tile.label}
          />
        </Card>
      ))}

      <Card className="mt-4">
        <View className="flex-row items-center">
          <View className="flex-1 pr-3">
            <AppText variant="heading" tone="primary">
              {REPORTS_STRINGS.interestsHeading(MOCK_IDENTITY.child)}
            </AppText>
            <AppText variant="body" tone="secondary">
              {interestsLabel}
            </AppText>
          </View>
          <Illustration name="dino-scene" width={ART.width} height={ART.height} />
        </View>
      </Card>

      <AppText variant="caption" tone="muted" className="mt-4">
        {REPORTS_STRINGS.purposeNote}
      </AppText>
    </Screen>
  );
}
