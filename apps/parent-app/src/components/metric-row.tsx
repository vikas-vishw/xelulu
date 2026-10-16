// Non-pressable metric row: a leading icon tile, a title over a subtitle, and an
// already-formatted trailing value. Each row sits inside its own caller-supplied Card, so it
// draws no divider and expects none (Req 2.9).

import { View } from "react-native";

import { AppText } from "./app-text";
import { type IconName } from "./icon";
import { IconTile, type IconTileTone } from "./icon-tile";

export type MetricRowProps = Readonly<{
  icon: IconName;
  /** The leading IconTile's category colour. Beige, as before, when it is not given. */
  iconTone?: IconTileTone;
  title: string;
  subtitle: string;
  /** Already-formatted display value, e.g. "+12". Never computed here. */
  value: string;
  tone?: "info" | "primary";
  testID?: string;
}>;

export function MetricRow({
  icon,
  iconTone,
  title,
  subtitle,
  value,
  tone = "primary",
  testID,
}: MetricRowProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${value} ${title}`}
      className="flex-row items-center"
    >
      <IconTile icon={icon} tone={iconTone} />
      <View className="ml-3 flex-1">
        <AppText variant="heading" tone="primary">
          {title}
        </AppText>
        <AppText variant="label" tone="secondary">
          {subtitle}
        </AppText>
      </View>
      <AppText variant="heading" tone={tone === "info" ? "info" : "primary"}>
        {value}
      </AppText>
    </View>
  );
}
