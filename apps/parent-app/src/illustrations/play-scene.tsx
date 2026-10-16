// Original work, Xelulu-owned. No third-party art.
//
// A warm outdoor scene: sky band, a distant hill, a near hill, a winding path and three leaf
// shapes. Static only: no animation and nothing that flashes (safety.md s.6, Req 20.5).

import Svg, { Ellipse, Path, Rect } from "react-native-svg";

import { color } from "../theme/theme";

export type PlaySceneProps = Readonly<{ width: number; height: number }>;

export function PlayScene({ width, height }: PlaySceneProps): React.JSX.Element {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="100" height="100" fill={color["illustration-sky"]} />
      {/* Distant hill */}
      <Path
        d="M0 58 Q26 38 52 56 Q74 70 100 54 L100 100 L0 100 Z"
        fill={color["illustration-figure"]}
      />
      {/* Near hill */}
      <Path
        d="M0 72 Q24 56 48 72 Q72 86 100 70 L100 100 L0 100 Z"
        fill={color["illustration-hill"]}
      />
      {/* Winding path */}
      <Path
        d="M44 100 Q54 86 46 76 Q38 66 52 58"
        stroke={color.page}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      {/* Three leaf shapes */}
      <Ellipse cx="16" cy="24" rx="9" ry="5" fill={color["illustration-hill"]} />
      <Ellipse cx="78" cy="18" rx="8" ry="4.5" fill={color["illustration-hill"]} />
      <Ellipse cx="62" cy="34" rx="6" ry="3.5" fill={color["illustration-hill"]} />
    </Svg>
  );
}
