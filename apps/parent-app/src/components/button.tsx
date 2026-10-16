// Primary and secondary button. Full width, radius md, min height 48. The pressed state is a
// colour change only, with no animation (Req 2.8, C15).
//
// The height, the disabled state and the press tint are all classes. NativeWind claims the
// `style` prop of any element that carries a `className`, so a `style` function is never
// invoked and anything expressed inside one never renders (nativewind issue 1105). The press
// tint is an `active:` variant; it is composed in only when the button is enabled, so a
// disabled button cannot darken under a touch.

import { Pressable, View } from "react-native";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";

export type ButtonVariant = "primary" | "secondary";

export type ButtonProps = Readonly<{
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
  className?: string;
  testID?: string;
}>;

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  icon,
  accessibilityHint,
  className,
  testID,
}: ButtonProps): React.JSX.Element {
  const primary = variant === "primary";
  const classes = [
    "min-h-control w-full flex-row items-center justify-center rounded-md px-4",
    primary ? "bg-brand" : "bg-surface-beige border border-hairline",
    disabled ? "opacity-disabled" : primary ? "active:bg-brand-pressed" : "active:bg-hairline",
    className ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={classes}
    >
      {icon === undefined ? null : (
        <View className="mr-2">
          <Icon name={icon} size="md" color={primary ? "on-brand" : "brand"} decorative />
        </View>
      )}
      <AppText variant="heading" tone={primary ? "on-brand" : "brand"}>
        {label}
      </AppText>
    </Pressable>
  );
}
