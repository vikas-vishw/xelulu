// Ionicons wrapper (C4). `IconName` is the closed set of glyphs this phase uses, so a typo
// fails `tsc --noEmit`. Colours come from the Theme_Module only.

import Ionicons from "@expo/vector-icons/Ionicons";

import { color, tokens, type ColorToken } from "../theme/theme";

export type IconName =
  | "add"
  | "barbell-outline"
  | "battery-charging-outline"
  | "bed-outline"
  | "bluetooth-outline"
  | "book-outline"
  | "brush-outline"
  | "bulb-outline"
  | "calendar"
  | "calendar-outline"
  | "call"
  | "call-outline"
  | "camera-outline"
  | "chatbubble-ellipses-outline"
  | "checkmark"
  | "checkmark-circle"
  | "chevron-back"
  | "chevron-forward"
  | "close"
  | "cloud-download-outline"
  | "eye-off-outline"
  | "eye-outline"
  | "game-controller"
  | "game-controller-outline"
  | "happy-outline"
  | "hardware-chip-outline"
  | "heart-outline"
  | "help-circle-outline"
  | "home"
  | "home-outline"
  | "information-circle-outline"
  | "language-outline"
  | "leaf-outline"
  | "lock-closed-outline"
  | "logo-apple"
  | "logo-google"
  | "mail-outline"
  | "mic-off-outline"
  | "mic-outline"
  | "moon"
  | "moon-outline"
  | "notifications-outline"
  | "partly-sunny"
  | "people"
  | "people-outline"
  | "person-circle-outline"
  | "person-outline"
  | "power-outline"
  | "remove"
  | "restaurant-outline"
  | "school"
  | "school-outline"
  | "settings-outline"
  | "shield-checkmark-outline"
  | "sparkles-outline"
  | "stats-chart-outline"
  | "sunny"
  | "sunny-outline"
  | "time-outline"
  | "trash-outline"
  | "volume-high"
  | "volume-high-outline"
  | "volume-mute"
  | "walk-outline"
  | "wifi-outline";

export type IconSize = "sm" | "md" | "lg";

const SIZE: Readonly<Record<IconSize, number>> = {
  sm: tokens.size.iconSm,
  md: tokens.size.icon,
  lg: tokens.size.iconLg,
};

export type IconProps = Readonly<{
  name: IconName;
  size?: IconSize;
  color?: ColorToken;
  /** Hides the glyph from accessibility when adjacent text already says it (Req 3.6). */
  decorative?: boolean;
  testID?: string;
}>;

export function Icon({
  name,
  size = "md",
  color: colorToken = "text-primary",
  decorative = false,
  testID,
}: IconProps): React.JSX.Element {
  return (
    <Ionicons
      name={name}
      size={SIZE[size]}
      color={color[colorToken]}
      testID={testID}
      accessible={decorative ? false : undefined}
      accessibilityElementsHidden={decorative || undefined}
      importantForAccessibility={decorative ? "no-hide-descendants" : undefined}
    />
  );
}
