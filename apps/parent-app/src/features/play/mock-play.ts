// Screen 8's mock content library (Req 19.1, 19.5). Display labels and enum values only: no
// network call, no environment read, no media file and no URL. The shared domain type is
// imported as a type only (Req 19.2, 22.3).

import type { ContentKind } from "@xelulu/shared";

import type { IllustrationName } from "../../illustrations/illustration";

import { PLAY_STRINGS } from "./strings";

/** The three filterable categories; the "All" segment is not a category. */
export type PlayCategory = "games" | "stories" | "learning";

export type PlayItem = Readonly<{
  item_id: string;
  title: string;
  subtitle: string;
  category: PlayCategory;
  /** `story | song | rhyme | lullaby | game`. The union has no learning member, so the three
   *  learning cards take `"game"`: they are played, not read or sung. Carried for Phase 3's
   *  content fetch and never rendered. */
  kind: ContentKind;
  illustration: IllustrationName;
}>;

export type PlayData = Readonly<{ items: readonly PlayItem[] }>;

const ITEMS = PLAY_STRINGS.items;

export const MOCK_PLAY: PlayData = {
  items: [
    {
      item_id: "content_mock_animal_adventure",
      title: ITEMS.animalAdventure.title,
      subtitle: ITEMS.animalAdventure.subtitle,
      category: "games",
      kind: "game",
      illustration: "play-scene",
    },
    {
      item_id: "content_mock_treasure_hunt",
      title: ITEMS.treasureHunt.title,
      subtitle: ITEMS.treasureHunt.subtitle,
      category: "games",
      kind: "game",
      illustration: "play-scene",
    },
    {
      item_id: "content_mock_dance",
      title: ITEMS.dance.title,
      subtitle: ITEMS.dance.subtitle,
      category: "games",
      kind: "song",
      illustration: "play-scene",
    },
    {
      item_id: "content_mock_story_time",
      title: ITEMS.storyTime.title,
      subtitle: ITEMS.storyTime.subtitle,
      category: "stories",
      kind: "story",
      illustration: "story-scene",
    },
    {
      item_id: "content_mock_rhyme_time",
      title: ITEMS.rhymeTime.title,
      subtitle: ITEMS.rhymeTime.subtitle,
      category: "stories",
      kind: "rhyme",
      illustration: "story-scene",
    },
    {
      item_id: "content_mock_counting_fun",
      title: ITEMS.countingFun.title,
      subtitle: ITEMS.countingFun.subtitle,
      category: "learning",
      kind: "game",
      illustration: "play-scene",
    },
    {
      item_id: "content_mock_our_world",
      title: ITEMS.ourWorld.title,
      subtitle: ITEMS.ourWorld.subtitle,
      category: "learning",
      kind: "game",
      illustration: "space-scene",
    },
    {
      item_id: "content_mock_feelings",
      title: ITEMS.feelings.title,
      subtitle: ITEMS.feelings.subtitle,
      category: "learning",
      kind: "game",
      illustration: "story-scene",
    },
  ],
};
