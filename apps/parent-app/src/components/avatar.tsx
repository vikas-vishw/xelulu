// Round person token. D8 forbids a photo, so it draws an Illustration clipped to the disc, or
// the first letter of the name on a beige disc (Req 2.4, 20.6).

import { View } from "react-native";

import { Illustration, type IllustrationName } from "../illustrations/illustration";
import { tokens } from "../theme/theme";

import { AppText } from "./app-text";
import { KIT_STRINGS } from "./strings";

export type AvatarSize = "sm" | "lg";

const DISC: Readonly<Record<AvatarSize, number>> = { sm: 40, lg: 96 };

export type AvatarProps = Readonly<{
  name: string;
  illustration?: IllustrationName;
  size?: AvatarSize;
  accessibilityLabel?: string;
  testID?: string;
}>;

export function Avatar({
  name,
  illustration,
  size = "sm",
  accessibilityLabel,
  testID,
}: AvatarProps): React.JSX.Element {
  const disc = DISC[size];
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? KIT_STRINGS.avatarLabel(name)}
      className="items-center justify-center overflow-hidden border border-hairline bg-surface-beige"
      style={{ width: disc, height: disc, borderRadius: tokens.radius.pill }}
    >
      {illustration === undefined ? (
        <AppText variant="title" tone="brand">
          {initial}
        </AppText>
      ) : (
        <Illustration name={illustration} width={disc} height={disc} />
      )}
    </View>
  );
}
