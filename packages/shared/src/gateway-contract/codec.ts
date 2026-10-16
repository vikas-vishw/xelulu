// Parse and serialise functions for every Document B v2 message, the union parsers and the
// device dispatch by topic suffix. Requirements 3.8, 4.4, 4.5, 6.3, 6.4 and 10.1–10.8.
// Result-returning parsers never throw. No error carries an input value (C20).
import type { z } from "zod";

import { AckMessageSchema, type AckMessage } from "./ack.js";
import {
  AudioControlMessageSchema,
  AudioEndMessageSchema,
  AudioStartMessageSchema,
  type AudioControlMessage,
  type AudioEndMessage,
  type AudioStartMessage,
} from "./audio.js";
import {
  AnimateCmdMessageSchema,
  CmdMessageSchema,
  ConfigCmdMessageSchema,
  GestureCmdMessageSchema,
  LedCmdMessageSchema,
  MoveCmdMessageSchema,
  OtaCmdMessageSchema,
  PlayCmdMessageSchema,
  SayCmdMessageSchema,
  SetModeCmdMessageSchema,
  StopAudioCmdMessageSchema,
  VolumeCmdMessageSchema,
  type AnimateCmdMessage,
  type CmdMessage,
  type ConfigCmdMessage,
  type GestureCmdMessage,
  type LedCmdMessage,
  type MoveCmdMessage,
  type OtaCmdMessage,
  type PlayCmdMessage,
  type SayCmdMessage,
  type SetModeCmdMessage,
  type StopAudioCmdMessage,
  type VolumeCmdMessage,
} from "./commands.js";
import { ContractError, mapZodIssues, type ContractIssue, type ParseResult } from "./errors.js";
import {
  ButtonEventMessageSchema,
  CryEventMessageSchema,
  ErrorEventMessageSchema,
  EventMessageSchema,
  InterruptEventMessageSchema,
  MotionEventMessageSchema,
  NfcEventMessageSchema,
  TouchEventMessageSchema,
  WakeEventMessageSchema,
  type ButtonEventMessage,
  type CryEventMessage,
  type ErrorEventMessage,
  type EventMessage,
  type InterruptEventMessage,
  type MotionEventMessage,
  type NfcEventMessage,
  type TouchEventMessage,
  type WakeEventMessage,
} from "./events.js";
import { HelloMessageSchema, type HelloMessage } from "./hello.js";
import {
  StatusMessageSchema,
  StatusTopicMessageSchema,
  type StatusMessage,
  type StatusTopicMessage,
} from "./status.js";
import type { TopicSuffix } from "./topics.js";

type Codec<T> = {
  readonly parse: (text: string) => ParseResult<T>;
  readonly parseOrThrow: (text: string) => T;
  readonly serialise: (message: T) => string;
};

function failure<T>(variant: string, issues: readonly ContractIssue[]): ParseResult<T> {
  return { ok: false, error: new ContractError(variant, issues) };
}

/** Maps a Zod failure to contract issues; never returns an empty list. */
function issuesOf(error: z.ZodError): ContractIssue[] {
  const issues = mapZodIssues(error.issues);
  return issues.length > 0 ? issues : [{ path: [], kind: "custom" }];
}

/**
 * Internal factory. The schema's output type must be assignable to the hand-written wire type
 * `T`; the exact equality is asserted in the contract type tests.
 */
function makeCodec<T>(variant: string, schema: z.ZodType<T>): Codec<T> {
  const parse = (text: string): ParseResult<T> => {
    if (typeof text !== "string") return failure(variant, [{ path: [], kind: "invalid_type" }]);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      // The thrown error's message can quote the input, so it is discarded.
      return failure(variant, [{ path: [], kind: "invalid_json" }]);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return failure(variant, [{ path: [], kind: "not_object" }]);
    }
    const result = schema.safeParse(value);
    if (!result.success) return failure(variant, issuesOf(result.error));
    return { ok: true, value: result.data };
  };

  const parseOrThrow = (text: string): T => {
    const result = parse(text);
    if (!result.ok) throw result.error;
    return result.value;
  };

  const serialise = (message: T): string => {
    const result = schema.safeParse(message);
    if (!result.success) throw new ContractError(variant, issuesOf(result.error));
    return JSON.stringify(result.data);
  };

  return { parse, parseOrThrow, serialise };
}

// Variants.

const hello = makeCodec<HelloMessage>("hello", HelloMessageSchema);
export const parseHelloMessage: (text: string) => ParseResult<HelloMessage> = hello.parse;
export const parseHelloMessageOrThrow: (text: string) => HelloMessage = hello.parseOrThrow;
export const serialiseHelloMessage: (message: HelloMessage) => string = hello.serialise;

const status = makeCodec<StatusMessage>("status", StatusMessageSchema);
export const parseStatusMessage: (text: string) => ParseResult<StatusMessage> = status.parse;
export const parseStatusMessageOrThrow: (text: string) => StatusMessage = status.parseOrThrow;
export const serialiseStatusMessage: (message: StatusMessage) => string = status.serialise;

const touch = makeCodec<TouchEventMessage>("touch event", TouchEventMessageSchema);
export const parseTouchEventMessage: (text: string) => ParseResult<TouchEventMessage> = touch.parse;
export const parseTouchEventMessageOrThrow: (text: string) => TouchEventMessage =
  touch.parseOrThrow;
export const serialiseTouchEventMessage: (message: TouchEventMessage) => string = touch.serialise;

const wake = makeCodec<WakeEventMessage>("wake event", WakeEventMessageSchema);
export const parseWakeEventMessage: (text: string) => ParseResult<WakeEventMessage> = wake.parse;
export const parseWakeEventMessageOrThrow: (text: string) => WakeEventMessage = wake.parseOrThrow;
export const serialiseWakeEventMessage: (message: WakeEventMessage) => string = wake.serialise;

const cry = makeCodec<CryEventMessage>("cry event", CryEventMessageSchema);
export const parseCryEventMessage: (text: string) => ParseResult<CryEventMessage> = cry.parse;
export const parseCryEventMessageOrThrow: (text: string) => CryEventMessage = cry.parseOrThrow;
export const serialiseCryEventMessage: (message: CryEventMessage) => string = cry.serialise;

const motion = makeCodec<MotionEventMessage>("motion event", MotionEventMessageSchema);
export const parseMotionEventMessage: (text: string) => ParseResult<MotionEventMessage> =
  motion.parse;
export const parseMotionEventMessageOrThrow: (text: string) => MotionEventMessage =
  motion.parseOrThrow;
export const serialiseMotionEventMessage: (message: MotionEventMessage) => string =
  motion.serialise;

const button = makeCodec<ButtonEventMessage>("button event", ButtonEventMessageSchema);
export const parseButtonEventMessage: (text: string) => ParseResult<ButtonEventMessage> =
  button.parse;
export const parseButtonEventMessageOrThrow: (text: string) => ButtonEventMessage =
  button.parseOrThrow;
export const serialiseButtonEventMessage: (message: ButtonEventMessage) => string =
  button.serialise;

const nfc = makeCodec<NfcEventMessage>("nfc event", NfcEventMessageSchema);
export const parseNfcEventMessage: (text: string) => ParseResult<NfcEventMessage> = nfc.parse;
export const parseNfcEventMessageOrThrow: (text: string) => NfcEventMessage = nfc.parseOrThrow;
export const serialiseNfcEventMessage: (message: NfcEventMessage) => string = nfc.serialise;

const interrupt = makeCodec<InterruptEventMessage>("interrupt event", InterruptEventMessageSchema);
export const parseInterruptEventMessage: (text: string) => ParseResult<InterruptEventMessage> =
  interrupt.parse;
export const parseInterruptEventMessageOrThrow: (text: string) => InterruptEventMessage =
  interrupt.parseOrThrow;
export const serialiseInterruptEventMessage: (message: InterruptEventMessage) => string =
  interrupt.serialise;

const errorEvent = makeCodec<ErrorEventMessage>("error event", ErrorEventMessageSchema);
export const parseErrorEventMessage: (text: string) => ParseResult<ErrorEventMessage> =
  errorEvent.parse;
export const parseErrorEventMessageOrThrow: (text: string) => ErrorEventMessage =
  errorEvent.parseOrThrow;
export const serialiseErrorEventMessage: (message: ErrorEventMessage) => string =
  errorEvent.serialise;

const audioStart = makeCodec<AudioStartMessage>("audio_start", AudioStartMessageSchema);
export const parseAudioStartMessage: (text: string) => ParseResult<AudioStartMessage> =
  audioStart.parse;
export const parseAudioStartMessageOrThrow: (text: string) => AudioStartMessage =
  audioStart.parseOrThrow;
export const serialiseAudioStartMessage: (message: AudioStartMessage) => string =
  audioStart.serialise;

const audioEnd = makeCodec<AudioEndMessage>("audio_end", AudioEndMessageSchema);
export const parseAudioEndMessage: (text: string) => ParseResult<AudioEndMessage> = audioEnd.parse;
export const parseAudioEndMessageOrThrow: (text: string) => AudioEndMessage = audioEnd.parseOrThrow;
export const serialiseAudioEndMessage: (message: AudioEndMessage) => string = audioEnd.serialise;

/** The ack variant parser is also the `ack` topic parser. */
const ack = makeCodec<AckMessage>("ack", AckMessageSchema);
export const parseAckMessage: (text: string) => ParseResult<AckMessage> = ack.parse;
export const parseAckMessageOrThrow: (text: string) => AckMessage = ack.parseOrThrow;
export const serialiseAckMessage: (message: AckMessage) => string = ack.serialise;

const say = makeCodec<SayCmdMessage>("say cmd", SayCmdMessageSchema);
export const parseSayCmdMessage: (text: string) => ParseResult<SayCmdMessage> = say.parse;
export const parseSayCmdMessageOrThrow: (text: string) => SayCmdMessage = say.parseOrThrow;
export const serialiseSayCmdMessage: (message: SayCmdMessage) => string = say.serialise;

const animate = makeCodec<AnimateCmdMessage>("animate cmd", AnimateCmdMessageSchema);
export const parseAnimateCmdMessage: (text: string) => ParseResult<AnimateCmdMessage> =
  animate.parse;
export const parseAnimateCmdMessageOrThrow: (text: string) => AnimateCmdMessage =
  animate.parseOrThrow;
export const serialiseAnimateCmdMessage: (message: AnimateCmdMessage) => string = animate.serialise;

const gesture = makeCodec<GestureCmdMessage>("gesture cmd", GestureCmdMessageSchema);
export const parseGestureCmdMessage: (text: string) => ParseResult<GestureCmdMessage> =
  gesture.parse;
export const parseGestureCmdMessageOrThrow: (text: string) => GestureCmdMessage =
  gesture.parseOrThrow;
export const serialiseGestureCmdMessage: (message: GestureCmdMessage) => string = gesture.serialise;

const move = makeCodec<MoveCmdMessage>("move cmd", MoveCmdMessageSchema);
export const parseMoveCmdMessage: (text: string) => ParseResult<MoveCmdMessage> = move.parse;
export const parseMoveCmdMessageOrThrow: (text: string) => MoveCmdMessage = move.parseOrThrow;
export const serialiseMoveCmdMessage: (message: MoveCmdMessage) => string = move.serialise;

const play = makeCodec<PlayCmdMessage>("play cmd", PlayCmdMessageSchema);
export const parsePlayCmdMessage: (text: string) => ParseResult<PlayCmdMessage> = play.parse;
export const parsePlayCmdMessageOrThrow: (text: string) => PlayCmdMessage = play.parseOrThrow;
export const serialisePlayCmdMessage: (message: PlayCmdMessage) => string = play.serialise;

const setMode = makeCodec<SetModeCmdMessage>("set_mode cmd", SetModeCmdMessageSchema);
export const parseSetModeCmdMessage: (text: string) => ParseResult<SetModeCmdMessage> =
  setMode.parse;
export const parseSetModeCmdMessageOrThrow: (text: string) => SetModeCmdMessage =
  setMode.parseOrThrow;
export const serialiseSetModeCmdMessage: (message: SetModeCmdMessage) => string = setMode.serialise;

const led = makeCodec<LedCmdMessage>("led cmd", LedCmdMessageSchema);
export const parseLedCmdMessage: (text: string) => ParseResult<LedCmdMessage> = led.parse;
export const parseLedCmdMessageOrThrow: (text: string) => LedCmdMessage = led.parseOrThrow;
export const serialiseLedCmdMessage: (message: LedCmdMessage) => string = led.serialise;

const volume = makeCodec<VolumeCmdMessage>("volume cmd", VolumeCmdMessageSchema);
export const parseVolumeCmdMessage: (text: string) => ParseResult<VolumeCmdMessage> = volume.parse;
export const parseVolumeCmdMessageOrThrow: (text: string) => VolumeCmdMessage = volume.parseOrThrow;
export const serialiseVolumeCmdMessage: (message: VolumeCmdMessage) => string = volume.serialise;

const config = makeCodec<ConfigCmdMessage>("config cmd", ConfigCmdMessageSchema);
export const parseConfigCmdMessage: (text: string) => ParseResult<ConfigCmdMessage> = config.parse;
export const parseConfigCmdMessageOrThrow: (text: string) => ConfigCmdMessage = config.parseOrThrow;
export const serialiseConfigCmdMessage: (message: ConfigCmdMessage) => string = config.serialise;

const stopAudio = makeCodec<StopAudioCmdMessage>("stop_audio cmd", StopAudioCmdMessageSchema);
export const parseStopAudioCmdMessage: (text: string) => ParseResult<StopAudioCmdMessage> =
  stopAudio.parse;
export const parseStopAudioCmdMessageOrThrow: (text: string) => StopAudioCmdMessage =
  stopAudio.parseOrThrow;
export const serialiseStopAudioCmdMessage: (message: StopAudioCmdMessage) => string =
  stopAudio.serialise;

const ota = makeCodec<OtaCmdMessage>("ota cmd", OtaCmdMessageSchema);
export const parseOtaCmdMessage: (text: string) => ParseResult<OtaCmdMessage> = ota.parse;
export const parseOtaCmdMessageOrThrow: (text: string) => OtaCmdMessage = ota.parseOrThrow;
export const serialiseOtaCmdMessage: (message: OtaCmdMessage) => string = ota.serialise;

// Unions.

const statusTopic = makeCodec<StatusTopicMessage>("status topic", StatusTopicMessageSchema);
export const parseStatusTopicMessage: (text: string) => ParseResult<StatusTopicMessage> =
  statusTopic.parse;
export const parseStatusTopicMessageOrThrow: (text: string) => StatusTopicMessage =
  statusTopic.parseOrThrow;
export const serialiseStatusTopicMessage: (message: StatusTopicMessage) => string =
  statusTopic.serialise;

const event = makeCodec<EventMessage>("event", EventMessageSchema);
export const parseEventMessage: (text: string) => ParseResult<EventMessage> = event.parse;
export const parseEventMessageOrThrow: (text: string) => EventMessage = event.parseOrThrow;
export const serialiseEventMessage: (message: EventMessage) => string = event.serialise;

const audioControl = makeCodec<AudioControlMessage>("audio control", AudioControlMessageSchema);
export const parseAudioControlMessage: (text: string) => ParseResult<AudioControlMessage> =
  audioControl.parse;
export const parseAudioControlMessageOrThrow: (text: string) => AudioControlMessage =
  audioControl.parseOrThrow;
export const serialiseAudioControlMessage: (message: AudioControlMessage) => string =
  audioControl.serialise;

const cmd = makeCodec<CmdMessage>("cmd", CmdMessageSchema);
export const parseCmdMessage: (text: string) => ParseResult<CmdMessage> = cmd.parse;
export const parseCmdMessageOrThrow: (text: string) => CmdMessage = cmd.parseOrThrow;
export const serialiseCmdMessage: (message: CmdMessage) => string = cmd.serialise;

// Device dispatch by topic suffix.

/** Everything a device publishes over MQTT. */
export type MqttDeviceMessage = StatusTopicMessage | EventMessage | AckMessage;
/** Everything a device sends: MQTT messages plus the audio WebSocket markers. */
export type DeviceMessage = MqttDeviceMessage | AudioControlMessage;
/** The messages that belong on one topic. A device never publishes on `cmd`. */
export type DeviceMessageForTopic<S extends TopicSuffix> = S extends "status"
  ? StatusTopicMessage
  : S extends "event"
    ? EventMessage
    : S extends "ack"
      ? AckMessage
      : never;

const DEVICE_VARIANT = "device";

/**
 * Parses a message a device published on the topic with `suffix`, accepting only that topic's
 * messages. Never throws. On `cmd` it fails with `wrong_topic` without reading the text.
 */
export function parseDeviceMessage<S extends TopicSuffix>(
  suffix: S,
  text: string,
): ParseResult<DeviceMessageForTopic<S>> {
  // Checked at runtime too: JS callers and casts can pass any value.
  const s: unknown = suffix;
  let result: ParseResult<DeviceMessage>;
  switch (s) {
    case "status":
      result = parseStatusTopicMessage(text);
      break;
    case "event":
      result = parseEventMessage(text);
      break;
    case "ack":
      result = parseAckMessage(text);
      break;
    case "cmd":
      return failure(DEVICE_VARIANT, [{ path: [], kind: "wrong_topic" }]);
    default:
      return failure(DEVICE_VARIANT, [{ path: ["suffix"], kind: "invalid_topic_suffix" }]);
  }
  // The switch has matched `result` to `suffix`, which TypeScript cannot follow through `S`.
  return result as ParseResult<DeviceMessageForTopic<S>>;
}

/** Throwing variant of `parseDeviceMessage`, with the same issues. */
export function parseDeviceMessageOrThrow<S extends TopicSuffix>(
  suffix: S,
  text: string,
): DeviceMessageForTopic<S> {
  const result = parseDeviceMessage(suffix, text);
  if (!result.ok) throw result.error;
  return result.value;
}
