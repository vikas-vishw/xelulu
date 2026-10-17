// The `routine_lookup` tool's seam (Phase 3 Req 9.4). A lookup answers with the routine's name
// and its time, which is all a child needs to hear ("bedtime is at 8:30").
//
// Times are `HH:MM` in the device's local day, the same shape the contract uses for quiet hours,
// so nothing here has to reason about time zones.
//
// THIS MODULE HOLDS THE INTERFACE AND NOTHING ELSE (Phase 4 Req 10.1a). The Phase 3
// `ROUTINE_FIXTURE`, `RoutineFixture` and `createRoutines` are gone: `src/routines/routine-store.ts`
// implements `RoutineStore extends Routines` from the Starter_Content's six templates, so the six
// routine times have exactly one source of truth and not two. `playMinutesUsed` keeps its exact
// shape, which is why `brain/tools/device-action.ts` needed no edit at all (C16).
export type RoutineLookup =
  | { readonly ok: true; readonly name: string; readonly at: string }
  | { readonly ok: false; readonly reason: "unknown_routine" | "disabled" };

export interface Routines {
  lookup(name: string): RoutineLookup;
  names(): readonly string[];
  /** Minutes of play recorded for this device on the current local day. */
  playMinutesUsed(deviceId: string): number;
}
