// The Child_Context table (Req 10, C9): who the Gateway is talking to, and what the parent has
// allowed. There is no backend in this phase (C10), so the table is in-process and seeded from a
// fixture; the only thing that moves at runtime is which child a device says is active.
//
// The active child's id arrives in the device's own `status` message, which already carries
// `active_child_id` in Document B, so no new write surface is added. The id is used as a lookup
// key and NEVER logged: Phase 1.2 Req 12.5 forbids it, and `age_stage` is logged instead because
// it is one of four buckets and names nobody (C9).
//
// When the id is null or names a child the table does not know, the most restrictive context
// applies rather than a permissive default. A missing context is exactly the case where guessing
// is dangerous: an unknown child gets `tiny` vocabulary, English, no content categories beyond
// the defaults and movement off (safety.md §8).
import { type AgeStage, type SupportedLang } from "@xelulu/shared";

/** The device policy a tool call is gated on before anything is sent (safety.md §5). */
export type DevicePolicy = Readonly<{
  /** `HH:MM` start and end, wrapping midnight. Null when the parent set none. */
  quietHours: Readonly<{ start: string; end: string }> | null;
  /** Minutes of play allowed today. Null when the parent set no limit. */
  playLimitMinutes: number | null;
  movementOn: boolean;
}>;

export type ChildContext = Readonly<{
  ageStage: AgeStage;
  langs: readonly SupportedLang[];
  allowedCategories: readonly string[];
  deferTopics: readonly string[];
  policy: DevicePolicy;
}>;

/**
 * The context for a null or unknown `active_child_id`: the narrowest vocabulary, English only,
 * no content category opened, no movement. Deliberately not a copy of any fixture child, so a
 * table miss can never be mistaken for a real child's settings.
 */
export const MOST_RESTRICTIVE_CONTEXT: ChildContext = Object.freeze({
  ageStage: "tiny" as AgeStage,
  langs: Object.freeze(["en-IN"]) as readonly SupportedLang[],
  allowedCategories: Object.freeze([]) as readonly string[],
  deferTopics: Object.freeze([]) as readonly string[],
  policy: Object.freeze({ quietHours: null, playLimitMinutes: null, movementOn: false }),
});

/**
 * The in-process children this phase knows about (C10). Keyed by the `active_child_id` a device
 * reports. Replaced by Supabase rows under RLS in the backend phase.
 */
export const FIXTURE_CHILDREN: Readonly<Record<string, ChildContext>> = Object.freeze({
  child_mock_1: Object.freeze({
    ageStage: "little" as AgeStage,
    langs: Object.freeze(["en-IN", "hi-IN"]) as readonly SupportedLang[],
    allowedCategories: Object.freeze([
      "stories",
      "songs",
      "animals",
      "games",
      "feelings",
      "manners",
    ]) as readonly string[],
    deferTopics: Object.freeze([]) as readonly string[],
    policy: Object.freeze({
      quietHours: Object.freeze({ start: "22:00", end: "07:00" }),
      playLimitMinutes: 60,
      movementOn: true,
    }),
  }),
  child_mock_2: Object.freeze({
    ageStage: "explorer" as AgeStage,
    langs: Object.freeze(["en-IN", "hi-IN"]) as readonly SupportedLang[],
    allowedCategories: Object.freeze([
      "stories",
      "animals",
      "maths",
      "world",
      "games",
    ]) as readonly string[],
    // A parent-added Defer_Topic, so the `parent_added` code has a live path. Never logged as
    // text: the Input_Guard reports it under the `parent_added` topic code only (Req 7.5).
    deferTopics: Object.freeze(["thunderstorm"]) as readonly string[],
    policy: Object.freeze({
      quietHours: null,
      playLimitMinutes: null,
      movementOn: false,
    }),
  }),
});

export interface ChildContextTable {
  /** From the device's latest accepted `status` (Req 10.1). Null clears the device's child. */
  setActiveChild(deviceId: string, activeChildId: string | null): void;
  /** The active child's context, or MOST_RESTRICTIVE_CONTEXT for a null or unknown id. */
  forDevice(deviceId: string): ChildContext;
  /**
   * An opaque per-child key for the stores that are scoped per child (the Memory_Store). It is
   * the active child's id when there is one, and a device-scoped key when there is not, so a
   * device with no active child cannot read another child's facts. NEVER logged (C9).
   */
  childKeyFor(deviceId: string): string;
}

export function createChildContextTable(
  children: Readonly<Record<string, ChildContext>> = FIXTURE_CHILDREN,
): ChildContextTable {
  const active = new Map<string, string>();

  return {
    setActiveChild(deviceId, activeChildId) {
      if (activeChildId === null || activeChildId === "") active.delete(deviceId);
      else active.set(deviceId, activeChildId);
    },

    forDevice(deviceId) {
      const id = active.get(deviceId);
      if (id === undefined) return MOST_RESTRICTIVE_CONTEXT;
      return children[id] ?? MOST_RESTRICTIVE_CONTEXT;
    },

    childKeyFor(deviceId) {
      const id = active.get(deviceId);
      if (id === undefined) return `device:${deviceId}`;
      return children[id] === undefined ? `device:${deviceId}` : `child:${id}`;
    },
  };
}
