// Adapter_Scaffold: ElevenLabs text-to-speech (Req 3.1–3.4, C7).
//
// Declaration only. This module exports its provider id, its Provider_Declaration and a factory
// that refuses, and nothing else. It contains no HTTP call, no WebSocket, no socket, no `fetch`,
// no vendor SDK import, no vendor type and no environment read, for the reasons given in
// `adapter-sarvam-stt.ts`.
//
// Recorded data-handling settings (safety.md §1): zero retention and no training. Before this
// adapter may be used, the vendor's zero-retention mode must be confirmed in writing on the plan
// we actually buy, together with the commercial licence and the voice licence (F4). No voice
// cloning happens in this phase (C20): the Grandma voice is a later phase with its own consent
// record and its own licence gate.
import type { ProviderId } from "@xelulu/shared";

import { NO_RETENTION_NO_TRAINING, type DataHandlingDeclaration } from "./provider-declaration.js";

/** The closed-list id a Log_Entry would carry for this adapter. */
export const ELEVENLABS_TTS_PROVIDER_ID: ProviderId = "elevenlabs";

/** The vendor's recorded posture: no retention of request data, no training on it. */
export const ELEVENLABS_TTS_DATA_HANDLING: DataHandlingDeclaration = NO_RETENTION_NO_TRAINING;

/**
 * Refuses with `not_configured`. It takes no argument, so it keeps nothing, and it reads no
 * environment variable and opens no socket on any path (Req 3.3).
 */
export function createElevenLabsTts(): { readonly ok: false; readonly reason: "not_configured" } {
  return { ok: false, reason: "not_configured" };
}
