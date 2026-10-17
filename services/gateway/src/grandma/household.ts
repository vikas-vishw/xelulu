// The household and the user of this phase (Phase 4 C34, Req 7.9, 7.9a): two in-process
// constants and one total function, and deliberately nothing more.
//
// Phase 4 has one registered device, no backend and no user model, so the household is a single
// constant rather than a row. Phase 5 replaces this with the Supabase binding under RLS, where a
// `device_id` is bound to exactly one `household_id` (tech.md).
//
// Read in the Gateway as it stands: `Registry` exposes per-device predicates only and holds no
// household, `createRegistry` takes one `{ deviceId, token }`, nothing else under
// `services/gateway/src` mentions a household, and `.env.example` is frozen at 23 keys. Putting a
// household on the Registry was rejected for blast radius — the interface, `createRegistry`,
// `registry.test.ts` and the composition root — all to carry one constant.
import type { Registry } from "../devices/registry.js";

/** The one household of this phase. Every household-scoped row is resolved to it. */
export const DEV_HOUSEHOLD_ID = "hh_dev_1";

/**
 * The one user id of this phase (Req 7.9a). Every `recorded_by_user_id`, every
 * `requested_by_user_id` and every Consent_Record `user_id` comes from here, bound in the
 * composition root and NEVER read from a request body: a loopback write that can name a user can
 * attribute an adult's consent, a recording or a call to an arbitrary id, which is the same
 * cross-tenant write surface C34 rejected for the household. Phase 5 replaces it with the real
 * user under RLS.
 */
export const DEV_USER_ID = "user_dev_1";

/**
 * The household for a device: the constant for a registered device, null for anything else.
 * Total, and the only source of a `household_id` in this phase (Req 7.9).
 */
export function householdForDevice(deviceId: string, registry: Registry): string | null {
  return registry.isRegistered(deviceId) ? DEV_HOUSEHOLD_ID : null;
}
