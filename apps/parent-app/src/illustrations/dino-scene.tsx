// Original work, Xelulu-owned. No third-party art.
//
// A rounded dinosaur silhouette on a hill. Static only: no animation and nothing that flashes
// (Req 20.5).

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { color } from "../theme/theme";

export type DinoSceneProps = Readonly<{ width: number; height: number }>;

export function DinoScene({ width, height }: DinoSceneProps): React.JSX.Element {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="100" height="100" fill={color["illustration-sky"]} />
      {/* Hill */}
      <Path
        d="M0 76 Q30 60 58 74 Q80 85 100 74 L100 100 L0 100 Z"
        fill={color["illustration-hill"]}
      />
      {/* Body */}
      <Path
        d="M34 76 Q30 52 48 48 Q66 44 70 62 Q72 76 66 76 Q62 68 54 70 Q44 72 42 76 Z"
        fill={color["illustration-figure"]}
      />
      {/* Neck and head */}
      <Path
        d="M62 52 Q64 36 76 34 Q86 33 86 42 Q86 50 76 50 Q70 50 68 56 Z"
        fill={color["illustration-figure"]}
      />
      {/* Tail */}
      <Path
        d="M34 72 Q20 70 12 78"
        stroke={color["illustration-figure"]}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      {/* Eye */}
      <Circle cx="80" cy="41" r="2" fill={color["character-face"]} />
    </Svg>
  );
}
