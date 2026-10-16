// Screen 12 of the Reference: Family. Mock data and local state only, no network call and no
// environment read (Req 15.1-15.8, 22.1, 22.2).
//
// No row carries a contact detail: a display name, a role label, a permission line and an age
// or language label are all a mock member has (Req 15.8, D13).
//
// Deviations from the frozen Reference, both reported: the Dad row drops the chevron the
// Reference draws, because this phase has no caregiver detail screen and a chevron that opens
// nothing is a dead control (D24b); and "+ Add Child" and "+ Invite Caregiver" are the kit's
// secondary Button, a beige-filled hairline-bordered full-width control, where the Reference
// draws borderless centred rows inside the card (Req 1.3 keeps the kit as it stands).
//
// The Grandma row keeps its chevron and opens `/grandma-mode` (Req 15.5). The row is composed
// once and rendered in both the Children section and the Grandparents panel, so both copies
// lead to the same screen.

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { Avatar } from "../../components/avatar";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { SectionTitle } from "../../components/section-title";
import { SegmentedTabs, type SegmentedOption } from "../../components/segmented-tabs";
import { TextField } from "../../components/text-field";
import { isBlank } from "../../lib/text";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_FAMILY, type FamilyChild, type FamilyData, type FamilyMember } from "./mock-family";
import { childLine, FAMILY_STRINGS } from "./strings";

const SEGMENT_KEYS = ["children", "caregivers", "grandparents"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: FAMILY_STRINGS.segments[key],
}));

const NAME_MAX = 40;

/** A member card's testID, so a test can read one member's own card in isolation. */
export function memberCardTestId(userId: string): string {
  return `family-member-${userId}`;
}

/** One member card: the name, the role label, and that member's own permission line. */
function MemberCard({ member }: Readonly<{ member: FamilyMember }>): React.JSX.Element {
  return (
    <Card className="mt-3" testID={memberCardTestId(member.user_id)}>
      <View className="flex-row items-center">
        <Avatar name={member.display_name} />
        <View className="ml-3 flex-1">
          <AppText variant="heading" tone="primary">
            {member.display_name}
          </AppText>
          <AppText variant="label" tone="secondary">
            {member.role_label}
          </AppText>
          <AppText variant="caption" tone="muted">
            {member.permission_line}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

export type FamilyScreenProps = Readonly<{ data?: FamilyData }>;

export function FamilyScreen({ data = MOCK_FAMILY }: FamilyScreenProps): React.JSX.Element {
  const [segment, setSegment] = useState<SegmentKey>("children");
  const [children, setChildren] = useState<readonly FamilyChild[]>(data.children);
  /** Members invited on this screen, kept apart from the household's own two: the Children
   *  segment draws the first household caregiver only, as the Reference does, so an invited
   *  member joins that one row instead of adding Meera's card to a panel she is not drawn in. */
  const [invited, setInvited] = useState<readonly FamilyMember[]>([]);
  /** `null` while that inline add form is closed. */
  const [childDraft, setChildDraft] = useState<string | null>(null);
  const [caregiverDraft, setCaregiverDraft] = useState<string | null>(null);

  const onSegmentChange = (key: string): void => {
    const next = SEGMENT_KEYS.find((candidate) => candidate === key);
    if (next !== undefined) setSegment(next);
  };

  const confirmAddChild = (): void => {
    if (childDraft === null || isBlank(childDraft)) return;
    setChildren([
      ...children,
      {
        child_id: `child_local_${children.length + 1}`,
        display_name: childDraft.trim(),
        age_label: FAMILY_STRINGS.ageNotSet,
        languages_label: FAMILY_STRINGS.languagesNotSet,
      },
    ]);
    setChildDraft(null);
  };

  const confirmInvite = (): void => {
    if (caregiverDraft === null || isBlank(caregiverDraft)) return;
    setInvited([
      ...invited,
      {
        user_id: `user_local_${invited.length + 1}`,
        display_name: caregiverDraft.trim(),
        role: "caregiver",
        role_label: FAMILY_STRINGS.roles.caregiver,
        permission_line: FAMILY_STRINGS.caregiverPermission,
      },
    ]);
    setCaregiverDraft(null);
  };

  /** The section the Reference draws under the Children segment: Grandma, then the household's
   *  first caregiver row ("Dad / Parent"), then anyone invited here. */
  const sectionMembers: readonly FamilyMember[] = [...data.caregivers.slice(0, 1), ...invited];

  const grandmaRow = (member: FamilyMember): React.JSX.Element => (
    <ListRow
      leading={<Avatar name={member.display_name} />}
      title={member.display_name}
      subtitle={member.role_label}
      onPress={() => router.push(ROUTE_PATH["grandma-mode"])}
    />
  );

  return (
    <Screen scroll>
      <ScreenTitle name={SCREEN_HEADER_NAME.family}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME.family}
        </AppText>
      </ScreenTitle>
      <AppText variant="body" tone="secondary" className="mt-1">
        {FAMILY_STRINGS.subheader}
      </AppText>

      <View className="mt-4">
        <SegmentedTabs
          options={SEGMENTS}
          value={segment}
          onChange={onSegmentChange}
          accessibilityLabel={FAMILY_STRINGS.segmentsLabel}
        />
      </View>

      {segment === "children" ? (
        <>
          <Card className="mt-4" padded={false}>
            {children.map((child, index) => (
              <View
                key={child.child_id}
                className={index === 0 ? undefined : "border-t border-hairline"}
              >
                <ListRow
                  leading={<Avatar name={child.display_name} />}
                  title={child.display_name}
                  subtitle={childLine(child.age_label, child.languages_label)}
                  onPress={() => router.push(ROUTE_PATH["child-profile"])}
                />
              </View>
            ))}
            <View className="border-t border-hairline p-3">
              <Button
                label={FAMILY_STRINGS.addChild}
                variant="secondary"
                icon="add"
                onPress={() => setChildDraft("")}
              />
            </View>
          </Card>

          {childDraft === null ? null : (
            <Card className="mt-3">
              <TextField
                label={FAMILY_STRINGS.childName}
                value={childDraft}
                onChangeText={setChildDraft}
                maxLength={NAME_MAX}
                autoCapitalize="words"
              />
              <Button
                label={FAMILY_STRINGS.confirmAddChild}
                disabled={isBlank(childDraft)}
                onPress={confirmAddChild}
                className="mt-4"
              />
              <Button
                label={FAMILY_STRINGS.cancel}
                variant="secondary"
                onPress={() => setChildDraft(null)}
                className="mt-2"
              />
            </Card>
          )}

          <SectionTitle className="mt-6">{FAMILY_STRINGS.grandparentsAndCaregivers}</SectionTitle>
          <Card className="mt-3" padded={false}>
            {data.grandparents.map((member) => (
              <View key={member.user_id}>{grandmaRow(member)}</View>
            ))}
            {sectionMembers.map((member) => (
              <View key={member.user_id} className="border-t border-hairline">
                <ListRow
                  leading={<Avatar name={member.display_name} />}
                  title={member.display_name}
                  subtitle={member.role_label}
                  trailing="none"
                />
              </View>
            ))}
            <View className="border-t border-hairline p-3">
              <Button
                label={FAMILY_STRINGS.inviteCaregiver}
                variant="secondary"
                icon="add"
                onPress={() => setCaregiverDraft("")}
              />
            </View>
          </Card>

          {caregiverDraft === null ? null : (
            <Card className="mt-3">
              <TextField
                label={FAMILY_STRINGS.caregiverName}
                value={caregiverDraft}
                onChangeText={setCaregiverDraft}
                maxLength={NAME_MAX}
                autoCapitalize="words"
              />
              <Button
                label={FAMILY_STRINGS.confirmInvite}
                disabled={isBlank(caregiverDraft)}
                onPress={confirmInvite}
                className="mt-4"
              />
              <Button
                label={FAMILY_STRINGS.cancel}
                variant="secondary"
                onPress={() => setCaregiverDraft(null)}
                className="mt-2"
              />
            </Card>
          )}
        </>
      ) : null}

      {/* One card per member, each with that member's own permission line (Req 15.3). */}
      {segment === "caregivers"
        ? [...data.caregivers, ...invited].map((member) => (
            <MemberCard key={member.user_id} member={member} />
          ))
        : null}

      {segment === "grandparents"
        ? data.grandparents.map((member) => (
            <Card key={member.user_id} className="mt-3" padded={false}>
              {grandmaRow(member)}
              <View className="px-4 pb-3">
                <AppText variant="caption" tone="muted">
                  {member.permission_line}
                </AppText>
              </View>
            </Card>
          ))
        : null}
    </Screen>
  );
}
