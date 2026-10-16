// The Home Dashboard, screen 6 of the Reference. Mock data and an injectable clock only: no
// network call, no environment read, no animation (C14, C15).

import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { AppText } from "../../components/app-text";
import { Card } from "../../components/card";
import { Icon } from "../../components/icon";
import { QuickActionTile } from "../../components/quick-action-tile";
import { Screen } from "../../components/screen";
import { SectionTitle } from "../../components/section-title";
import { StatTile } from "../../components/stat-tile";
import { StatusPill } from "../../components/status-pill";
import { CharacterPlaceholder } from "../../character/character-placeholder";
import { batteryTone } from "../../lib/battery";
import { tokens } from "../../theme/theme";
import { ROUTE_PATH } from "../shell/routes";

import { greetingFor } from "./greeting";
import { MOCK_HOME, type HomeData } from "./mock-home";
import { StoryThumbnail } from "./story-thumbnail";
import {
  batteryLabel,
  childLine,
  greetingLine,
  HOME_STRINGS,
  onlineLabel,
  playTimeValue,
  robotCardLabel,
} from "./strings";

const WELL = { width: 104, height: 88 } as const;
const CHARACTER_SIZE = 80;
const THUMBNAIL_SIZE = 56;
const ROW_GAP = { gap: tokens.spacing["3"] } as const;

/** The battery pill, so a test can read the tone its dot draws as well as its text (D15). */
export const BATTERY_PILL_TEST_ID = "home-battery-pill";

export type HomeDashboardProps = Readonly<{
  now?: () => Date;
  data?: HomeData;
}>;

export function HomeDashboard({
  now = () => new Date(),
  data = MOCK_HOME,
}: HomeDashboardProps): React.JSX.Element {
  const greeting = greetingFor(now());
  const { parent, child, device, today, last_activity: lastActivity } = data;

  return (
    <Screen scroll>
      {/* Header */}
      <View className="mt-2 flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center">
            <AppText variant="title" tone="primary" header>
              {greetingLine(greeting.text, parent.display_name)}
            </AppText>
            <View className="ml-2">
              <Icon name={greeting.icon} size="md" color="sun" decorative />
            </View>
          </View>
          <AppText variant="label" tone="muted" className="mt-1">
            {childLine(child.display_name)}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={HOME_STRINGS.settingsButton}
          onPress={() => router.push(ROUTE_PATH.settings)}
          className="h-touch w-touch items-center justify-center rounded-pill border border-hairline bg-surface active:bg-surface-beige"
        >
          <Icon name="settings-outline" size="md" color="text-primary" decorative />
        </Pressable>
      </View>

      {/* Robot status card */}
      <Card
        onPress={() => router.push(ROUTE_PATH.device)}
        accessibilityLabel={robotCardLabel(device.display_name, device.online, device.battery_pct)}
        padded={false}
        className="mt-5 p-3"
      >
        <View className="flex-row items-center">
          <View className="items-center justify-center rounded-lg bg-surface-beige" style={WELL}>
            <CharacterPlaceholder size={CHARACTER_SIZE} />
          </View>
          <View className="ml-3 flex-1">
            <AppText variant="heading" tone="primary">
              {device.display_name}
            </AppText>
            <AppText variant="label" tone="muted">
              {onlineLabel(device.online)}
            </AppText>
            <StatusPill
              testID={BATTERY_PILL_TEST_ID}
              className="mt-2"
              tone={batteryTone(device.battery_pct)}
              label={batteryLabel(device.battery_pct)}
            />
          </View>
          <Icon name="chevron-forward" size="md" color="text-muted" decorative />
        </View>
      </Card>

      {/* Quick actions */}
      <View className="mt-5 flex-row" style={ROW_GAP}>
        <QuickActionTile
          icon="game-controller-outline"
          label={HOME_STRINGS.quickActions.play}
          onPress={() => router.navigate(ROUTE_PATH.play)}
        />
        <QuickActionTile
          icon="calendar-outline"
          label={HOME_STRINGS.quickActions.routines}
          onPress={() => router.navigate(ROUTE_PATH.routines)}
        />
        <QuickActionTile
          icon="call-outline"
          label={HOME_STRINGS.quickActions.voiceCall}
          onPress={() => router.push(ROUTE_PATH["voice-call"])}
        />
        <QuickActionTile
          icon="settings-outline"
          label={HOME_STRINGS.quickActions.settings}
          onPress={() => router.push(ROUTE_PATH.settings)}
        />
      </View>

      {/* Today with Xelulu */}
      <SectionTitle className="mt-6">{HOME_STRINGS.todaySection}</SectionTitle>
      <View className="mt-3 flex-row" style={ROW_GAP}>
        <StatTile
          value={{ text: String(today.activities), tone: "info" }}
          label={HOME_STRINGS.activitiesLabel}
        />
        <StatTile
          value={{ text: playTimeValue(today.play_minutes) }}
          label={HOME_STRINGS.playTimeLabel}
        />
        {/* C13: a static label from mock data. Nothing infers a mood. */}
        <StatTile value={{ icon: "happy-outline", color: "sun" }} label={today.mood_label} />
      </View>

      {/* Last Activity */}
      <SectionTitle className="mt-6">{HOME_STRINGS.lastActivitySection}</SectionTitle>
      <Card className="mt-3 p-3" padded={false}>
        <View className="flex-row items-center">
          <StoryThumbnail size={THUMBNAIL_SIZE} />
          <View className="ml-3 flex-1">
            <AppText variant="heading" tone="primary">
              {lastActivity.title}
            </AppText>
            <AppText variant="label" tone="secondary">
              {lastActivity.subtitle}
            </AppText>
            <AppText variant="caption" tone="muted">
              {lastActivity.time_label}
            </AppText>
          </View>
        </View>
      </Card>
    </Screen>
  );
}
