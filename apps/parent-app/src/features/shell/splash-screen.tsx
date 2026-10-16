// Screen 1 of the Reference: the brand moment. A plain setTimeout replaces to Home, cleared on
// unmount so an early unmount navigates nowhere (Req 4.2, 4.3, 4.6, D11). No photographic
// background: D9 allows original vector art only.

import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { PageDots } from "../../components/page-dots";
import { Screen } from "../../components/screen";
import { CharacterPlaceholder } from "../../character/character-placeholder";

import { ROUTE_PATH } from "./routes";
import { ScreenTitle } from "./screen-title";
import { SHELL_STRINGS } from "./strings";

/** How long the brand moment is held before Home replaces it. */
export const SPLASH_DELAY_MS = 1200;

const CHARACTER_SIZE = 200;
const DOT_COUNT = 3;

export type SplashScreenProps = Readonly<{
  /** Injectable only so a unit test can avoid the wait. */
  delayMs?: number;
}>;

export function SplashScreen({ delayMs = SPLASH_DELAY_MS }: SplashScreenProps): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => router.replace(ROUTE_PATH.home), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    <Screen>
      <ScreenTitle align="center" name={SHELL_STRINGS.wordmark}>
        <AppText variant="display" tone="brand">
          {SHELL_STRINGS.wordmark}
        </AppText>
      </ScreenTitle>

      <View className="mt-3 items-center">
        {SHELL_STRINGS.tagline.map((line) => (
          <AppText key={line} variant="body" tone="secondary">
            {line}
          </AppText>
        ))}
      </View>

      <View className="flex-1 items-center justify-center">
        <CharacterPlaceholder size={CHARACTER_SIZE} />
        <View className="mt-6">
          <PageDots count={DOT_COUNT} index={0} />
        </View>
      </View>

      <View className="items-center pb-6">
        <AppText variant="label" tone="muted">
          {SHELL_STRINGS.footer}
        </AppText>
      </View>
    </Screen>
  );
}
