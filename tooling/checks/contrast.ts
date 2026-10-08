// WCAG 2.x contrast ratio between two sRGB hex colours.
// Pure: no filesystem, no env, no I/O. Used by tooling/test/contrast.test.ts
// to check the placeholder palettes (Req 4.7, 5.5).

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#RGB` or `#RRGGBB` (case-insensitive) into 0–255 channels. */
function parseHex(hex: string): [number, number, number] {
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new Error(
      `Invalid hex colour ${JSON.stringify(hex)}: expected #RGB or #RRGGBB (hex digits only).`,
    );
  }
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Linearises one 0–255 sRGB channel per WCAG 2.x. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a hex colour, in [0, 1]. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * Contrast ratio between a foreground and background colour, in [1, 21].
 * Symmetric in its arguments. Throws on any input that is not #RGB or #RRGGBB.
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
