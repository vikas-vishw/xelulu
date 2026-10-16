// Screen header: an optional back control, then the title with the `header` role (Req 3.5).
// Back goes to the previous screen, or to Home when the screen was opened by deep link
// (Req 4.7).

import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { ROUTE_PATH } from "../features/shell/routes";
import { BACK_LABEL } from "../features/shell/strings";

import { AppText } from "./app-text";
import { Icon } from "./icon";

/**
 * The back control's 44x44 pt box and its press tint, as classes. NativeWind claims the `style`
 * prop of an element that carries a `className`, so a `style` function is never invoked and the
 * sizing inside one never renders (nativewind issue 1105).
 */
const BACK_CONTROL =
  "mr-2 h-touch w-touch items-center justify-center rounded-pill active:bg-surface-beige";

export type ScreenHeaderProps = Readonly<{
  title: string;
  back?: boolean;
  testID?: string;
}>;

function goBack(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(ROUTE_PATH.home);
}

export function ScreenHeader({
  title,
  back = false,
  testID,
}: ScreenHeaderProps): React.JSX.Element {
  return (
    <View testID={testID} className="mt-2 flex-row items-center">
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={BACK_LABEL}
          onPress={goBack}
          className={BACK_CONTROL}
        >
          <Icon name="chevron-back" size="lg" color="text-primary" decorative />
        </Pressable>
      ) : null}
      <AppText variant="title" tone="primary" header>
        {title}
      </AppText>
    </View>
  );
}
