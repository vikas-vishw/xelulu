import type { IsoDateTime } from "./common.js";

export type ConsentPurpose = "child_data_processing" | "grandma_recording" | "grandma_voice_clone";

/** DPDP Rules wording: reliable identity details or a virtual token. */
export type VerificationMethod = "identity_details" | "virtual_token";

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
