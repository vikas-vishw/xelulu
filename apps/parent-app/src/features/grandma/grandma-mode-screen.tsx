// Screen 13 of the Reference: Grandma Mode. Mock data and local state only, no network call
// and no environment read (Req 16.1-16.7, 22.1, 22.2).
//
// There is no camera in v1 (product.md v1 facts, D3), so the first row is a VOICE call and the
// screen holds no video view, no lens control and no clone-voice control (G06 is P1). Nothing
// here captures or plays audio either: the record control reveals one line and imports no
// audio module (Req 16.5, 16.7).
//
// All four rows pass `trailing="none"`: the Reference draws no trailing chevron on any
// screen-13 row, and `ListRow`'s default would add three. The three live rows keep their press
// handlers. The Festival row is static, with the muted trailing text "Later phase".
//
// Deviations from the frozen Reference, both reported: the first row is renamed to "Voice Call
// with Xelulu / Talk and listen together" (D5), and the hero is our own illustration rather
// than a photograph (Req 20.1). The record and schedule panels the Reference does not draw are
// the inline mock panels Req 16.4 and 16.5 ask for.

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { CharacterPlaceholder } from "../../character/character-placeholder";
import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { CircleButton } from "../../components/circle-button";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { TextField } from "../../components/text-field";
import { Illustration } from "../../illustrations/illustration";
import { tokens } from "../../theme/theme";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_GRANDMA, type GrandmaData, type GrandmaRowKey } from "./mock-grandma";
import { GRANDMA_STRINGS } from "./strings";

const HERO_HEIGHT = 190;
const PERSON_SIZE = 130;
const CHARACTER_SIZE = 110;
/** How far the character sits over the figure, so the pair reads as one scene. */
const HERO_OVERLAP: number = tokens.spacing["6"] ?? 0;
const HERO_STACK = {
  width: PERSON_SIZE + CHARACTER_SIZE - HERO_OVERLAP,
  height: PERSON_SIZE,
} as const;

const TIME_MAX = 10;

/** The one inline panel open at a time; `null` is none. */
type PanelKey = "record" | "schedule";

export type GrandmaModeScreenProps = Readonly<{ data?: GrandmaData }>;

export function GrandmaModeScreen({
  data = MOCK_GRANDMA,
}: GrandmaModeScreenProps): React.JSX.Element {
  const [panel, setPanel] = useState<PanelKey | null>(null);
  const [recordNotice, setRecordNotice] = useState(false);
  const [time, setTime] = useState(data.default_story_time);
  /** The confirmation line, once "Set time" has been pressed; `null` before that. */
  const [scheduled, setScheduled] = useState<string | null>(null);

  const openVoiceCall = (): void => router.push(ROUTE_PATH["voice-call"]);

  const togglePanel = (key: PanelKey): void => {
    setPanel(panel === key ? null : key);
  };

  /** The Festival row has no handler, which is what keeps it non-pressable (Req 16.1). */
  const press = (key: GrandmaRowKey): (() => void) | undefined => {
    if (key === "call") return openVoiceCall;
    if (key === "stories") return () => togglePanel("record");
    if (key === "schedule") return () => togglePanel("schedule");
    return undefined;
  };

  return (
    <Screen scroll>
      <ScreenTitle back name={SCREEN_HEADER_NAME["grandma-mode"]}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME["grandma-mode"]}
        </AppText>
      </ScreenTitle>
      <AppText variant="body" tone="secondary" className="mt-1">
        {GRANDMA_STRINGS.subheader}
      </AppText>

      {/* The hero well. The figure is decorative; the character keeps its own image label. */}
      <View
        className="mt-4 items-center justify-end bg-surface-beige"
        style={{ height: HERO_HEIGHT, borderRadius: tokens.radius.xl }}
      >
        <View style={HERO_STACK}>
          <View className="absolute bottom-0 right-0">
            <Illustration name="person-figure" width={PERSON_SIZE} height={PERSON_SIZE} />
          </View>
          <View className="absolute bottom-0 left-0">
            <CharacterPlaceholder size={CHARACTER_SIZE} />
          </View>
        </View>
      </View>

      {/* One grouped Card with a hairline between the rows, as the Reference draws them. */}
      <Card className="mt-4" padded={false}>
        {data.rows.map((row, index) => (
          <View key={row.key} className={index === 0 ? undefined : "border-t border-hairline"}>
            <ListRow
              icon={row.icon}
              title={row.title}
              subtitle={row.subtitle}
              trailingText={row.key === "festival" ? GRANDMA_STRINGS.laterPhase : undefined}
              trailing="none"
              onPress={press(row.key)}
            />
          </View>
        ))}
      </Card>

      {panel === "record" ? (
        <Card className="mt-3 items-center">
          <CircleButton
            icon="mic-outline"
            label={GRANDMA_STRINGS.record}
            onPress={() => setRecordNotice(true)}
          />
          {recordNotice ? (
            <AppText variant="body" tone="secondary" className="mt-3 text-center">
              {GRANDMA_STRINGS.recordLater}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {panel === "schedule" ? (
        <Card className="mt-3">
          <TextField
            label={GRANDMA_STRINGS.storyTime}
            value={time}
            onChangeText={setTime}
            trailingIcon="time-outline"
            maxLength={TIME_MAX}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            label={GRANDMA_STRINGS.setTime}
            onPress={() => setScheduled(GRANDMA_STRINGS.scheduleMock(time))}
            className="mt-4"
          />
          {scheduled === null ? null : (
            <AppText variant="body" tone="secondary" className="mt-3">
              {scheduled}
            </AppText>
          )}
        </Card>
      ) : null}

      <Card className="mt-4">
        <AppText variant="body" tone="secondary">
          {GRANDMA_STRINGS.consentNote}
        </AppText>
      </Card>

      <Button label={GRANDMA_STRINGS.callGrandmaMode} onPress={openVoiceCall} className="mt-4" />
    </Screen>
  );
}
