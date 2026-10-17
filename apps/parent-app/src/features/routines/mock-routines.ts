// Screen 10's presentation map (Phase 4 Req 19.5). The row list itself is gone: the rows come
// from the routines In_App_Store over the shared Starter_Content routine templates
// (`src/lib/stores/routine-store.ts`), which is the same seed the Gateway's Routine_Store reads.
//
// A Routine_Template carries a `routine_id`, a lowercase `name`, an `HH:MM` `at`, `enabled` and a
// behaviour id — and none of a title case, a subtitle, an icon, a tone or a 12-hour label. All
// five of those live here and in `strings.ts`, keyed by the template's `routine_id`, so the app
// invents no row text and a template with no entry here renders no row at all.
//
// Display labels only: every time is a static string, nothing is scheduled, and no command
// reaches a robot from here.

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

/** One Reference row's presentation: its glyph, its tile colour and its three strings. */
export type RoutinePresentation = Readonly<{
  icon: IconName;
  tone: IconTileTone;
  /** The row's title case, its subtitle and its 12-hour label, from `strings.ts`. */
  text: Readonly<{ title: string; subtitle: string; timeLabel: string }>;
}>;

/**
 * The six Reference rows, keyed by the Starter_Content template's `routine_id` (Req 19.5). The
 * camelCase `strings.ts` keys are reached through this map and are deliberately not renamed.
 */
export const ROUTINE_PRESENTATION: Readonly<Record<string, RoutinePresentation>> = Object.freeze({
  morning: { icon: "sunny-outline", tone: "amber", text: ROWS.morning },
  brushing: { icon: "brush-outline", tone: "sky", text: ROWS.brushing },
  meals: { icon: "restaurant-outline", tone: "rose", text: ROWS.meals },
  play_time: { icon: "game-controller-outline", tone: "amber", text: ROWS.playTime },
  wind_down: { icon: "leaf-outline", tone: "lavender", text: ROWS.windDown },
  bedtime: { icon: "moon-outline", tone: "lavender", text: ROWS.bedtime },
});
