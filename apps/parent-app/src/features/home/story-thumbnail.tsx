// Original work, Xelulu-owned. No third-party art.
//
// Decorative thumbnail for the Last Activity card: a warm sky, a green hill and a simple round
// elephant. Hidden from accessibility, because the card's text names the activity (Req 3.6).
// Static only: no animation and nothing that flashes.

import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { color } from "../../theme/theme";

export type StoryThumbnailProps = Readonly<{ size: number }>;

export function StoryThumbnail({ size }: StoryThumbnailProps): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 56 56">
        <Rect x="0" y="0" width="56" height="56" rx="12" fill={color["illustration-sky"]} />
        <Path
          d="M0 44 Q18 28 38 40 Q48 45 56 42 L56 56 L0 56 Z"
          fill={color["illustration-hill"]}
        />
        <Circle cx="27" cy="30" r="11" fill={color["illustration-figure"]} />
        <Circle cx="18" cy="26" r="5" fill={color["illustration-figure"]} />
        <Circle cx="36" cy="26" r="5" fill={color["illustration-figure"]} />
        <Path
          d="M27 38 Q27 46 22 48"
          stroke={color["illustration-figure"]}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
