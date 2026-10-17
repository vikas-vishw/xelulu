import type { IsoDateTime } from "./common.js";

/**
 * The consent purposes, as a frozen runtime list with the union derived from it (Phase 4 C36),
 * so a store can test membership against the shared list rather than against a type.
 */
export const CONSENT_PURPOSES = Object.freeze([
  "child_data_processing",
  "grandma_recording",
  "grandma_voice_clone",
] as const);
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** DPDP Rules wording: reliable identity details or a virtual token. */
export const VERIFICATION_METHODS = Object.freeze(["identity_details", "virtual_token"] as const);
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/** A verifiable parental consent record: who, what, when and which notice version. */
export interface Consent {
  /** Referenced by `GrandmaAsset.consent_record_id`. */
  consent_id: string;
  household_id: string;
  /** The consenting parent. */
  user_id: string;
  purpose: ConsentPurpose;
  /** Notice version. */
  version: string;
  verification_method: VerificationMethod;
  given_at: IsoDateTime;
  /** `null` means consent has not been withdrawn. */
  withdrawn_at: IsoDateTime | null;
}
