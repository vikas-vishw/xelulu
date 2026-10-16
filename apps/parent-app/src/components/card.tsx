// White rounded card with a hairline border and the one soft shadow. Pressable, with the
// `button` role and a label, only when `onPress` is given.
//
// The minimum height and the press tint are classes: NativeWind claims the `style` prop of an
// element that carries a `className`, so a `style` function is never invoked (nativewind issue
// 1105). `cardShadow` stays an inline STATIC style, which NativeWind merges rather than drops;
// React Native's shadow props have no faithful class under this Tailwind config.

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { cardShadow } from "../theme/theme";

type CardBase = Readonly<{
  children: ReactNode;
  /** Default padding (spacing 4); set false when the content supplies its own. */
  padded?: boolean;
  className?: string;
  testID?: string;
}>;

export type CardProps = CardBase &
  (
    | Readonly<{ onPress: () => void; accessibilityLabel: string }>
    | Readonly<{ onPress?: never; accessibilityLabel?: never }>
  );

const BASE = "rounded-xl border border-hairline bg-surface";

export function Card(props: CardProps): React.JSX.Element {
  const { children, padded = true, className, testID } = props;
  const classes = [BASE, padded ? "p-4" : "", className ?? ""]
    .filter((part) => part.length > 0)
    .join(" ");

  if (props.onPress === undefined) {
    return (
      <View testID={testID} className={classes} style={cardShadow}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      className={`${classes} min-h-touch active:bg-surface-beige`}
      style={cardShadow}
    >
      {children}
    </Pressable>
  );
}
