// CONTRACT_FIELD_NAMES (D5, Req 4.5): every field name declared anywhere in the Document B v2
// contract schemas, derived at module load by walking the exported schemas, never restated.
// Zod stays shared-package internal: the services use this list, never `zod` itself (Req 2.3).
import { z } from "zod";

import {
  AckMessageSchema,
  AnimateCmdMessageSchema,
  AudioControlMessageSchema,
  AudioEndMessageSchema,
  AudioStartMessageSchema,
  ButtonEventMessageSchema,
  CmdMessageSchema,
  ConfigCmdMessageSchema,
  CryEventMessageSchema,
  ErrorEventMessageSchema,
  EventMessageSchema,
  GestureCmdMessageSchema,
  HelloMessageSchema,
  InterruptEventMessageSchema,
  LedCmdMessageSchema,
  MotionEventMessageSchema,
  MoveCmdMessageSchema,
  NfcEventMessageSchema,
  OtaCmdMessageSchema,
  PlayCmdMessageSchema,
  SayCmdMessageSchema,
  SetModeCmdMessageSchema,
  StatusMessageSchema,
  StatusTopicMessageSchema,
  StopAudioCmdMessageSchema,
  TouchEventMessageSchema,
  VolumeCmdMessageSchema,
  WakeEventMessageSchema,
} from "../gateway-contract/index.js";

/** The 24 variant schemas and the 4 union schemas exported by the contract. */
const CONTRACT_SCHEMAS: readonly unknown[] = [
  HelloMessageSchema,
  StatusMessageSchema,
  TouchEventMessageSchema,
  WakeEventMessageSchema,
  CryEventMessageSchema,
  MotionEventMessageSchema,
  ButtonEventMessageSchema,
  NfcEventMessageSchema,
  InterruptEventMessageSchema,
  ErrorEventMessageSchema,
  AudioStartMessageSchema,
  AudioEndMessageSchema,
  AckMessageSchema,
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
  StatusTopicMessageSchema,
  EventMessageSchema,
  AudioControlMessageSchema,
  CmdMessageSchema,
];

/**
 * Walks one schema. Objects add their shape keys and recurse into each value; optional and
 * nullable wrappers are unwrapped; unions (including discriminated unions) recurse into each
 * option; arrays recurse into the element. Anything else is a leaf with no names. Refinements
 * stay on the same ZodObject in Zod 4, so refined objects are walked as objects.
 */
function walk(schema: unknown, names: Set<string>): void {
  if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape as Record<string, unknown>)) {
      names.add(key);
      walk(value, names);
    }
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    walk(schema.unwrap(), names);
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options as readonly unknown[]) walk(option, names);
  } else if (schema instanceof z.ZodArray) {
    walk(schema.element, names);
  }
}

function collectFieldNames(schemas: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const schema of schemas) walk(schema, names);
  return names;
}

/** Every field name declared anywhere in the contract's schemas, sorted, frozen. */
export const CONTRACT_FIELD_NAMES: readonly string[] = Object.freeze(
  [...collectFieldNames(CONTRACT_SCHEMAS)].sort(),
);
