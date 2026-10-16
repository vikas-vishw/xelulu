// Screen 9's mock insights (Req 19.1, 19.5). Every number and every time is a static display
// label: no code here or on the screen computes, scores, infers or ranks anything about a
// child (Req 11.6, D14). No child audio, no transcript and no raw sensor value.

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
  /** Already-formatted display value, e.g. "+12". Never computed. */
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

export type GrowData = Readonly<{
  overview: readonly GrowMetric[];
  interests: readonly GrowInterest[];
  milestones: readonly GrowMilestone[];
}>;

const METRICS = GROW_STRINGS.metrics;
const INTERESTS = GROW_STRINGS.interests;
const MILESTONES = GROW_STRINGS.milestones;

export const MOCK_GROW: GrowData = {
  overview: [
    { key: "language", icon: "heart-outline", icon_tone: "rose", ...METRICS.language },
    { key: "reading", icon: "book-outline", icon_tone: "sky", ...METRICS.reading },
    { key: "curiosity", icon: "bulb-outline", icon_tone: "amber", ...METRICS.curiosity },
    {
      key: "physical-play",
      icon: "barbell-outline",
      icon_tone: "mint",
      ...METRICS.physicalPlay,
    },
  ],
  interests: [
    { key: "dinosaurs", illustration: "dino-scene", ...INTERESTS.dinosaurs },
    { key: "animals", illustration: "play-scene", ...INTERESTS.animals },
    { key: "space", illustration: "space-scene", ...INTERESTS.space },
  ],
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
