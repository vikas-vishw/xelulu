// Setup_Flow mock data (Req 19.1, 19.5). Nothing here comes from a network call, an
// environment variable or a device: display labels, enum-like words and one ISO day only. The
// shared domain types are imported as types only (Req 19.2, 22.3).

import type { ChildProfile } from "@xelulu/shared";

import type { IconName } from "../../components/icon";
import type { Step } from "../../components/step-list";
import { MOCK_IDENTITY } from "../../lib/mock-identity";

import { SETUP_STRINGS } from "./strings";

/** One page of screen 2's value carousel. */
export type ValuePage = Readonly<{ key: string; icon: IconName; title: string }>;

export type OnboardingData = Readonly<{ pages: readonly ValuePage[] }>;

export type ChildDraft = Pick<ChildProfile, "display_name" | "date_of_birth"> &
  Readonly<{
    /** Display labels for the language chips, app-local on purpose. `ChildProfile.languages` is
     *  documented in `packages/shared` as BCP-47-like language *tags*, so a real Phase 3 row
     *  holds ["en","hi"] and would render as two two-letter chips. Phase 3 maps tags to labels;
     *  until then the labels are their own field. */
    language_labels: readonly string[];
    /** The chip that renders `selected`, as the Reference draws "English" filled beside an
     *  outlined "Hindi". Must be one of `language_labels`. */
    primary_language: string;
    interest_labels: readonly string[];
    /** The initially selected gender chip, "Boy" as the Reference draws it. Display only:
     *  nothing derives from it and no other payload reads it (Req 8.3). */
    gender_label: string;
  }>;

export const MOCK_ONBOARDING: OnboardingData = {
  pages: [
    { key: "plays", icon: "walk-outline", title: SETUP_STRINGS.onboarding.values.plays },
    {
      key: "talks",
      icon: "chatbubble-ellipses-outline",
      title: SETUP_STRINGS.onboarding.values.talks,
    },
    { key: "teaches", icon: "school-outline", title: SETUP_STRINGS.onboarding.values.teaches },
  ],
};

/** `Step` is the kit type from `step-list.tsx`; the mock does not declare a second shape. */
export const MOCK_PAIR_STEPS: readonly Step[] = [
  { key: "power", title: SETUP_STRINGS.pair.steps.power, icon: "power-outline" },
  { key: "bluetooth", title: SETUP_STRINGS.pair.steps.bluetooth, icon: "bluetooth-outline" },
  { key: "wifi", title: SETUP_STRINGS.pair.steps.wifi, icon: "wifi-outline" },
  { key: "complete", title: SETUP_STRINGS.pair.steps.complete, icon: "checkmark-circle" },
];

export const MOCK_CHILD_DRAFT: ChildDraft = {
  display_name: MOCK_IDENTITY.child,
  date_of_birth: "2020-03-15",
  language_labels: ["English", "Hindi"],
  primary_language: "English",
  interest_labels: ["Animals", "Space", "Dinosaurs"],
  gender_label: SETUP_STRINGS.childProfile.genderOptions[0],
};
