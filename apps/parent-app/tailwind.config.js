// Tailwind/NativeWind config. Every value comes from src/theme/tokens.json, the single token
// source (C6). The default colour palette is replaced, not extended, so a non-token colour
// class (bg-white, text-gray-500) does not exist. Spacing is replaced too, because NativeWind's
// default rem is 14 px, which would make p-4 14 px instead of 16 px.
const tokens = require("./src/theme/tokens.json");

/** `{ md: "12px", … }` from a token record of numbers. */
function px(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, `${value}px`]));
}

/**
 * Named box sizes, so a 44 pt touch target, a control height, a row height and a tile height
 * are classes (`w-touch`, `h-touch`, `min-h-touch`, `min-w-touch`, `min-h-control`,
 * `min-h-row`, `min-h-tile`) and never a `style` function, which NativeWind drops on an element
 * that also carries a `className`. Every value comes from tokens.json's `size` block.
 */
const boxSize = px({
  touch: tokens.size.touchMin,
  control: tokens.size.controlMin,
  row: tokens.size.rowMin,
  tile: tokens.size.tileMin,
});

/** `{ body: ["15px", { lineHeight: "20px", fontWeight: "400" }], … }` */
const fontSize = Object.fromEntries(
  Object.entries(tokens.typography).map(([key, style]) => [
    key,
    [`${style.size}px`, { lineHeight: `${style.lineHeight}px`, fontWeight: style.weight }],
  ]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    colors: { transparent: "transparent", ...tokens.color },
    fontSize,
    spacing: px(tokens.spacing),
    borderRadius: px(tokens.radius),
    // Appended, never reordered: the colour key order above is load-bearing for `text-danger`
    // winning the cascade (see docs/design-system.md). `opacity` adds the named token values
    // (`opacity-scrim`, `opacity-disabled`) on top of Tailwind's own scale.
    extend: {
      width: boxSize,
      height: boxSize,
      minWidth: boxSize,
      minHeight: boxSize,
      opacity: tokens.opacity,
    },
  },
  plugins: [],
};
