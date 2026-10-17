// Screen 9 of the Reference: Grow / Learning Insights. Mock data and local state only, no
// network call and no environment read (Req 11.1-11.6, 22.1, 22.2).
//
// The four metric values and the interest cards come from the reports In_App_Store (Phase 4 Req
// 19.4): counts out of the shared `summariseActivity`, computed on request. Nothing on this
// screen scores, ranks, infers or predicts anything about a child, and an interest card names a
// Content_Category the robot played from rather than a trait (Req 19.8, D14). The milestone rows
// stay a Mock_Module.
//
// One deviation from the frozen Reference, reported: the reports entry row at the bottom is an
// addition the Reference does not draw (D24c). Without it, `/reports` would be reachable only
// by deep link.

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { Card } from "../../components/card";
import { ListRow } from "../../components/list-row";
import { MetricRow } from "../../components/metric-row";
import { Screen } from "../../components/screen";
import { SectionTitle } from "../../components/section-title";
import { SegmentedTabs, type SegmentedOption } from "../../components/segmented-tabs";
import { Illustration } from "../../illustrations/illustration";
import { APP_REPORT_STORE, type AppReportStore } from "../../lib/stores/report-store";
import { tokens } from "../../theme/theme";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_GROW, type GrowData, type GrowInterest } from "./mock-grow";
import { GROW_STRINGS } from "./strings";

const SEGMENT_KEYS = ["overview", "interests", "milestones"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: GROW_STRINGS.segments[key],
}));

const ROW_GAP = { gap: tokens.spacing["3"] } as const;
/** The small interest tile: a 72 pt beige well with the art drawn wider and clipped. */
const TILE_WELL = 72;
const TILE_ART = { width: 120, height: TILE_WELL } as const;
/** The wide interest row's leading well. */
const ROW_WELL = { width: 72, height: 64 } as const;
const ROW_ART = { width: 110, height: 64 } as const;

function InterestTile({ interest }: Readonly<{ interest: GrowInterest }>): React.JSX.Element {
  return (
    <Card className="flex-1 items-center overflow-hidden" padded={false}>
      <View
        className="w-full items-center justify-center overflow-hidden bg-surface-beige"
        style={{ height: TILE_WELL }}
      >
        <Illustration
          name={interest.illustration}
          width={TILE_ART.width}
          height={TILE_ART.height}
        />
      </View>
      <AppText variant="label" tone="primary" className="py-2 text-center">
        {interest.label}
      </AppText>
    </Card>
  );
}

function InterestRow({ interest }: Readonly<{ interest: GrowInterest }>): React.JSX.Element {
  return (
    <Card className="mt-3">
      <View className="flex-row items-center">
        <View
          className="items-center justify-center overflow-hidden rounded-lg bg-surface-beige"
          style={ROW_WELL}
        >
          <Illustration
            name={interest.illustration}
            width={ROW_ART.width}
            height={ROW_ART.height}
          />
        </View>
        <View className="ml-3 flex-1">
          <AppText variant="heading" tone="primary">
            {interest.label}
          </AppText>
          <AppText variant="label" tone="secondary">
            {interest.detail}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

export type GrowScreenProps = Readonly<{ data?: GrowData; store?: AppReportStore }>;

export function GrowScreen({
  data = MOCK_GROW,
  store = APP_REPORT_STORE,
}: GrowScreenProps): React.JSX.Element {
  const [segment, setSegment] = useState<SegmentKey>("overview");

  const onSegmentChange = (key: string): void => {
    const next = SEGMENT_KEYS.find((candidate) => candidate === key);
    if (next !== undefined) setSegment(next);
  };

  const metrics = store.growMetrics();
  const interests = store.growInterests();

  return (
    <Screen scroll>
      <ScreenTitle name={SCREEN_HEADER_NAME.grow}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME.grow}
        </AppText>
      </ScreenTitle>
      <AppText variant="body" tone="secondary" className="mt-1">
        {GROW_STRINGS.subheader}
      </AppText>

      <View className="mt-4">
        <SegmentedTabs
          options={SEGMENTS}
          value={segment}
          onChange={onSegmentChange}
          accessibilityLabel={GROW_STRINGS.segmentsLabel}
        />
      </View>

      {segment === "overview" ? (
        <>
          {/* One Card per metric row, with a visible gap, as the Reference draws them. */}
          {metrics.map((metric) => (
            <Card key={metric.key} className="mt-3">
              <MetricRow
                icon={metric.icon}
                iconTone={metric.icon_tone}
                title={metric.title}
                subtitle={metric.subtitle}
                value={metric.value}
                tone="info"
              />
            </Card>
          ))}

          <SectionTitle className="mt-6">{GROW_STRINGS.currentInterests}</SectionTitle>
          <View className="mt-3 flex-row" style={ROW_GAP}>
            {interests.map((interest) => (
              <InterestTile key={interest.key} interest={interest} />
            ))}
          </View>
        </>
      ) : null}

      {segment === "interests"
        ? interests.map((interest) => <InterestRow key={interest.key} interest={interest} />)
        : null}

      {segment === "milestones" ? (
        // Grouped in one Card with a hairline between rows: these are plain list rows, not the
        // Reference's separately carded metrics.
        <Card className="mt-3" padded={false}>
          {data.milestones.map((milestone, index) => (
            <View
              key={milestone.key}
              className={index === 0 ? undefined : "border-t border-hairline"}
            >
              <ListRow
                icon="checkmark-circle"
                title={milestone.title}
                subtitle={milestone.subtitle}
                trailingText={milestone.time_label}
                trailing="none"
              />
            </View>
          ))}
        </Card>
      ) : null}

      <Card className="mt-4" padded={false}>
        <ListRow
          icon="stats-chart-outline"
          title={GROW_STRINGS.reportsRow.title}
          subtitle={GROW_STRINGS.reportsRow.subtitle}
          onPress={() => router.push(ROUTE_PATH.reports)}
        />
      </Card>
    </Screen>
  );
}
