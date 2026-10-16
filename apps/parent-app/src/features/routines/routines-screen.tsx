// Screen 10 of the Reference: Routines. Mock data and local state only, no network call and
// no environment read (Req 13.1-13.6, 22.1, 22.2).
//
// Nothing here schedules anything or sends a command: a toggle flips one local row, and the
// add form appends one local row that is forgotten on reload (D10).
//
// Deviations from the frozen Reference: none. The six rows sit in one grouped Card with a
// hairline between them, and "+ Add Routine" is the kit's filled full-width primary Button,
// which is what the Reference draws below the card.

import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { TextField } from "../../components/text-field";
import { isBlank } from "../../lib/text";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_ROUTINES, type RoutineRow, type RoutinesData } from "./mock-routines";
import { ROUTINES_STRINGS } from "./strings";

const NAME_MAX = 40;
const TIME_MAX = 10;

/** The glyph every locally added row carries: the Reference has no row to copy one from. */
const NEW_ROW_ICON = "time-outline";

/** A locally added row keeps the kit's default tile colour, for the same reason. */
const NEW_ROW_TONE = "beige";

export type RoutinesScreenProps = Readonly<{ data?: RoutinesData }>;

export function RoutinesScreen({ data = MOCK_ROUTINES }: RoutinesScreenProps): React.JSX.Element {
  const [rows, setRows] = useState<readonly RoutineRow[]>(data.rows);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [time, setTime] = useState("");

  const setEnabled = (routineId: string, next: boolean): void => {
    setRows(rows.map((row) => (row.routine_id === routineId ? { ...row, enabled: next } : row)));
  };

  const closeForm = (): void => {
    setAdding(false);
    setName("");
    setTime("");
  };

  const confirmAdd = (): void => {
    if (isBlank(name)) return;
    setRows([
      ...rows,
      {
        routine_id: `routine_local_${rows.length + 1}`,
        icon: NEW_ROW_ICON,
        icon_tone: NEW_ROW_TONE,
        title: name.trim(),
        subtitle: ROUTINES_STRINGS.newRoutineSubtitle,
        // Req 13.5 disables confirm on a blank name only, so a blank time gets a text fallback.
        time_label: isBlank(time) ? ROUTINES_STRINGS.timeNotSet : time.trim(),
        enabled: true,
      },
    ]);
    closeForm();
  };

  return (
    <Screen scroll>
      <ScreenTitle name={SCREEN_HEADER_NAME.routines}>
        <AppText variant="title" tone="primary">
          {SCREEN_HEADER_NAME.routines}
        </AppText>
      </ScreenTitle>
      <AppText variant="body" tone="secondary" className="mt-1">
        {ROUTINES_STRINGS.subheader}
      </AppText>

      {/* One grouped Card enclosing every row, with a hairline between them, as the Reference
          draws screen 10 — unlike screens 9, 11 and 15, which card each row separately. */}
      <Card className="mt-4" padded={false}>
        {rows.map((row, index) => (
          <View
            key={row.routine_id}
            className={index === 0 ? undefined : "border-t border-hairline"}
          >
            <ListRow
              icon={row.icon}
              iconTone={row.icon_tone}
              title={row.title}
              subtitle={row.subtitle}
              trailingText={row.time_label}
              trailing={{
                toggle: {
                  value: row.enabled,
                  onValueChange: (next) => setEnabled(row.routine_id, next),
                  accessibilityLabel: row.title,
                },
              }}
            />
          </View>
        ))}
      </Card>

      <Button
        label={ROUTINES_STRINGS.addRoutine}
        icon="add"
        onPress={() => setAdding(true)}
        className="mt-4"
      />

      {adding ? (
        <Card className="mt-3">
          <TextField
            label={ROUTINES_STRINGS.routineName}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            autoCapitalize="words"
          />
          <View className="mt-3">
            <TextField
              label={ROUTINES_STRINGS.time}
              value={time}
              onChangeText={setTime}
              trailingIcon="time-outline"
              maxLength={TIME_MAX}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Button
            label={ROUTINES_STRINGS.confirmAdd}
            disabled={isBlank(name)}
            onPress={confirmAdd}
            className="mt-4"
          />
          <Button
            label={ROUTINES_STRINGS.cancel}
            variant="secondary"
            onPress={closeForm}
            className="mt-2"
          />
        </Card>
      ) : null}
    </Screen>
  );
}
