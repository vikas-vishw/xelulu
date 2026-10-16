// 40x40 rounded leading tile for a list row. Decorative: the row's title carries the meaning.
//
// `tone` is the tile's category colour. `beige` stays the default, so a caller that does not
// opt in renders exactly as it did in Phase 2.1. The five pastel tones are the Reference's
// per-category tiles (screens 9, 10, 11, 15 and 16a); each one pairs its pastel fill with a
// deeper glyph of the same hue, and every pairing is a listed Contrast_Pair at the 3:1 graphic
// minimum.

import { View } from "react-native";

import { type ColorToken } from "../theme/theme";

import { Icon, type IconName } from "./icon";

const TILE = 40;

export type IconTileTone = "beige" | "surface" | "rose" | "sky" | "amber" | "mint" | "lavender";

/** The fill class and the glyph token per tone. The two neutral tones keep the brand glyph. */
const TONE: Readonly<Record<IconTileTone, Readonly<{ fill: string; glyph: ColorToken }>>> = {
  beige: { fill: "bg-surface-beige", glyph: "brand" },
  surface: { fill: "bg-surface border border-hairline", glyph: "brand" },
  rose: { fill: "bg-tile-rose", glyph: "glyph-rose" },
  sky: { fill: "bg-tile-sky", glyph: "glyph-sky" },
  amber: { fill: "bg-tile-amber", glyph: "glyph-amber" },
  mint: { fill: "bg-tile-mint", glyph: "glyph-mint" },
  lavender: { fill: "bg-tile-lavender", glyph: "glyph-lavender" },
};

export type IconTileProps = Readonly<{
  icon: IconName;
  tone?: IconTileTone;
  testID?: string;
}>;

export function IconTile({ icon, tone = "beige", testID }: IconTileProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      className={`items-center justify-center rounded-md ${TONE[tone].fill}`}
      style={{ width: TILE, height: TILE }}
    >
      <Icon name={icon} size="md" color={TONE[tone].glyph} decorative />
    </View>
  );
}
