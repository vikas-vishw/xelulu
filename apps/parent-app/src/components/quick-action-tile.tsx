// Dense_Component (Req 3.4): a square white tile with a line icon over a short label.
// Font scaling is capped at tokens.fontScale.denseMax so four tiles stay on one row.
//
// The tile's sizing and its press tint are classes: NativeWind claims the `style` prop of an
// element that carries a `className`, so a `style` function is never invoked (nativewind issue
// 1105). `cardShadow` stays an inline STATIC style, which NativeWind merges; React Native's
// shadow props have no faithful class under this Tailwind config.

import { Pressable } from "react-native";

import { cardShadow } from "../theme/theme";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";

export type QuickActionTileProps = Readonly<{
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}>;

export function QuickActionTile({
  icon,
  label,
  onPress,
  testID,
}: QuickActionTileProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-tile min-w-touch flex-1 items-center justify-center rounded-lg border border-hairline bg-surface px-1 py-3 active:bg-surface-beige"
      style={cardShadow}
    >
      <Icon name={icon} size="lg" color="brand" decorative />
      <AppText variant="label" tone="primary" dense className="mt-2" numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}
