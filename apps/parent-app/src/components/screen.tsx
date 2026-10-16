// Page frame: cream background, the top safe-area edge, and the page's horizontal padding.
// `scroll` wraps the content in a ScrollView for screens taller than the viewport.

import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { tokens } from "../theme/theme";

export type ScreenProps = Readonly<{
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}>;

export function Screen({ children, scroll = false, testID }: ScreenProps): React.JSX.Element {
  const content = <View className="flex-1 px-5">{children}</View>;
  return (
    <SafeAreaView testID={testID} edges={["top"]} className="flex-1 bg-page">
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: tokens.spacing["6"] }}
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}
