// Non-pressable summary row: an icon tile, then the value over its label. Differs from
// StatTile, which is a square equal-flex tile showing an icon or a value. Each one sits inside
// its own caller-supplied Card, so it draws no divider and expects none (Req 2.9).

import { View } from "react-native";

import { AppText } from "./app-text";
import { type IconName } from "./icon";
import { IconTile, type IconTileTone } from "./icon-tile";

export type MetricTileProps = Readonly<{
  icon: IconName;
  /** The leading IconTile's category colour. Beige, as before, when it is not given. */
  iconTone?: IconTileTone;
  value: string;
  label: string;
  testID?: string;
}>;

export function MetricTile({
  icon,
  iconTone,
  value,
  label,
  testID,
}: MetricTileProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${value} ${label}`}
      className="flex-row items-center"
    >
      <IconTile icon={icon} tone={iconTone} />
      <View className="ml-3 flex-1">
        <AppText variant="stat" tone="primary">
          {value}
        </AppText>
        <AppText variant="label" tone="muted">
          {label}
        </AppText>
      </View>
    </View>
  );
}
