// Screen 5 of the Reference: the child profile form. Every value is local state over an
// injected mock, the clock is injected, and the age stage comes from the pure `ageStageFor`
// (Req 8.1-8.11, 19.1). The photo badge opens nothing: no media module, no picker, no
// permission prompt (D8).

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { Avatar } from "../../components/avatar";
import { Button } from "../../components/button";
import { Chip } from "../../components/chip";
import { CircleButton } from "../../components/circle-button";
import { Screen } from "../../components/screen";
import { TextField } from "../../components/text-field";
import { isBlank } from "../../lib/text";
import { tokens } from "../../theme/theme";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { ageStageFor } from "./age-stage";
import { MOCK_CHILD_DRAFT, type ChildDraft } from "./mock-setup";
import { SETUP_STRINGS } from "./strings";

const NAME_MAX = 40;
const DOB_MAX = 10;
const CHIP_MAX = 24;
const CHIP_ROW_GAP = { gap: tokens.spacing["2"] } as const;

const CHILD = SETUP_STRINGS.childProfile;

/** The injected clock, as the `YYYY-MM-DD` day `ageStageFor` compares against. */
function isoDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type ChildProfileScreenProps = Readonly<{ data?: ChildDraft; now?: () => Date }>;

export function ChildProfileScreen({
  data = MOCK_CHILD_DRAFT,
  now = () => new Date(),
}: ChildProfileScreenProps): React.JSX.Element {
  const [name, setName] = useState(data.display_name);
  const [dob, setDob] = useState(data.date_of_birth);
  const [gender, setGender] = useState(data.gender_label);
  const [languages, setLanguages] = useState<readonly string[]>(data.language_labels);
  const [primaryLanguage, setPrimaryLanguage] = useState(data.primary_language);
  const [interests, setInterests] = useState<readonly string[]>(data.interest_labels);
  /** `null` while the inline add form is closed. */
  const [languageDraft, setLanguageDraft] = useState<string | null>(null);
  const [interestDraft, setInterestDraft] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

  const stage = ageStageFor(dob, isoDay(now()));

  const removeLanguage = (label: string): void => {
    const next = languages.filter((entry) => entry !== label);
    setLanguages(next);
    // The primary chip is the filled one, so removing it moves the fill to what is left.
    if (label === primaryLanguage) setPrimaryLanguage(next[0] ?? "");
  };

  const confirmLanguage = (): void => {
    if (languageDraft === null || isBlank(languageDraft)) return;
    setLanguages([...languages, languageDraft.trim()]);
    setLanguageDraft(null);
  };

  const confirmInterest = (): void => {
    if (interestDraft === null || isBlank(interestDraft)) return;
    setInterests([...interests, interestDraft.trim()]);
    setInterestDraft(null);
  };

  return (
    <Screen scroll>
      <ScreenTitle back align="center" name={SCREEN_HEADER_NAME["child-profile"]}>
        <AppText variant="title" tone="primary">
          {CHILD.heading}
        </AppText>
      </ScreenTitle>

      <View className="mt-5 items-center">
        <View>
          <Avatar name={name} size="lg" />
          <View className="absolute bottom-0 right-0">
            <CircleButton
              size="badge"
              icon="camera-outline"
              accessibilityLabel={CHILD.addPhotoA11y}
              onPress={() => setPhotoNotice(CHILD.photoUnavailable)}
            />
          </View>
        </View>
        {photoNotice === null ? null : (
          <AppText variant="caption" tone="muted" className="mt-2">
            {photoNotice}
          </AppText>
        )}
      </View>

      <View className="mt-6">
        <TextField
          label={CHILD.childName}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          autoCapitalize="words"
        />
      </View>

      <View className="mt-4">
        <TextField
          label={CHILD.dateOfBirth}
          value={dob}
          onChangeText={setDob}
          trailingIcon="calendar-outline"
          maxLength={DOB_MAX}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <AppText variant="caption" tone="muted" className="mt-1">
          {stage.ok ? CHILD.ageStageLine(stage.stage) : CHILD.dobFormat}
        </AppText>
      </View>

      {/* Gender: single select, and it feeds nothing (Req 8.3). */}
      <AppText variant="label" tone="secondary" className="mt-4">
        {CHILD.genderLabel}
      </AppText>
      <View className="mt-2 flex-row flex-wrap items-center" style={CHIP_ROW_GAP}>
        {CHILD.genderOptions.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={option === gender}
            onPress={() => setGender(option)}
          />
        ))}
      </View>

      <AppText variant="label" tone="secondary" className="mt-4">
        {CHILD.languagesLabel}
      </AppText>
      <View className="mt-2 flex-row flex-wrap items-center" style={CHIP_ROW_GAP}>
        {languages.map((label) => (
          <Chip
            key={label}
            label={label}
            trailing="remove"
            selected={label === primaryLanguage}
            onPress={() => removeLanguage(label)}
          />
        ))}
        <Chip label={CHILD.addChip} trailing="add" onPress={() => setLanguageDraft("")} />
      </View>
      {languageDraft === null ? null : (
        <View className="mt-2">
          <TextField
            value={languageDraft}
            onChangeText={setLanguageDraft}
            placeholder={CHILD.newLanguage}
            maxLength={CHIP_MAX}
          />
          <Button
            label={CHILD.confirmAddLanguage}
            disabled={isBlank(languageDraft)}
            onPress={confirmLanguage}
            className="mt-2"
          />
        </View>
      )}

      <AppText variant="label" tone="secondary" className="mt-4">
        {CHILD.interestsLabel}
      </AppText>
      <View className="mt-2 flex-row flex-wrap items-center" style={CHIP_ROW_GAP}>
        {interests.map((label) => (
          <Chip
            key={label}
            label={label}
            trailing="remove"
            onPress={() => setInterests(interests.filter((entry) => entry !== label))}
          />
        ))}
        <Chip label={CHILD.addMoreChip} trailing="add" onPress={() => setInterestDraft("")} />
      </View>
      {interestDraft === null ? null : (
        <View className="mt-2">
          <TextField
            value={interestDraft}
            onChangeText={setInterestDraft}
            placeholder={CHILD.newInterest}
            maxLength={CHIP_MAX}
          />
          <Button
            label={CHILD.confirmAddInterest}
            disabled={isBlank(interestDraft)}
            onPress={confirmInterest}
            className="mt-2"
          />
        </View>
      )}

      <View className="mt-6">
        <Button
          label={CHILD.continueLabel}
          disabled={isBlank(name) || !stage.ok}
          onPress={() => router.replace(ROUTE_PATH.home)}
        />
      </View>
    </Screen>
  );
}
