// Original work, Xelulu-owned. No third-party art.
//
// The Illustration registry (Req 20.1-20.5). Every picture in the app is one of these original
// static SVGs: no photograph, no raster asset and no third-party art file. Without an
// `accessibilityLabel` the art is decorative and hidden from accessibility, because the adjacent
// text already names it (Req 20.4).

import { View } from "react-native";

import { DinoScene } from "./dino-scene";
import { PersonFigure } from "./person-figure";
import { PlayScene } from "./play-scene";
import { SpaceScene } from "./space-scene";
import { StoryScene } from "./story-scene";

export const ILLUSTRATION_NAMES = [
  "play-scene",
  "story-scene",
  "person-figure",
  "space-scene",
  "dino-scene",
] as const;

export type IllustrationName = (typeof ILLUSTRATION_NAMES)[number];

type ArtProps = Readonly<{ width: number; height: number }>;

const REGISTRY: Readonly<Record<IllustrationName, (props: ArtProps) => React.JSX.Element>> = {
  "play-scene": PlayScene,
  "story-scene": StoryScene,
  "person-figure": PersonFigure,
  "space-scene": SpaceScene,
  "dino-scene": DinoScene,
};

export type IllustrationProps = Readonly<{
  name: IllustrationName;
  width: number;
  height: number;
  /** Omit to leave the art decorative (the default); the adjacent text names it. */
  accessibilityLabel?: string;
  testID?: string;
}>;

export function Illustration({
  name,
  width,
  height,
  accessibilityLabel,
  testID,
}: IllustrationProps): React.JSX.Element {
  const Art = REGISTRY[name];

  if (accessibilityLabel === undefined) {
    return (
      <View
        testID={testID}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Art width={width} height={height} />
      </View>
    );
  }

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Art width={width} height={height} />
    </View>
  );
}
