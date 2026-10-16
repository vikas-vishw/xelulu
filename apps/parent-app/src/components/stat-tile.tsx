// Dense_Component (Req 3.4): a non-pressable tile showing one value over its label. Read as a
// single accessibility element, "<value> <label>", so the number and its meaning arrive together.

import { View } from "react-native";

import { cardShadow, type ColorToken } from "../theme/theme";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";

const MIN_HEIGHT = 84;

export type StatValue =
  | Readonly<{ text: string; tone?: "primary" | "info" }>
  | Readonly<{ icon: IconName; color: ColorToken }>;

export type StatTileProps = Readonly<{
  value: StatValue;
  label: string;
  testID?: string;
}>;

function valueText(value: StatValue): string | null {
  return "text" in value ? value.text : null;
}

export function StatTile({ value, label, testID }: StatTileProps): React.JSX.Element {
  const text = valueText(value);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={text === null ? label : `${text} ${label}`}
      className="flex-1 items-center justify-center rounded-lg border border-hairline bg-surface px-2 py-3"
      style={[cardShadow, { minHeight: MIN_HEIGHT }]}
    >
      {"text" in value ? (
        <AppText variant="stat" tone={value.tone ?? "primary"} dense>
          {value.text}
        </AppText>
      ) : (
        <Icon name={value.icon} size="lg" color={value.color} decorative />
      )}
      <AppText variant="label" tone="muted" dense className="mt-1" numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}
