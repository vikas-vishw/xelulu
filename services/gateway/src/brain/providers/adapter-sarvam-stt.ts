// Adapter_Scaffold: Sarvam speech-to-text (Req 3.1–3.4, C7).
//
// Declaration only. This module exports its provider id, its Provider_Declaration and a factory
// that refuses, and nothing else. It contains no HTTP call, no WebSocket, no socket, no `fetch`,
// no vendor SDK import, no vendor type and no environment read, because Phase 1.2 Requirement 14.3
// fixes the gateway's runtime dependencies at `@xelulu/shared`, `mqtt` and `ws` and bans the global
// `fetch`, and Phase 3 keeps all of that. Real wiring arrives in a later phase that must amend
// Requirements 14.3 and 14.4 and add `src/brain/transport/` to the transport allowlist.
//
// Recorded data-handling settings (safety.md §1, tech.md "Record the setting in the provider
// adapter"): zero retention and no training. Before this adapter may be used, the vendor's
// account-level "do not retain request data" and "do not train on request data" settings must be
// confirmed in writing, together with the commercial licence and the processing region (F4).
// Until then the Provider_Gate never sees this provider, because the factory hands back no
// provider at all.
import type { ProviderId } from "@xelulu/shared";

import { NO_RETENTION_NO_TRAINING, type DataHandlingDeclaration } from "./provider-declaration.js";

/** The closed-list id a Log_Entry would carry for this adapter. */
export const SARVAM_STT_PROVIDER_ID: ProviderId = "sarvam";

/** The vendor's recorded posture: no retention of request data, no training on it. */
export const SARVAM_STT_DATA_HANDLING: DataHandlingDeclaration = NO_RETENTION_NO_TRAINING;

/**
 * Refuses with `not_configured`. It takes no argument, so it keeps nothing, and it reads no
 * environment variable and opens no socket on any path (Req 3.3).
 */
export function createSarvamStt(): { readonly ok: false; readonly reason: "not_configured" } {
  return { ok: false, reason: "not_configured" };
}
