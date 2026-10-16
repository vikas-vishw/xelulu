// Typed view of the single token source (C6). `tokens.json` is the only place a raw design
// value is written; this module is the only way a component reads one.

import raw from "./tokens.json";

export type ColorToken = keyof typeof raw.color;
export type TypographyToken = keyof typeof raw.typography;
export type RadiusToken = "sm" | "md" | "lg" | "xl" | "pill";

export type TypeStyle = Readonly<{
  size: number;
  lineHeight: number;
  weight: "400" | "500" | "600" | "700";
}>;

export type ContrastPair = Readonly<{
  fg: ColorToken;
  bg: ColorToken;
  min: 3 | 4.5;
  use: string;
}>;

export type Tokens = Readonly<{
  color: Readonly<Record<ColorToken, string>>;
  typography: Readonly<Record<TypographyToken, TypeStyle>>;
  spacing: Readonly<Record<string, number>>;
  radius: Readonly<Record<RadiusToken, number>>;
  shadow: Readonly<{
    color: string;
    opacity: number;
    radius: number;
    offsetY: number;
    elevation: number;
  }>;
  size: Readonly<{
    touchMin: number;
    iconSm: number;
    icon: number;
    iconLg: number;
    tabBarHeight: number;
    controlMin: number;
    rowMin: number;
    tileMin: number;
  }>;
  fontScale: Readonly<{ denseMax: number }>;
  opacity: Readonly<Record<"scrim" | "disabled", number>>;
  contrastPairs: readonly ContrastPair[];
}>;

/** Typed view of tokens.json; a shape mismatch fails `tsc --noEmit`. */
export const tokens = raw as Tokens;

/** Colour tokens by name, for icon colours, Switch colours and SVG fills. */
export const color = tokens.color;

/**
 * The one card shadow, as a React Native style.
 *
 * This is the single value that stays an inline style rather than a class. `shadowColor`,
 * `shadowOpacity`, `shadowRadius`, `shadowOffset` and `elevation` have no faithful Tailwind
 * class under this config, and a static style object IS merged by NativeWind on an element that
 * also carries a `className` (verified against nativewind 4.2.7 / react-native-css-interop
 * 0.2.7; see docs/design-system.md, "Pressed states are classes"). Only a style FUNCTION is
 * dropped, so this must never be put inside one.
 */
export const cardShadow = {
  shadowColor: tokens.shadow.color,
  shadowOpacity: tokens.shadow.opacity,
  shadowRadius: tokens.shadow.radius,
  shadowOffset: { width: 0, height: tokens.shadow.offsetY },
  elevation: tokens.shadow.elevation,
} as const;
