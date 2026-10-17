// The Consent_Store (Phase 4 Req 6): the shape of a consent record — who, what, when, which
// notice version, and how the adult was verified — held in memory and nothing else.
//
// WHAT THIS IS NOT (Req 6.7, F7). A record captured from an internal loopback console is **not**
// verifiable parental consent under the DPDP Act. safety.md §2 asks for verifiable consent from
// an identifiable adult parent, a plain-language notice, withdrawal as easy as giving, and
// erasure on withdrawal. What this module records is the record's SHAPE, against a single
// in-process dev user id, on an unauthenticated surface with no parent, no identity and no
// notice. Real verifiable consent arrives in Phase 5 with the backend, the role model and the
// parent app, and no comment, label or report sentence in this phase may read otherwise.
//
// Two rules carry the rest:
//
//  - A withdrawal KEEPS the record and sets `withdrawn_at`, so withdrawal is auditable (Req 6.3),
//    and every permission check treats a withdrawn record as absent (Req 6.5).
//  - There is no name, no contact detail and no identity document here (Req 6.4). `user_id` and
//    `household_id` are opaque ids, and nothing else about a person is stored.
//
// This module writes NO Log_Entry, and that is a decision rather than an omission: `GRANDMA_EVENTS`
// carries no consent event, so there is no closed enum a consent write could be logged under, and
// the recordings a withdrawal affects are logged by the Grandma_Store's `onConsentWithdrawn`
// instead. Inventing a log kind for it would be a Document-B-adjacent change this phase does not
// need.
import {
  CONSENT_PURPOSES,
  VERIFICATION_METHODS,
  type Consent,
  type ConsentPurpose,
  type VerificationMethod,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { IdSource } from "../ids.js";

/** The library's capacity. A record past it is refused rather than evicting an existing one. */
export const CONSENT_MAX_RECORDS = 200;

export const CONSENT_MAX_VERSION_CODE_POINTS = 40;

/** Every id this store issues carries this prefix, so a log line reads as a consent id. */
export const CONSENT_ID_PREFIX = "cns_";

/**
 * What a caller may submit. The `household_id` comes from `householdForDevice` and the `user_id`
 * from `DEV_USER_ID`; a request body naming either is refused by the route before this is built
 * (Req 7.9, 7.9a).
 */
export type ConsentInput = Readonly<{
  /** Generated when absent. */
  consent_id?: string;
  household_id: string;
  user_id: string;
  purpose: ConsentPurpose;
  version: string;
  verification_method: VerificationMethod;
}>;

export type ConsentRecordResult =
  | { readonly ok: true; readonly consent: Consent }
  /** The dotted field path. NEVER the submitted value (Req 6.2). */
  | { readonly ok: false; readonly field: string };

export interface ConsentStore {
  list(householdId: string): readonly Consent[];
  get(consentId: string): Consent | null;
  record(input: ConsentInput): ConsentRecordResult;
  /** True when the record existed and was not already withdrawn. Keeps the record (Req 6.3). */
  withdraw(consentId: string, atIso: string): boolean;
  /** True only for an existing, matching, non-withdrawn record (Req 6.5, C14). */
  isLiveFor(consentId: string, householdId: string, purpose: ConsentPurpose): boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function memberOf(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

export function createConsentStore(deps: Readonly<{ clock: Clock; ids: IdSource }>): ConsentStore {
  const rows = new Map<string, Consent>();

  return {
    list(householdId) {
      return [...rows.values()]
        .filter((row) => row.household_id === householdId)
        .sort((a, b) =>
          a.given_at === b.given_at
            ? a.consent_id < b.consent_id
              ? -1
              : 1
            : a.given_at < b.given_at
              ? -1
              : 1,
        );
    },

    get: (consentId) => rows.get(consentId) ?? null,

    record(input) {
      // Field rules first, in a fixed order, naming the path and echoing nothing (Req 6.2).
      if (!isNonEmptyString(input.household_id)) return { ok: false, field: "household_id" };
      if (!isNonEmptyString(input.user_id)) return { ok: false, field: "user_id" };
      if (!memberOf(CONSENT_PURPOSES, input.purpose)) return { ok: false, field: "purpose" };
      if (!isNonEmptyString(input.version)) return { ok: false, field: "version" };
      if ([...input.version].length > CONSENT_MAX_VERSION_CODE_POINTS) {
        return { ok: false, field: "version" };
      }
      if (!memberOf(VERIFICATION_METHODS, input.verification_method)) {
        return { ok: false, field: "verification_method" };
      }
      if (input.consent_id !== undefined && !isNonEmptyString(input.consent_id)) {
        return { ok: false, field: "consent_id" };
      }
      if (input.consent_id !== undefined && rows.has(input.consent_id)) {
        return { ok: false, field: "consent_id" };
      }
      if (rows.size >= CONSENT_MAX_RECORDS) return { ok: false, field: "consent_id" };

      const consent: Consent = Object.freeze({
        consent_id: input.consent_id ?? CONSENT_ID_PREFIX + deps.ids.next(""),
        household_id: input.household_id,
        user_id: input.user_id,
        purpose: input.purpose,
        version: input.version,
        verification_method: input.verification_method,
        given_at: isoAt(deps.clock.now()),
        withdrawn_at: null,
      });
      rows.set(consent.consent_id, consent);
      return { ok: true, consent };
    },

    withdraw(consentId, atIso) {
      const row = rows.get(consentId);
      if (row === undefined || row.withdrawn_at !== null) return false;
      // The record stays; only `withdrawn_at` moves, so a withdrawal is auditable (Req 6.3).
      rows.set(consentId, Object.freeze({ ...row, withdrawn_at: atIso }));
      return true;
    },

    isLiveFor(consentId, householdId, purpose) {
      const row = rows.get(consentId);
      if (row === undefined) return false;
      return (
        row.household_id === householdId && row.purpose === purpose && row.withdrawn_at === null
      );
    },
  };
}
