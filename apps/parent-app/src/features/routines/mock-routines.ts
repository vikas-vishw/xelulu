// Screen 10's mock routines (Req 19.1, 19.3, 19.5). Display labels only: every time is a
// static string, nothing is scheduled, and no command reaches a robot from here.

import type { IconName } from "../../components/icon";
import type { IconTileTone } from "../../components/icon-tile";

import { ROUTINES_STRINGS } from "./strings";

export type RoutineRow = Readonly<{
  routine_id: string;
  icon: IconName;
  /** The row's tile colour, as the Reference draws screen 10's six routines. */
  icon_tone: IconTileTone;
  title: string;
  subtitle: string;
  time_label: string;
  enabled: boolean;
}>;

export type RoutinesData = Readonly<{ rows: readonly RoutineRow[] }>;

const ROWS = ROUTINES_STRINGS.rows;

/** One mock row from its strings entry. All six start on, as the Reference draws them. */
function row(
  routineId: string,
  icon: IconName,
  iconTone: IconTileTone,
  text: Readonly<{ title: string; subtitle: string; timeLabel: string }>,
): RoutineRow {
  return {
    routine_id: routineId,
    icon,
    icon_tone: iconTone,
    title: text.title,
    subtitle: text.subtitle,
    time_label: text.timeLabel,
    enabled: true,
  };
}

export const MOCK_ROUTINES: RoutinesData = {
  rows: [
    row("routine_mock_morning", "sunny-outline", "amber", ROWS.morning),
    row("routine_mock_brushing", "brush-outline", "sky", ROWS.brushing),
    row("routine_mock_meals", "restaurant-outline", "rose", ROWS.meals),
    row("routine_mock_play-time", "game-controller-outline", "amber", ROWS.playTime),
    row("routine_mock_wind-down", "leaf-outline", "lavender", ROWS.windDown),
    row("routine_mock_bedtime", "moon-outline", "lavender", ROWS.bedtime),
  ],
};
