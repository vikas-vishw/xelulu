// Public surface of the Document B v2 contract (proto_ver 2). Requirements 14.1–14.4.
// Explicit named exports only. Internal modules (primitives, envelope) and helpers (the codec
// factory, Zod issue mapping) are deliberately not exported.

// Constants and topics.
export { AUDIO_FORMAT, PROTO_VER } from "./constants.js";
export { TOPIC_PREFIX, TOPIC_SUFFIXES, buildTopic, parseTopic } from "./topics.js";
export type { ParsedTopic, TopicSuffix } from "./topics.js";

// Errors.
export { ContractError } from "./errors.js";
export type { ContractIssue, ContractIssueKind, ParseResult } from "./errors.js";

// Closed lists and open vocabularies.
export {
  ACK_REASONS,
  ACK_STATUSES,
  BUTTONS,
  BUTTON_ACTIONS,
  CMD_ACTIONS,
  EVENT_KINDS,
  KNOWN_EXPRESSIONS,
  KNOWN_EYES,
  KNOWN_GESTURE_NAMES,
  LED_EFFECTS,
  LED_TARGETS,
  MODES,
  MOTION_KINDS,
  MOVE_COMMANDS,
  PLAY_SOURCES,
  SAY_VOICES,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
} from "./enums.js";
export type {
  AckReason,
  AckStatus,
  ButtonAction,
  ButtonName,
  CmdAction,
  EventKind,
  LedEffect,
  LedTarget,
  Mode,
  MotionKind,
  MoveCommand,
  PlaySource,
  SayVoice,
  TouchGesture,
  TouchZone,
  WakeSource,
} from "./enums.js";

// Schemas and wire types.
export { HelloMessageSchema } from "./hello.js";
export type { HelloMessage } from "./hello.js";

export { StatusMessageSchema, StatusTopicMessageSchema } from "./status.js";
export type { StatusMessage, StatusTopicMessage } from "./status.js";

export {
  ButtonEventMessageSchema,
  CryEventMessageSchema,
  ErrorEventMessageSchema,
  EventMessageSchema,
  InterruptEventMessageSchema,
  MotionEventMessageSchema,
  NfcEventMessageSchema,
  TouchEventMessageSchema,
  WakeEventMessageSchema,
} from "./events.js";
export type {
  ButtonEventMessage,
  CryEventMessage,
  ErrorEventMessage,
  EventDataFor,
  EventMessage,
  InterruptEventMessage,
  MotionEventMessage,
  NfcEventMessage,
  TouchEventMessage,
  WakeEventMessage,
} from "./events.js";

export {
  AudioControlMessageSchema,
  AudioEndMessageSchema,
  AudioStartMessageSchema,
} from "./audio.js";
export type { AudioControlMessage, AudioEndMessage, AudioStartMessage } from "./audio.js";

export { AckMessageSchema } from "./ack.js";
export type { AckMessage } from "./ack.js";

export {
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
} from "./commands.js";
export type {
  AnimateCmdMessage,
  CmdMessage,
  ConfigCmdMessage,
  GestureCmdMessage,
  LedCmdMessage,
  MoveCmdData,
  MoveCmdMessage,
  OtaCmdMessage,
  PlayCmdMessage,
  QuietHours,
  SayCmdMessage,
  SetModeCmdMessage,
  StopAudioCmdMessage,
  VolumeCmdMessage,
} from "./commands.js";

// Codecs and device dispatch.
export {
  parseAckMessage,
  parseAckMessageOrThrow,
  parseAnimateCmdMessage,
  parseAnimateCmdMessageOrThrow,
  parseAudioControlMessage,
  parseAudioControlMessageOrThrow,
  parseAudioEndMessage,
  parseAudioEndMessageOrThrow,
  parseAudioStartMessage,
  parseAudioStartMessageOrThrow,
  parseButtonEventMessage,
  parseButtonEventMessageOrThrow,
  parseCmdMessage,
  parseCmdMessageOrThrow,
  parseConfigCmdMessage,
  parseConfigCmdMessageOrThrow,
  parseCryEventMessage,
  parseCryEventMessageOrThrow,
  parseDeviceMessage,
  parseDeviceMessageOrThrow,
  parseErrorEventMessage,
  parseErrorEventMessageOrThrow,
  parseEventMessage,
  parseEventMessageOrThrow,
  parseGestureCmdMessage,
  parseGestureCmdMessageOrThrow,
  parseHelloMessage,
  parseHelloMessageOrThrow,
  parseInterruptEventMessage,
  parseInterruptEventMessageOrThrow,
  parseLedCmdMessage,
  parseLedCmdMessageOrThrow,
  parseMotionEventMessage,
  parseMotionEventMessageOrThrow,
  parseMoveCmdMessage,
  parseMoveCmdMessageOrThrow,
  parseNfcEventMessage,
  parseNfcEventMessageOrThrow,
  parseOtaCmdMessage,
  parseOtaCmdMessageOrThrow,
  parsePlayCmdMessage,
  parsePlayCmdMessageOrThrow,
  parseSayCmdMessage,
  parseSayCmdMessageOrThrow,
  parseSetModeCmdMessage,
  parseSetModeCmdMessageOrThrow,
  parseStatusMessage,
  parseStatusMessageOrThrow,
  parseStatusTopicMessage,
  parseStatusTopicMessageOrThrow,
  parseStopAudioCmdMessage,
  parseStopAudioCmdMessageOrThrow,
  parseTouchEventMessage,
  parseTouchEventMessageOrThrow,
  parseVolumeCmdMessage,
  parseVolumeCmdMessageOrThrow,
  parseWakeEventMessage,
  parseWakeEventMessageOrThrow,
  serialiseAckMessage,
  serialiseAnimateCmdMessage,
  serialiseAudioControlMessage,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  serialiseButtonEventMessage,
  serialiseCmdMessage,
  serialiseConfigCmdMessage,
  serialiseCryEventMessage,
  serialiseErrorEventMessage,
  serialiseEventMessage,
  serialiseGestureCmdMessage,
  serialiseHelloMessage,
  serialiseInterruptEventMessage,
  serialiseLedCmdMessage,
  serialiseMotionEventMessage,
  serialiseMoveCmdMessage,
  serialiseNfcEventMessage,
  serialiseOtaCmdMessage,
  serialisePlayCmdMessage,
  serialiseSayCmdMessage,
  serialiseSetModeCmdMessage,
  serialiseStatusMessage,
  serialiseStatusTopicMessage,
  serialiseStopAudioCmdMessage,
  serialiseTouchEventMessage,
  serialiseVolumeCmdMessage,
  serialiseWakeEventMessage,
} from "./codec.js";
export type { DeviceMessage, DeviceMessageForTopic, MqttDeviceMessage } from "./codec.js";
