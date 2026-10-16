# Requirements Document

## Introduction

Phase 2.2 builds the rest of the parent app. Phase 2.1 delivered the token source, the component kit, the navigation shell and one built screen (Home, screen 6 of the Reference). This phase replaces every remaining placeholder with a built screen, using the Phase 2.1 design system as it stands.

The Reference has 16 screens (numbered 1 to 16, with two labelled "13." and none "14." — see the Glossary). Screen 6 is already built, so 15 remain. Screen 16 is titled "Notifications & Settings" but the Reference draws **only** the Notifications list; the nine-row settings list comes from the step brief, is founder-directed and has no Reference cell. The two lists are two routes, so this phase delivers 16 built screens across 17 route files. Two routes are new: `/reports` (screen 15) and `/grandma-mode` (screen 13).

Everything runs on mock data in Expo Go. There is no backend call, no network, no persistence and no environment read. Every toggle, tab, carousel, form and mock flow works and resets on reload.

Nothing changes in Document B, `packages/shared`, the gateway, the simulator, the admin console, `.env.example` or `docs/`.

### Out of scope

- Any backend: Supabase, auth, real device data, Realtime, and any network request.
- Persistence of any kind, including `AsyncStorage`, `SecureStore` and the file system. Local React state only.
- Rive, Lottie, any animation, and the Expo dev build. The app stays on Expo Go (Phase 2.1 C18).
- Real Bluetooth, Wi-Fi provisioning, permissions, audio capture, audio playback and telephony. Pair Xelulu and the voice call are mock UI.
- Any camera or video. There is none in v1 (`product.md`), and none is added here under any name.
- Dark mode, translation, and a date-picker or slider dependency.
- Real deletion or export on screen 14. The DPDP surface is built, with a real confirmation step, but nothing is deleted or exported.
- Restyling or recreating Phase 2.1 tokens, kit components or the route table.

### Choices made

Items marked FLAG change a steering rule, a prior-phase decision or the frozen Reference. Omar approves this spec by default: this phase is generated and built in one run, with no stop for approval, and approving the run approves these choices as written.

- **D1. FLAG: Splash and first run.** `app/index.tsx` becomes the Splash / Brand screen (screen 1), not a redirect. After 1,200 ms it calls `router.replace(ROUTE_PATH.home)`. This supersedes Phase 2.1 Req 4.2 ("`/` redirects to `/home`") and the navigation test that asserts the immediate redirect; both are updated and listed under "Superseded prior items". Tests use Jest fake timers. Onboarding is not auto-entered, because nothing persists a first-run flag (D10). When entered, the setup flow chains `/onboarding` -> `/auth` -> `/pair-device` -> `/child-profile` -> `/home`, and all four stay reachable by deep link on their own.
- **D2. FLAG: two new routes.** `app/reports.tsx` (screen 15) and `app/grandma-mode.tsx` (screen 13). Both keys are added to `src/features/shell/routes.ts` (`STACK_KEYS`, `ROUTE_PATH`, `ROUTE_TITLE` "Reports" and "Grandma Mode"), and the recursive route-file list in `tooling/test/layout.test.ts` is extended by exactly these two files. Entry points: Grow opens Reports; Family's Grandparents tab opens Grandma Mode from the Grandma row. Both also open by deep link.
- **D3. FLAG: the camera Repo_Check is relaxed exactly once.** `tooling/test/placeholder.test.ts` keeps banning any import of `expo-camera`, `expo-video`, `expo-av` or any other camera-or-video native module, and any `<Camera` element. The `"Camera` string-literal ban is narrowed: the label is allowed only in the device feature's string module and screen file, and only as static, non-pressable text. A positive assertion is added: the device camera row's text is "Not included on this model", and that row carries no toggle, no `Switch`, no `onPress` and no `accessibilityRole="switch"`.
- **D4. FLAG: Live View's third control is Speaker.** The Reference shows "Rotate", which is a camera control, and v1 has no camera. Founder-directed deviation: the three controls are Mute, End Call and Speaker.
- **D5. FLAG: "Voice Call with Xelulu".** The Reference's Grandma Mode row "Video Call with Xelulu" is renamed "Voice Call with Xelulu" and opens the audio-only call at `/voice-call`. No video anywhere, under any label.
- **D6. Age stage from date of birth.** Whole completed years at the current date: 0–2 `tiny`, 3–5 `little`, 6–8 `explorer`, 9 and over `maker`. These ranges are the app's assumption; `product.md` names the stages only. The derivation is a pure, tested function in the child-profile feature, taking an injected reference date, and it reuses the `AgeStage` union through `import type` from `@xelulu/shared` only.
- **D7. No new runtime dependency.** Volume is a stepped control built from `Pressable` and tokens: `accessibilityRole="adjustable"`, `accessibilityValue`, discrete steps, and the percentage always visible as text. No slider, no date picker, no gesture library. Any genuine need for a new dependency is a FLAG, is pinned to an exact version, and is limited to modules bundled with Expo Go SDK 57.
- **D8. No camera and no gallery picker.** Avatars are an original static SVG or an initial letter on a token-coloured disc. "Add photo" on screen 5 is a non-functional mock whose accessibility label says it is not available in this build. `expo-image-picker` and every other media picker stay out of `package.json`.
- **D9. Original illustrations only.** Every illustration is a static SVG drawn in the repo in the Phase 2.1 character style, in `apps/parent-app/src/illustrations/`. Each file carries the licence comment "Original work, Xelulu-owned" and an entry in the design-system asset list. One small set is reused across the screens (a scene well, a story scene, a person figure, a globe-and-stars motif, a dinosaur motif). No photograph, no stock art, no third-party asset.
- **D10. Local state only.** Every toggle, segmented tab, carousel, form field and mock flow works through `useState` in its screen and resets on reload. Nothing is persisted and nothing is sent. Form fields are controlled. Validation is trivial emptiness checking only: a required-and-empty field disables the submit control and shows one muted line.
- **D11. No animation.** Phase 2.1 C15 holds: no `Animated`, no `react-native-reanimated`, no `moti`, no `animate-` or `transition` class, and nothing flashing between 3 and 30 Hz. The carousel is a paged `ScrollView` or `FlatList` with `pagingEnabled`, plus tappable dots. The splash delay is a plain `setTimeout` cleared on unmount.
- **D12. Accessibility bar unchanged.** Phase 2.1 C8 holds. Every text-on-background pair used by a new screen is a `Contrast_Pair` in `tokens.json` meeting its minimum, with ratios recomputed by `tooling/checks/contrast.ts`. Touch targets are at least 44×44 pt. Every control has an accessibility role and label. Selected state is exposed on tabs and segmented controls. Status is never carried by colour alone. Font scaling stays on; `maxFontSizeMultiplier` stays confined to the Dense_Components, and if a new dense tile needs the cap, the allow-list in `placeholder.test.ts` is extended and the extension is named in the Done-when report.
- **D13. Privacy and safety in the copy and the mocks.** No URL literal, phone number, price or brand link appears in any user-facing string. No child audio, transcript or raw value appears in any mock payload: display names, identifiers, counts, enum values and times only. Every user-facing string of a feature lives in that feature's `strings.ts`.
- **D14. DPDP s.9 stays open.** Reports, Grow and Notifications are static mock summaries. No code profiles, tracks, scores or infers anything about a child. The Phase 2.1 open item stands: legal review of reports and cry alerts against DPDP s.9 is pending (`safety.md`).
- **D15. The Phase 2.1 battery-tone gap is closed.** All three battery tones are tested at the 20% and 10% thresholds, on the Device screen and on Home's status pill: 100/20 success, 19/10 warning, 9/0 danger, with the percentage always in the text.
- **D16. FLAG: date of birth is an ISO text field.** D7 forbids a date-picker dependency, so screen 5's date field is a controlled text field holding `YYYY-MM-DD` (the shape of `ChildProfile.date_of_birth`), pre-filled `2020-03-15` to match the Reference's child. A caption below it shows the derived age stage, or one muted line asking for `YYYY-MM-DD` when the text is not a valid date. The calendar glyph is decorative and not pressable. This deviates from the Reference's "15 Mar 2020" presentation, for that reason only.
- **D17. Parent Account is a mock.** "Create Account" validates emptiness only (D10) and navigates to `/pair-device`. The Google and Apple buttons are labelled mock controls: no SDK, no URL, no deep link, no navigation. Pressing one shows a single muted line saying it is not available in this build, and their accessibility labels say so too. The line "By continuing, you agree to our Terms & Privacy Policy." is static text, not a link, because no URL literal is allowed.
- **D18. The call duration is static.** Screen 7 shows a fixed mock duration label ("0:42"). No timer ticks, because D11 allows no animation and this phase has no live call.
- **D19. The Volume control.** Steps of 5 from 0 to 100, initial value 60 (the Reference), minus and plus controls at 44×44 pt, the value shown as "<n>%", and `accessibilityValue` carrying min, max and now.
- **D20. The mock interaction catalogue.** These are the only interactive behaviours, all local (D10):
  - Onboarding: swipe or tap the dots to page through 3 value cards; "Get Started" opens `/auth`.
  - Pair Xelulu: "Start Pairing" advances the 4-step checklist by one step per press; on the last step it opens `/child-profile`. No Bluetooth, Wi-Fi or permission API is touched.
  - Child Profile: name and date fields are typed; one gender chip may be selected and is used for nothing; "+ Add" (language) and "+ Add more" (interest) open a small inline field that appends a chip; chips are removable; "Continue" opens `/home`.
  - Play, Grow, Family, Privacy, Reports, Notifications: every segment of a segmented control renders real mock content. Play filters its cards by category; Notifications filters its list by kind; Reports swaps a second mock data set for Month; Grow, Family and Privacy each render their own panel per segment. No segment says "coming later".
  - Routines: six toggles flip; "+ Add Routine" opens an inline name-and-time field that appends a routine row.
  - Device: the Movement toggle flips; Volume steps; Quiet Hours, Sleep / Wake and Software & Health open an inline detail panel on the same screen; the Camera row is static text (D3).
  - Family: "+ Add Child" and "+ Invite Caregiver" open an inline field that appends a card or row.
  - Grandma Mode: "Schedule a Story" and the record control open an inline mock panel that confirms the mock set a time; "Call Grandma Mode" and the "Voice Call with Xelulu" row open `/voice-call`.
  - Privacy: "View All Memories" expands the list in place; "Delete or Export Data" opens a confirmation dialog with Cancel, "Delete everything" and "Export data". Choosing either shows one line stating that this build is a mock and nothing left the device. No copy claims that anything was deleted or exported.
  - Settings: rows with a route open it (child profiles, devices, routines, privacy, notifications). Account, language, help and about are non-pressable rows with the muted trailing text "Later phase".
- **D21. Kit extensions.** The Phase 2.1 kit is reused unchanged in look. These components are added, each documented in the design-system doc: TextField, Chip, Avatar, StepList, PageDots, Stepper, MediaCard, MetricRow, MetricTile, CircleButton, ConfirmDialog. Three optional, additive props are added to `ListRow` rather than cloning it: `leading` (a node replacing the icon tile), `trailingText` (text before the trailing chevron or toggle), and `tone` (`"default" | "danger"`, which tints the title and `trailingText` and leaves the leading slot untouched, because `IconTile` hard-codes its glyph colour and may not be edited). No existing component's default appearance changes, and no other kit component is edited: danger-toned text is rendered through `AppText`'s existing `className` prop with the token-derived class `text-danger`, not by adding a tone to `AppText`.
- **D22. Screen files live in features, routes stay thin.** Each route file renders one exported screen component from `src/features/<area>/`, as Home does. The route file holds nothing but the import, the default export and, where Phase 2.1 required it, its one-line note. One existing note is **rewritten**: `app/device.tsx` currently says this screen carries no Camera row, which D3 makes false, so it is replaced with a pointer that states the Camera row is static text reading "Not included on this model". `app/voice-call.tsx`'s note is still true and is left as it is.
- **D23. FLAG: two extensions to `structure.md`'s tree.** First, `apps/parent-app/src/illustrations/` is a new top-level app folder, a sibling of `src/character/`. `structure.md` lists `assets/` for "fonts, .riv, .json" — asset files the bundler loads — and these are not files but React components that draw with `react-native-svg` and take their fills from the Theme_Module, so they must live under `src/` to be type-checked, linted and token-scanned. Second, seven feature folders (`play`, `grow`, `routines`, `device`, `family`, `notifications`, `settings`) sit outside `structure.md`'s named list, which is illustrative rather than exhaustive; `setup`, `talk`, `grandma`, `privacy` and `reports` are from that list. Phase 2.1 set the precedent for both by introducing `src/theme/` as its choice C6. The reasoning is in design decisions 4 and 6a.
- **D24. FLAG: eight further deviations from the frozen Reference.** Each of these changes something the Reference draws, so each is flagged here rather than only noted in the design. (a) **Screen 11's Movement row carries a `Toggle`** where the Reference draws a chevron — the step brief specifies a movement toggle, and the Reference's one switch, which sits on the Camera (Privacy) row, is removed with that row's control (D3). (b) **Screen 12's "Dad" row drops the Reference's chevron**: there is no caregiver detail screen in this phase, and a chevron that opens nothing is a dead control. (c) **Screen 9 gains a reports entry row** the Reference does not draw, so `/reports` is reachable without a deep link (D2). (d) **Screen 15's "Aarav's Interests" block is wrapped in a `Card`** the Reference draws without one, so the heading, the line and the illustration read as one group. (e) **Screen 2 shows one value row per carousel page** instead of the Reference's three stacked rows (Req 5.1). (f) **Screen 1's current page dot is an equal 8 pt recoloured dot**, not the Reference's elongated pill. (g) **Screen 2's page dots sit further apart than the Reference draws them**: each interactive dot is centred in its own 44×44 pt touch target with no overlapping hit area, which is what makes Req 5.3's dot press well defined. (h) **Screen 5's interest chips all render unselected**: an interest has no primary, so none is filled; the language row's primary chip is filled, as the Reference draws it. Every one of the eight is reported by the Done-when report.

### Superseded prior items

- Phase 2.1 **Req 4.2** (`/` redirects to `/home`): replaced by Requirement 4 (D1). `app/index.tsx` is the Splash screen and replaces to `/home` after the delay.
- Phase 2.1 **Req 11.3** (the test that `/` redirects to `/home`, and that each route renders its C10 placeholder title): replaced by Requirements 4.4 and 26.2. Routes now render their built screens.
- Phase 2.1 **Req 11.2** (the tab-bar case and the Play-tab-press case) and **Req 11.5** (the four Home-control cases and the two settings-control cases): these six `navigation.test.tsx` cases opened the app at `/` and assumed `/` lands on Home. They now open at `ROUTE_PATH.home`, because `/` is the Splash (D1). The assertions themselves are unchanged. Requirement 26.16 pins this.
- Phase 2.1 **Req 4.6** (every route other than `/home` shows the Placeholder_Screen): removed. No route shows a Placeholder_Screen after this phase, and `PlaceholderScreen` is deleted from the kit together with `PLACEHOLDER_LINE`.
- Phase 2.1 **Req 10.1 / C10** (the exact route-file list): extended by `reports.tsx` and `grandma-mode.tsx` (D2).
- Phase 2.1 **Req 8.6 / Req 10.2** (no `"Camera` string literal anywhere in the app): narrowed by D3 to the device feature only, as static non-pressable text, plus the new positive assertion. Every other part of Req 8.6 stands.
- Phase 2.1 **C10 note placement**: the voice-call and device notes move into their feature modules with the screens (D22); each route file keeps a one-line pointer. `app/device.tsx`'s pointer is rewritten, because its current text contradicts D3; `app/voice-call.tsx`'s is unchanged.
- Phase 2.1 **C10 placeholder titles**: still the `ROUTE_TITLE` values and still the accessible header name on every stack screen, except where a built screen's Reference header differs. Requirement 3.4 names the exceptions.

## Glossary

- **Parent_App**: the Expo app in `apps/parent-app`.
- **Reference**: `docs/design/Xelulu Parent App UX Flow-4.png`. "Screen N" means the screen numbered N on it. The Reference labels two screens "13." (Grandma Mode and Privacy & Memory) and labels none "14."; in this spec **screen 13 is Grandma Mode and screen 14 is Privacy & Memory**, and every later reference to those numbers uses that reading. `docs/design/Xelulu Family App Design System-5.png` section 02 is secondary; the Reference wins on any conflict.
- **Token_Source**: `apps/parent-app/src/theme/tokens.json`.
- **Theme_Module**: `apps/parent-app/src/theme/theme.ts`.
- **Component_Kit**: the components in `apps/parent-app/src/components/`.
- **Kit_Addition**: one of the D21 components.
- **Contrast_Pair**: an entry in the Token_Source naming a foreground token, a background token, a minimum ratio and a use.
- **Dense_Component**: a component listed in the font-cap allow-list of `tooling/test/placeholder.test.ts`.
- **Route_Table**: `apps/parent-app/src/features/shell/routes.ts`.
- **Tab_Route**: one of `/home`, `/play`, `/grow`, `/routines`, `/family`.
- **Stack_Route**: one of `/onboarding`, `/auth`, `/pair-device`, `/child-profile`, `/settings`, `/device`, `/privacy`, `/notifications`, `/voice-call`, `/reports`, `/grandma-mode`.
- **Setup_Flow**: the chain `/onboarding` -> `/auth` -> `/pair-device` -> `/child-profile` -> `/home`.
- **Built_Screen**: a screen component in `src/features/<area>/` rendered by one route file.
- **Mock_Module**: a typed `mock-*.ts` module in a feature folder holding that screen's data.
- **Illustration**: an original static SVG component in `apps/parent-app/src/illustrations/`.
- **Confirm_Dialog**: the Kit_Addition that asks for confirmation before a mock destructive action.
- **App_Test_Suite**: the Jest tests in `apps/parent-app/test/`.
- **Repo_Check**: a Vitest test under `tooling/test/`.
- **Design_System_Doc**: `apps/parent-app/docs/design-system.md`.

## Requirements

### Requirement 1: Reuse of the Phase 2.1 design system

**User Story:** As Omar, I want the 16 screens built from the system we already approved, so that the app stays one coherent product.

#### Acceptance Criteria

1. THE Built_Screens SHALL take every colour, type size, spacing, radius, shadow and touch-size value from the Token_Source, through Tailwind classes or the Theme_Module.
2. THE Parent_App SHALL contain no hex, `rgb(`, `rgba(`, `hsl(` or `hsla(` colour literal outside the Token_Source, no `dark:` class and no `text-[Npx]` class.
3. THE existing Component_Kit components SHALL keep their current default appearance, and THE only changes to them SHALL be the three optional additive `ListRow` props of D21.
4. WHEN a Reference element has no existing token, THE implementation SHALL add a named token to the Token_Source rather than write the value inline, and SHALL add a Contrast_Pair for it when it is a text, icon or control-boundary colour.
5. THE Route_Table SHALL stay the one place a route path is written, and no Built_Screen SHALL hold a route string literal.
6. THE `PlaceholderScreen` component and the `PLACEHOLDER_LINE` string SHALL be removed, because no route uses them after this phase.

### Requirement 2: Component kit additions

**User Story:** As the implementation engineer, I want the few components the new screens genuinely need, so that I do not restyle what exists or repeat myself.

#### Acceptance Criteria

1. THE Component_Kit SHALL add exactly the D21 components: TextField, Chip, Avatar, StepList, PageDots, Stepper, MediaCard, MetricRow, MetricTile, CircleButton and ConfirmDialog, with the props the design gives.
2. WHEN a user types in a TextField, THE TextField SHALL call `onChangeText` with the new text, and WHILE its `secure` prop is set THE TextField SHALL mask the text and offer a reveal control with an accessibility label.
3. WHEN a user presses a Chip, THE Chip SHALL call `onPress` once and SHALL expose its selected state.
4. THE Avatar SHALL render either an Illustration or the first letter of its `name` on a token-coloured disc, and SHALL carry the `image` role with an accessibility label.
5. THE StepList SHALL show each step as done, current or pending, with the state in text or an accessibility label and never by colour alone.
6. WHEN a user presses a PageDots dot, THE PageDots SHALL call `onSelect` with that index, and THE dots SHALL expose the current page.
7. WHEN a user presses the Stepper's minus or plus control, THE Stepper SHALL call `onChange` with the value moved by one step, clamped to its minimum and maximum, and THE Stepper SHALL carry `accessibilityRole="adjustable"`, `accessibilityValue` and the value as visible text (D19).
8. WHEN a user presses a MediaCard, THE MediaCard SHALL call `onPress` once, and THE card SHALL show an Illustration well, a title, a subtitle and a trailing chevron.
9. THE MetricRow SHALL show a leading icon tile, a title, a subtitle and a trailing value, and THE MetricTile SHALL show an icon, a value and a label.
10. WHEN a user presses a CircleButton, THE CircleButton SHALL call `onPress` once, and WHILE its tone is `danger` THE CircleButton SHALL use the danger fill with on-brand text and keep its label in text.
11. WHEN the Confirm_Dialog is open, THE Confirm_Dialog SHALL show a title, a body, a cancel control and one or more action controls, SHALL expose itself with the `alert` accessibility role, and SHALL call the matching handler exactly once per press.
12. WHEN a user presses any Kit_Addition, THE component SHALL show its pressed state as a colour or opacity change only, with no animation.

### Requirement 3: Routes and navigation

**User Story:** As Omar, I want every Reference screen on its own route, reachable the way the Reference implies.

#### Acceptance Criteria

1. THE Parent_App SHALL hold exactly the Phase 2.1 route files plus `app/reports.tsx` and `app/grandma-mode.tsx` under `app/`.
2. THE Parent_App SHALL add the keys `reports` and `grandma-mode` to `STACK_KEYS` and `ROUTE_PATH` in the Route_Table, and `ROUTE_TITLE` in the shell strings (`src/features/shell/strings.ts`, where it is exported) SHALL give them the titles "Reports" and "Grandma Mode".
3. WHEN any Tab_Route or Stack_Route is opened directly by URL, THE Parent_App SHALL render that route's Built_Screen.
4. THE `SCREEN_HEADER_NAME` table in the shell strings SHALL be the single source of the accessible header name of every Tab_Route and Stack_Route screen. Its value SHALL be the route's `ROUTE_TITLE` for each Stack_Route except `/voice-call` ("Live with Xelulu"), `/privacy` ("Privacy & Memory"), `/grandma-mode` ("Grandma Mode") and `/reports` ("This Week with Xelulu"), and SHALL be the Reference's header text for each non-Home Tab_Route ("Play with Xelulu", "Growing Together", "Daily Routines", "Our Family"); each SHALL be rendered as that screen's `header`-role element. Home is excluded, because its header is the greeting line.
5. THE Stack_Routes SHALL be shown without the tab bar, and each SHALL carry a back control that goes back, or to `/home` when there is no previous screen.
6. WHILE a Tab_Route is shown, THE tab bar SHALL mark exactly that tab selected.
7. WHEN a user presses the Grow screen's reports entry, THE Parent_App SHALL open `/reports`.
8. WHEN a user presses the Grandma row on Family's Grandparents segment, THE Parent_App SHALL open `/grandma-mode`.
9. THE Built_Screens SHALL navigate only to routes in the Route_Table, and no screen SHALL open an external URL or a native share, mail or dial intent.

### Requirement 4: Screen 1, Splash / Brand, and first run

**User Story:** As a parent opening the app, I want a calm brand moment and then my home screen.

#### Acceptance Criteria

1. THE Splash screen SHALL show the Xelulu wordmark, the line "A little companion for a brighter childhood.", the character Illustration, the page dots and the footer row `Play • Learn • Grow • Together` (U+2022 BULLET, single spaces, as the Reference draws it), in the Reference's screen-1 layout.
2. WHEN the Splash screen has been shown for 1,200 ms, THE Parent_App SHALL call `router.replace` to `/home`.
3. WHEN the Splash screen unmounts before the delay elapses, THE Parent_App SHALL clear the timer and SHALL not navigate.
4. THE Parent_App SHALL not enter the Setup_Flow automatically, because no first-run state is persisted (D10).
5. WHEN a user reaches the end of the Setup_Flow at `/child-profile` and presses Continue, THE Parent_App SHALL open `/home`.
6. THE Splash screen SHALL use a plain `setTimeout` and no animation (D11).

### Requirement 5: Screen 2, Onboarding / Value

**User Story:** As a parent, I want to see what Xelulu does before I make an account.

#### Acceptance Criteria

1. THE Onboarding screen SHALL show the heading "A friend to play, learn and grow with.", an Illustration hero, the PageDots and the primary button "Get Started", and SHALL present the three value rows "Plays and moves around your home", "Understands and talks" and "Teaches, explores and grows with your child" **one per carousel page**, each with its icon. This is a deviation from the Reference, which draws all three stacked.
2. THE value rows SHALL be a 3-page carousel implemented as a paged `ScrollView` or `FlatList` with `pagingEnabled`, with all three pages mounted and the PageDots as the page control (D11). EACH page SHALL be exactly the carousel viewport's width, taken from `useWindowDimensions` and reduced by the `Screen`'s horizontal padding on both sides, and that one value SHALL be the `scrollTo` offset multiplier and the divisor the page index is derived from, so that paging, a dot press and the index agree.
3. WHEN a user pages the carousel or presses a dot, THE Onboarding screen SHALL show that page and SHALL mark that dot current.
4. WHEN a user presses "Get Started", THE Parent_App SHALL open `/auth`.

### Requirement 6: Screen 3, Parent Account

**User Story:** As a parent, I want to see the account screen I will later really use.

#### Acceptance Criteria

1. THE Parent Account screen SHALL show "Welcome to", the Xelulu wordmark, "Create your account", the three TextFields "Parent's name", "Email address" and "Password", the primary button "Create Account", the divider "or continue with", the Google and Apple buttons, and the static line "By continuing, you agree to our Terms & Privacy Policy.".
2. THE Password TextField SHALL mask its text and offer a reveal control.
3. WHILE any of the three fields is empty, THE "Create Account" button SHALL be disabled and the screen SHALL show one muted line asking for the missing details.
4. WHEN all three fields hold text and a user presses "Create Account", THE Parent_App SHALL open `/pair-device`.
5. WHEN a user presses the Google or the Apple button, THE screen SHALL show one muted line saying that sign-in with that provider is not available in this build, and SHALL not navigate (D17). THE screen SHALL hold **one notice slot**, with this precedence: a provider press sets the provider line and it replaces the Requirement 6.3 fill-in line until a field changes; WHILE no provider has been pressed and any field is blank, the fill-in line shows; WHILE no provider has been pressed and all three fields hold text, no line shows.
6. THE Google and Apple buttons SHALL carry accessibility labels stating they are not available in this build, and the screen SHALL import no provider SDK and hold no URL literal.
7. THE "Terms & Privacy Policy" line SHALL be static text with no press handler and no link.

### Requirement 7: Screen 4, Pair Xelulu

**User Story:** As a parent, I want to walk the pairing steps, so that the flow is reviewable before the real radios exist.

#### Acceptance Criteria

1. THE Pair Xelulu screen SHALL show a back control, the heading "Let's set up your Xelulu", the line "Connect via Bluetooth and Wi-Fi", the character Illustration, the StepList with the four steps "Power on Xelulu", "Connect via Bluetooth", "Join your Wi-Fi network" and "Complete setup", and the primary button "Start Pairing".
2. THE StepList SHALL start with step 1 done and step 2 current, as the Reference shows.
3. WHEN a user presses "Start Pairing" and a later step remains, THE screen SHALL mark the current step done and the next step current.
4. WHEN a user presses "Start Pairing" on the last step, THE Parent_App SHALL open `/child-profile`.
5. THE Pair Xelulu screen SHALL call no Bluetooth, Wi-Fi, network or permission API, and SHALL import no module that provides one.

### Requirement 8: Screen 5, Child Profile, and age stage

**User Story:** As a parent, I want to describe my child, and I want the app to work out which age stage that is.

#### Acceptance Criteria

1. THE Child Profile screen SHALL show the heading "Tell us about your child", an Avatar with a non-functional "add photo" control, the "Child's name" TextField, the "Date of birth" TextField, the gender chips "Boy", "Girl" and "Prefer not to say", the "Languages" chips with "+ Add", the "Interests (optional)" chips with "+ Add more", and the primary button "Continue".
2. THE "add photo" control SHALL open no camera and no picker, SHALL import no media module, and SHALL carry an accessibility label saying a photo cannot be added in this build (D8).
3. THE gender chip row SHALL start with "Boy" selected, which is what the Reference draws, seeded from the mock's `gender_label`. WHEN a user presses a gender chip, THE screen SHALL select exactly that chip, and THE selection SHALL feed no derivation, no label and no mock payload.
4. WHEN a user presses "+ Add" or "+ Add more" and types a value, THE screen SHALL append that chip to the matching list, and WHEN a user presses a chip's remove control THE screen SHALL drop it.
5. THE Date of birth TextField SHALL hold `YYYY-MM-DD`, pre-filled `2020-03-15` (D16).
6. WHEN the Date of birth text is a valid calendar date not in the future, THE screen SHALL show the derived age stage below the field as text.
7. WHEN the Date of birth text is not a valid calendar date, or is in the future, THE screen SHALL show one muted line asking for a date as `YYYY-MM-DD`, and SHALL show no age stage.
8. THE age-stage function SHALL be pure, SHALL take the date of birth and an injected reference date, SHALL return `tiny` for 0–2 completed years, `little` for 3–5, `explorer` for 6–8 and `maker` for 9 and over, and SHALL never throw (D6).
9. THE age-stage function SHALL type its result with the `AgeStage` union imported from `@xelulu/shared` with `import type` only.
10. WHILE the name field is empty or the date is invalid, THE "Continue" button SHALL be disabled.
11. WHEN a user presses "Continue", THE Parent_App SHALL open `/home`.

### Requirement 9: Screen 7, Live View & Voice Call

**User Story:** As a parent, I want to talk to my child through Xelulu, with audio and status only.

#### Acceptance Criteria

1. THE Live View screen SHALL show a back control, the header "Live with Xelulu", a settings control, the static duration label, the character Illustration in a scene well, the PageDots, and the three CircleButtons "Mute", "End Call" and "Speaker", in the Reference's screen-7 layout.
2. THE third control SHALL be "Speaker", not the Reference's "Rotate" (D4).
3. THE "End Call" control SHALL use the danger tone and SHALL keep its label in text.
4. WHEN a user presses "Mute" or "Speaker", THE screen SHALL flip that control's state and SHALL expose the new state in its accessibility label and in visible text.
5. WHEN a user presses "End Call", THE Parent_App SHALL go back, or to `/home` when there is no previous screen.
6. THE Live View screen SHALL show the connection status as text ("Connected" from mock data), never by colour alone.
7. THE duration label SHALL be a static mock string with no timer (D18).
8. THE Live View screen and its feature module SHALL contain no video view, no camera control, no audio capture, no audio playback and no media module import, and SHALL carry the note that the screen is audio and status only.

### Requirement 10: Screen 8, Play & Adventure

**User Story:** As a parent, I want to browse what my child can play, and start it from here later.

#### Acceptance Criteria

1. THE Play screen SHALL show a back control, the header "Play with Xelulu", the SegmentedTabs "All", "Games", "Stories" and "Learning", and the MediaCards from its Mock_Module, each with an Illustration well, a title, a subtitle and a chevron.
2. THE Mock_Module SHALL include at least "Animal Adventure / Go on a quest", "Treasure Hunt / Find, explore, learn", "Dance with Xelulu / Move and groove" and "Story Time", each tagged with one category.
3. WHEN a user selects a segment, THE Play screen SHALL show only the cards of that category, and "All" SHALL show every card.
4. WHEN a segment has no card, THE Play screen SHALL show one muted line saying nothing is here yet.
5. WHEN a user presses a MediaCard, THE Play screen SHALL show one muted line saying the activity starts from the robot in a later phase, and SHALL not navigate.
6. THE Play screen SHALL render the tab bar with Play selected.

### Requirement 11: Screen 9, Grow / Learning Insights

**User Story:** As a parent, I want a calm view of how my child is growing.

#### Acceptance Criteria

1. THE Grow screen SHALL show the header "Growing Together", the line "Everyday learning, naturally.", the SegmentedTabs "Overview", "Interests" and "Milestones", and the tab bar with Grow selected.
2. THE Overview segment SHALL show the MetricRows "Language / New words this week / +12", "Reading / Stories together / 4", "Curiosity / Questions & exploration / 8" and "Physical Play / Movement & activity / 5", then the "Current Interests" section with the interest cards "Dinosaurs", "Animals" and "Space".
3. THE Interests segment SHALL show the interest cards with their mock detail lines, and THE Milestones segment SHALL show the mock milestone rows. Neither SHALL say "coming later".
4. WHEN a user selects a segment, THE Grow screen SHALL show that segment's panel and SHALL expose only that segment as selected.
5. THE Grow screen SHALL show a reports entry that opens `/reports` (D2, D24c: the Reference does not draw this row).
6. THE Grow values SHALL come from a Mock_Module as static numbers and labels. No code SHALL compute, score, infer or rank anything about a child (D14).

### Requirement 12: Screen 15, Reports

**User Story:** As a parent, I want a weekly summary I asked for.

#### Acceptance Criteria

1. THE Reports screen SHALL show a back control, the header "This Week with Xelulu", the line "Beautiful moments together.", the SegmentedTabs "Week" and "Month", the four MetricTiles "5 / Stories heard", "12 / New words", "8 / Questions asked" and "6 / Play sessions", and the interests block "Aarav's Interests / Dinosaurs, Space, Animals" with its Illustration, wrapped in a Card (D24d: the Reference draws the block without one).
2. WHEN a user selects "Month", THE Reports screen SHALL show the month Mock_Module's values, and WHEN a user selects "Week" it SHALL show the week values.
3. THE Reports values SHALL be static mock data only, and the screen SHALL state that reports are summaries a parent asks for (D14).
4. THE Reports screen SHALL contain no advertising, no third-party content and no behavioural inference.

### Requirement 13: Screen 10, Routines

**User Story:** As a parent, I want to see and switch my child's daily routines.

#### Acceptance Criteria

1. THE Routines screen SHALL show the header "Daily Routines", the line "Set a routine, Xelulu makes it special.", the six routine rows and the primary button "+ Add Routine", with the tab bar and Routines selected.
2. THE six rows SHALL be "Morning / Wake up and greet / 7:00 AM", "Brushing / Make it fun / 8:00 AM", "Meals / Gentle reminders / 12:30 PM", "Play Time / Games & exploration / 5:00 PM", "Wind Down / Calm activities / 8:00 PM" and "Bedtime / Stories & good night / 8:30 PM", each with its icon, its time as text and a Toggle.
3. WHEN a user presses a row's Toggle, THE Routines screen SHALL flip that row only and SHALL expose the new checked state.
4. WHEN a user presses "+ Add Routine", types a name and a time and confirms, THE Routines screen SHALL append a row with that name and time, switched on.
5. WHILE the inline add form's name is empty, THE confirm control SHALL be disabled.
6. THE routine state SHALL be local and SHALL reset on reload (D10).

### Requirement 14: Screen 11, Device page

**User Story:** As a parent, I want the robot's controls in one place, and I want to know the camera is simply not on this model.

#### Acceptance Criteria

1. THE Device screen SHALL show a back control, the header "Xelulu" with the line "Living Room", the character Illustration, the online state as text, the battery readout as "Battery <n>%" with its bar, and the rows Movement, Volume, Quiet Hours, Camera, Sleep / Wake and Software & Health, in the Reference's screen-11 order.
2. THE Movement row SHALL carry a Toggle whose state shows as text ("Enabled" or "Disabled"), and pressing it SHALL flip that state (D24a: the Reference draws a chevron here and puts its switch on the Camera row).
3. THE Volume row SHALL carry the Stepper of D19, showing "<n>%" as text.
4. THE Camera row SHALL show the static text "Not included on this model", SHALL carry no toggle, no switch and no press handler, and SHALL not be focusable as a control (D3).
5. WHEN a user presses the Quiet Hours, Sleep / Wake or Software & Health row, THE Device screen SHALL show that row's inline mock detail panel on the same screen.
6. THE Quiet Hours row SHALL show "10:00 PM - 7:00 AM" and THE Software & Health row SHALL show "Up to date • All good", both from the Mock_Module.
7. WHILE the mock battery is 20% or more, THE battery readout SHALL use the success tone; WHILE it is 10% to 19%, the warning tone; WHILE it is under 10%, the danger tone. In every case THE percentage SHALL appear in the text (D15).
8. THE Device screen SHALL accept an injected device Mock_Module, so the three tones are testable at 20, 19, 10 and 9 percent.
9. THE Device screen SHALL send no command and SHALL state in a comment that the robot's firmware decides what is physically safe and the app cannot override it (`safety.md` §5).

### Requirement 15: Screen 12, Family

**User Story:** As a parent, I want to see everyone who shares Xelulu and what they may do.

#### Acceptance Criteria

1. THE Family screen SHALL show the header "Our Family", the line "People who share Xelulu", the SegmentedTabs "Children", "Caregivers" and "Grandparents", and the tab bar with Family selected.
2. THE Children segment SHALL show the child cards "Aarav / 4 years • English, Hindi" and "Diya / 7 years • English" with Avatars and chevrons, then "+ Add Child", then the "Grandparents & Caregivers" section with the rows "Grandma / Storyteller" and "Dad / Parent" and the control "+ Invite Caregiver". THE "Dad" row SHALL carry no chevron (D24b: the Reference draws one, and this phase has no caregiver detail screen).
3. THE Caregivers segment SHALL show one card per member with that member's role label and, as text, **that member's own permission line** — never one hard-coded line for the whole panel. THE caregiver line SHALL match `product.md`: a caregiver can start games and routines and see battery, and cannot see reports or change controls. THE parent line SHALL state full access to devices, children, reports and privacy, because `MOCK_FAMILY.caregivers` holds a parent (Dad, the row the Reference draws) as well as a caregiver (Meera), and stating a caregiver's limits over a parent's name would contradict `product.md`.
4. THE Grandparents segment SHALL show the grandparent rows with the role "Storyteller" and the note that a grandparent can record content and make calls only.
5. WHEN a user presses the Grandma row on the Grandparents segment, THE Parent_App SHALL open `/grandma-mode`.
6. WHEN a user presses a child card, THE Parent_App SHALL open `/child-profile`.
7. WHEN a user presses "+ Add Child" or "+ Invite Caregiver", types a name and confirms, THE Family screen SHALL append that card or row locally.
8. THE Family values SHALL come from a Mock_Module and SHALL carry no contact detail: no email address, no phone number and no URL (D13).

### Requirement 16: Screen 13, Grandma Mode

**User Story:** As a parent, I want grandma's stories and calls in one warm place.

#### Acceptance Criteria

1. THE Grandma Mode screen SHALL show a back control, the header "Grandma Mode", the line "Stories, calls and special moments.", the Illustration hero, the rows "Voice Call with Xelulu / Talk and listen together", "Grandma's Stories / Cultural stories & rhymes", "Festival Special / Diwali, Eid, Christmas & more" and "Schedule a Story / Set time for a daily story", and the primary button "Call Grandma Mode". THE "Festival Special" row SHALL be a static, non-pressable row with the muted trailing text "Later phase", because G08 is P1 (`product.md`). THE Reference draws **no trailing chevron on any screen-13 row**, so all four rows SHALL pass `trailing="none"` while the three live rows keep their press handlers.
2. THE first row SHALL read "Voice Call with Xelulu", not the Reference's "Video Call with Xelulu" (D5).
3. WHEN a user presses that row or "Call Grandma Mode", THE Parent_App SHALL open `/voice-call`.
4. WHEN a user presses "Schedule a Story", THE screen SHALL open an inline mock panel offering a time and a confirm control, and on confirm SHALL show one line stating the mock set that time and nothing was saved.
5. WHEN a user presses the record control, THE screen SHALL show one line stating that recording arrives with the real audio pipeline in a later phase, and SHALL capture no audio and import no audio module.
6. THE Grandma Mode screen SHALL state in text that a grandparent recording is adult-provided content stored only with a recorded consent statement, and that it is never child audio (`safety.md` §1).
7. THE Grandma Mode screen SHALL contain no video, no camera and no clone-voice control.

### Requirement 17: Screen 14, Privacy & Memory

**User Story:** As a parent, I want to see what Xelulu remembers and be able to delete or export it.

#### Acceptance Criteria

1. THE Privacy screen SHALL show a back control, the header "Privacy & Memory", the line "You are in control.", the SegmentedTabs "Memory", "Recordings" and "Settings", the row "What Xelulu Remembers / 15 items • View and manage", the "Recent Memories" rows, the primary button "View All Memories" and the danger-tone row "Delete or Export Data". THE danger row SHALL be drawn as the Reference draws it: one centred pressable row holding a small inline danger-coloured glyph and the danger-toned label, with no leading icon tile, no subtitle and no chevron.
2. THE Recent Memories rows SHALL be "Aarav loves dinosaurs / 2 days ago", "Prefers Hindi bedtime stories / 3 days ago" and "Gets excited about space / 5 days ago", from the Mock_Module.
3. WHEN a user presses "View All Memories", THE Privacy screen SHALL expand the list in place to the full mock set.
4. THE Recordings segment SHALL list only adult-provided grandparent recordings, each with its consent statement shown as text, and SHALL state that no child audio is ever stored (`safety.md` §1).
5. THE Settings segment SHALL show the mock privacy toggles and the retention line stating that transcripts are text only and are deleted after 30 days by default.
6. WHEN a user presses "Delete or Export Data", THE Privacy screen SHALL open the Confirm_Dialog with a cancel control and the actions "Delete everything" and "Export data".
7. WHEN a user cancels the Confirm_Dialog, THE Privacy screen SHALL close it and SHALL change nothing.
8. WHEN a user confirms either action, THE Privacy screen SHALL show one line stating that this build is a mock and that nothing was deleted, exported or sent, and SHALL change no mock data.
9. THE Privacy screen SHALL never claim that data was deleted or exported, and SHALL hold no transcript text, no audio reference and no raw value in its Mock_Module (D13).
10. THE Privacy screen SHALL state that withdrawal of consent is as easy as giving it, and that deletion on withdrawal is real in the shipped product (`safety.md` §2).

### Requirement 18: Screen 16, Notifications, and the Settings list

**User Story:** As a parent, I want my alerts in one list and my settings in another.

#### Acceptance Criteria

1. THE Notifications screen SHALL show a back control, the header "Notifications", the SegmentedTabs "All", "Device" and "Activity", and the notification rows from its Mock_Module, each with an icon, a title, a detail line and a relative time.
2. THE Mock_Module SHALL include "Xelulu is charging / Battery at 20% / 10 min ago", "Play time completed / Today's play time reached / 1 hour ago", "New memory saved / Aarav loves space / 2 hours ago", "Bedtime routine starting / Story time in 10 minutes / Today, 8:20 PM" and "Software update available / New features for Xelulu / 1 day ago", each tagged `device` or `activity`.
3. WHEN a user selects "Device" or "Activity", THE Notifications screen SHALL show only the rows of that kind, and "All" SHALL show every row.
4. THE Settings screen SHALL be a separate route at `/settings` and SHALL show a back control, the header "Settings" and the rows Account, Child profiles, Devices, Routines, Privacy, Notifications, Language, Help and About, in that order. This nine-row list is founder-directed from the step brief and has **no Reference cell**; the Reference's screen 16 draws only the Notifications list.
5. WHEN a user presses Child profiles, Devices, Routines, Privacy or Notifications, THE Parent_App SHALL open `/child-profile`, `/device`, `/routines`, `/privacy` or `/notifications` respectively.
6. THE Account, Language, Help and About rows SHALL be non-pressable and SHALL show the muted trailing text "Later phase" (D20).
7. THE Settings screen SHALL show no secret, no token, no key name, no endpoint and no environment value.

### Requirement 19: Mock data and local state

**User Story:** As Omar, I want this phase provably offline and stateless, so that Phase 3 can wire the real data without untangling anything.

#### Acceptance Criteria

1. EACH Built_Screen that renders mock values SHALL take them from a typed Mock_Module in its feature folder, and SHALL accept that module as an optional prop so tests can inject their own. THE Splash, Parent Account and Settings screens hold no mock values — their only data are strings and the Route_Table — so they take no data prop. THE design SHALL give the prop signature of all sixteen screens in one table.
2. THE Mock_Modules SHALL reuse `packages/shared` domain types through `import type` only, with `Pick` where only part of a type is needed, and SHALL define app-local types for anything the domain does not cover.
3. THE Parent_App SHALL hold every interactive value in local React state, and SHALL reset to the Mock_Module values on reload.
4. THE Parent_App SHALL use no persistence API, including `AsyncStorage`, `expo-secure-store`, `expo-file-system` and `localStorage`.
5. THE Mock_Modules SHALL contain no child audio, no transcript, no raw sensor value, no contact detail, no price and no URL: display names, identifiers, counts, enum values, labels and times only (D13).
6. THE Mock_Modules SHALL be self-consistent across screens: the same parent, child, second child, device and household appear with the same names everywhere.

### Requirement 20: Illustrations and avatars

**User Story:** As Omar, I want every picture in the app to be ours.

#### Acceptance Criteria

1. EVERY Illustration SHALL be an original static SVG component under `apps/parent-app/src/illustrations/`, drawn with `react-native-svg`, with fills from the Theme_Module only.
2. EVERY Illustration file SHALL carry the licence comment "Original work, Xelulu-owned" and SHALL appear in the Design_System_Doc's asset list.
3. THE Parent_App SHALL contain no photograph, no raster asset and no third-party art file.
4. EVERY Illustration SHALL carry either the `image` role with an accessibility label, or be hidden from accessibility when adjacent text already says it.
5. NO Illustration SHALL animate, and none SHALL flash between 3 and 30 Hz (`safety.md` §6, D11).
6. THE Avatar SHALL fall back to the initial letter of the name when no Illustration is given (D8).

### Requirement 21: Accessibility

**User Story:** As a parent who uses large text or a screen reader, I want all 16 screens to work.

#### Acceptance Criteria

1. EVERY pressable control on a Built_Screen SHALL carry an accessibility role and an accessibility label, and SHALL have a touch area of at least 44×44 pt.
2. EVERY SegmentedTabs control SHALL expose the selected state on the selected option only, so that exactly one option **inside that control's `tablist`** reports `accessibilityState.selected`. This is a per-`tablist` property, not a per-screen one: `tab-bar.tsx` and `segmented-tabs.tsx` both render the `tab` role, and on a Tab_Route one Tab_Bar tab is also selected. EVERY assertion of this clause SHALL therefore be scoped inside that control's `tablist`, named by the feature's `segmentsLabel` string.
3. EVERY status on a Built_Screen SHALL appear as text next to its colour, never as colour alone.
4. THE Token_Source SHALL list a Contrast_Pair for every new text, icon or control-boundary colour on every background it is used on, and every pair SHALL meet its minimum: 4.5:1 for text below the large-text size, 3:1 for large text, icons and control boundaries.
5. THE Parent_App SHALL leave system font scaling on, and SHALL cap it with `maxFontSizeMultiplier` only inside a Dense_Component.
6. EACH Built_Screen SHALL expose exactly one element with the `header` accessibility role whose accessible name is that route's `SCREEN_HEADER_NAME` value, as its screen title — except the Splash screen at `/`, which is neither a Tab_Route nor a Stack_Route and has no `SCREEN_HEADER_NAME` entry; its header name is the shell's `wordmark` string. Section headings rendered with `SectionTitle` also carry the `header` role and are additional headings, not screen titles; a screen SHALL NOT expose a second `header`-role element with the screen title's name.
7. EVERY TextField SHALL be labelled, and its error line SHALL be associated with it by `accessibilityLabel` or `accessibilityHint`.
8. THE Confirm_Dialog SHALL move focus into itself when it opens and SHALL expose the `alert` role.

Note: these checks cover the basics only. Full WCAG validation needs manual testing with assistive technologies and an expert accessibility review.

### Requirement 22: Boundaries, privacy and safety

**User Story:** As Omar, I want the phase to stay inside the lines that steering draws.

#### Acceptance Criteria

1. THE Parent_App source SHALL contain no `fetch(`, `XMLHttpRequest`, `WebSocket` or `EventSource`, and no import of `@supabase/*`, `mqtt` or `ws`.
2. THE Parent_App SHALL read no environment variable and SHALL talk no MQTT.
3. THE Parent_App SHALL import from `@xelulu/shared` with `import type` only, and SHALL import nothing from `apps/admin` or `services/*`.
4. THE Parent_App SHALL contain no `Animated` usage, no `react-native-reanimated` or `moti` import, and no `animate-` or `transition` class.
5. THE Parent_App SHALL declare no new runtime dependency (D7), and SHALL keep `expo-dev-client`, Rive, Lottie, every media picker and every camera or video module out of its `package.json`.
6. THE Parent_App SHALL contain no camera feature and no video view, and the only "Camera" text SHALL be the device row of Requirement 14.4 (D3).
7. THE Parent_App SHALL contain no non-local URL literal and no `KEY=value` or `KEY: value` Panel_Key line in any tracked file.
8. THE Parent_App SHALL keep every user-facing string of a feature in that feature's `strings.ts` module.
9. THE Parent_App SHALL contain no purchase, advertisement, sign-up link, price, phone number or brand link, and no open-internet affordance (`safety.md` §3).
10. THE Parent_App source files SHALL use kebab-case file names and PascalCase types. Mock_Module payload field names SHALL use snake_case, matching the shape a domain row would have so Phase 3 can swap a mock for a real row (the Phase 2.1 `HomeData` already does this). EVERY other identifier — props, locals, functions, components — SHALL be camelCase or PascalCase as its kind requires.
11. THE Parent_App SHALL compile under TypeScript strict mode with no `any`, no non-null assertion and no `@ts-expect-error`.

### Requirement 23: Protected files

**User Story:** As Omar, I want this phase to touch nothing it has no business touching.

#### Acceptance Criteria

1. THE implementation SHALL leave `docs/**` **at the repo root**, `packages/shared/src/**`, `.env.example`, `tooling/fixtures/approved-panel.txt`, `.github/workflows/ci.yml`, `apps/admin/**`, `services/**` and every other spec folder unchanged. `apps/parent-app/docs/design-system.md` is **not** covered by this clause: it is in scope for Requirement 24.
2. THE only Repo_Checks the implementation SHALL change are `tooling/test/layout.test.ts`, `tooling/test/placeholder.test.ts` and `tooling/test/contrast.test.ts`, and `tooling/test/readme.test.ts` only if the README changes.
3. EVERY other Repo_Check, including `env-reads.test.ts`, `url-scan.test.ts`, `secret-check.test.ts`, `file-names.test.ts`, `tsconfig.test.ts`, `manifests.test.ts` and `no-cross-package-import.test.ts`, SHALL pass unchanged.

### Requirement 24: Docs

**User Story:** As Omar, I want the additions written down where the design system already is.

#### Acceptance Criteria

1. THE Design_System_Doc SHALL add every Kit_Addition with its props and when to use it, the three additive `ListRow` props, every new token with its value and use, and every new Contrast_Pair with its ratio and minimum.
2. THE Design_System_Doc SHALL list every Illustration in its asset list with the licence line.
3. THE Design_System_Doc SHALL record the D6 age-stage ranges as the app's assumption, and SHALL record that the Volume control is stepped because this phase adds no dependency (D7, D19).
4. THE Design_System_Doc SHALL note that `PlaceholderScreen` is removed and why.
5. THE root README SHALL keep its `pnpm start:app` table row wording (including the words "expo go" and "home dashboard") and the `/--/` deep-link substring, SHALL replace the sentence "The app itself opens on the Home dashboard" with "The app opens on the splash and then the Home dashboard", SHALL delete the now-false sentence "Every screen other than Home is a titled placeholder in this phase.", and SHALL add that `/--/reports` and `/--/grandma-mode` are new routes.

### Requirement 25: Repo checks

**User Story:** As the implementation engineer, I want the Phase 2.1 checks updated only where this phase changes what they guard.

#### Acceptance Criteria

1. THE `layout.test.ts` Repo_Check SHALL require exactly the Phase 2.1 route files plus `reports.tsx` and `grandma-mode.tsx` under `apps/parent-app/app` (D2).
2. THE `placeholder.test.ts` parent-app block SHALL keep every Phase 2.1 check except the `"Camera` string-literal ban, which SHALL be narrowed to allow the label only in the device feature's string module and screen file (D3).
3. THE `placeholder.test.ts` Repo_Check SHALL add a positive assertion that the device feature's strings hold "Not included on this model" and that the camera row carries no toggle, switch or press handler.
4. THE `placeholder.test.ts` Repo_Check SHALL add a ban on imports of `expo-image-picker`, `expo-media-library`, `@react-native-async-storage/async-storage`, `expo-secure-store` and `expo-file-system` (D8, Req 19.4).
5. THE `placeholder.test.ts` font-cap allow-list SHALL be extended only if a new Dense_Component needs the cap, and any extension SHALL be named in the Done-when report (D12).
6. THE `contrast.test.ts` Repo_Check SHALL check every Contrast_Pair in the Token_Source, including the new ones, against its minimum, and SHALL keep the admin palette checks unchanged.
7. THE `readme.test.ts` Repo_Check SHALL pass unchanged (Req 24.5).

### Requirement 26: Verification

**User Story:** As Omar, I want a Done-when report backed by tests, plus a short checklist I can run on my phone.

#### Acceptance Criteria

1. THE App_Test_Suite SHALL stay smoke and key-interaction only, example-based, with no fast-check in the app.
2. THE App_Test_Suite SHALL show that every Tab_Route and Stack_Route, including `/reports` and `/grandma-mode`, renders its Built_Screen with its `SCREEN_HEADER_NAME` value (Requirement 3.4), and that the five Tab_Bar tabs — **identified by their `TAB_LABEL` names, not by the `tab` role alone** — appear on a Tab_Route and on no other route. `SegmentedTabs` options carry the same `tab` role, so a whole-screen role count is false on every segmented screen; the count SHALL filter `queryAllByRole("tab")` by `TAB_LABEL` membership.
3. THE App_Test_Suite SHALL show, with Jest fake timers, that `/` renders the Splash screen, that it replaces to `/home` after 1,200 ms, and that unmounting before then navigates nowhere (D1).
4. THE App_Test_Suite SHALL show the Setup_Flow chain: "Get Started" opens `/auth`, "Create Account" with filled fields opens `/pair-device`, "Start Pairing" advances the StepList and on the last step opens `/child-profile`, and "Continue" opens `/home`.
5. THE App_Test_Suite SHALL show that the Google and Apple buttons navigate nowhere and show the not-available line (D17).
6. THE App_Test_Suite SHALL show the age-stage function returning `tiny`, `little`, `explorer` and `maker` at the 3, 6 and 9 year boundaries, and the invalid-date line on the Child Profile screen.
7. THE App_Test_Suite SHALL show the Live View controls: Mute and Speaker flip and expose their state, and End Call leaves the screen (D4).
8. THE App_Test_Suite SHALL show one segmented control per segmented screen filtering or swapping its content, and exposing exactly one selected option **within that control's `tablist`** (Requirement 21.2).
9. THE App_Test_Suite SHALL show a Routines toggle flipping one row only, and "+ Add Routine" appending a row.
10. THE App_Test_Suite SHALL show the three battery tones at 20, 19, 10 and 9 percent on the Device screen and on Home's status pill, with the percentage in the text (D15).
11. THE App_Test_Suite SHALL show the Device camera row rendering "Not included on this model" with no switch role and no press handler.
12. THE App_Test_Suite SHALL show the Privacy "Delete or Export Data" flow: the dialog opens, cancel changes nothing, and confirming shows the mock line without claiming a deletion or an export.
13. THE App_Test_Suite SHALL show Grow opening `/reports` and the Family Grandparents row opening `/grandma-mode`.
14. WHEN `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test` run, each SHALL succeed, and `pnpm test` SHALL run the App_Test_Suite.
15. THE design SHALL give a manual phone checklist for Omar to run in Expo Go, one line per screen. The agent does not run it.
16. THE App_Test_Suite SHALL open its Home-control, settings-control, tab-bar and Play-tab assertions at `ROUTE_PATH.home`, not at `/`, because `/` is the Splash (D1). Only the splash cases of Requirement 26.3 SHALL open at `/`. THE eight migrated cases SHALL keep their **intent**, with one exception: their tab-count and selected-count assertions SHALL be rescoped per Requirements 21.2 and 26.2 — counted through the `TAB_LABEL` filter, and for the Play-tab case asserted as "the Play tab is selected" plus one selected Tab_Bar tab — because `SegmentedTabs` shares the `tab` role and a whole-screen count is arithmetically false once the segmented screens exist.

### Requirement 27: Open items carried forward

**User Story:** As Omar, I want to know what is still unresolved after this phase.

#### Acceptance Criteria

1. THE spec SHALL record that legal review of reports and cry alerts against DPDP s.9 is still pending, and that Reports, Grow and Notifications are static mock summaries until it completes (D14).
2. THE spec SHALL record that the Reference's "Rotate" control and "Video Call with Xelulu" row are deliberately not built, with D4 and D5 as the reasons.
3. THE spec SHALL record that the D6 age-stage ranges are the app's assumption, to be confirmed against the product docs when they name ranges.
4. THE spec SHALL record that real consent capture, real deletion and real export arrive with Supabase in a later phase, and that this phase builds only the surface.

## Corrections made in response to the design reviews

Round 1 (26 findings) added Requirement 26.16 and clarified the Glossary, the Introduction and
Requirements 4.1, 5.1, 5.2, 16.1, 18.4, 19.1, 22.10 and 24.5, plus two superseded Phase 2.1 items.

Round 2 (18 findings) made these corrections, each because the reviewer verified the opposite
against the code or against the frozen Reference:

- **Requirement 2.1 / D21.** `ListRow`'s `tone="danger"` tints the title and `trailingText` only.
  It cannot tint the leading glyph, because `IconTile` hard-codes `color="brand"` and Requirement
  1.3 forbids editing it. Danger-toned text is `AppText` with `className="text-danger"`; no tone is
  added to `AppText`.
- **Requirement 3.2.** `STACK_KEYS` and `ROUTE_PATH` live in the Route_Table; `ROUTE_TITLE` is
  exported from the shell strings, which is where the code has it.
- **Requirement 3.4 and 26.2.** `SCREEN_HEADER_NAME` is named as the single source of accessible
  header names, for Tab_Routes as well as Stack_Routes.
- **Requirement 8.3.** The gender chip row starts on "Boy", as the Reference draws it.
- **Requirement 16.1.** The claim that the Reference draws the Festival row with a chevron was
  wrong: the Reference draws no chevron on any screen-13 row, so all four rows pass
  `trailing="none"`.
- **Requirement 17.1.** Screen 14's danger row is specified as the Reference draws it: a centred
  row with a small inline glyph, no icon tile, no subtitle and no chevron.
- **D22.** `app/device.tsx`'s existing note contradicts D3 and is rewritten.
- **D23 (new FLAG).** The two `structure.md` extensions � `src/illustrations/` and the seven feature
  folders � are now a named choice rather than only a design argument.

Round 3 (17 findings) added the **D24 FLAG** (eight further Reference deviations) and corrected
Requirements 11.5, 12.1, 14.2, 15.2, 21.6 and 23.1.

Round 4 (14 findings) made these corrections, each because the reviewer verified the opposite
against the code or against the frozen Reference:

- **Requirement 21.2, 26.2 and 26.16.** `tab-bar.tsx` and `segmented-tabs.tsx` both render
  `accessibilityRole="tab"`, so Tab_Bar presence is counted by `TAB_LABEL` name and "exactly one
  option selected" is a per-`tablist` property. Req 26.16's "the migrated assertions are unchanged"
  now carries the rescoping exception for the tab-count and selected-count assertions. This was the
  round's HIGH finding; the mechanism is in the design's "Counting tabs: Tab_Bar versus
  SegmentedTabs".
- **Requirement 21.6.** The Splash screen at `/` is named as the exception: it has no
  `SCREEN_HEADER_NAME` entry, and its header name is the shell's `wordmark` string.
- **Requirement 15.3.** The Caregivers segment renders **each member's own** permission line.
  `MOCK_FAMILY.caregivers` holds Dad (a parent) and Meera (a caregiver), so one hard-coded
  caregiver line would have stated a caregiver's limits over a parent's name, contradicting
  `product.md`.
- **Requirement 5.2.** The carousel's page width is pinned: `useWindowDimensions` minus the
  `Screen`'s horizontal padding on both sides, used as the `scrollTo` multiplier and the index
  divisor, so `pagingEnabled`, a dot press and the derived index agree.
- **Requirement 6.5.** Screen 3 has one notice slot with a stated precedence: a provider press
  replaces the fill-in line until a field changes.
