// Dense_Component (Req 3.4): the bottom tab bar. Each item carries the `tab` role, its
// `selected` state and a text label, so the active tab never depends on colour alone.
//
// Each item's 44 pt minimum box and its press tint are classes. NativeWind claims the `style`
// prop of an element that carries a `className`, so a `style` function is never invoked
// (nativewind issue 1105). The bar's own height stays an inline STATIC style, which NativeWind
// merges: it depends on the measured safe-area inset, which no class can express.

import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TabKey } from "../features/shell/routes";
import { tokens } from "../theme/theme";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";

export type TabBarItem = Readonly<{
  key: TabKey;
  label: string;
  icon: IconName;
  iconActive: IconName;
}>;

export type TabBarProps = Readonly<{
  items: readonly TabBarItem[];
  activeKey: TabKey;
  onSelect: (key: TabKey) => void;
  testID?: string;
}>;

export function TabBar({ items, activeKey, onSelect, testID }: TabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      className="flex-row border-t border-hairline bg-surface"
      style={{ height: tokens.size.tabBarHeight + insets.bottom, paddingBottom: insets.bottom }}
    >
      {items.map((item) => {
        const selected = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(item.key)}
            className="min-h-touch min-w-touch flex-1 items-center justify-center active:bg-surface-beige"
          >
            <Icon
              name={selected ? item.iconActive : item.icon}
              size="md"
              color={selected ? "brand" : "text-muted"}
              decorative
            />
            <AppText variant="caption" tone={selected ? "brand" : "muted"} dense className="mt-1">
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
