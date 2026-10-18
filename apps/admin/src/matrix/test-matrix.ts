// The Test_Matrix rows (Phase 6 C8, C9; Req 4.1, 4.2, 4.3, 4.6).
//
// THE CONTRACT IS THE MATRIX. Every row is built at runtime by walking a Document B list imported
// from the Shared_Package — `CMD_ACTIONS`, `EVENT_KINDS` and `TOUCH_ZONES` — plus exactly two
// fixed rows that name no wire value at all. Nothing here lists a wire value, so a Document B
// list that gains a member gains its row with no change to this file, and the matrix cannot drift
// from the contract. `tooling/test/matrix-derivation.test.ts` is the Repo_Check that proves it.
//
// DIRECTIONALITY IS THE CENTRAL RULE (C9). A cloud→device row is `driven`: the console fires it
// itself through the Device_Control_Route. A device→cloud row is `observed`: it ORIGINATES AT THE
// DEVICE, the console watches the Operator_Stream for it and can neither cause it nor ask anyone
// else to — the console sends no request to any origin but its own. The operator fires those from
// the Simulator control panel during bring-up, and a hardware engineer touches the real robot
// afterwards.
import { CMD_ACTIONS, EVENT_KINDS, TOUCH_ZONES } from "@xelulu/shared";
import type { CmdAction } from "@xelulu/shared";

/** How a row is proved: the console drives it, or it watches for it (C9). */
export type MatrixDirection = "driven" | "observed";

/** Which contract list a row came from, or `fixed` for the two rows that name no wire value. */
export type MatrixGroup = "cmd" | "event" | "zone" | "fixed";

/**
 * The two rows with no contract member of their own: one complete audio turn through the mock
 * brain, and the device's own safety refusal reaching the cloud as a rejected ack (Req 4.1, 4.8).
 */
export const FIXED_ROWS = Object.freeze(["audio_turn", "safety_refusal"] as const);
export type FixedRowName = (typeof FIXED_ROWS)[number];

export type MatrixRow = Readonly<{
  /** `cmd:<action>`, `event:<kind>`, `zone:<zone>` or `fixed:<name>`. Built, never written out. */
  id: string;
  direction: MatrixDirection;
  group: MatrixGroup;
  /** The contract member this row covers; null for a fixed row. */
  member: string | null;
  /** Driven rows only: whether the Device_Action_Gate is expected to refuse it (Req 4.6). */
  expectRefusal: boolean;
}>;

/**
 * The three Document B lists the matrix walks. Typed as plain strings so a test can substitute a
 * list containing a member Document B does not have yet and watch exactly one extra row appear
 * (Property 4, Req 4.3).
 */
export type MatrixLists = Readonly<{
  cmdActions: readonly string[];
  eventKinds: readonly string[];
  touchZones: readonly string[];
}>;

/** The real lists, straight from the Shared_Package. The default for `buildMatrix`. */
export const CONTRACT_LISTS: MatrixLists = Object.freeze({
  cmdActions: CMD_ACTIONS,
  eventKinds: EVENT_KINDS,
  touchZones: TOUCH_ZONES,
});

/**
 * Which of Document B's actions an operator may fire from the console, written as an exhaustive
 * decision over `CmdAction` rather than as a list of wire values — the same shape, and for the
 * same two reasons, as the Device_Action_Gate's own table in the Gateway: the contract stays the
 * only place those values are listed, and if Document B gains an action this record stops
 * compiling until someone decides whether an operator may reach it.
 *
 * The five true entries mirror `DEVICE_ACTION_ALLOWED`. The console cannot import the Gateway's
 * copy (an app may not import from a service), so it derives the same answer the same way; a row
 * whose answer here disagrees with the gate simply fails its run, which is the honest outcome.
 */
const OPERATOR_DRIVABLE: Readonly<Record<CmdAction, boolean>> = Object.freeze({
  say: true,
  animate: true,
  gesture: true,
  led: true,
  play: true,
  // Movement belongs to the body controller's hard limits, never to the console (safety.md §5).
  move: false,
  // Not conversational, and not an operator power the gate grants: the route refuses each one.
  set_mode: false,
  volume: false,
  config: false,
  stop_audio: false,
  ota: false,
});

/** The allow-listed actions, derived from the contract list and the decision table above. */
export const DRIVABLE_ACTIONS: readonly string[] = Object.freeze(
  CMD_ACTIONS.filter((action) => OPERATOR_DRIVABLE[action]),
);

const DRIVABLE: ReadonlySet<string> = new Set(DRIVABLE_ACTIONS);

/**
 * True when the Device_Control_Route is expected to send this action. An action the console has
 * never heard of — a member substituted by a test, or one Document B gains before anyone updates
 * the table above — is NOT drivable, so its row expects a refusal. The conservative answer.
 */
export function isDrivable(action: string): boolean {
  return DRIVABLE.has(action);
}

function makeRow(
  id: string,
  direction: MatrixDirection,
  group: MatrixGroup,
  member: string | null,
  expectRefusal: boolean,
): MatrixRow {
  return Object.freeze({ id, direction, group, member, expectRefusal });
}

/**
 * Every row of the Test_Matrix, in contract order: one driven row per command action, one observed
 * row per event kind, one per touch zone, then the two fixed rows. `lists` substitutes any of the
 * three Document B lists; anything it leaves out comes from the contract (Req 4.1–4.3).
 */
export function buildMatrix(lists: Partial<MatrixLists> = {}): readonly MatrixRow[] {
  const cmdActions = lists.cmdActions ?? CONTRACT_LISTS.cmdActions;
  const eventKinds = lists.eventKinds ?? CONTRACT_LISTS.eventKinds;
  const touchZones = lists.touchZones ?? CONTRACT_LISTS.touchZones;

  return Object.freeze([
    ...cmdActions.map((action) =>
      makeRow(`cmd:${action}`, "driven", "cmd", action, !isDrivable(action)),
    ),
    ...eventKinds.map((kind) => makeRow(`event:${kind}`, "observed", "event", kind, false)),
    ...touchZones.map((zone) => makeRow(`zone:${zone}`, "observed", "zone", zone, false)),
    ...FIXED_ROWS.map((name) => makeRow(`fixed:${name}`, "observed", "fixed", null, false)),
  ]);
}

/** The id of a fixed row, for the reducer and the page. Built from `FIXED_ROWS`, never typed out. */
export function fixedRowId(name: FixedRowName): string {
  return `fixed:${name}`;
}
