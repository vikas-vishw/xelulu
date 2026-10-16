// Round icon control with its label below it: the call controls and the child-profile photo
// badge. The disc, the label and the state line are one Pressable, so the whole control is one
// touch target (Req 2.10, 21.1).

import { Pressable, View } from "react-native";

import { color, tokens } from "../theme/theme";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";

export type CircleButtonSize = "badge" | "lg";

/**
 * The disc's diameter per size. Exported so a test can check the rendered disc against the
 * 44 pt minimum instead of restating the number.
 *
 * The disc's sizing and its press tint stay an inline STATIC style array, which NativeWind
 * merges onto the element's classes rather than dropping, and `pressed` reaches it through
 * Pressable's children-as-function — a prop NativeWind does not touch — so unlike a `style`
 * callback it really does run.
 */
export const DISC: Readonly<Record<CircleButtonSize, number>> = { badge: 40, lg: 64 };

type CircleButtonBase = Readonly<{
  icon: IconName;
  stateText?: string;
  size?: CircleButtonSize; // default "lg"
  tone?: "neutral" | "danger";
  onPress: () => void;
  testID?: string;
}>;

export type CircleButtonProps =
  /** Labelled: the visible label is the accessible name unless overridden. */
  | (CircleButtonBase & Readonly<{ label: string; accessibilityLabel?: string }>)
  /** Unlabelled (the badge): `accessibilityLabel` is required and carries the name. */
  | (CircleButtonBase & Readonly<{ label?: undefined; accessibilityLabel: string }>);

/** `accessibilityLabel` when given; else "<label>, <stateText>"; else the label. */
function accessibleName(props: CircleButtonProps): string {
  if (props.label === undefined) return props.accessibilityLabel;
  if (props.accessibilityLabel !== undefined) return props.accessibilityLabel;
  return props.stateText === undefined ? props.label : `${props.label}, ${props.stateText}`;
}

export function CircleButton(props: CircleButtonProps): React.JSX.Element {
  const { icon, stateText, size = "lg", tone = "neutral", onPress, testID } = props;
  const disc = DISC[size];
  const danger = tone === "danger";

  // A badge draws at 40 pt, so 2 pt of slop on each edge clears the 44 pt minimum. The clamp is
  // load-bearing: the `lg` default already draws wider than the minimum, and a negative hitSlop
  // would shrink the touch box of the disc, the label and the state line alike.
  const slop = Math.max(0, (tokens.size.touchMin - disc) / 2);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibleName(props)}
      onPress={onPress}
      hitSlop={slop}
      className="items-center"
    >
      {({ pressed }) => (
        <>
          <View
            className={`items-center justify-center ${
              danger ? "bg-danger" : "bg-surface border border-hairline"
            }`}
            style={[
              { width: disc, height: disc, borderRadius: tokens.radius.pill },
              pressed
                ? { backgroundColor: danger ? color["brand-pressed"] : color["surface-beige"] }
                : null,
            ]}
          >
            <Icon name={icon} size="lg" color={danger ? "on-brand" : "brand"} decorative />
          </View>
          {props.label === undefined ? null : (
            <AppText variant="label" tone="primary" className="mt-2">
              {props.label}
            </AppText>
          )}
          {stateText === undefined ? null : (
            <AppText variant="caption" tone="muted">
              {stateText}
            </AppText>
          )}
        </>
      )}
    </Pressable>
  );
}
