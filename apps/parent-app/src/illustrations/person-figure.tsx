// Original work, Xelulu-owned. No third-party art.
//
// A simple seated adult figure: head, shoulders and a shawl arc. Used for the Grandma hero and
// the Family avatars. Static only: no animation and nothing that flashes (Req 20.5).

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { color } from "../theme/theme";

export type PersonFigureProps = Readonly<{ width: number; height: number }>;

export function PersonFigure({ width, height }: PersonFigureProps): React.JSX.Element {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="100" height="100" fill={color["surface-beige"]} />
      {/* Shawl arc behind the shoulders */}
      <Path d="M14 100 Q22 56 50 54 Q78 56 86 100 Z" fill={color["illustration-figure"]} />
      {/* Shoulders */}
      <Path d="M24 100 Q30 68 50 66 Q70 68 76 100 Z" fill={color["character-ear"]} />
      {/* Head */}
      <Circle cx="50" cy="40" r="19" fill={color["character-body"]} />
      {/* Hair line across the brow */}
      <Path
        d="M33 34 Q50 20 67 34"
        stroke={color["illustration-figure"]}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
