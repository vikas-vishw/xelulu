// Original work, Xelulu-owned. No third-party art.
//
// Static vector stand-in for Xelulu (C2): a cream rounded body with two bunny ears, a dark
// face panel, two warm eye arcs and a small smile. No animation and nothing that flashes
// (Req 7.5, safety.md s.6). Rive replaces the drawing later behind these same props.

import { View } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";

import { color } from "../theme/theme";

export type CharacterPlaceholderProps = Readonly<{
  size: number;
  accessibilityLabel?: string;
}>;

const DEFAULT_LABEL = "Xelulu robot";

export function CharacterPlaceholder({
  size,
  accessibilityLabel = DEFAULT_LABEL,
}: CharacterPlaceholderProps): React.JSX.Element {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* Ears */}
        <G>
          <Rect x="22" y="4" width="14" height="30" rx="7" fill={color["character-ear"]} />
          <Rect x="25" y="8" width="8" height="22" rx="4" fill={color["character-body"]} />
          <Rect x="64" y="4" width="14" height="30" rx="7" fill={color["character-ear"]} />
          <Rect x="67" y="8" width="8" height="22" rx="4" fill={color["character-body"]} />
        </G>
        {/* Body */}
        <Rect x="12" y="26" width="76" height="68" rx="26" fill={color["character-body"]} />
        {/* Face panel */}
        <Rect x="24" y="40" width="52" height="38" rx="17" fill={color["character-face"]} />
        {/* Eyes: two upward arcs */}
        <Path
          d="M34 58 Q39 50 44 58"
          stroke={color["character-eye"]}
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d="M56 58 Q61 50 66 58"
          stroke={color["character-eye"]}
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Smile */}
        <Path
          d="M44 68 Q50 73 56 68"
          stroke={color["character-eye"]}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
