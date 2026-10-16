// Screen 14's mock privacy data (Req 19.1, 19.5, 19.6, D13). Display labels, counts, enum
// values, dates and consent statements only.
//
// What this module deliberately does not carry: anything the child said, anywhere a file could
// be found, and any raw sensor reading. The `GrandmaAsset` field that points at the stored file
// is not picked (Req 17.9).

import type { GrandmaAsset } from "@xelulu/shared";

import type { IllustrationName } from "../../illustrations/illustration";
import { MOCK_IDENTITY } from "../../lib/mock-identity";

import { PRIVACY_STRINGS } from "./strings";

export type Memory = Readonly<{
  memory_id: string;
  label: string;
  age_label: string;
  illustration: IllustrationName;
}>;

/** Adult-provided content only: the field that locates the stored file is not picked. */
export type RecordingRow = Pick<GrandmaAsset, "asset_id" | "kind" | "title" | "lang"> &
  Readonly<{ recorded_label: string; consent_statement: string }>;

export type PrivacyToggle = Readonly<{
  key: string;
  title: string;
  subtitle: string;
  enabled: boolean;
}>;

export type PrivacyData = Readonly<{
  /** Exactly fifteen, so the row's "15 items" line is true. */
  memories: readonly Memory[];
  /** How many of them the Memory panel shows before "View All Memories". */
  recent_count: number;
  recordings: readonly RecordingRow[];
  toggles: readonly PrivacyToggle[];
}>;

const MEM = PRIVACY_STRINGS.memories;
const TOGGLE = PRIVACY_STRINGS.toggles;
const NOTICE_VERSION = "v1";

export const MOCK_PRIVACY: PrivacyData = {
  memories: [
    {
      memory_id: "memory_mock_1",
      label: MEM.dinosaurs.label(MOCK_IDENTITY.child),
      age_label: MEM.dinosaurs.ageLabel,
      illustration: "dino-scene",
    },
    {
      memory_id: "memory_mock_2",
      label: MEM.hindiStories.label,
      age_label: MEM.hindiStories.ageLabel,
      illustration: "story-scene",
    },
    {
      memory_id: "memory_mock_3",
      label: MEM.space.label,
      age_label: MEM.space.ageLabel,
      illustration: "space-scene",
    },
    {
      memory_id: "memory_mock_4",
      label: MEM.counting.label,
      age_label: MEM.counting.ageLabel,
      illustration: "play-scene",
    },
    {
      memory_id: "memory_mock_5",
      label: MEM.braveElephant.label,
      age_label: MEM.braveElephant.ageLabel,
      illustration: "story-scene",
    },
    {
      memory_id: "memory_mock_6",
      label: MEM.greeting.label,
      age_label: MEM.greeting.ageLabel,
      illustration: "play-scene",
    },
    {
      memory_id: "memory_mock_7",
      label: MEM.moon.label,
      age_label: MEM.moon.ageLabel,
      illustration: "space-scene",
    },
    {
      memory_id: "memory_mock_8",
      label: MEM.nickname.label(MOCK_IDENTITY.device),
      age_label: MEM.nickname.ageLabel,
      illustration: "person-figure",
    },
    {
      memory_id: "memory_mock_9",
      label: MEM.freezeDance.label,
      age_label: MEM.freezeDance.ageLabel,
      illustration: "play-scene",
    },
    {
      memory_id: "memory_mock_10",
      label: MEM.sharing.label(MOCK_IDENTITY.secondChild),
      age_label: MEM.sharing.ageLabel,
      illustration: "person-figure",
    },
    {
      memory_id: "memory_mock_11",
      label: MEM.animalNames.label,
      age_label: MEM.animalNames.ageLabel,
      illustration: "dino-scene",
    },
    {
      memory_id: "memory_mock_12",
      label: MEM.hindiRhymes.label,
      age_label: MEM.hindiRhymes.ageLabel,
      illustration: "story-scene",
    },
    {
      memory_id: "memory_mock_13",
      label: MEM.brushing.label,
      age_label: MEM.brushing.ageLabel,
      illustration: "play-scene",
    },
    {
      memory_id: "memory_mock_14",
      label: MEM.bedtimeWave.label,
      age_label: MEM.bedtimeWave.ageLabel,
      illustration: "person-figure",
    },
    {
      memory_id: "memory_mock_15",
      label: MEM.rain.label,
      age_label: MEM.rain.ageLabel,
      illustration: "space-scene",
    },
  ],
  recent_count: 3,
  recordings: [
    {
      asset_id: "asset_mock_1",
      kind: "story",
      title: "The Brave Elephant",
      lang: "hi",
      recorded_label: PRIVACY_STRINGS.recordedBy(MOCK_IDENTITY.grandparent, "12 Jan 2026"),
      consent_statement: PRIVACY_STRINGS.consentStatement(
        MOCK_IDENTITY.parent,
        "12 Jan 2026",
        NOTICE_VERSION,
      ),
    },
    {
      asset_id: "asset_mock_2",
      kind: "rhyme",
      title: "Chanda Mama",
      lang: "hi",
      recorded_label: PRIVACY_STRINGS.recordedBy(MOCK_IDENTITY.grandparent, "14 Jan 2026"),
      consent_statement: PRIVACY_STRINGS.consentStatement(
        MOCK_IDENTITY.parent,
        "14 Jan 2026",
        NOTICE_VERSION,
      ),
    },
    {
      asset_id: "asset_mock_3",
      kind: "lullaby",
      title: "Sleepy Little Star",
      lang: "en",
      recorded_label: PRIVACY_STRINGS.recordedBy(MOCK_IDENTITY.grandparent, "20 Jan 2026"),
      consent_statement: PRIVACY_STRINGS.consentStatement(
        MOCK_IDENTITY.parent,
        "20 Jan 2026",
        NOTICE_VERSION,
      ),
    },
  ],
  toggles: [
    {
      key: "text-records",
      title: TOGGLE.textRecords.title,
      subtitle: TOGGLE.textRecords.subtitle,
      enabled: true,
    },
    {
      key: "cry-alerts",
      title: TOGGLE.cryAlerts.title,
      subtitle: TOGGLE.cryAlerts.subtitle,
      enabled: true,
    },
    {
      key: "weekly-reports",
      title: TOGGLE.weeklyReports.title,
      subtitle: TOGGLE.weeklyReports.subtitle,
      enabled: true,
    },
    {
      key: "memory",
      title: TOGGLE.memory.title,
      subtitle: TOGGLE.memory.subtitle,
      enabled: true,
    },
  ],
};
