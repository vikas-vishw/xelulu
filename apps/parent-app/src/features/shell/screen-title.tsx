// Header composition for the screens whose visible heading is not a single plain title line:
// an optional back control, the title line(s) inside the one `header`-role wrapper, and an
// optional trailing control (Req 3.4, 3.5, 21.6).
//
// This lives in the shell, not in the kit: Req 2.1 closes the Component_Kit at its eleven
// additions, and Req 1.3 bars adding props to `ScreenHeader`.

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Icon } from "../../components/icon";

import { goBack } from "./go-back";
import { BACK_LABEL } from "./strings";

/**
 * The back control's 44x44 pt box and its press tint, as classes. NativeWind claims the `style`
 * prop of an element that carries a `className`, so a `style` function is never invoked and the
 * sizing inside one never renders (nativewind issue 1105).
 */
const BACK_CONTROL =
  "mr-2 h-touch w-touch items-center justify-center rounded-pill active:bg-surface-beige";

export type ScreenTitleProps = Readonly<{
  /** The accessible name: SCREEN_HEADER_NAME[key], or the Req 3.4 exception's text. */
  name: string;
  back?: boolean;
  /** Optional trailing control, e.g. the Live View gear. */
  right?: ReactNode;
  /** "start" (the default) for a left-aligned heading; "center" for screens 1-5. */
  align?: "start" | "center";
  /** The visible title line(s) only. Subtitles are rendered by the screen as siblings. */
  children: ReactNode;
}>;

export function ScreenTitle({
  name,
  back = false,
  right,
  align = "start",
  children,
}: ScreenTitleProps): React.JSX.Element {
  return (
    <View className="mt-2 flex-row items-center">
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={BACK_LABEL}
          onPress={goBack}
          className={BACK_CONTROL}
        >
          <Icon name="chevron-back" size="lg" color="text-primary" decorative />
        </Pressable>
      ) : null}
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={name}
        className={align === "center" ? "flex-1 items-center" : "flex-1 items-start"}
      >
        {children}
      </View>
      {right}
    </View>
  );
}
