// Every piece of text in the app. Size, line height and weight come from one typography token;
// colour comes from one tone. Font scaling stays on (Req 3.4): only a Dense_Component passes
// `dense`, which caps scaling at tokens.fontScale.denseMax.

import type { ReactNode } from "react";
import { Text } from "react-native";

import { tokens, type TypographyToken } from "../theme/theme";

export type TextTone = "primary" | "secondary" | "muted" | "brand" | "info" | "on-brand";

const TONE_CLASS: Readonly<Record<TextTone, string>> = {
  primary: "text-text-primary",
  secondary: "text-text-secondary",
  muted: "text-text-muted",
  brand: "text-brand",
  info: "text-info",
  "on-brand": "text-on-brand",
};

const VARIANT_CLASS: Readonly<Record<TypographyToken, string>> = {
  display: "text-display",
  title: "text-title",
  heading: "text-heading",
  stat: "text-stat",
  body: "text-body",
  label: "text-label",
  caption: "text-caption",
};

export type AppTextProps = Readonly<{
  variant: TypographyToken;
  tone?: TextTone;
  /** Gives the text the `header` accessibility role (Req 3.5). */
  header?: boolean;
  /** Dense_Components only (Req 3.4). */
  dense?: boolean;
  className?: string;
  numberOfLines?: number;
  testID?: string;
  children: ReactNode;
}>;

export function AppText({
  variant,
  tone = "primary",
  header = false,
  dense = false,
  className,
  numberOfLines,
  testID,
  children,
}: AppTextProps): React.JSX.Element {
  const classes = [VARIANT_CLASS[variant], TONE_CLASS[tone], className ?? ""]
    .filter((part) => part.length > 0)
    .join(" ");
  return (
    <Text
      testID={testID}
      accessibilityRole={header ? "header" : undefined}
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={dense ? tokens.fontScale.denseMax : undefined}
      className={classes}
    >
      {children}
    </Text>
  );
}
