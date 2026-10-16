// Original work, Xelulu-owned. No third-party art.
//
// A bedtime scene: a night sky, a moon crescent and an open book. Static only: no animation and
// nothing that flashes (safety.md s.6, Req 20.5).

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { color } from "../theme/theme";

export type StorySceneProps = Readonly<{ width: number; height: number }>;

export function StoryScene({ width, height }: StorySceneProps): React.JSX.Element {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="100" height="100" fill={color["illustration-night"]} />
      {/* Moon crescent: a warm disc with the sky disc cut over it */}
      <Circle cx="74" cy="26" r="13" fill={color["character-eye"]} />
      <Circle cx="68" cy="22" r="12" fill={color["illustration-night"]} />
      {/* Open book: two cream pages over a spine */}
      <Path d="M50 62 Q34 52 16 58 L16 84 Q34 78 50 86 Z" fill={color["character-body"]} />
      <Path d="M50 62 Q66 52 84 58 L84 84 Q66 78 50 86 Z" fill={color["character-ear"]} />
      <Path
        d="M50 62 L50 86"
        stroke={color["illustration-night"]}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
