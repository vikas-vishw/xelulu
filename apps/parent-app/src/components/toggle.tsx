// Switch wrapper. The `switch` role and the checked state come from React Native's Switch;
// the track and thumb colours come from the Theme_Module.

import { Switch, View } from "react-native";

import { color, tokens } from "../theme/theme";

// The native Switch box is fixed and smaller than 44 pt (about 51x31 pt), so the Toggle both
// reserves a tokens.size.touchMin square of layout and extends the Switch's own touch box over
// it with hitSlop (Req 3.2). The look of the Switch itself is unchanged.
const TOUCH_MIN = tokens.size.touchMin;

/** Touch-area padding on each side of the native Switch box. */
export const TOGGLE_HIT_SLOP = tokens.spacing["3"];

export type ToggleProps = Readonly<{
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
}>;

export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  testID,
}: ToggleProps): React.JSX.Element {
  return (
    <View
      style={{
        minWidth: TOUCH_MIN,
        minHeight: TOUCH_MIN,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Switch
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        value={value}
        onValueChange={() => onValueChange(!value)}
        hitSlop={TOGGLE_HIT_SLOP}
        trackColor={{ false: color["control-off"], true: color.success }}
        thumbColor={color.surface}
        ios_backgroundColor={color["control-off"]}
      />
    </View>
  );
}
