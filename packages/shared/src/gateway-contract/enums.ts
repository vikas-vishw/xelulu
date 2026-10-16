// Document B v2 closed lists and open vocabularies. Requirements 1.2, 7.6 and 9.1–9.4.
// Every list is a frozen readonly tuple: element assignment is a compile error and,
// at runtime in strict-mode ESM, throws without changing the contents.

// Closed lists (C4): the schemas accept exactly these values, case-sensitive.

export const TOUCH_ZONES = Object.freeze([
  "head",
  "left_ear",
  "right_ear",
  "belly",
  "back",
  "left_hand",
  "right_hand",
] as const);
export type TouchZone = (typeof TOUCH_ZONES)[number];

export const TOUCH_GESTURES = Object.freeze(["tap", "double_tap", "hold", "pat"] as const);
export type TouchGesture = (typeof TOUCH_GESTURES)[number];

export const WAKE_SOURCES = Object.freeze(["hey_lulu", "touch"] as const);
export type WakeSource = (typeof WAKE_SOURCES)[number];

export const MOTION_KINDS = Object.freeze([
  "pickup",
  "shake",
  "upside_down",
  "drop",
  "tilt",
] as const);
export type MotionKind = (typeof MOTION_KINDS)[number];

export const BUTTONS = Object.freeze(["belly_talk"] as const);
export type ButtonName = (typeof BUTTONS)[number];

export const BUTTON_ACTIONS = Object.freeze(["press", "release"] as const);
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

/** Shared by `status.mode` and the `set_mode` command (C17). */
export const MODES = Object.freeze(["idle", "play", "story", "quiet", "sleep"] as const);
export type Mode = (typeof MODES)[number];

export const MOVE_COMMANDS = Object.freeze(["come", "stop", "turn"] as const);
export type MoveCommand = (typeof MOVE_COMMANDS)[number];

export const PLAY_SOURCES = Object.freeze(["stream", "cache"] as const);
export type PlaySource = (typeof PLAY_SOURCES)[number];

export const LED_TARGETS = Object.freeze(["ears", "cheeks", "belly"] as const);
export type LedTarget = (typeof LED_TARGETS)[number];

/** Listed as in Document B. The flash-rate limit (safety.md §6) is enforced in firmware. */
export const LED_EFFECTS = Object.freeze(["solid", "pulse", "rainbow"] as const);
export type LedEffect = (typeof LED_EFFECTS)[number];

export const SAY_VOICES = Object.freeze(["xelulu", "grandma"] as const);
export type SayVoice = (typeof SAY_VOICES)[number];

export const ACK_STATUSES = Object.freeze(["accepted", "done", "rejected", "failed"] as const);
export type AckStatus = (typeof ACK_STATUSES)[number];

/** The hardware's truth: the cloud accepts these and never retries around them. */
export const ACK_REASONS = Object.freeze([
  "picked_up",
  "at_edge",
  "charging",
  "quiet_hours",
  "low_battery",
  "unsafe",
  "busy",
  "unknown_action",
] as const);
export type AckReason = (typeof ACK_REASONS)[number];

export const EVENT_KINDS = Object.freeze([
  "touch",
  "wake",
  "cry",
  "motion",
  "button",
  "nfc",
  "interrupt",
  "error",
] as const);
export type EventKind = (typeof EVENT_KINDS)[number];

export const CMD_ACTIONS = Object.freeze([
  "say",
  "animate",
  "gesture",
  "move",
  "play",
  "set_mode",
  "led",
  "volume",
  "config",
  "stop_audio",
  "ota",
] as const);
export type CmdAction = (typeof CMD_ACTIONS)[number];

// Open vocabularies (C4): the fields accept any non-empty string; these are the known values.

/** Known values for animate and say `expression`. */
export const KNOWN_EXPRESSIONS = Object.freeze([
  "happy",
  "love",
  "sleepy",
  "curious",
  "sad",
  "listening",
] as const);

/** Known values for animate `eyes`. */
export const KNOWN_EYES = Object.freeze(["blink", "hearts"] as const);

/** Known values for gesture `name`. */
export const KNOWN_GESTURE_NAMES = Object.freeze([
  "wave",
  "high_five",
  "hug",
  "clap",
  "point_left",
  "nod",
  "shake",
] as const);
