# Requirements Document

## Introduction

Phase 2.1 gives the parent app (`apps/parent-app`) its design system, its navigation shell and one fully built reference screen, the Home Dashboard (screen 6 of the Reference). Everything runs on mock data in Expo Go. The app makes no backend call.

The design system is a single token source plus a small component kit (cards, buttons, toggles, list rows, status pills, segmented tabs, tab bar) that the later screens will reuse. The navigation shell has the 5 bottom tabs and every stack route from the Reference. Every screen except Home is a titled placeholder.

Nothing changes in Document B, `packages/shared`, the gateway, the simulator, the admin console, `.env.example` or `docs/`.

### Out of scope

- Building any screen other than Home (screens 1–5 and 7–16 get placeholder routes only).
- Rive, Lottie, any animation, and the Expo dev build.
- Supabase, auth, real device data, and any network request.
- Dark mode.
- Translation. Strings are English but kept in one module per feature, so `src/lib/i18n` can be added later.

### Choices made

These choices were settled with Omar before this spec. Items marked FLAG change a steering rule or a prior-phase decision, or add a dependency. Approving this spec approves them as written.

- **C1. FLAG: the Reference.** Omar names `docs/design/Xelulu Parent App UX Flow-4.png` (16 screens) as the frozen Reference. `product.md` still names a "frozen 21-screen UI contract (`docs/design/parent-app-uiux-flow.png`)", and that file does not exist. This spec follows Omar. It proposes this one-line steering update for Omar to approve, and does not make it: in `product.md` "How we work", replace "the full parent app exactly as the frozen 21-screen UI contract (`docs/design/parent-app-uiux-flow.png`)" with "the full parent app exactly as the frozen 16-screen UI reference (`docs/design/Xelulu Parent App UX Flow-4.png`)". The board labels two screens "13". Grandma Mode and Privacy & Memory are different screens.
- **C2. Character (Omar's choice).** An original static vector placeholder drawn in the repo with `react-native-svg`: a cream rounded body, a dark face panel, two warm eyes drawn as soft arcs, and two bunny ears. It has no animation and no flashing. It lives at `src/character/character-placeholder.tsx`, with props `size` and `accessibilityLabel`, so Rive can replace it later behind the same props. Licence: original work, owned by Xelulu. The licence is recorded in a comment in the file and in the asset licence list.
- **C3. Fonts.** The platform system font (SF Pro on iOS, Roboto on Android), so there is no font dependency. Sizes, line heights and weights are tokens.
- **C4. Icons.** `@expo/vector-icons` Ionicons, which is bundled with Expo Go. Tabs use outline/filled pairs. The sun, moon and smiling-face glyphs come from the same set, not from emoji.
- **C5. FLAG: new dependencies.** Dependencies `react-native-svg` and `@expo/vector-icons`, plus `@xelulu/shared` (`workspace:*`) for type-only imports of domain types. DevDependencies `jest-expo`, `jest`, `@testing-library/react-native` and `@jest/globals`. Each is pinned to the exact Expo SDK 57-compatible version: `react-native-svg` 15.15.4 and `jest-expo` 57.0.x per Expo's `bundledNativeModules.json`, with the rest resolved at implementation. The parent app gains its first workspace edge (`@xelulu/parent-app -> @xelulu/shared`), which `structure.md` allows.
- **C6. Styling and the single token source.** NativeWind 4.2.7, already present. `src/theme/tokens.json` is the only place a colour or other raw design value is written. `tailwind.config.js` requires it. `src/theme/theme.ts` re-exports it with types for components that need raw values (icon colours, Switch track colours, SVG fills, shadows). Tailwind's default colour palette is replaced, not extended, so a non-token colour class does not exist. A Repo_Check fails on any colour literal outside `tokens.json`.
- **C7. Tokens.** Colours, a typography scale (display, title, heading, stat, body, label, caption), a 4-pt spacing scale, radii (sm 8, md 12, lg 14, xl 16, pill), one soft shadow, and a 44-pt minimum touch size. The design gives every hex value, matched to the Reference, and every contrast pair with its ratio.
- **C8. FLAG: accessibility over pixel-closeness.** The look follows the Reference, but its light-grey secondary and muted text is darkened so that body text meets 4.5:1, and large text, icons and control boundaries meet 3:1, on cream, white and beige. Status is never shown by colour alone. Touch targets are at least 44×44 pt. Every control has an accessibility role and label, and tab items expose their selected state. Font scaling stays on everywhere. `maxFontSizeMultiplier` (1.5) is allowed only in the quick-action tile, the stat tile and the tab bar.
- **C9. FLAG: light theme only.** The Phase 0 dark-mode palette and every `dark:` class are removed, and `app.json` sets `userInterfaceStyle` to `light`. The Phase 0 tooling checks that expected the placeholder screen, the dark palette or the README placeholder row are updated. The superseded items are listed below.
- **C10. Routes.** Expo Router, kebab-case files, typed routes stay off (as in Phase 0):
  - `app/_layout.tsx`: the root Stack with every header hidden. Screens draw their own header.
  - `app/index.tsx`: redirects to `/home`.
  - `app/(tabs)/_layout.tsx`: Tabs with the kit's Tab_Bar. Routes `home.tsx` (built), `play.tsx`, `grow.tsx`, `routines.tsx`, `family.tsx`.
  - `app/(onboarding)/onboarding.tsx`, `auth.tsx`, `pair-device.tsx`, `child-profile.tsx`.
  - `app/settings.tsx`, `device.tsx`, `privacy.tsx`, `notifications.tsx`, `voice-call.tsx`.
  - Placeholder titles: Play, Grow, Routines, Family, Welcome, Create account, Pair Xelulu, Child profile, Settings, Xelulu device, Privacy & Memory, Notifications, Live with Xelulu. Each placeholder shows one muted line, "Coming in a later phase". Stack placeholders have a back control.
  - Voice call: when built, the screen is audio and status only, with no video and no camera. Device: when built, the screen has no "Camera (Privacy)" row (`product.md` v1 facts). Both notes are recorded in the code.
- **C11. Reaching routes.** On Home, the gear opens `/settings` and the robot card opens `/device`. The quick actions open the Play tab, the Routines tab, `/voice-call` and `/settings`. The other stack routes are reached by deep link (the README explains how to append `/--/<route>` to the `exp://` URL that Expo prints) and are proven by router tests. There is no "all screens" menu. The "Today with Xelulu" tiles and the "Last Activity" card are not pressable in this phase, because the Reference has no target screen for them yet.
- **C12. Greeting and mock data.** The time of day comes from an injectable clock: 05:00–11:59 "Good morning", 12:00–16:59 "Good afternoon", otherwise "Good evening". The glyph is a sun in the morning; the afternoon partly-sunny glyph and the evening moon glyph are minor additions. All Home values come from the typed module `src/features/home/mock-home.ts`, which uses `Pick`s of the shared `User`, `ChildProfile` and `Device` types. Battery, online state, today counts and last activity are app-local types. No shared type changes.
- **C13. FLAG: DPDP s.9.** The "Great Mood" tile appears as in the Reference, but only from static mock data. No mood inference exists or is implied. Legal review of reports and alerts against s.9 is pending (`safety.md`). It stays an open item for whatever real data source later feeds this tile.
- **C14. No backend.** The parent app makes no network request, imports no Supabase, MQTT or WebSocket client and reads no environment variable in this phase. A Repo_Check enforces this.
- **C15. No animation.** The UI is static: no Reanimated, Moti or `Animated` usage, and nothing flashes. A pressed state is a colour or opacity change only.
- **C16. FLAG (with C5): app tests.** jest-expo and React Native Testing Library, in `apps/parent-app/test/`. Tests are smoke and key-interaction only, all example-based (no fast-check). The parent app gains `"test": "jest"`, and the root `test` script appends `pnpm --filter @xelulu/parent-app test` after `vitest run`. Vitest's include list does not cover the app. The CI workflow file is unchanged, but its `pnpm test` step now also runs the app's Jest suite on all three OSes.
- **C17. Docs.** `apps/parent-app/docs/design-system.md` documents every token (name, value, use, contrast pair), every kit component (props, when to use it) and the asset licence list. The README `pnpm start:app` row and the Expo Go line are updated, and a deep-link note is added.
- **C18. FLAG: Expo Go stays in Phase 2.1.** Phase 0 (C4, C17, Req 4.2), the README and `tech.md` say the app moves to an Expo dev build "from Phase 2" for Rive. Phase 2.1 has no Rive (C2), so it stays on Expo Go. The dev build arrives with Rive in a later Phase 2 step.
- **C19. Manual phone checklist.** Omar runs it in Expo Go. The agent does not run it (design, "Manual phone checklist").

### Superseded prior items

- Phase 0 **Req 4.4** (exactly one route, `/`): replaced by Requirement 4.
- Phase 0 **Req 4.5** (exactly two text elements, including "Phase 0 placeholder"): removed. The placeholder screen is gone.
- Phase 0 **Req 4.6** (font scaling on every text element): kept, except the `maxFontSizeMultiplier` cap of C8 on three named components.
- Phase 0 **Req 4.7** (every text element at least 16 pt, and 4.5:1 in light and dark): replaced by Requirements 1.5 and 1.6 (a 12-pt minimum token, listed contrast pairs, light only).
- Phase 0 **Req 14.8** parent app row ("Expo Go shows the Placeholder_Screen"): replaced by Requirement 9.3.
- Phase 0 **C4 / C17 / Req 4.2** wording "from Phase 2 ... Expo dev build": deferred by C18.
- Repo_Checks: `layout.test.ts` "app holds only `_layout.tsx` and `index.tsx`"; the `placeholder.test.ts` "parent app" block; the parent-app palette in `contrast.test.ts`; the `readme.test.ts` start:app row; the `manifests.test.ts` workspace-edge list. Each is replaced as Requirement 10 states.

## Glossary

- **Parent_App**: the Expo app in `apps/parent-app`.
- **Reference**: `docs/design/Xelulu Parent App UX Flow-4.png`. "Screen N" means the screen numbered N on it.
- **Token_Source**: `apps/parent-app/src/theme/tokens.json`.
- **Theme_Module**: `apps/parent-app/src/theme/theme.ts`, the typed re-export of the Token_Source.
- **Component_Kit**: the reusable components in `apps/parent-app/src/components/`.
- **Tab_Bar**: the kit's bottom tab bar component.
- **Tab_Route**: one of `/home`, `/play`, `/grow`, `/routines`, `/family`.
- **Stack_Route**: one of `/onboarding`, `/auth`, `/pair-device`, `/child-profile`, `/settings`, `/device`, `/privacy`, `/notifications`, `/voice-call`.
- **Placeholder_Screen**: the kit screen with a title, the line "Coming in a later phase" and, on a Stack_Route, a back control.
- **Home_Dashboard**: the built screen at `/home`.
- **Mock_Home_Data**: the typed module `src/features/home/mock-home.ts`.
- **Clock**: a function returning the current `Date`, injected into the Home_Dashboard.
- **Character_Placeholder**: `src/character/character-placeholder.tsx`.
- **Contrast_Pair**: an entry in the Token_Source naming a foreground token, a background token, a minimum ratio and a use.
- **Dense_Component**: the quick-action tile, the stat tile or the Tab_Bar.
- **App_Test_Suite**: the Jest tests in `apps/parent-app/test/`.
- **Repo_Check**: a Vitest test under `tooling/test/`.
- **Design_System_Doc**: `apps/parent-app/docs/design-system.md`.

## Requirements

### Requirement 1: Design tokens

**User Story:** As the implementation engineer, I want one token source, so that every later screen matches the Reference without copying values.

#### Acceptance Criteria

1. THE Token_Source SHALL define the colour, typography, spacing, radius, shadow, touch-size and Contrast_Pair tokens listed in the design, with the design's values.
2. THE `tailwind.config.js` SHALL take its colours, font sizes, spacing and radii from the Token_Source, replacing Tailwind's default colour palette, and SHALL contain no colour literal.
3. THE Theme_Module SHALL re-export the Token_Source with TypeScript types, and components SHALL read raw values (icon colours, Switch colours, SVG fills, shadow) only from the Theme_Module.
4. THE Parent_App source under `app/` and `src/`, and its config files, SHALL contain no hex, `rgb(`, `rgba(`, `hsl(` or `hsla(` colour literal outside the Token_Source.
5. THE Token_Source SHALL give every typography token a size of at least 12 pt.
6. THE Token_Source SHALL list a Contrast_Pair for every text, icon and control-boundary colour on every background it is used on, and every listed pair SHALL meet its minimum: 4.5:1 for text below the large-text size, and 3:1 for large text, icons and control boundaries.
7. THE Parent_App SHALL use the light theme only: `app.json` SHALL set `userInterfaceStyle` to `light`, and no source file SHALL use a `dark:` class.

### Requirement 2: Component kit

**User Story:** As the implementation engineer, I want a small kit matching the Reference, so that screens 1–16 can be built from it.

#### Acceptance Criteria

1. THE Component_Kit SHALL provide AppText, Icon, Card, Button (primary and secondary), Toggle, ListRow, IconTile, StatusPill, SegmentedTabs, SectionTitle, QuickActionTile, StatTile, Screen, ScreenHeader, PlaceholderScreen and Tab_Bar, with the props given in the design.
2. WHEN a user presses an enabled Button, THE Button SHALL call its `onPress` handler once.
3. WHILE a Button is disabled, THE Button SHALL expose the disabled state and SHALL not call `onPress` when pressed.
4. WHEN a user presses a Toggle, THE Toggle SHALL call `onValueChange` with the opposite value and SHALL expose its checked state.
5. THE StatusPill SHALL show its state as text next to a coloured dot, so that the state never depends on colour alone.
6. WHEN a user presses a ListRow that has an `onPress` handler, THE ListRow SHALL call that handler once.
7. WHEN a user selects a SegmentedTabs option, THE SegmentedTabs SHALL call `onChange` with that option's key and SHALL expose the selected state on the selected option only.
8. WHEN a user presses a pressable kit component, THE component SHALL show its pressed state as a colour or opacity change only, with no animation.

### Requirement 3: Accessibility

**User Story:** As a parent who uses large text or a screen reader, I want the app to be usable, so that I am not locked out.

#### Acceptance Criteria

1. THE Component_Kit SHALL give every pressable control an accessibility role and an accessibility label.
2. THE Component_Kit SHALL give every pressable control a touch area of at least 44×44 pt.
3. THE Tab_Bar SHALL expose each tab item with the `tab` role and its selected state.
4. THE Parent_App SHALL leave system font scaling on for every text element, and SHALL set `maxFontSizeMultiplier` (1.5) only inside a Dense_Component.
5. THE screen title on each screen SHALL carry the `header` accessibility role.
6. THE Character_Placeholder SHALL carry the `image` role and its accessibility label, and decorative glyphs that repeat adjacent text SHALL be hidden from accessibility.

Note: these checks cover the basics only. Full WCAG validation needs manual testing with assistive technologies and an expert accessibility review.

### Requirement 4: Navigation shell

**User Story:** As Omar, I want every Reference screen to have a route, so that later phases fill them in without restructuring navigation.

#### Acceptance Criteria

1. THE Parent_App SHALL define exactly the route files listed in C10 under `app/`.
2. WHEN the Parent_App opens at `/`, THE Parent_App SHALL redirect to `/home`.
3. THE Tab_Bar SHALL show 5 tabs in the order Home, Play, Grow, Routines, Family, each with an icon and a text label.
4. WHILE a Tab_Route is shown, THE Tab_Bar SHALL show that tab as selected with the filled icon in the brand colour and a brand-coloured label, and every other tab with the outline icon in the muted colour and a muted label.
5. WHEN a user presses a tab, THE Parent_App SHALL show that tab's route.
6. WHEN any Tab_Route other than `/home`, or any Stack_Route, is opened directly by URL, THE Parent_App SHALL show the Placeholder_Screen with that route's C10 title.
7. WHEN a user presses the back control on a Stack_Route, THE Parent_App SHALL go back, or to `/home` when there is no previous screen.
8. THE Stack_Routes SHALL be shown without the Tab_Bar.

### Requirement 5: Home Dashboard content

**User Story:** As a parent, I want a home screen that shows my child's robot at a glance, matching screen 6.

#### Acceptance Criteria

1. THE Home_Dashboard SHALL show, top to bottom: the header, the robot status card, the quick actions, "Today with Xelulu", "Last Activity", and the Tab_Bar with Home selected, in the layout the design gives for screen 6.
2. THE Home_Dashboard header SHALL show "<greeting>, <parent display name>" with the greeting glyph after it, the line "<child display name> is playing with Xelulu" in muted text, and a round settings button labelled "Settings".
3. THE robot status card SHALL show the Character_Placeholder in a beige image well, the device display name, the online state as text ("Online" or "Offline"), a StatusPill "Battery <n>%", and a trailing chevron.
4. THE quick actions SHALL be 4 QuickActionTiles in the order Play, Routines, Voice Call, Settings, each a line icon over a label.
5. THE "Today with Xelulu" section SHALL show 3 StatTiles: the activities count in the info colour over "Activities", the play time as "<n> min" over "Play time", and the smiling-face glyph over "<mood label>".
6. THE "Last Activity" section SHALL show a card with a story thumbnail, the activity title, the activity subtitle and the time in caption style.
7. THE Home_Dashboard SHALL take every value in criteria 2–6 from the Mock_Home_Data, and the time of day from its Clock.
8. THE "Today with Xelulu" tiles and the "Last Activity" card SHALL not be pressable.
9. THE Mock_Home_Data SHALL hold the mood as a static label only. No code SHALL compute, infer or store a mood (C13).

### Requirement 6: Greeting and Home navigation

**User Story:** As a parent, I want the greeting to fit the time and the Home controls to open the right places.

#### Acceptance Criteria

1. WHEN the Clock gives a local time from 05:00 to 11:59, THE Home_Dashboard SHALL greet with "Good morning" and the sun glyph.
2. WHEN the Clock gives a local time from 12:00 to 16:59, THE Home_Dashboard SHALL greet with "Good afternoon" and the partly-sunny glyph.
3. WHEN the Clock gives a local time from 17:00 to 04:59, THE Home_Dashboard SHALL greet with "Good evening" and the moon glyph.
4. WHEN a user presses the settings button, THE Parent_App SHALL open `/settings`.
5. WHEN a user presses the robot status card, THE Parent_App SHALL open `/device`.
6. WHEN a user presses the Play, Routines, Voice Call or Settings quick action, THE Parent_App SHALL open `/play`, `/routines`, `/voice-call` or `/settings` respectively.

### Requirement 7: Character and illustrations

**User Story:** As Omar, I want an original static character, so that the app runs in Expo Go now and Rive can replace it later.

#### Acceptance Criteria

1. THE Character_Placeholder SHALL render the C2 drawing with `react-native-svg`, at the given `size`, with fills from the Theme_Module only.
2. THE Character_Placeholder SHALL accept exactly the props `size` and `accessibilityLabel` (default "Xelulu robot").
3. THE story thumbnail on Home SHALL be an original static SVG drawing with fills from the Theme_Module only.
4. THE Character_Placeholder and the story thumbnail SHALL each carry a licence comment ("original work, Xelulu-owned") and appear in the Design_System_Doc's asset licence list.
5. THE Character_Placeholder and the story thumbnail SHALL contain no animation.

### Requirement 8: Boundaries and safety

**User Story:** As Omar, I want this phase to stay a static, offline, safe UI.

#### Acceptance Criteria

1. THE Parent_App source SHALL contain no `fetch(`, `XMLHttpRequest`, `WebSocket` or `EventSource`, and no import of `@supabase/*`, `mqtt` or `ws`.
2. THE Parent_App SHALL read no environment variable.
3. THE Parent_App SHALL import from `@xelulu/shared` only with `import type`, and SHALL import nothing from `apps/admin` or `services/*`.
4. THE Parent_App source SHALL contain no `Animated` usage, no `react-native-reanimated` or `moti` import, and no `animate-` or `transition` class.
5. THE Parent_App SHALL declare only dependencies that ship in Expo Go for SDK 57 or are pure JavaScript, and SHALL keep `expo-dev-client`, Rive and Lottie out of its `package.json`.
6. THE Parent_App SHALL contain no camera feature, no video view and no "Camera (Privacy)" control, and the `voice-call` and `device` route files SHALL carry the C10 notes.
7. THE Parent_App SHALL keep every user-facing string of a feature in that feature's `strings.ts` module.

### Requirement 9: Docs

**User Story:** As Omar, I want the tokens and components written down, so that the design system is reviewable.

#### Acceptance Criteria

1. THE Design_System_Doc SHALL list every token in the Token_Source with its name, value and use, every Contrast_Pair with its ratio and minimum, and the font-scaling cap rule.
2. THE Design_System_Doc SHALL list every Component_Kit component with its props and when to use it, and the asset licence list.
3. THE root README `pnpm start:app` row SHALL say that Expo Go shows the Home dashboard.
4. THE root README SHALL explain how to open a Stack_Route by appending `/--/<route>` to the `exp://` URL that Expo prints, with no non-local URL literal, and SHALL say that Phase 2.1 still runs in Expo Go (C18).

### Requirement 10: Repo checks

**User Story:** As the implementation engineer, I want the Phase 0 checks updated only where this phase changes what they guard.

#### Acceptance Criteria

1. THE `layout.test.ts` Repo_Check SHALL require exactly the C10 route files under `apps/parent-app/app`, in place of "only `_layout.tsx` and `index.tsx`".
2. THE `placeholder.test.ts` "parent app" block SHALL be replaced by checks of Requirements 1.4, 1.7, 3.4, 8.1, 8.2, 8.3, 8.4 and 8.6 over `apps/parent-app/app` and `apps/parent-app/src`, plus a check that text sizes come only from typography tokens (no `text-[Npx]` class), and SHALL keep every admin and boundary check in that file.
3. THE `contrast.test.ts` Repo_Check SHALL check every Contrast_Pair in the Token_Source against its minimum, and that every typography token is at least 12 pt, in place of the parent-app placeholder palette, and SHALL keep the admin palette checks unchanged.
4. THE `readme.test.ts` Repo_Check SHALL require that the `pnpm start:app` row names Expo Go and "Home dashboard", and that the README contains `/--/`, and SHALL keep every other check.
5. THE `manifests.test.ts` Repo_Check SHALL add `@xelulu/parent-app -> @xelulu/shared` to the allowed workspace edges and SHALL keep every other check, including the parent-app forbidden-dependency list.
6. THE `env-reads.test.ts`, `url-scan.test.ts`, `secret-check.test.ts`, `file-names.test.ts`, `tsconfig.test.ts` and `no-cross-package-import.test.ts` Repo_Checks SHALL pass unchanged.
7. THE `.env.example`, `tooling/fixtures/approved-panel.txt`, `docs/`, `packages/shared/src/`, `.github/workflows/ci.yml` and the other specs SHALL stay unchanged.

### Requirement 11: Verification

**User Story:** As Omar, I want the Done-when checks backed by tests, plus a short manual checklist for my phone.

#### Acceptance Criteria

1. THE App_Test_Suite SHALL show that a Button calls `onPress` and does nothing while disabled, that a Toggle flips and exposes its checked state, that a StatusPill shows its text, that a ListRow calls `onPress`, and that SegmentedTabs selects an option.
2. THE App_Test_Suite SHALL show that the Tab_Bar has 5 tabs with Home selected at `/home`, and that pressing Play shows the Play placeholder with Play selected.
3. THE App_Test_Suite SHALL show that `/` redirects to `/home`, and that each Tab_Route and Stack_Route renders its C10 title.
4. THE App_Test_Suite SHALL show that the Home_Dashboard, with a fixed Clock and the Mock_Home_Data, renders the greeting, "Xelulu", "Online", "Battery 78%", the 4 quick actions, the 3 today tiles and the last activity, and that the greeting boundaries of Requirement 6.1–6.3 hold at 04:59, 05:00, 11:59, 12:00, 16:59 and 17:00.
5. THE App_Test_Suite SHALL show that each Home control in Requirement 6.4–6.6 opens its route.
6. WHEN `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test` run, each SHALL succeed, and `pnpm test` SHALL run the App_Test_Suite.
