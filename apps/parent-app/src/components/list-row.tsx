// Settings-style row: optional leading IconTile or node, title, optional subtitle, optional
// trailing text, and a trailing chevron or Toggle. Min height 56, so the touch area clears
// 44 pt (Req 3.2).
//
// `leading`, `trailingText` and `tone` are additive (D21): with none of them set the rendering
// is the same as Phase 2.1's.

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";
import { IconTile, type IconTileTone } from "./icon-tile";
import { Toggle, type ToggleProps } from "./toggle";

/**
 * The row's box. `min-h-row` is tokens.size.rowMin (56), so the touch area clears the 44 pt
 * minimum. It is a class, not a `style`: NativeWind claims the `style` prop of an element that
 * carries a `className`, so a `style` function is never invoked (nativewind issue 1105).
 */
const ROW_BOX = "min-h-row flex-row items-center px-4";

export type ListRowTrailing = "chevron" | "none" | Readonly<{ toggle: ToggleProps }>;

export type ListRowTone = "default" | "danger";

export type ListRowProps = Readonly<{
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** The leading IconTile's category colour. Beige, as before, when it is not given. */
  iconTone?: IconTileTone;
  /** Replaces the leading IconTile (an Avatar, usually). Ignored when `icon` is set. */
  leading?: ReactNode;
  /** Text shown before the trailing chevron or Toggle: a time, a value, "Later phase". */
  trailingText?: string;
  /** `danger` tints the title and `trailingText`. The leading slot is unchanged. */
  tone?: ListRowTone;
  trailing?: ListRowTrailing;
  onPress?: () => void;
  testID?: string;
}>;

function Trailing({ trailing }: Readonly<{ trailing: ListRowTrailing }>): React.JSX.Element | null {
  if (trailing === "none") return null;
  if (trailing === "chevron")
    return <Icon name="chevron-forward" size="md" color="text-muted" decorative />;
  return <Toggle {...trailing.toggle} />;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconTone,
  leading,
  trailingText,
  tone = "default",
  trailing = "chevron",
  onPress,
  testID,
}: ListRowProps): React.JSX.Element {
  // Danger-toned text is AppText plus the token-derived `text-danger` class: `TextTone` holds no
  // `danger` member and Req 1.3 bars editing app-text.tsx. The leading slot is never tinted by
  // `tone`: an IconTile's glyph follows its own `iconTone`, and a row that wants another graphic
  // passes one through `leading` instead.
  const dangerClass = tone === "danger" ? "text-danger" : undefined;

  const trailingTextParts = [trailing === "none" ? "" : "mr-2", dangerClass ?? ""].filter(
    (part) => part.length > 0,
  );
  const trailingTextClass = trailingTextParts.length > 0 ? trailingTextParts.join(" ") : undefined;

  const leadingSlot =
    icon !== undefined ? (
      <IconTile icon={icon} tone={iconTone} />
    ) : leading !== undefined ? (
      leading
    ) : null;

  const body = (
    <>
      {leadingSlot === null ? null : <View className="mr-3">{leadingSlot}</View>}
      <View className="flex-1">
        <AppText variant="heading" className={dangerClass}>
          {title}
        </AppText>
        {subtitle === undefined ? null : (
          <AppText variant="label" tone="secondary">
            {subtitle}
          </AppText>
        )}
      </View>
      {trailingText === undefined ? null : (
        <AppText variant="label" tone="muted" className={trailingTextClass}>
          {trailingText}
        </AppText>
      )}
      <Trailing trailing={trailing} />
    </>
  );

  if (onPress === undefined) {
    // No `accessible` wrapper and no `accessibilityLabel`: the title, the subtitle and the
    // trailing text stay three announcements in document order.
    return (
      <View testID={testID} className={ROW_BOX}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={trailingText === undefined ? title : `${title}, ${trailingText}`}
      onPress={onPress}
      className={`${ROW_BOX} active:bg-surface-beige`}
    >
      {body}
    </Pressable>
  );
}
