// Original work, Xelulu-owned. No third-party art.
//
// A globe with a ring and four stars on the night sky. Static only: no animation and nothing
// that flashes (Req 20.5).

import Svg, { Circle, Ellipse, Rect } from "react-native-svg";

import { color } from "../theme/theme";

export type SpaceSceneProps = Readonly<{ width: number; height: number }>;

export function SpaceScene({ width, height }: SpaceSceneProps): React.JSX.Element {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width="100" height="100" fill={color["illustration-night"]} />
      {/* Globe */}
      <Circle cx="50" cy="54" r="22" fill={color["illustration-figure"]} />
      {/* Ring */}
      <Ellipse
        cx="50"
        cy="54"
        rx="34"
        ry="10"
        stroke={color["character-eye"]}
        strokeWidth="3"
        fill="none"
      />
      {/* Four stars */}
      <Circle cx="16" cy="18" r="3" fill={color["character-body"]} />
      <Circle cx="84" cy="22" r="2.5" fill={color["character-body"]} />
      <Circle cx="28" cy="88" r="2" fill={color["character-body"]} />
      <Circle cx="76" cy="84" r="3" fill={color["character-body"]} />
    </Svg>
  );
}
