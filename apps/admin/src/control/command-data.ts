// The minimal valid `data` the console sends for each Document B command action (Phase 6 C8).
//
// A bring-up probe, not a product behaviour: the smallest body each command schema accepts, built
// from the contract's own Known_Vocabularies and closed lists so no wire value is written out
// here. Shared by the Test_Matrix's driven rows and the Device Control page, so there is one
// answer to "what does the console send for `led`".
//
// The six actions the Device_Action_Gate does not allow get `{}`. That is not laziness: the gate
// refuses on the action before it ever reads `data`, and a refused request puts nothing on the
// wire, so inventing a body for `ota` or `move` would only mean writing a URL and a speed into
// the console for a command that can never leave it.
import {
  KNOWN_EXPRESSIONS,
  KNOWN_EYES,
  KNOWN_GESTURE_NAMES,
  LED_EFFECTS,
  LED_TARGETS,
  PLAY_SOURCES,
  SAY_VOICES,
  SUPPORTED_LANGS,
} from "@xelulu/shared";
import type { CmdAction } from "@xelulu/shared";

/** A command body as the route takes it: JSON, and never read by the console again. */
export type CommandData = Readonly<Record<string, unknown>>;

const EMPTY: CommandData = Object.freeze({});

/** A steady mid-blue. `LED_EFFECTS[0]` is the solid effect, so nothing flashes (safety.md §6). */
const PROBE_COLOR = "#2244aa";

/** Well under full brightness: a bring-up probe should be visible, not dazzling. */
const PROBE_BRIGHTNESS = 40;

/** A short hint, so a `say` probe does not hold the face in a listening pose. */
const PROBE_SAY_MS = 1200;

/** What a `play` probe asks for. Any non-empty id satisfies the schema; the ack is the point. */
const PROBE_CONTENT_ID = "bringup_probe";

/**
 * One body per action, exhaustive over `CmdAction` so a new Document B action stops this file
 * compiling until someone writes its probe.
 */
const PROBE_DATA: Readonly<Record<CmdAction, CommandData>> = Object.freeze({
  say: Object.freeze({
    expression: KNOWN_EXPRESSIONS[0],
    lang: SUPPORTED_LANGS[0],
    voice: SAY_VOICES[0],
    duration_hint_ms: PROBE_SAY_MS,
  }),
  animate: Object.freeze({
    expression: KNOWN_EXPRESSIONS[0],
    eyes: KNOWN_EYES[0],
    loop: false,
  }),
  gesture: Object.freeze({ name: KNOWN_GESTURE_NAMES[0] }),
  led: Object.freeze({
    target: LED_TARGETS[0],
    color: PROBE_COLOR,
    effect: LED_EFFECTS[0],
    brightness: PROBE_BRIGHTNESS,
  }),
  play: Object.freeze({ content_id: PROBE_CONTENT_ID, source: PLAY_SOURCES[1] }),
  // Refused by the gate on the action alone, so nothing of these ever reaches the wire.
  move: EMPTY,
  set_mode: EMPTY,
  volume: EMPTY,
  config: EMPTY,
  stop_audio: EMPTY,
  ota: EMPTY,
});

const BY_ACTION: ReadonlyMap<string, CommandData> = new Map(Object.entries(PROBE_DATA));

/**
 * The probe body for an action. An action the console has no body for — one substituted by a test,
 * or one Document B gains before anyone writes its probe — gets `{}`, which the gate refuses.
 */
export function probeData(action: string): CommandData {
  return BY_ACTION.get(action) ?? EMPTY;
}
