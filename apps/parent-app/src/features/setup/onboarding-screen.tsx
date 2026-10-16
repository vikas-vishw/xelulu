// Screen 2 of the Reference: the value carousel. Mock data and local state only, no network
// call and no environment read (Req 5.1-5.4, 22.1, 22.2).
//
// Two deviations from the frozen Reference, both reported: the three value rows become the
// three pages of a carousel, so one is visible at a time (Req 5.2, D24e), and the dots are
// `PageDots`' interactive mode, so they sit 44 pt apart (D24g). `scrollTo` is called with
// `animated: false`, because D11 allows no animation.

import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { CharacterPlaceholder } from "../../character/character-placeholder";
import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { IconTile } from "../../components/icon-tile";
import { PageDots } from "../../components/page-dots";
import { Screen } from "../../components/screen";
import { Illustration } from "../../illustrations/illustration";
import { tokens } from "../../theme/theme";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_ONBOARDING, type OnboardingData } from "./mock-setup";
import { SETUP_STRINGS } from "./strings";

const HERO_HEIGHT = 180;
const PERSON_SIZE = 120;
const CHARACTER_SIZE = 110;
// `tokens.spacing` is indexed, so under `noUncheckedIndexedAccess` these two read as
// `number | undefined`. Both are used in arithmetic, so each is pinned to a number here.
/** The Screen's horizontal padding, spacing 5. */
const SCREEN_PADDING: number = tokens.spacing["5"] ?? 0;
/** How far the character sits over the figure, so the pair reads as one hug. */
const HERO_OVERLAP: number = tokens.spacing["6"] ?? 0;
const HERO_STACK = {
  width: PERSON_SIZE + CHARACTER_SIZE - HERO_OVERLAP,
  height: PERSON_SIZE,
} as const;
const CAROUSEL_HEIGHT = 150;

/** The carousel's handle, so a test can settle it on a page without a real gesture. */
export const CAROUSEL_TEST_ID = "onboarding-carousel";

export type OnboardingScreenProps = Readonly<{ data?: OnboardingData }>;

export function OnboardingScreen({
  data = MOCK_ONBOARDING,
}: OnboardingScreenProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  // One number for paging, for the `scrollTo` offset and for the index: the viewport inside the
  // Screen's horizontal padding (spacing 5 each side), so no negative margin is needed.
  const PAGE_WIDTH = width - 2 * SCREEN_PADDING;

  const [index, setIndex] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const onDotPress = (next: number): void => {
    setIndex(next);
    scroller.current?.scrollTo({ x: next * PAGE_WIDTH, y: 0, animated: false });
  };

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / PAGE_WIDTH));
  };

  return (
    <Screen>
      <ScreenTitle back align="center" name={SCREEN_HEADER_NAME.onboarding}>
        <AppText variant="title" tone="primary">
          {SETUP_STRINGS.onboarding.heading}
        </AppText>
      </ScreenTitle>

      {/* The hero well. The figure is decorative; the character keeps its own image label. */}
      <View
        className="mt-5 items-center justify-end rounded-xl bg-surface-beige"
        style={{ height: HERO_HEIGHT }}
      >
        <View style={HERO_STACK}>
          <View className="absolute bottom-0 left-0">
            <Illustration name="person-figure" width={PERSON_SIZE} height={PERSON_SIZE} />
          </View>
          <View className="absolute bottom-0 right-0">
            <CharacterPlaceholder size={CHARACTER_SIZE} />
          </View>
        </View>
      </View>

      <ScrollView
        ref={scroller}
        testID={CAROUSEL_TEST_ID}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        className="mt-6"
        style={{ height: CAROUSEL_HEIGHT }}
      >
        {data.pages.map((page) => (
          <View
            key={page.key}
            className="items-center justify-center"
            style={{ width: PAGE_WIDTH }}
          >
            <IconTile icon={page.icon} />
            <AppText variant="heading" tone="primary" className="mt-3 text-center">
              {page.title}
            </AppText>
          </View>
        ))}
      </ScrollView>

      <View className="mt-2 items-center">
        <PageDots count={data.pages.length} index={index} onSelect={onDotPress} />
      </View>

      <View className="flex-1 justify-end pb-6">
        <Button
          label={SETUP_STRINGS.onboarding.getStarted}
          onPress={() => router.push(ROUTE_PATH.auth)}
        />
      </View>
    </Screen>
  );
}
