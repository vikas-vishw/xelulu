// Screen 8 of the Reference: Play & Adventure. The cards come from the content In_App_Store over
// the shared Starter_Content, in memory: no network call and no environment read (Phase 4 Req
// 19.3, Phase 2.2 Req 10.1-10.6, 22.1, 22.2). Only `active` items are offered — the store filters
// them — so a draft never reaches this screen.
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
import { APP_CONTENT_STORE, type AppContentStore } from "../../lib/stores/content-store";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { PLAY_STRINGS } from "./strings";

/** "all" plus the three `PlayCategory` values, in the Reference's order. */
const SEGMENT_KEYS = ["all", "games", "stories", "learning"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: PLAY_STRINGS.segments[key],
}));

export type PlayScreenProps = Readonly<{ store?: AppContentStore }>;

export function PlayScreen({ store = APP_CONTENT_STORE }: PlayScreenProps): React.JSX.Element {
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

  const items = store.playItems();
  const visible = category === "all" ? items : items.filter((item) => item.category === category);

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
