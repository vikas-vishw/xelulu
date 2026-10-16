// Content card: an Illustration well above a title, a subtitle and a trailing chevron. The art
// is decorative, because the card's own text names it (Req 2.8, 20.4).

import { View } from "react-native";

import { Illustration, type IllustrationName } from "../illustrations/illustration";
import { tokens } from "../theme/theme";

import { AppText } from "./app-text";
import { Card } from "./card";
import { Icon } from "./icon";

const WELL_HEIGHT = 112;
/** Wide enough that the art fills the well on the widest phone this phase targets. */
const WELL_WIDTH = 480;

export type MediaCardProps = Readonly<{
  title: string;
  subtitle: string;
  illustration: IllustrationName;
  onPress: () => void;
  testID?: string;
}>;

export function MediaCard({
  title,
  subtitle,
  illustration,
  onPress,
  testID,
}: MediaCardProps): React.JSX.Element {
  return (
    <Card
      testID={testID}
      padded={false}
      onPress={onPress}
      accessibilityLabel={`${title}, ${subtitle}`}
      className="overflow-hidden"
    >
      <View
        className="w-full items-center justify-center overflow-hidden bg-surface-beige"
        style={{ height: WELL_HEIGHT, borderRadius: tokens.radius.lg }}
      >
        <Illustration name={illustration} width={WELL_WIDTH} height={WELL_HEIGHT} />
      </View>
      <View className="flex-row items-center p-3">
        <View className="flex-1 pr-3">
          <AppText variant="heading" tone="primary">
            {title}
          </AppText>
          <AppText variant="label" tone="secondary">
            {subtitle}
          </AppText>
        </View>
        <Icon name="chevron-forward" size="md" color="text-muted" decorative />
      </View>
    </Card>
  );
}
