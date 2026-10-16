// Adapter_Scaffold: a vendor-neutral hosted LLM with function calling (Req 3.1–3.4, C7, F1).
//
// Declaration only. This module exports its provider id, its Provider_Declaration and a factory
// that refuses, and nothing else. It contains no HTTP call, no WebSocket, no socket, no `fetch`,
// no vendor SDK import, no vendor type and no environment read, for the reasons given in
// `adapter-sarvam-stt.ts`.
//
// The vendor is deliberately unnamed: tech.md asks for "a hosted model with function calling" and
// names nobody, so the choice, its region, its zero-retention contract terms and its
// function-calling dialect are Omar's ruling F1. The provider id is `hosted_llm` so no vendor
// string can leak into a Log_Entry before that ruling.
//
// Recorded data-handling settings (safety.md §1): zero retention and no training. Before this
// adapter may be used, the vendor's zero-retention and no-training terms must be confirmed in
// writing for the exact endpoint and plan, together with the commercial licence and the
// processing region (F4). Whatever the vendor, the tool allow-list stays ours: a provider may ask
// for anything and the Tool_Router executes only the five Allow_Listed_Tools, with no browsing, no
// search, no URL fetching and no code execution (safety.md §3).
import type { ProviderId } from "@xelulu/shared";

import { NO_RETENTION_NO_TRAINING, type DataHandlingDeclaration } from "./provider-declaration.js";

/** The closed-list id a Log_Entry would carry for this adapter. */
export const HOSTED_LLM_PROVIDER_ID: ProviderId = "hosted_llm";

/** The vendor's recorded posture: no retention of request data, no training on it. */
export const HOSTED_LLM_DATA_HANDLING: DataHandlingDeclaration = NO_RETENTION_NO_TRAINING;

/**
 * Refuses with `not_configured`. It takes no argument, so it keeps nothing, and it reads no
 * environment variable and opens no socket on any path (Req 3.3).
 */
export function createHostedLlm(): { readonly ok: false; readonly reason: "not_configured" } {
  return { ok: false, reason: "not_configured" };
}
