// Public surface of the shared domain model (Requirements 14.1, 14.3, 15, 16).
// Explicit named exports only.

export { AGE_STAGES, deriveAgeStage } from "./age-stage.js";
export type { AgeStage, AgeStageError, AgeStageResult } from "./age-stage.js";

export { DEFAULT_TRANSCRIPT_RETENTION_DAYS } from "./retention.js";

export { SUPPORTED_LANGS } from "./language.js";
export type { SupportedLang } from "./language.js";

export type { IsoDate, IsoDateTime } from "./common.js";

export type { Household } from "./household.js";
export type { User, UserRole } from "./user.js";
export type { ChildProfile } from "./child-profile.js";
export type { Device } from "./device.js";
export type { Session, TranscriptSpeaker, TranscriptTurn } from "./session.js";
export type { Event } from "./event.js";

export {
  CONTENT_CATEGORIES,
  CONTENT_KINDS,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  contentRowClass,
} from "./content-item.js";
export type {
  ContentCategory,
  ContentChoice,
  ContentItem,
  ContentItemBase,
  ContentKind,
  ContentRowClass,
  ContentSource,
  ContentStatus,
  ContentStep,
  GlobalContentItem,
  HouseholdContentItem,
  LocalisedText,
} from "./content-item.js";

export { ACTIVITY_KINDS, CHARGE_THRESHOLDS } from "./activity.js";
export type { ActivityKind, ActivityRecord } from "./activity.js";

export { REPORT_PERIODS, reportWindow, summariseActivity } from "./report-summary.js";
export type { ReportSummary, ReportWindow } from "./report-summary.js";

export { GRANDMA_ASSET_KINDS } from "./grandma-asset.js";
export type { GrandmaAsset, GrandmaAssetKind } from "./grandma-asset.js";
export { CONSENT_PURPOSES, VERIFICATION_METHODS } from "./consent.js";
export type { Consent, ConsentPurpose, VerificationMethod } from "./consent.js";
export type { Report, ReportPeriod } from "./report.js";
