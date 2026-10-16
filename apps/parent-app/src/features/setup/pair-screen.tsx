// Screen 4 of the Reference: the pairing walkthrough. The steps are a local counter and
// nothing else: no Bluetooth, Wi-Fi, network or permission API is called, and no module that
// provides one is imported (Req 7.1-7.5). Pairing itself is Document C's, at Phase 6.

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { CharacterPlaceholder } from "../../character/character-placeholder";
import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { Screen } from "../../components/screen";
import { StepList, type Step } from "../../components/step-list";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_PAIR_STEPS } from "./mock-setup";
import { SETUP_STRINGS } from "./strings";

const WELL_HEIGHT = 200;
const CHARACTER_SIZE = 150;
/** Step 1 done and step 2 current, as the Reference draws it (Req 7.2). */
const FIRST_CURRENT_STEP = 1;

export type PairScreenProps = Readonly<{ steps?: readonly Step[] }>;

export function PairScreen({ steps = MOCK_PAIR_STEPS }: PairScreenProps): React.JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(FIRST_CURRENT_STEP);
  const onLastStep = currentIndex >= steps.length - 1;

  const onStartPairing = (): void => {
    if (onLastStep) {
      router.push(ROUTE_PATH["child-profile"]);
      return;
    }
    setCurrentIndex(currentIndex + 1);
  };

  return (
    <Screen scroll>
      <ScreenTitle back align="center" name={SCREEN_HEADER_NAME["pair-device"]}>
        <AppText variant="title" tone="primary">
          {SETUP_STRINGS.pair.heading}
        </AppText>
      </ScreenTitle>

      <View className="mt-1 items-center">
        <AppText variant="body" tone="secondary">
          {SETUP_STRINGS.pair.subheading}
        </AppText>
      </View>

      <View
        className="mt-5 items-center justify-center rounded-xl bg-surface-beige"
        style={{ height: WELL_HEIGHT }}
      >
        <CharacterPlaceholder size={CHARACTER_SIZE} />
      </View>

      <View className="mt-6">
        <StepList steps={steps} currentIndex={currentIndex} />
      </View>

      <View className="mt-6">
        <Button label={SETUP_STRINGS.pair.startPairing} onPress={onStartPairing} />
      </View>
    </Screen>
  );
}
