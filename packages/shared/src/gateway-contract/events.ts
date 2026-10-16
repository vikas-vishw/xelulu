// Events on `xelulu/{device_id}/event`, one schema per event kind, narrowed by `event`.
// Document B v2 §3.3, Requirements 5.1–5.10. Rulings 3: wake `dir_deg` is an integer 0–359,
// error `code` and `detail` accept any string (empty allowed).
import { z } from "zod";

import { eventSchema } from "./envelope.js";
import {
  BUTTON_ACTIONS,
  BUTTONS,
  MOTION_KINDS,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
  type ButtonAction,
  type ButtonName,
  type EventKind,
  type MotionKind,
  type TouchGesture,
  type TouchZone,
  type WakeSource,
} from "./enums.js";
import {
  anyString,
  degInt,
  emptyData,
  enumOf,
  finite,
  nonEmpty,
  nonNegFinite,
  unit,
} from "./primitives.js";

export const TouchEventMessageSchema = eventSchema(
  "touch",
  z.strictObject({ zone: enumOf(TOUCH_ZONES), gesture: enumOf(TOUCH_GESTURES) }),
);

export const WakeEventMessageSchema = eventSchema(
  "wake",
  z.strictObject({ source: enumOf(WAKE_SOURCES), dir_deg: degInt.optional() }),
);

/** Cry detection runs on the device: only confidence and duration leave the robot. */
export const CryEventMessageSchema = eventSchema(
  "cry",
  z.strictObject({ confidence: unit, duration_s: nonNegFinite }),
);

export const MotionEventMessageSchema = eventSchema(
  "motion",
  z.strictObject({ event: enumOf(MOTION_KINDS), value: finite }),
);

export const ButtonEventMessageSchema = eventSchema(
  "button",
  z.strictObject({ button: enumOf(BUTTONS), action: enumOf(BUTTON_ACTIONS) }),
);

export const NfcEventMessageSchema = eventSchema("nfc", z.strictObject({ card_id: nonEmpty }));

export const InterruptEventMessageSchema = eventSchema("interrupt", emptyData);

export const ErrorEventMessageSchema = eventSchema(
  "error",
  z.strictObject({ code: anyString, detail: anyString }),
);

/** Every event, narrowed by `event`. */
export const EventMessageSchema = z.discriminatedUnion("event", [
  TouchEventMessageSchema,
  WakeEventMessageSchema,
  CryEventMessageSchema,
  MotionEventMessageSchema,
  ButtonEventMessageSchema,
  NfcEventMessageSchema,
  InterruptEventMessageSchema,
  ErrorEventMessageSchema,
]);

type EventEnvelope<K extends EventKind, D> = {
  proto_ver: 2;
  ts: number;
  type: "event";
  event_id: string;
  event: K;
  time_uncertain?: boolean | undefined;
  data: D;
};

export type TouchEventMessage = EventEnvelope<"touch", { zone: TouchZone; gesture: TouchGesture }>;
export type WakeEventMessage = EventEnvelope<
  "wake",
  { source: WakeSource; dir_deg?: number | undefined }
>;
export type CryEventMessage = EventEnvelope<"cry", { confidence: number; duration_s: number }>;
export type MotionEventMessage = EventEnvelope<"motion", { event: MotionKind; value: number }>;
export type ButtonEventMessage = EventEnvelope<
  "button",
  { button: ButtonName; action: ButtonAction }
>;
export type NfcEventMessage = EventEnvelope<"nfc", { card_id: string }>;
export type InterruptEventMessage = EventEnvelope<"interrupt", Record<string, never>>;
export type ErrorEventMessage = EventEnvelope<"error", { code: string; detail: string }>;

export type EventMessage =
  | TouchEventMessage
  | WakeEventMessage
  | CryEventMessage
  | MotionEventMessage
  | ButtonEventMessage
  | NfcEventMessage
  | InterruptEventMessage
  | ErrorEventMessage;

/** The `data` shape for one event kind, for example `EventDataFor<"cry">`. */
export type EventDataFor<K extends EventKind> = Extract<EventMessage, { event: K }>["data"];
