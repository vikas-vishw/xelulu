// The Provider_Gate (Req 1.3, 1.5): the Safety_Layer's accept/refuse decision on a provider's
// Provider_Declaration. A provider is accepted only when it declares no retention and no
// training (safety.md §1); anything else is refused, whatever the vendor or the capability.
// Each check adds exactly one `provider_check` Log_Entry carrying the capability, the provider id
// from the closed list, the two declared booleans and the outcome, and no other value.
import type { ProviderCapability, ProviderId } from "@xelulu/shared";

import type { GatewayLog } from "../../log/gateway-log.js";
import type { DataHandlingDeclaration } from "./provider-declaration.js";
import type { LlmProvider } from "./llm-provider.js";
import type { SttProvider } from "./stt-provider.js";
import type { TtsProvider } from "./tts-provider.js";

export type GateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly capability: ProviderCapability; readonly provider: ProviderId };

/** The least a capability's provider must expose to be checked: its id and its declaration. */
export type CheckableProvider = Readonly<{
  id: ProviderId;
  dataHandling: DataHandlingDeclaration;
}>;

export type ProviderGateDeps = Readonly<{ log: Pick<GatewayLog, "add"> }>;

/** Accepts exactly a declaration of no retention and no training (safety.md §1, Req 1.3). */
export function checkProvider(
  capability: ProviderCapability,
  provider: CheckableProvider,
): GateResult {
  const { vendorRetainsRequestData: retains, vendorMayTrainOnRequestData: trains } =
    provider.dataHandling;
  return retains || trains ? { ok: false, capability, provider: provider.id } : { ok: true };
}

/** Checks one capability and adds its `provider_check` entry (Req 1.3, 1.5). */
function checkAndLog(
  deps: ProviderGateDeps,
  capability: ProviderCapability,
  provider: CheckableProvider,
): GateResult {
  const result = checkProvider(capability, provider);
  deps.log.add({
    kind: "provider_check",
    capability,
    provider: provider.id,
    retains: provider.dataHandling.vendorRetainsRequestData,
    trains: provider.dataHandling.vendorMayTrainOnRequestData,
    outcome: result.ok ? "accepted" : "refused",
  });
  return result;
}

/**
 * Checks all three and logs one `provider_check` entry each, in capability order, so the log shows
 * every declaration even when an earlier one is refused. The first refusal is returned (Req 1.4).
 */
export function checkProviders(
  deps: ProviderGateDeps,
  providers: Readonly<{ stt: SttProvider; llm: LlmProvider; tts: TtsProvider }>,
): GateResult {
  const checks: readonly (readonly [ProviderCapability, CheckableProvider])[] = [
    ["stt", providers.stt],
    ["llm", providers.llm],
    ["tts", providers.tts],
  ];
  let refusal: GateResult | null = null;
  for (const [capability, provider] of checks) {
    const result = checkAndLog(deps, capability, provider);
    if (!result.ok && refusal === null) refusal = result;
  }
  return refusal ?? { ok: true };
}
