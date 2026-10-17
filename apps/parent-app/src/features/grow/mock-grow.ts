// Screen 9's presentation maps and its milestone rows (Phase 4 Req 19.4). The four metric values
// and the interest cards come from the reports In_App_Store now — counts out of the shared
// `summariseActivity` (`src/lib/stores/report-store.ts`) — so what stays here is the presentation
// a count cannot carry: an icon, a tone and an illustration.
//
// Nothing here or on the screen scores, ranks, infers or predicts anything about a child (Req
// 19.8, safety.md §2). An interest card names a Content_Category the robot played from; it is
// content metadata, never a trait. No child audio, no transcript and no raw sensor value.

import type { IconName } from "../../components/icon";
import type { IconTileTone } from "../../components/icon-tile";
import type { IllustrationName } from "../../illustrations/illustration";

import { GROW_STRINGS } from "./strings";

export type GrowMetric = Readonly<{
  key: string;
  icon: IconName;
  /** The metric's tile colour, as the Reference draws screen 9's four rows. */
  icon_tone: IconTileTone;
  title: string;
  subtitle: string;
  /** Already-formatted display value, e.g. "+12", counted by the store. */
  value: string;
}>;

export type GrowInterest = Readonly<{
  key: string;
  label: string;
  detail: string;
  illustration: IllustrationName;
}>;

export type GrowMilestone = Readonly<{
  key: string;
  title: string;
  subtitle: string;
  time_label: string;
}>;

/** What the screen still takes as a Mock_Module: the milestone rows the Reference draws. */
export type GrowData = Readonly<{ milestones: readonly GrowMilestone[] }>;

const METRICS = GROW_STRINGS.metrics;
const CATEGORIES = GROW_STRINGS.categories;
const MILESTONES = GROW_STRINGS.milestones;

/** The metric keys, in the Reference's order. */
export type GrowMetricKey = keyof typeof METRICS;

export type GrowMetricPresentation = Readonly<{
  key: GrowMetricKey;
  icon: IconName;
  icon_tone: IconTileTone;
  title: string;
  subtitle: string;
}>;

/** The four Reference metric rows, less the value the store counts. */
export const GROW_METRIC_PRESENTATION: readonly GrowMetricPresentation[] = Object.freeze([
  { key: "language", icon: "heart-outline", icon_tone: "rose", ...METRICS.language },
  { key: "reading", icon: "book-outline", icon_tone: "sky", ...METRICS.reading },
  { key: "curiosity", icon: "bulb-outline", icon_tone: "amber", ...METRICS.curiosity },
  { key: "physicalPlay", icon: "barbell-outline", icon_tone: "mint", ...METRICS.physicalPlay },
]);

/**
 * One label, one line and one illustration per Content_Category, so an interest card renders
 * from a count with no text invented outside `strings.ts` (Req 19.4). A category with no entry
 * here renders no card, the same rule the Play and Routines maps follow.
 */
export const GROW_CATEGORY_PRESENTATION: Readonly<
  Record<string, Readonly<{ label: string; detail: string; illustration: IllustrationName }>>
> = Object.freeze({
  stories: { ...CATEGORIES.stories, illustration: "story-scene" },
  songs: { ...CATEGORIES.songs, illustration: "story-scene" },
  animals: { ...CATEGORIES.animals, illustration: "play-scene" },
  maths: { ...CATEGORIES.maths, illustration: "space-scene" },
  world: { ...CATEGORIES.world, illustration: "space-scene" },
  feelings: { ...CATEGORIES.feelings, illustration: "story-scene" },
  manners: { ...CATEGORIES.manners, illustration: "play-scene" },
  games: { ...CATEGORIES.games, illustration: "play-scene" },
});

export const MOCK_GROW: GrowData = {
  milestones: [
    {
      key: "first-sentence",
      title: MILESTONES.firstSentence.title,
      subtitle: MILESTONES.firstSentence.subtitle,
      time_label: MILESTONES.firstSentence.timeLabel,
    },
    {
      key: "counts-to-twenty",
      title: MILESTONES.countsToTwenty.title,
      subtitle: MILESTONES.countsToTwenty.subtitle,
      time_label: MILESTONES.countsToTwenty.timeLabel,
    },
    {
      key: "please-thank-you",
      title: MILESTONES.pleaseThankYou.title,
      subtitle: MILESTONES.pleaseThankYou.subtitle,
      time_label: MILESTONES.pleaseThankYou.timeLabel,
    },
  ],
};
