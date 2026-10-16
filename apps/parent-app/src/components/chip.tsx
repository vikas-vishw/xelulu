// Pill-shaped label, optionally selectable or removable. Selected is a brand fill plus
// `accessibilityState.selected`, so the state is never carried by colour alone (Req 2.3, 21.3).
//
// The 44 pt minimum height, the pill radius and the press tint are classes. NativeWind claims
// the `style` prop of an element that carries a `className`, so a `style` function is never
// invoked and nothing inside one renders (nativewind issue 1105).

import { Pressable, View } from "react-native";

import { AppText } from "./app-text";
import { Icon } from "./icon";
import { KIT_STRINGS } from "./strings";

export type ChipTrailing = "none" | "remove" | "add";

export type ChipProps = Readonly<{
  label: string;
  selected?: boolean;
  onPress?: () => void;
  trailing?: ChipTrailing;
  accessibilityLabel?: string;
  testID?: string;
}>;

const BASE = "min-h-touch flex-row items-center rounded-pill px-4";

export function Chip({
  label,
  selected = false,
  onPress,
  trailing = "none",
  accessibilityLabel,
  testID,
}: ChipProps): React.JSX.Element {
  const fillClass = selected ? "bg-brand" : "bg-surface border border-hairline";
  const tone = selected ? "on-brand" : "primary";
  const glyphColor = selected ? "on-brand" : "text-muted";

  const body = (
    <>
      {trailing === "add" ? (
        <View className="mr-1">
          <Icon name="add" size="sm" color={glyphColor} decorative />
        </View>
      ) : null}
      <AppText variant="label" tone={tone}>
        {label}
      </AppText>
      {trailing === "remove" ? (
        <View className="ml-1">
          <Icon name="close" size="sm" color={glyphColor} decorative />
        </View>
      ) : null}
    </>
  );

  if (onPress === undefined) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={accessibilityLabel ?? label}
        className={`${BASE} ${fillClass}`}
      >
        {body}
      </View>
    );
  }

  const name =
    accessibilityLabel ?? (trailing === "remove" ? KIT_STRINGS.removeLabel(label) : label);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`${BASE} ${fillClass} ${selected ? "active:bg-brand-pressed" : "active:bg-hairline"}`}
    >
      {body}
    </Pressable>
  );
}
