// Screen 8 of the Reference: Play & Adventure. Mock data and local state only, no network
// call and no environment read (Req 10.1-10.6, 22.1, 22.2).
//
// Nothing here starts an activity: pressing a card sets one muted line saying the robot starts
// it, and never navigates (Req 10.5).

import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { MediaCard } from "../../components/media-card";
import { Screen } from "../../components/screen";
import { ScreenHeader } from "../../components/screen-header";
import { SegmentedTabs, type SegmentedOption } from "../../components/segmented-tabs";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_PLAY, type PlayData } from "./mock-play";
import { PLAY_STRINGS } from "./strings";

/** "all" plus the three `PlayCategory` values, in the Reference's order. */
const SEGMENT_KEYS = ["all", "games", "stories", "learning"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: PLAY_STRINGS.segments[key],
}));

export type PlayScreenProps = Readonly<{ data?: PlayData }>;

export function PlayScreen({ data = MOCK_PLAY }: PlayScreenProps): React.JSX.Element {
  const [category, setCategory] = useState<SegmentKey>("all");
  const [notice, setNotice] = useState<string | null>(null);

  // Narrowed without a cast: `SegmentedTabs` hands back the key as a plain string.
  const onSegmentChange = (key: string): void => {
    const next = SEGMENT_KEYS.find((candidate) => candidate === key);
    if (next === undefined) return;
    setCategory(next);
    // The notice names a card that may no longer be on screen, so the segment change clears it.
    setNotice(null);
  };

  const visible =
    category === "all" ? data.items : data.items.filter((item) => item.category === category);

  return (
    <Screen scroll>
      <ScreenHeader title={SCREEN_HEADER_NAME.play} back />

      <View className="mt-4">
        <SegmentedTabs
          options={SEGMENTS}
          value={category}
          onChange={onSegmentChange}
          accessibilityLabel={PLAY_STRINGS.segmentsLabel}
        />
      </View>

      {notice === null ? null : (
        <AppText variant="caption" tone="muted" className="mt-3">
          {notice}
        </AppText>
      )}

      {visible.length === 0 ? (
        <AppText variant="body" tone="muted" className="mt-4">
          {PLAY_STRINGS.nothingHere}
        </AppText>
      ) : null}

      {visible.map((item) => (
        <View key={item.item_id} className="mt-3">
          <MediaCard
            title={item.title}
            subtitle={item.subtitle}
            illustration={item.illustration}
            onPress={() => setNotice(PLAY_STRINGS.startsFromRobot)}
          />
        </View>
      ))}
    </Screen>
  );
}
