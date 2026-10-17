// The routines In_App_Store (Phase 4 Req 19.1, 19.5, 19.7). The Routines screen depends on this
// interface and on nothing else.
//
// The templates are the SAME shared Starter_Content rows the Gateway's Routine_Store seeds from,
// so the app and the robot cannot disagree about which routines exist or when they run. A
// template carries no presentation at all, so each row's icon, tone, title, subtitle and 12-hour
// label come from `mock-routines.ts`'s map keyed by `routine_id` — and a template with no entry
// there renders no row (Req 19.5).
//
// One of the four app files allowed a runtime import from `@xelulu/shared` (Req 19.7). No network
// call, no environment read and nothing scheduled: the screen's toggle stays local state.

import { createStarterRoutines } from "@xelulu/shared";
import type { RoutineTemplate } from "@xelulu/shared";

import {
  ROUTINE_PRESENTATION,
  type RoutineRow,
  type RoutinesData,
} from "../../features/routines/mock-routines";

/** One row per template that has a Reference row to render. Order comes from the templates. */
function toRow(template: RoutineTemplate): RoutineRow[] {
  const presentation = ROUTINE_PRESENTATION[template.routine_id];
  if (presentation === undefined) return [];
  return [
    {
      routine_id: template.routine_id,
      icon: presentation.icon,
      icon_tone: presentation.tone,
      title: presentation.text.title,
      subtitle: presentation.text.subtitle,
      time_label: presentation.text.timeLabel,
      enabled: template.enabled,
    },
  ];
}

export interface AppRoutineStore {
  /** The rows the screen opens with. Local edits afterwards stay on the screen. */
  routines(): RoutinesData;
}

export function createAppRoutineStore(
  templates: readonly RoutineTemplate[] = createStarterRoutines(),
): AppRoutineStore {
  const data: RoutinesData = Object.freeze({
    rows: Object.freeze(templates.flatMap(toRow)),
  });
  return { routines: () => data };
}

/** The app's one store instance, built from the Starter_Content templates at import time. */
export const APP_ROUTINE_STORE: AppRoutineStore = createAppRoutineStore();
