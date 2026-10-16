// Commands on `xelulu/{device_id}/cmd`, one schema per action, narrowed by `action`.
// Document B v2 §4, Requirements 8.1–8.16. Commands carry `cmd_id` and no `ts` or `type`.
// `say` audio is streamed down the audio WebSocket, so say `data` has no audio key.
import { z } from "zod";

import { cmdSchema } from "./envelope.js";
import {
  LED_EFFECTS,
  LED_TARGETS,
  MODES,
  PLAY_SOURCES,
  SAY_VOICES,
  type CmdAction,
  type LedEffect,
  type LedTarget,
  type Mode,
  type PlaySource,
  type SayVoice,
} from "./enums.js";
import {
  emptyData,
  enumOf,
  hexColor,
  hhmm,
  httpsUrl,
  lang,
  nonEmpty,
  nonNegFinite,
  nonNegInt,
  pct,
} from "./primitives.js";

export const SayCmdMessageSchema = cmdSchema(
  "say",
  z.strictObject({
    expression: nonEmpty,
    lang,
    voice: enumOf(SAY_VOICES),
    duration_hint_ms: nonNegInt,
  }),
);

export const AnimateCmdMessageSchema = cmdSchema(
  "animate",
  z.strictObject({ expression: nonEmpty, eyes: nonEmpty, loop: z.boolean() }),
);

export const GestureCmdMessageSchema = cmdSchema("gesture", z.strictObject({ name: nonEmpty }));

/**
 * Move data, discriminated on `cmd` (D9, ruling 4). `come` and `turn` require both speeds;
 * `stop` may omit either or both. `max_dist_mm` is always required. Speeds and distance are
 * non-negative with no upper bound (ruling 3): firmware caps speed and torque.
 */
const moveData = z.discriminatedUnion("cmd", [
  z.strictObject({
    cmd: z.literal("come"),
    linear_mms: nonNegFinite,
    angular_mrad_s: nonNegFinite,
    max_dist_mm: nonNegFinite,
  }),
  z.strictObject({
    cmd: z.literal("turn"),
    linear_mms: nonNegFinite,
    angular_mrad_s: nonNegFinite,
    max_dist_mm: nonNegFinite,
  }),
  z.strictObject({
    cmd: z.literal("stop"),
    linear_mms: nonNegFinite.optional(),
    angular_mrad_s: nonNegFinite.optional(),
    max_dist_mm: nonNegFinite,
  }),
]);

export const MoveCmdMessageSchema = cmdSchema("move", moveData);

export const PlayCmdMessageSchema = cmdSchema(
  "play",
  z.strictObject({ content_id: nonEmpty, source: enumOf(PLAY_SOURCES) }),
);

export const SetModeCmdMessageSchema = cmdSchema(
  "set_mode",
  z.strictObject({ mode: enumOf(MODES) }),
);

export const LedCmdMessageSchema = cmdSchema(
  "led",
  z.strictObject({
    target: enumOf(LED_TARGETS),
    color: hexColor,
    effect: enumOf(LED_EFFECTS),
    brightness: pct,
  }),
);

export const VolumeCmdMessageSchema = cmdSchema("volume", z.strictObject({ level: pct }));

/** A config delta must carry at least one key. A key present with `null` counts as present. */
function atLeastOneDeltaKey(data: Record<string, unknown>, ctx: z.RefinementCtx): void {
  if (!Object.values(data).some((value) => value !== undefined)) {
    ctx.addIssue({ code: "custom", path: [], params: { kind: "config_empty" } });
  }
}

export const ConfigCmdMessageSchema = cmdSchema(
  "config",
  z
    .strictObject({
      volume: pct.optional(),
      quiet_hours: z.strictObject({ start: hhmm, end: hhmm }).optional(),
      movement_on: z.boolean().optional(),
      language: lang.optional(),
      active_child_id: z.string().nullable().optional(),
    })
    .superRefine(atLeastOneDeltaKey),
);

export const StopAudioCmdMessageSchema = cmdSchema("stop_audio", emptyData);

export const OtaCmdMessageSchema = cmdSchema("ota", z.strictObject({ manifest_url: httpsUrl }));

/** Every command, narrowed by `action`. */
export const CmdMessageSchema = z.discriminatedUnion("action", [
  SayCmdMessageSchema,
  AnimateCmdMessageSchema,
  GestureCmdMessageSchema,
  MoveCmdMessageSchema,
  PlayCmdMessageSchema,
  SetModeCmdMessageSchema,
  LedCmdMessageSchema,
  VolumeCmdMessageSchema,
  ConfigCmdMessageSchema,
  StopAudioCmdMessageSchema,
  OtaCmdMessageSchema,
]);

type CmdEnvelope<A extends CmdAction, D> = {
  proto_ver: 2;
  cmd_id: string;
  action: A;
  data: D;
};

export type QuietHours = { start: string; end: string };

export type SayCmdMessage = CmdEnvelope<
  "say",
  { expression: string; lang: string; voice: SayVoice; duration_hint_ms: number }
>;
export type AnimateCmdMessage = CmdEnvelope<
  "animate",
  { expression: string; eyes: string; loop: boolean }
>;
export type GestureCmdMessage = CmdEnvelope<"gesture", { name: string }>;

/** Ruling 4: move data is discriminated on `cmd`; speeds are optional only on `stop`. */
export type MoveCmdData =
  | { cmd: "come"; linear_mms: number; angular_mrad_s: number; max_dist_mm: number }
  | {
      cmd: "stop";
      linear_mms?: number | undefined;
      angular_mrad_s?: number | undefined;
      max_dist_mm: number;
    }
  | { cmd: "turn"; linear_mms: number; angular_mrad_s: number; max_dist_mm: number };
export type MoveCmdMessage = CmdEnvelope<"move", MoveCmdData>;

export type PlayCmdMessage = CmdEnvelope<"play", { content_id: string; source: PlaySource }>;
export type SetModeCmdMessage = CmdEnvelope<"set_mode", { mode: Mode }>;
export type LedCmdMessage = CmdEnvelope<
  "led",
  { target: LedTarget; color: string; effect: LedEffect; brightness: number }
>;
export type VolumeCmdMessage = CmdEnvelope<"volume", { level: number }>;
export type ConfigCmdMessage = CmdEnvelope<
  "config",
  {
    volume?: number | undefined;
    quiet_hours?: QuietHours | undefined;
    movement_on?: boolean | undefined;
    language?: string | undefined;
    active_child_id?: string | null | undefined;
  }
>;
export type StopAudioCmdMessage = CmdEnvelope<"stop_audio", Record<string, never>>;
export type OtaCmdMessage = CmdEnvelope<"ota", { manifest_url: string }>;

export type CmdMessage =
  | SayCmdMessage
  | AnimateCmdMessage
  | GestureCmdMessage
  | MoveCmdMessage
  | PlayCmdMessage
  | SetModeCmdMessage
  | LedCmdMessage
  | VolumeCmdMessage
  | ConfigCmdMessage
  | StopAudioCmdMessage
  | OtaCmdMessage;
