// Screen 7 of the Reference: Live View & Voice Call.
//
// This screen is AUDIO AND STATUS ONLY. There is no camera in v1 (product.md v1 facts), so it
// holds no video view, no lens control, no audio capture, no audio playback and no media
// module import of any kind (Req 9.8, D3, D4). Everything it shows is a mock label plus two
// local control states; no network call and no environment read (Req 22.1, 22.2).
//
// Two additions the Reference does not draw, both reported: the "Connected" status pill, so
// the connection state is text and not colour alone (Req 9.6), and the static duration label
// (D18). The Reference's third control is "Rotate", which D4 replaces with "Speaker".

import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { CharacterPlaceholder } from "../../character/character-placeholder";
import { AppText } from "../../components/app-text";
import { CircleButton } from "../../components/circle-button";
import { Icon } from "../../components/icon";
import { PageDots } from "../../components/page-dots";
import { Screen } from "../../components/screen";
import { StatusPill } from "../../components/status-pill";
import { tokens } from "../../theme/theme";
import { goBack } from "../shell/go-back";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_CALL, type CallData } from "./mock-call";
import { TALK_STRINGS } from "./strings";

const SCENE_HEIGHT = 360;
const CHARACTER_SIZE = 200;
const DOT_COUNT = 3;
const DOT_INDEX = 1;

export type LiveCallScreenProps = Readonly<{ data?: CallData }>;

export function LiveCallScreen({ data = MOCK_CALL }: LiveCallScreenProps): React.JSX.Element {
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);

  const gear = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={TALK_STRINGS.settings}
      onPress={() => router.push(ROUTE_PATH.settings)}
      className="h-touch w-touch items-center justify-center rounded-pill active:bg-surface-beige"
    >
      <Icon name="settings-outline" size="md" color="text-primary" decorative />
    </Pressable>
  );

  return (
    <Screen>
      <ScreenTitle back name={SCREEN_HEADER_NAME["voice-call"]} right={gear}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME["voice-call"]}
        </AppText>
      </ScreenTitle>

      <View className="mt-4 items-center">
        <StatusPill tone="success" label={data.status_label} />
        <AppText variant="label" tone="muted" className="mt-2">
          {data.duration_label}
        </AppText>
      </View>

      {/* The scene well. No photograph and no live picture: a static drawing of the robot. */}
      <View
        className="mt-4 items-center justify-center bg-surface-beige"
        style={{ height: SCENE_HEIGHT, borderRadius: tokens.radius.xl }}
      >
        <CharacterPlaceholder size={CHARACTER_SIZE} />
      </View>

      <View className="mt-4 items-center">
        <PageDots count={DOT_COUNT} index={DOT_INDEX} />
      </View>

      <View className="flex-1 flex-row items-end justify-around pb-6">
        <CircleButton
          icon={muted ? "mic-off-outline" : "mic-outline"}
          label={TALK_STRINGS.mute}
          stateText={muted ? TALK_STRINGS.micOff : TALK_STRINGS.micOn}
          onPress={() => setMuted(!muted)}
        />
        <CircleButton icon="call" tone="danger" label={TALK_STRINGS.endCall} onPress={goBack} />
        <CircleButton
          icon={speakerOn ? "volume-high" : "volume-mute"}
          label={TALK_STRINGS.speaker}
          stateText={speakerOn ? TALK_STRINGS.speakerOn : TALK_STRINGS.speakerOff}
          onPress={() => setSpeakerOn(!speakerOn)}
        />
      </View>
    </Screen>
  );
}
