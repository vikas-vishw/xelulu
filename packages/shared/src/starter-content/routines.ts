// The six routine templates (Req 10.1a): the morning, brushing, meals, play-time, wind-down and
// bedtime rows, with exactly the names and times the Phase 3 `routine_lookup` fixture answered
// with — because that fixture is DELETED when the Gateway's Routine_Store arrives, so these six
// rows are the one source of truth for the six times rather than the second one.
//
// A template carries what to do and when, and none of how it looks: no title case, no subtitle,
// no icon and no 12-hour label. The parent app already holds all five of those and maps them on
// by `routine_id` (Req 19.5).
import type { RoutineTemplate } from "./index.js";

export const STARTER_ROUTINE_SPECS: readonly RoutineTemplate[] = Object.freeze([
  Object.freeze({
    routine_id: "morning",
    name: "morning",
    at: "07:00",
    enabled: true,
    behaviour: "morning",
  }),
  Object.freeze({
    routine_id: "brushing",
    name: "brushing",
    at: "08:00",
    enabled: true,
    behaviour: "brushing",
  }),
  Object.freeze({
    routine_id: "meals",
    name: "meals",
    at: "12:30",
    enabled: true,
    behaviour: "meals",
  }),
  Object.freeze({
    routine_id: "play_time",
    name: "play time",
    at: "17:00",
    enabled: true,
    behaviour: "play_time",
  }),
  Object.freeze({
    routine_id: "wind_down",
    name: "wind down",
    at: "20:00",
    enabled: true,
    behaviour: "wind_down",
  }),
  Object.freeze({
    routine_id: "bedtime",
    name: "bedtime",
    at: "20:30",
    enabled: true,
    behaviour: "bedtime",
  }),
] as const);
