// Screen 14 of the Reference: Privacy & Memory. Mock data and local state only, no network
// call and no environment read (Req 17.1-17.10, 22.1, 22.2).
//
// This is the DPDP erasure and export surface (`safety.md` §2). It asks for a confirmation
// before it says anything happened, and then it says that nothing happened: this build deletes
// nothing, exports nothing and sends nothing, and no line on the screen claims otherwise
// (Req 17.8, 17.9). The mock data is never mutated by either action.
//
// Nothing here holds a transcript, an audio reference or a raw value. A memory is a short
// parent-facing summary, and a recording row is adult-provided grandparent content with its
// consent statement in plain text (Req 17.4, D13).
//
// Deviations from the frozen Reference, both reported: the memory rows drop the chevron the
// Reference draws (`trailing="none"`), because nothing opens yet and a dead control is worse
// than none; and each memory's age label sits in the row's trailing slot rather than under its
// title, which is what `ListRow.trailingText` provides (D21).

import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { ConfirmDialog, type ConfirmAction } from "../../components/confirm-dialog";
import { Icon } from "../../components/icon";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { SectionTitle } from "../../components/section-title";
import { SegmentedTabs, type SegmentedOption } from "../../components/segmented-tabs";
import { Illustration } from "../../illustrations/illustration";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_PRIVACY, type PrivacyData, type PrivacyToggle } from "./mock-privacy";
import { languageLabel, PRIVACY_STRINGS, RECORDING_KIND_LABEL } from "./strings";

const SEGMENT_KEYS = ["memory", "recordings", "settings"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];

const SEGMENTS: readonly SegmentedOption[] = SEGMENT_KEYS.map((key) => ({
  key,
  label: PRIVACY_STRINGS.segments[key],
}));

/** The memory row's art, drawn square in the leading slot. */
const ART = 40;

/** The dialog's two action keys. */
const ACTION_KEYS = { delete: "delete", export: "export" } as const;

const ACTIONS: readonly ConfirmAction[] = [
  { key: ACTION_KEYS.delete, label: PRIVACY_STRINGS.dialog.deleteEverything, tone: "danger" },
  { key: ACTION_KEYS.export, label: PRIVACY_STRINGS.dialog.exportData },
];

/** The dialog's handle, so a test can read it by its own id. */
export const CONFIRM_DIALOG_TEST_ID = "privacy-confirm-dialog";

/**
 * The Reference's "Delete or Export Data" row: one centred danger-coloured line with a small
 * inline glyph, no icon tile, no subtitle and no chevron. `ListRow` cannot draw that shape, and
 * Req 2.1 closes the Component_Kit at its eleven additions, so this stays a screen-local
 * composition and is not copied anywhere else.
 *
 * The glyph is decorative because the label says the same thing, the label is text rather than
 * colour alone, and the pressed state is a colour switch with no animation.
 */
function DangerRow({ onPress }: Readonly<{ onPress: () => void }>): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={PRIVACY_STRINGS.deleteOrExport}
      onPress={onPress}
      className="min-h-row flex-row items-center justify-center gap-2 px-4 active:bg-surface-beige"
    >
      <Icon name="trash-outline" size="md" color="danger" decorative />
      <AppText variant="heading" className="text-danger">
        {PRIVACY_STRINGS.deleteOrExport}
      </AppText>
    </Pressable>
  );
}

export type PrivacyScreenProps = Readonly<{ data?: PrivacyData }>;

export function PrivacyScreen({ data = MOCK_PRIVACY }: PrivacyScreenProps): React.JSX.Element {
  const [segment, setSegment] = useState<SegmentKey>("memory");
  const [expanded, setExpanded] = useState(false);
  const [toggles, setToggles] = useState<readonly PrivacyToggle[]>(data.toggles);
  const [dialogOpen, setDialogOpen] = useState(false);
  /** The line an action leaves behind; `null` until one is confirmed. */
  const [notice, setNotice] = useState<string | null>(null);

  const onSegmentChange = (key: string): void => {
    const next = SEGMENT_KEYS.find((candidate) => candidate === key);
    if (next !== undefined) setSegment(next);
  };

  const setEnabled = (key: string, next: boolean): void => {
    setToggles(toggles.map((row) => (row.key === key ? { ...row, enabled: next } : row)));
  };

  // Either action closes the dialog and shows one line that claims nothing. No mock value is
  // touched: there is no delete call and no export call to make (Req 17.8).
  const onAction = (): void => {
    setDialogOpen(false);
    setNotice(PRIVACY_STRINGS.mockLine);
  };

  const shown = expanded ? data.memories : data.memories.slice(0, data.recent_count);

  return (
    <Screen scroll>
      <ScreenTitle back name={SCREEN_HEADER_NAME.privacy}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME.privacy}
        </AppText>
      </ScreenTitle>
      <AppText variant="body" tone="secondary" className="mt-1">
        {PRIVACY_STRINGS.subheader}
      </AppText>

      <View className="mt-4">
        <SegmentedTabs
          options={SEGMENTS}
          value={segment}
          onChange={onSegmentChange}
          accessibilityLabel={PRIVACY_STRINGS.segmentsLabel}
        />
      </View>

      {segment === "memory" ? (
        <>
          <Card className="mt-4" padded={false}>
            <ListRow
              icon="bulb-outline"
              title={PRIVACY_STRINGS.remembersTitle}
              subtitle={PRIVACY_STRINGS.remembersRow(data.memories.length)}
              onPress={() => setExpanded(true)}
            />
          </Card>

          <SectionTitle className="mt-6">{PRIVACY_STRINGS.recentMemories}</SectionTitle>
          {shown.map((memory) => (
            <Card key={memory.memory_id} className="mt-3" padded={false}>
              <ListRow
                leading={<Illustration name={memory.illustration} width={ART} height={ART} />}
                title={memory.label}
                trailingText={memory.age_label}
                trailing="none"
              />
            </Card>
          ))}

          <Button
            label={expanded ? PRIVACY_STRINGS.showLess : PRIVACY_STRINGS.viewAll}
            onPress={() => setExpanded(!expanded)}
            className="mt-4"
          />
        </>
      ) : null}

      {segment === "recordings" ? (
        <>
          <SectionTitle className="mt-6">{PRIVACY_STRINGS.recordingsHeading}</SectionTitle>
          {data.recordings.map((recording) => (
            <Card key={recording.asset_id} className="mt-3">
              <AppText variant="heading" tone="primary">
                {recording.title}
              </AppText>
              <AppText variant="label" tone="secondary">
                {PRIVACY_STRINGS.recordingLine(
                  RECORDING_KIND_LABEL[recording.kind],
                  languageLabel(recording.lang),
                )}
              </AppText>
              <AppText variant="label" tone="secondary" className="mt-2">
                {recording.recorded_label}
              </AppText>
              <AppText variant="caption" tone="muted">
                {recording.consent_statement}
              </AppText>
            </Card>
          ))}
          <AppText variant="body" tone="secondary" className="mt-4">
            {PRIVACY_STRINGS.noChildAudio}
          </AppText>
        </>
      ) : null}

      {segment === "settings" ? (
        <>
          <Card className="mt-4" padded={false}>
            {toggles.map((row, index) => (
              <View key={row.key} className={index === 0 ? undefined : "border-t border-hairline"}>
                <ListRow
                  title={row.title}
                  subtitle={row.subtitle}
                  trailing={{
                    toggle: {
                      value: row.enabled,
                      onValueChange: (next) => setEnabled(row.key, next),
                      accessibilityLabel: row.title,
                    },
                  }}
                />
              </View>
            ))}
          </Card>
          <AppText variant="body" tone="secondary" className="mt-4">
            {PRIVACY_STRINGS.retentionLine}
          </AppText>
          <AppText variant="body" tone="secondary" className="mt-2">
            {PRIVACY_STRINGS.withdrawalLine}
          </AppText>
        </>
      ) : null}

      {/* The DPDP surface sits below the panel on every segment (Req 17.1). */}
      <Card className="mt-6" padded={false}>
        <DangerRow onPress={() => setDialogOpen(true)} />
      </Card>

      {notice === null ? null : (
        <AppText variant="body" tone="secondary" className="mt-3">
          {notice}
        </AppText>
      )}

      <ConfirmDialog
        testID={CONFIRM_DIALOG_TEST_ID}
        visible={dialogOpen}
        title={PRIVACY_STRINGS.dialog.title}
        body={PRIVACY_STRINGS.dialog.body}
        cancelLabel={PRIVACY_STRINGS.dialog.cancel}
        actions={ACTIONS}
        onCancel={() => setDialogOpen(false)}
        onAction={onAction}
      />
    </Screen>
  );
}
