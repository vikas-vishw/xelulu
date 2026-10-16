# Implementation Plan: Phase 2.2 Parent App Screens

## Overview

Build order, in six waves plus a verification wave: foundations (tokens, kit additions,
illustrations, shared libs, shell, splash), the setup flow, play/grow/reports/live-call,
routines/device/family, grandma/privacy/notifications/settings, cross-cutting tests and docs, then
the final verification and Done-when report.

The seven verification points are tasks **1.11, 2.7, 3.6, 4.6, 5.7, 6.5 and 7.1**; `pnpm build`,
`pnpm lint`, `pnpm format:check` and `pnpm test` must all pass there, so each wave is independently
verifiable and the reviewer can approve or stop at its checkpoint. The dependency-graph **batches**
at the end of this document are execution order only, and the suite may be red between them â€” in
particular between tasks 3.1/3.3 and 3.5 (the generic per-route header assertion still compares
`ROUTE_TITLE` while `SCREEN_HEADER_NAME.play` is already "Play with Xelulu" and `ROUTE_TITLE.reports`
is "Reports") and between tasks 4.3 and 5.1 (Family's Grandma row is deliberately left unwired
until the `/grandma-mode` route exists). Do not read a batch boundary as a green bar (review
round-4 finding 7). No wave leaves a route without a screen: `PlaceholderScreen` is deleted only in
wave 4, after the last placeholder route is replaced.

Rules for every task: TypeScript strict, no `any`, no non-null assertion, no `@ts-expect-error`;
kebab-case file names; no colour literal outside `src/theme/tokens.json`; no new runtime dependency;
no network call, environment read, persistence API, media picker, camera or video module; no
animation; no non-local URL literal; no `KEY=value` or `KEY: value` Panel_Key line; `@xelulu/shared`
by `import type` only; every user-facing string in its feature's `strings.ts`; no git commits.

Five traps the existing checks and the existing suite set, each of which turns a wave checkpoint red
for a reason that is not obvious from the failure message:

- **The `tab` accessibility role is shared by the Tab_Bar and every `SegmentedTabs` option.**
  `tab-bar.tsx` and `segmented-tabs.tsx` both render `accessibilityRole="tab"` with
  `accessibilityState.selected`, and `test/navigation.test.tsx` asserts
  `queryAllByRole("tab")).toHaveLength(isTab ? TAB_KEYS.length : 0)` for every route plus exactly
  one selected tab after pressing Play. The moment a segmented screen exists those counts are
  false â€” `/play` 9, `/grow` 8, `/family` 8, `/privacy` 3, `/notifications` 3, `/reports` 2 â€” and
  the Play-tab case sees two selected tabs. `PageDots`' interactive dots carry the same role, so
  `/onboarding` adds three more. **Count Tab_Bar tabs by name and scope every segment
  assertion to its `tablist`**, exactly as the design's "Counting tabs: Tab_Bar versus
  SegmentedTabs" gives it:

  ```ts
  const TAB_LABELS: ReadonlySet<string> = new Set(TAB_KEYS.map((k) => TAB_LABEL[k]));
  const isSelected = (t: { props: { accessibilityState?: { selected?: boolean } } }): boolean =>
    t.props.accessibilityState?.selected === true;
  // No segment label collides with a tab label, so this filter is exact. Keep it that way.
  const tabBarTabs = (): unknown[] =>
    screen.queryAllByRole("tab").filter((t) => TAB_LABELS.has(String(t.props.accessibilityLabel)));
  ```

  Segment assertions:
  `within(screen.getByRole("tablist", { name: <feature>.segmentsLabel })).getAllByRole("tab", { selected: true })`
  has length 1. Tasks 1.9, 3.5, 4.5 and 5.6 own this; no task may assert a whole-screen `tab` count.
- **Every `SegmentedTabs` needs its `accessibilityLabel`.** The prop is required, and the string is
  the feature's `segmentsLabel` in its `strings.ts` (Req 22.8): "Play categories", "Growth
  sections", "Family groups", "Privacy sections", "Report period", "Notification kinds". It is also
  the `{ name }` the scope above resolves against, so the two rules are one string.
- **The word `dense` must not appear in any parent-app source file** outside the four font-cap
  files (`app-text.tsx` and the three Phase 2.1 Dense_Components) â€” **including inside a comment**.
  `tooling/test/placeholder.test.ts` asserts `not.toMatch(/\bmaxFontSizeMultiplier\b|\bdense\b/)`
  per file, case-sensitively, so a new component or mock module that merely mentions "dense tiles"
  in prose fails the check. Write "Dense_Component" (capitalised) when the concept must be named.
- **Danger-toned text is `<AppText variant="â€¦" className="text-danger">`.** `AppText`'s `TextTone`
  union is `primary | secondary | muted | brand | info | on-brand` and Req 1.3 forbids adding a
  member, so `tone="danger"` fails `tsc --noEmit`. The class exists because `tailwind.config.js`
  builds `colors` from `tokens.color`, and it carries no colour literal, so the token scan stays
  green. This is the only mechanism for danger text in the phase.
- **No string outside the device feature may begin with the word "Camera".** The live scan is
  `expect(src).not.toMatch(/["'`]Camera/)`, so it trips on any string *starting* "Camera", and D3
  allow-lists only `src/features/device/strings.ts` and `src/features/device/device-screen.tsx`.
  The two strings most at risk are screen 5's photo-badge strings, which are pinned verbatim in
  task 2.1. The glyph name `"camera-outline"` is lowercase and safe.

One more rule about the frozen Reference: claims about layout, row order, copy, control shape and
the presence or absence of a control are traced readings of the Reference and must be matched.
Claims that would need sub-pixel detail from a 1536Ã—1024 PNG holding sixteen mockups â€” an exact
separator codepoint, a one-step colour difference, whether a given chip is filled â€” are **design
decisions**, written down in `design.md`, and the implementation follows the written decision
rather than re-reading the image.

Do not edit: `docs/**`, `packages/shared/src/**`, `.env.example`,
`tooling/fixtures/approved-panel.txt`, `.github/workflows/ci.yml`, `apps/admin/**`, `services/**` or
any other spec folder. The only Repo_Checks this phase touches are
`tooling/test/placeholder.test.ts` and `tooling/test/layout.test.ts`.

Toolchain for every command (PowerShell): `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" +
$env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack";
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...` from `c:\xelulu`. Never system
Node 22 or a global pnpm.

## Tasks

- [x] 1. Wave 0 â€” tokens, component kit, illustrations, shared libs, shell and splash
  - [x] 1.1 Extend `src/theme/tokens.json` and `src/theme/theme.ts`
    - Add `color.illustration-night` `#2B3A55` and `color.scrim` `#2E2620`; add the top-level block
      `"opacity": { "scrim": 0.4 }`
    - Add the **seven** Contrast_Pairs from the design, each with its stated `use`:
      `danger`/`surface` min 4.5 (ratio 5.62), `danger`/`page` min 4.5 (5.01),
      `control-off`/`page` min 3 (3.52), `text-secondary`/`surface-beige` min 4.5 (6.32), and the
      three battery-bar pairs `success`/`hairline` min 3 (**3.69**), `warning`/`hairline` min 3
      (**3.73**), `danger`/`hairline` min 3 (**4.04**). The last three are the ones round 1 of the
      review found missing: the Device battery bar draws a tone-coloured fill on a `hairline`
      track, and `contrast.test.ts` only checks pairs that are listed. The ratios in brackets are
      the repo formula's output rounded to two places â€” round 2 of the review corrected
      `warning`/`hairline` from 3.70 and `danger`/`hairline` from 4.05, and task 6.3 copies these
      corrected figures into the Design_System_Doc. The check compares against `min`, not against
      the documented figure, so all seven pass either way
    - The `danger`/`surface` pair's `use` names exactly what it covers: the `ListRow tone="danger"`
      title and `trailingText`, and the Privacy screen's delete-or-export label. It does **not**
      cover screen 7's End Call label, which is `text-primary` under a danger-filled disc
    - Add **no** Contrast_Pair for the `hairline` control border: it is decorative (1.39:1 on
      `surface`), a control's boundary is carried by its fill, its label and its 44 pt target, and
      Phase 2.1 already draws buttons, cards, pills, tabs and the tab bar with it. Listing it would
      fail the check for no gain
    - Change no existing token and no existing pair's `fg`, `bg` or `min`. The **only** edit to an
      existing pair is the `use` string of `danger`/`surface` min 3, which becomes
      "Critical-battery dot (graphic, 3:1)" so the new min-4.5 `danger`/`surface` text pair beside
      it reads as deliberate rather than as a mistake
    - `theme.ts`: add `opacity: Readonly<Record<"scrim", number>>` to the `Tokens` type
    - Leave `tailwind.config.js` alone: it derives classes from the tokens already
    - `tooling/test/contrast.test.ts` must pass unchanged: it already iterates every Contrast_Pair,
      so the seven new pairs are checked without editing it. The phase ends with 28 pairs against
      the check's non-vacuity floor of 20
    - **Property 2: Every listed pair meets its minimum**
    - _Requirements: 1.1, 1.4, 21.4, 25.6_
  - [x] 1.2 Extend `IconName` and the kit strings
    - `src/components/icon.tsx`: add exactly the glyph names in the design's `IconName` table,
      alphabetically inside the union, **each name exactly once** (`lock-closed-outline` is listed
      under "Form fields" only; the design's Privacy row no longer repeats it). Change nothing else
      in the file
    - Add **no name the table does not list**. Round 4 deleted six that no screen cell renders â€”
      `ellipse`, `download-outline`, `image-outline`, `paw-outline`, `planet-outline` and
      `trophy-outline` â€” on the same rule that dropped `musical-notes-outline`: an unused union
      member is one more name to keep true. The pending `StepList` circle holds the step's own
      icon, the dialog's "Export data" action is a glyphless `Button`, the interest tiles draw
      Illustrations and the milestone rows use `checkmark-circle`, so none of the six has a renderer
    - `src/components/strings.ts`: add the Kit_Addition defaults â€” "Show password", "Hide password",
      the StepList state words ("done", "current step", "not started"), the PageDots label builder
      ("Page N of M"), the Stepper minus and plus labels, the Avatar fallback label builder, the
      Confirm_Dialog default cancel label
    - If `tsc` rejects a glyph name, swap it for the nearest alternative in the same table row and
      record the swap for the Done-when report
    - _Requirements: 1.1, 2.1, 22.8_
  - [x] 1.3 Add Kit_Additions A: `text-field.tsx`, `chip.tsx`, `avatar.tsx`, `stepper.tsx`, `circle-button.tsx`
    - Props exactly as the design's full `Readonly<{â€¦}>` prop blocks give them; roles, labels,
      states, minimum 44 pt touch areas and pressed-state rules exactly as its notes give them;
      raw values only from `theme.ts`; no animation
    - `TextField`: `accessibilityLabel = label ?? placeholder`, `errorText` also passed as
      `accessibilityHint`, `placeholderTextColor` from `text-muted`, reveal control 44Ã—44, and the
      additive `trailingIcon` â€” a decorative glyph **inside** the field at its right edge, in
      `text-muted`, hidden from accessibility, never pressable, ignored when `secure` is set
    - `CircleButton`: `size?: "badge" | "lg"` drawing a 40 or 64 pt disc (default `lg`), and the
      prop type **exactly** as the design gives it â€” a `CircleButtonBase` plus a two-arm
      discriminated union, so `tsc` rejects a button with neither `label` nor `accessibilityLabel`:

      ```ts
      export type CircleButtonProps =
        | (CircleButtonBase & Readonly<{ label: string; accessibilityLabel?: string }>)
        | (CircleButtonBase & Readonly<{ label?: undefined; accessibilityLabel: string }>);
      ```

    - `CircleButton` touch slop is `const slop = Math.max(0, (tokens.size.touchMin - DISC[size]) / 2); // badge 2, lg 0`.
      The clamp is load-bearing: unclamped it is **âˆ’10** for the `lg` default, and a negative
      `hitSlop` *shrinks* the touch box â€” including the label's, because disc, label and
      `stateText` are one `Pressable`. Add a `components.test.tsx` case asserting the slop is `0`
      or absent for `lg` and `2` for `badge`
    - `Stepper`: `accessibilityRole="adjustable"`, `accessibilityValue` with min/max/now/text, the
      value always visible via `format`, disabled control at each bound
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.10, 2.12, 21.1, 21.7_
  - [x] 1.4 Add Kit_Additions B: `step-list.tsx`, `page-dots.tsx`, `media-card.tsx`, `metric-row.tsx`, `metric-tile.tsx`, `confirm-dialog.tsx`
    - `StepList`: done/current/pending glyph shapes plus the state in each row's accessibility label
    - `PageDots` has **two modes with different spacing**, exactly as the design gives them.
      Decorative (`onSelect` omitted): dots in a row at `gap` spacing 2, container
      `accessible={false}` and `importantForAccessibility="no-hide-descendants"`, nothing
      pressable. Interactive (`onSelect` given): each 8 pt dot centred in its own **44Ã—44 pt
      `Pressable`**, containers edge-to-edge with **no `hitSlop` and no gap**, role `tab`,
      `accessibilityState.selected`, label "Page N of M". Do **not** give tightly spaced dots a
      `hitSlop`: 18 pt of slop per side overlaps both neighbours' centres, so which dot a tap
      selects would depend on z-order, and `fireEvent.press` would never catch it
    - `MediaCard`, `MetricRow`, `MetricTile`: as the design describes, each read as one accessibility
      element where it is not pressable. `MetricRow` and `MetricTile` draw **no divider and expect
      none**: each one sits in its own caller-supplied `Card`, because that is how the Reference
      draws screens 9 and 15
    - `StepList`: the current and pending circles hold the step's own `icon` glyph (in `brand` and
      `control-off` respectively) while a done circle holds `checkmark` on a `brand` fill, so the
      three states differ by shape as well as colour
    - `ConfirmDialog`: `Modal` with `transparent` and `animationType="none"`, scrim from `scrim` at
      `opacity.scrim`, `accessibilityRole="alert"`, `accessibilityViewIsModal`, one handler call per
      press, and focus movement by exactly the design's mechanism â€” `useRef<View>` on the title,
      `findNodeHandle` from `react-native`, and `AccessibilityInfo.setAccessibilityFocus(handle)`
      guarded by `typeof handle === "number"` so a null handle is a silent no-op
    - _Requirements: 2.1, 2.5, 2.6, 2.8, 2.9, 2.11, 2.12, 21.1, 21.8_
  - [x] 1.5 Add the three additive `ListRow` props
    - `leading`, `trailingText` and `tone` exactly as the design's prop type shows
    - `trailingText` is appended to the row's accessibility label as `"<title>, <trailingText>"`
      **only when `onPress` is set**. On a non-pressable row it renders as its own `AppText`
      (`label`/`text-muted`, or the danger class) and is announced in document order; the row adds
      no `accessible` wrapper and no `accessibilityLabel`. `list-row.tsx`'s non-pressable branch is
      a bare `View` with neither, and it is **not** given one: every `trailingText` consumer in
      this phase except Routines is non-pressable, and wrapping them would merge the title,
      subtitle and trailing text into one announcement
    - `tone="danger"` tints the **title and `trailingText`** only, through
      `className="text-danger"` on `AppText`. It must **not** tint the leading glyph: `ListRow`
      draws `icon` through `IconTile`, which hard-codes `color="brand"` and exposes only
      `tone?: "beige" | "surface"`, and Req 1.3 forbids editing `icon-tile.tsx`. A row that wants a
      coloured glyph passes `leading={<Icon name="â€¦" color="danger" decorative />}` instead
    - Do not add `danger` to `AppText`'s `TextTone`, and do not edit `app-text.tsx`,
      `icon-tile.tsx` or any other kit file
    - The default rendering with none of the three set must be unchanged, and no other kit component
      may change
    - _Requirements: 1.3, 2.1_
  - [x] 1.6 Add `src/illustrations/`
    - `play-scene.tsx`, `story-scene.tsx`, `person-figure.tsx`, `space-scene.tsx`, `dino-scene.tsx`
      and the `illustration.tsx` registry with `ILLUSTRATION_NAMES`, `IllustrationName` and the
      `Illustration` component
    - Each art file: `react-native-svg`, fills from `theme.ts` only, the licence comment
      "Original work, Xelulu-owned. No third-party art.", `{ width, height }` props, decorative by
      default and `image` role with a label when one is given, no animation and nothing that could
      flash
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 22.4_
  - [x] 1.7 Add `src/lib/` and wire Home to it
    - `battery.ts` (`batteryTone` with the 20 % / 10 % thresholds), `text.ts` (`isBlank`),
      `mock-identity.ts` (`MOCK_IDENTITY` as the design lists it)
    - `src/features/home/home-dashboard.tsx`: delete the local `batteryTone` and import it;
      `mock-home.ts`: take the three names and two ids from `MOCK_IDENTITY`. No other Home change,
      and `test/home-dashboard.test.tsx` must still pass as it stands
    - _Requirements: 19.6, 14.7, 1.3_
  - [x] 1.8 Extend the shell
    - `src/features/shell/go-back.ts`: `goBack()` with the Phase 2.1 behaviour
    - `src/features/shell/screen-title.tsx`: `ScreenTitle` with `name`, `back`, `right`,
      `align` and the title-only accessible wrapper, as the design specifies.
      `align?: "start" | "center"` defaults to `"start"`, and the accessible header wrapper is
      rendered `flex-1` with `items-start` or `items-center` from it:
      `className={align === "center" ? "flex-1 items-center" : "flex-1 items-start"}`. Screens 1â€“5
      pass `align="center"`; without the prop there is no way to centre those five headings without
      inventing a per-screen wrapper, which Req 2.1 keeps out of the kit (review round-4 finding 4)
    - `src/features/shell/strings.ts`: add `SCREEN_HEADER_NAME` for every non-Home route key,
      seeded with that key's `ROUTE_TITLE`. Five entries differ from their `ROUTE_TITLE` because
      the Reference's header text differs, and each is owned by the task that builds that screen,
      so the navigation test's single header assertion stays true at every checkpoint:
      `.play` â†’ task 3.1, `.grow` â†’ task 3.2, `.reports` â†’ task 3.3, `.routines` â†’ task 4.1,
      `.family` â†’ task 4.3. Leave `PLACEHOLDER_LINE` in place until task 5.5
    - **`SCREEN_HEADER_NAME` is the only place a header literal is written** where the visible
      title equals the accessible name. Those screens render `SCREEN_HEADER_NAME[key]` directly and
      their feature `strings.ts` holds **no `header` entry**: `/play`, `/grow`, `/routines`,
      `/family`, `/reports`, `/settings`, `/notifications`, `/privacy`, `/grandma-mode`,
      `/voice-call`. Only screens 1, 3, 4, 5 and 11 â€” where the visible wording differs from the
      accessible name â€” keep a title string of their own. A `subheader` string is not a header and
      stays in its feature
    - Add the splash footer string with a comment pinning the separator **as a decision**:
      `Play â€¢ Learn â€¢ Grow â€¢ Together` uses U+2022 BULLET and single spaces, not U+00B7 MIDDLE DOT.
      The Reference asset cannot settle a 2â€“3 px glyph, so this is the written choice, not a
      reading, and the comment says which codepoint it is because a diff cannot show it
    - _Requirements: 1.5, 3.4, 21.6, 22.8_
  - [x] 1.9 Build screen 1 and replace `app/index.tsx`
    - `src/features/shell/splash-screen.tsx` + `src/features/shell/strings.ts` additions: the
      wordmark, the two tagline lines, `CharacterPlaceholder` 200, decorative `PageDots count=3`,
      the footer row, `SPLASH_DELAY_MS = 1200`, and the `setTimeout` â†’ `router.replace(ROUTE_PATH.home)`
      cleared on unmount
    - `app/index.tsx`: render `<SplashScreen />` only (no `Redirect`)
    - Migrate **every** `openApp("/")` in `test/navigation.test.tsx` that expects Home to
      `openApp(ROUTE_PATH.home)`. The file has **five `openApp("/")` call sites covering nine test
      cases**: the redirect case (replaced below) plus **eight to migrate** â€” the tab-bar case, the
      Play-tab-press case, the four `Home controls` `it.each` cases and the two
      `pressing settings control %i` cases. Their assertions keep their intent (Req 26.16). Without
      this the wave 0 checkpoint ends red with at least eight failures
    - **Add the `tabBarTabs()` helper now, and route all three tab assertions through it**, so the
      suite does not go red in wave 2 when the first `SegmentedTabs` screen lands. `tab-bar.tsx`
      and `segmented-tabs.tsx` both render `accessibilityRole="tab"` with
      `accessibilityState.selected`, so a whole-screen role count is arithmetically false on every
      segmented screen (`/play` 9, `/grow` 8, `/family` 8, `/privacy` 3, `/notifications` 3,
      `/reports` 2 against an expected 5, 5, 5, 0, 0, 0), and the Play-tab case would see two
      selected tabs. Add, verbatim:

      ```ts
      const TAB_LABELS: ReadonlySet<string> = new Set(TAB_KEYS.map((k) => TAB_LABEL[k]));
      const isSelected = (t: { props: { accessibilityState?: { selected?: boolean } } }): boolean =>
        t.props.accessibilityState?.selected === true;
      /** Tab_Bar tabs only: `SegmentedTabs` options share the `tab` role. No segment label in this
       *  phase collides with a tab label, so the filter is exact â€” keep it that way. */
      const tabBarTabs = (): unknown[] =>
        screen.queryAllByRole("tab").filter((t) => TAB_LABELS.has(String(t.props.accessibilityLabel)));
      ```

      then: (a) the generic per-route case asserts
      `expect(tabBarTabs()).toHaveLength(isTab ? TAB_KEYS.length : 0)`; (b) the tab-bar ordering
      case reads its labels off `tabBarTabs()` and asserts one selected among them (at `/home` the
      filter is a no-op, because Home renders no `SegmentedTabs`); (c) the Play-tab case asserts
      `expect(screen.getByRole("tab", { name: TAB_LABEL.play })).toBeSelected()` plus
      `expect(tabBarTabs().filter(isSelected)).toHaveLength(1)`, **not** a whole-screen selected
      count (review round-4 finding 1, Req 21.2, 26.2, 26.16)
    - Replace the `redirects / to /home (Req 4.2)` case with three splash cases under
      `jest.useFakeTimers()`: (a) `/` renders the Splash â€” the wordmark and the footer row are on
      screen and the pathname is still `/`; (b) `act(() => jest.advanceTimersByTime(1200))` leaves
      the router at `/home`; (c) unmounting before advancing leaves the pathname unchanged
    - If `renderRouter` will not cooperate with fake timers, fall back to keeping case (a) in the
      router test and asserting the timing by rendering `<SplashScreen delayMs={0} />` directly
      with a mocked `router`; record which path was taken for the Done-when report
    - **Property 7: The splash leaves for Home once, and never after unmount**
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 26.3, 26.16_
  - [x] 1.10 Extend `test/components.test.tsx`
    - Keep every Phase 2.1 case. Add: TextField typing, masking and reveal, plus a `trailingIcon`
      case (the glyph renders, is hidden from accessibility and is not pressable); Chip press and
      selected state; Avatar initial and `image` role; StepList's three state labels; PageDots
      press and selected dot; Stepper Â±, clamping, disabled bounds and `accessibilityValue`;
      MediaCard press and label; MetricRow and MetricTile as single accessibility elements;
      CircleButton press, danger tone, `stateText`, the `badge` size case (no visible label,
      the accessible name comes from `accessibilityLabel`) and the **slop case** â€” `hitSlop` is `0`
      or absent for the `lg` default and `2` for `badge`, so the clamp cannot be dropped;
      ConfirmDialog `alert` role,
      `accessibilityViewIsModal`, cancel, and one call per action
    - `ListRow`'s three new props, with `trailingText` tested on **both** branches: a **pressable**
      row's accessibility label contains `"<title>, <trailingText>"`; a **non-pressable** row shows
      the trailing text on screen and exposes **no** accessibility label at all. Also: `leading`
      renders in the icon slot and is used instead of `icon`; `tone="danger"` leaves the leading
      slot untouched; and the default rendering with none of the three props set is unchanged
    - **Property 3: Kit_Additions report state and call handlers once**, **Property 4: State is
      never colour alone** (example-based)
    - _Requirements: 26.1, 2.2â€“2.12, 21.1, 21.3_
  - [x] 1.11 Wave 0 checkpoint
    - Run `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`,
      `corepack pnpm test`. Fix every failure before wave 1. Report what changed and anything the
      reviewer should look at

- [x] 2. Wave 1 â€” the setup flow (screens 2, 3, 4, 5)
  - [x] 2.1 Add the setup feature's data, strings and age-stage function
    - `src/features/setup/strings.ts`: every string of the four screens, including the muted lines
      (`fillAllFields`, `providerUnavailable`, `providerA11y`, `photoUnavailable`, `addPhotoA11y`,
      `dobFormat`, `ageStageLine`) and the static terms line
    - Pin these two strings **verbatim**, because the live scan trips on any string beginning
      "Camera" and these are the two most likely to:
      `photoUnavailable: "Adding a photo is not available in this build."` and
      `addPhotoA11y: "Add photo. Not available in this build."`
    - `src/features/setup/mock-setup.ts`: `MOCK_ONBOARDING`, `MOCK_PAIR_STEPS`, `MOCK_CHILD_DRAFT`,
      typed as the design gives them, names from `MOCK_IDENTITY`, `ChildProfile` by `import type`.
      `MOCK_CHILD_DRAFT` carries `gender_label: "Boy"`, which is the chip the Reference draws
      selected; it is the initial selection and nothing else reads it (Req 8.3)
    - `ChildDraft`'s `Pick` is `"display_name" | "date_of_birth"` **only**. The chip labels are
      app-local fields: `language_labels: readonly ["English", "Hindi"]`,
      `primary_language: "English"` (the chip the Reference draws filled) and
      `interest_labels: readonly ["Animals", "Space", "Dinosaurs"]`. Do **not** reuse
      `ChildProfile["languages"]` for them: `packages/shared` documents that field as BCP-47-like
      language *tags*, so a real Phase 3 row holds `["en","hi"]` and would render as two
      two-letter chips. Add the comment saying Phase 3 maps tags to labels
    - `src/features/setup/age-stage.ts`: `ageStageFor(dateOfBirth, reference): AgeStageLookup` â€”
      pure, anchored ISO parse, real-calendar-day check, leap-day rule, `AgeStage` by
      `import type`, never throws, with the comment naming
      `packages/shared/src/domain/age-stage.ts` as the authority. The result type is named
      **`AgeStageLookup`**, not `AgeStageResult`: `packages/shared` already exports that name with
      a different shape, and two types with one name would confuse Phase 3's deletion of this file
    - _Requirements: 8.8, 8.9, 19.1, 19.2, 19.5, 19.6, 22.8_
  - [x] 2.2 Build screen 2 and replace `app/(onboarding)/onboarding.tsx`
    - `onboarding-screen.tsx`: the design's layout table â€” `ScreenTitle back align="center"
      name={SCREEN_HEADER_NAME.onboarding}` ("Welcome"), the illustration hero well, the 3-page
      `pagingEnabled` carousel of the three value rows, tappable `PageDots`, "Get Started" â†’
      `/auth`. `scrollTo` with `animated: false`
    - **Pin the page width** â€” `pagingEnabled`, `scrollTo` and the index all need the same number,
      and D7 forbids a new dependency, so use `useWindowDimensions` from `react-native`:

      ```ts
      const { width } = useWindowDimensions();
      const PAGE_WIDTH = width - 2 * tokens.spacing["5"]; // the Screen's horizontal padding
      // each page: <View style={{ width: PAGE_WIDTH }} className="items-center justify-center">
      // dot press: ref.current?.scrollTo({ x: next * PAGE_WIDTH, y: 0, animated: false })
      // onMomentumScrollEnd: setIndex(Math.round(e.nativeEvent.contentOffset.x / PAGE_WIDTH))
      ```

      The carousel stays **inside** the `Screen`'s padding rather than edge-to-edge, so no negative
      margin is introduced (review round-4 finding 5, Req 5.2)
    - The hero well's `CharacterPlaceholder` keeps its default `image` role and label "Xelulu
      robot" â€” it offers no way to hide itself â€” while the `PersonFigure` beside it is decorative,
      which an `Illustration` achieves by taking no `accessibilityLabel` (round-4 finding 10)
    - One value row per page, which is a visible deviation from the Reference's three stacked rows
      (Req 5.1, 5.2, D24e); all three pages stay mounted. Record it for task 7.2's deviation list
    - The dots are `PageDots`' interactive mode, so they sit further apart than the Reference draws
      them (D24g): three 44Ã—44 pt containers, 132 pt in total. Record that for task 7.2 too
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 3.5, 22.4_
  - [x] 2.3 Build screen 3 and replace `app/(onboarding)/auth.tsx`
    - `account-screen.tsx`: `ScreenTitle back align="center"`, the three `TextField`s with their
      icons and limits, the password reveal,
      "Create Account" disabled until all three are non-blank (`isBlank`), the Google and Apple mock
      controls with their not-available line and accessibility labels, the divider and the static
      terms line. No provider SDK, no URL literal, no navigation from a provider press
    - **One notice slot**, held as a single `notice: string | null`: a provider press sets the
      provider line and it replaces the fill-in line until a field changes (the next
      `onChangeText` clears it); with no provider pressed and any field blank the fill-in line
      shows; with all three filled and no provider pressed no line shows (review round-4
      finding 12, Req 6.3, 6.5)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 22.7, 22.9_
  - [x] 2.4 Build screen 4 and replace `app/(onboarding)/pair-device.tsx`
    - `pair-screen.tsx`: header (`ScreenTitle back align="center"`), subheading, character well,
      `StepList currentIndex=1`, "Start
      Pairing" advancing by one and opening `/child-profile` on the last step. No Bluetooth, Wi-Fi,
      network or permission API, and no import that provides one
    - The character well's `CharacterPlaceholder` keeps its default `image` role and label "Xelulu
      robot"; it is not described as decorative and no wrapper hides it (round-4 finding 10)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 2.5 Build screen 5 and replace `app/(onboarding)/child-profile.tsx`
    - `child-profile-screen.tsx`: `ScreenTitle back align="center"`, `Avatar` with the inert add-photo
      `CircleButton size="badge" icon="camera-outline"` (no visible label, `accessibilityLabel`
      from `addPhotoA11y`), the name field, the ISO date field using
      `TextField trailingIcon="calendar-outline"` so the glyph sits inside the field at its right
      edge as the Reference draws it, the derived stage line or the format
      line, the gender chips (single select, feeding nothing, **initially "Boy"** from
      `MOCK_CHILD_DRAFT.gender_label` as the Reference draws it), the language and interest chip rows
      with inline add and per-chip remove, "Continue" disabled while the name is blank or the date
      invalid, then `router.replace(ROUTE_PATH.home)`
    - Props `{ data?: ChildDraft; now?: () => Date }`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.10, 8.11, 19.1_
  - [x] 2.6 Write `test/age-stage.test.ts` and `test/setup-flow.test.tsx`, and extend `test/navigation.test.tsx`
    - `age-stage.test.ts`: the day before and the day of the 3rd, 6th and 9th birthday; a 29 February
      birthday in a common year; `"not-a-date"`, `"2020-13-01"`, `"2020-02-30"`, `""`, a future date
    - `setup-flow.test.tsx`: carousel paging and dots; Account validation, the disabled button, both
      provider lines and no navigation; Pair stepping to `/child-profile`; Child Profile typing,
      chip add and remove, gender single-select, the stage line, the invalid-date line, Continue to
      `/home`
    - Assert screen 3's **notice precedence** (round-4 finding 12, Req 6.5): with all three fields
      blank the fill-in line is on screen; pressing Google replaces it with the provider line and
      the fill-in line is gone; typing into any field brings the fill-in line back. One notice is
      on screen at a time, never two
    - `navigation.test.tsx`: the four setup routes now render their Built_Screens with their
      `SCREEN_HEADER_NAME`, and each has a back control reaching `/home` from a deep link. The
      generic case's tab count goes through `tabBarTabs()` from task 1.9, which is what keeps
      `/onboarding` at zero Tab_Bar tabs even though its three interactive `PageDots` carry the
      `tab` role (round-4 finding 1)
    - **Property 8: The Setup_Flow chain reaches Home**, **Property 9: The age stage partitions the
      completed years**, **Property 11: A local change touches exactly one row** (example-based)
    - _Requirements: 26.1, 26.4, 26.5, 26.6, 3.3, 3.4, 3.5_
  - [x] 2.7 Wave 1 checkpoint
    - `corepack pnpm build`, `lint`, `format:check`, `test` all green; report the state of the setup
      flow for review

- [x] 3. Wave 2 â€” Play, Grow, Reports and the Live Call (screens 8, 9, 15, 7)
  - [x] 3.1 Build screen 8 and replace `app/(tabs)/play.tsx`
    - `src/features/play/{strings.ts,mock-play.ts,play-screen.tsx}`: `ScreenHeader back`, the four
      segments, the eight `MediaCard`s of the design's table with the Reference's four first, the
      category filter, the press notice line, the empty-state line, props `{ data?: PlayData }`
    - `strings.ts` carries `segmentsLabel: "Play categories"`, passed as the `SegmentedTabs`
      `accessibilityLabel` (the prop is required, and it is the name every segment assertion scopes
      itself to â€” round-4 findings 1 and 13)
    - Each item's `kind` takes the value the design's table pins: `game`, `game`, `song`, `story`,
      `rhyme`, `game`, `game`, `game` in that order. `ContentKind` is
      `story | song | rhyme | lullaby | game` and has no learning member, so the three learning
      cards are `game`. Do not invent a union member and do not write a cast; the field is carried
      for Phase 3 and is not rendered
    - `src/features/shell/strings.ts`: set `SCREEN_HEADER_NAME.play = "Play with Xelulu"`, the
      Reference's header text. Without it the generic header assertion fails at the wave 2
      checkpoint, because task 1.8 seeded the entry with `ROUTE_TITLE.play` ("Play")
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 19.1, 19.5, 3.4_
  - [x] 3.2 Build screen 9 and replace `app/(tabs)/grow.tsx`
    - `src/features/grow/{strings.ts,mock-grow.ts,grow-screen.tsx}`: `ScreenTitle`, the three
      segments, the four `MetricRow`s â€” **each in its own `Card` with `mt-3` between them**, which
      is how the Reference draws them, with no hairline divider â€” the "Current Interests" row of
      three illustration cards, the Interests and Milestones panels, and the always-visible reports
      row opening `/reports`
    - No code computes, scores, ranks or infers anything about a child; every value is a static mock
      label
    - The reports entry row is an **addition the Reference does not draw** (Req 11.5, D2, D24c):
      without it `/reports` would be reachable only by deep link. Record it for task 7.2's list
    - All four metric values render in the `info` tone, including `+12`. The Reference draws `+12`
      in blue and the other three in red; `danger` means a problem in this token set and a word
      count is not one, so the four are consistent
    - The four metric icons are pinned: Language `heart-outline`, Reading `book-outline`,
      Curiosity `bulb-outline`, Physical Play `barbell-outline` (round-4 finding 9)
    - `strings.ts` carries `segmentsLabel: "Growth sections"` for the `SegmentedTabs`
      `accessibilityLabel`
    - `src/features/shell/strings.ts`: set `SCREEN_HEADER_NAME.grow = "Growing Together"`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 3.4_
  - [x] 3.3 Build screen 15, add its route and update `layout.test.ts`
    - `src/features/shell/routes.ts`: add `reports` to `STACK_KEYS` and `ROUTE_PATH`;
      `strings.ts`: `ROUTE_TITLE.reports = "Reports"` and `SCREEN_HEADER_NAME.reports = "This Week
      with Xelulu"`
    - `src/features/reports/{strings.ts,mock-reports.ts,reports-screen.tsx}`: `ScreenTitle back`
      with the Reference header text, the Week/Month segments swapping the two mock sets, the four
      `MetricTile`s â€” **each in its own `Card` with `mt-3` between them**, as the Reference draws
      them, with no hairline divider â€” the interests card with `DinoScene`, the purpose note
    - Both mock sets carry `period: "weekly"`: `ReportPeriod` is `daily | weekly` and has no
      monthly member, so the Month set is a mock aggregate of weekly summaries. The field is not
      rendered and is never cast
    - `strings.ts` carries `segmentsLabel: "Report period"` for the `SegmentedTabs`
      `accessibilityLabel`
    - The "Aarav's Interests" block is wrapped in a `Card` the Reference draws without one
      (D24d); record it for task 7.2's deviation list
    - `app/reports.tsx`: the thin route file
    - `tooling/test/layout.test.ts`: add `reports.tsx` to the route-file list, nothing else
    - _Requirements: 3.1, 3.2, 3.4, 12.1, 12.2, 12.3, 12.4, 25.1, D2_
  - [x] 3.4 Build screen 7 and replace `app/voice-call.tsx`
    - `src/features/talk/{strings.ts,mock-call.ts,live-call-screen.tsx}`: `ScreenTitle back` with the
      trailing gear to `/settings`, the "Connected" `StatusPill`, the static duration label, the
      character scene well, decorative `PageDots`, and the three `CircleButton`s Mute / End Call
      (danger) / Speaker with their state text and labels; End Call calls `goBack()`
    - The feature module carries the audio-and-status-only note; `app/voice-call.tsx` keeps its
      one-line C10 pointer. No video, camera, capture, playback or media import anywhere
    - The scene well's `CharacterPlaceholder` keeps its default `image` role and label "Xelulu
      robot" (round-4 finding 10)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, D4_
  - [x] 3.5 Write `test/segments.test.tsx` and `test/talk-screen.test.tsx`, and extend `test/navigation.test.tsx`
    - `segments.test.tsx` (Play, Grow, Reports parts): each segment renders its own content, Play
      filters and shows the empty line with an injected empty module and
      the notice on a card press, Reports swaps the four numbers between Week and Month
    - **Scope every "exactly one option selected" assertion to its `tablist`**:
      `within(screen.getByRole("tablist", { name: PLAY_STRINGS.segmentsLabel })).getAllByRole("tab", { selected: true })`
      has length 1, and the same for `GROW_STRINGS.segmentsLabel` and
      `REPORTS_STRINGS.segmentsLabel`. A whole-screen count is false on `/play` and `/grow`,
      because the Tab_Bar's selected tab carries the same `tab` role (round-4 finding 1, Req 21.2)
    - `talk-screen.test.tsx`: Mute and Speaker flip and expose their state in text and label; End
      Call leaves the screen; the duration is static; "Connected" is text
    - `navigation.test.tsx`: switch the generic per-route header assertion from `ROUTE_TITLE` to
      `SCREEN_HEADER_NAME`, then confirm `/play`, `/grow`, `/reports` and `/voice-call` render their
      Built_Screens with their header names and the right chrome; Grow's reports row opens `/reports`
    - **Property 10: A segmented control filters or swaps**, **Property 4: State is never colour
      alone**, **Property 6: Every route renders its Built_Screen** (example-based)
    - _Requirements: 26.1, 26.2, 26.7, 26.8, 26.13_
  - [x] 3.6 Wave 2 checkpoint
    - `corepack pnpm build`, `lint`, `format:check`, `test` all green; report for review

- [x] 4. Wave 3 â€” Routines, Device and Family (screens 10, 11, 12)
  - [x] 4.1 Build screen 10 and replace `app/(tabs)/routines.tsx`
    - `src/features/routines/{strings.ts,mock-routines.ts,routines-screen.tsx}`: `ScreenTitle`, the
      six rows of the design's table as `ListRow` with `trailingText` plus `trailing={{ toggle }}`,
      the "+ Add Routine" button, the inline name-and-time form with the blank-name rule and the
      "Not set" fallback, all state local
    - "+ Add Routine" uses the kit `Button`. **This is not a deviation**: the Reference draws a
      filled, full-width, rounded control below the routines card, which is what the kit `Button`
      draws. Round 2 of the review recorded a borderless-centred-row deviation here; that reading
      was wrong and is withdrawn, so nothing goes on task 7.2's list for this control
    - The six routine rows sit inside **one `Card`**, with a `hairline` divider between rows, as
      the Reference draws them â€” unlike screens 9, 11 and 15, which draw one `Card` per row.
      Magnified, screen 10 is a single grouped near-white card whose rounded corners enclose
      Morning through Bedtime, with no cream gaps between rows; round 3's per-row finding was right
      for 9, 11 and 15 and was over-applied here (review round-4 finding 2). Nothing goes on task
      7.2's deviation list for this: either reading matches the Reference once the design and the
      task agree
    - `src/features/shell/strings.ts`: set `SCREEN_HEADER_NAME.routines = "Daily Routines"`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 19.3, 3.4_
  - [x] 4.2 Build screen 11 and replace `app/device.tsx`
    - `src/features/device/{strings.ts,mock-device.ts,device-screen.tsx}`: the header with the room
      line, the character well, the online-and-battery card using `batteryTone` with the percentage
      always in the text, the Movement row with its state word, the Volume `Stepper` (0â€“100 step 5,
      initial 60), Quiet Hours, the static Camera row, Sleep / Wake, Software & Health, and one
      inline detail panel at a time. The six setting rows are **one `Card` each**, with `mt-3`
      between them, as the Reference draws them â€” not one grouped card with hairline dividers
    - The Movement row's glyph is `walk-outline` (pinned in round 4, finding 9), and the robot
      well's `CharacterPlaceholder` keeps its default `image` role and label "Xelulu robot"
      (finding 10)
    - The Movement row's `Toggle` is a deviation (D24a): the Reference draws a chevron there and
      puts its one switch on the Camera (Privacy) row, which D3 removes. The step brief specifies a
      movement toggle, so the switch moves to Movement. Record it for task 7.2's list
    - The `"Camera"` label and `"Not included on this model"` live in `device/strings.ts` only; the
      row has no toggle, switch or press handler
    - **Rewrite `app/device.tsx`'s stale C10 comment.** It currently reads "v1 has no camera, so
      this screen carries no Camera (Privacy) row and no video view of any kind", which D3 and
      Req 14.4 make false â€” this phase builds a static Camera row. Replace it with:
      `// Route pointer: the Camera row is static text, "Not included on this model" â€” v1 has no`
      `// camera and no video view (product.md v1 facts, D3). Screen:`
      `// src/features/device/device-screen.tsx.`
      A false comment about the camera facts is the worst one to leave behind
    - In the same task, confirm `app/voice-call.tsx`'s note (the live session is audio and status
      only, no video and no camera in v1) is **still true** and leave it exactly as it is
    - The screen file opens with the `safety.md` Â§5 comment, and sends no command of any kind. Props
      `{ data?: DeviceData }`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 22.6, D3, D7, D19_
  - [x] 4.3 Build screen 12 and replace `app/(tabs)/family.tsx`
    - `src/features/family/{strings.ts,mock-family.ts,family-screen.tsx}`: `ScreenTitle`, the three
      segments, the two child rows with `Avatar` leading opening `/child-profile`, "+ Add Child",
      the "Grandparents & Caregivers" section with the Grandma and Dad rows, "+ Invite Caregiver",
      the per-member permission lines from `product.md`, and the inline add forms
    - **`MOCK_FAMILY.caregivers` holds exactly two members, in this order**, and the Caregivers
      panel renders **each member's own `permission_line`** â€” never one hard-coded caregiver line
      for the panel:

      ```ts
      caregivers: [
        { user_id: "user_mock_dad",   display_name: MOCK_IDENTITY.otherParent, role: "parent",
          role_label: "Parent",    permission_line: FAMILY_STRINGS.parentPermission },
        { user_id: "user_mock_meera", display_name: MOCK_IDENTITY.caregiver,  role: "caregiver",
          role_label: "Caregiver", permission_line: FAMILY_STRINGS.caregiverPermission },
      ],
      ```

      with `parentPermission: "Full access to devices, children, reports and privacy."` and
      `caregiverPermission: "Can start games and routines, and see the battery. Cannot see reports
      or change controls."`. With Dad the only member, the panel would have stated a caregiver's
      limits over a parent's name, contradicting `product.md` and Req 15.3; this also gives
      `MOCK_IDENTITY.caregiver` ("Meera") its first renderer (review round-4 finding 3). The
      Children segment still renders `caregivers[0]` â€” Dad, "Parent" â€” under "Grandparents &
      Caregivers" as the Reference draws it
    - `strings.ts` carries `segmentsLabel: "Family groups"` for the `SegmentedTabs`
      `accessibilityLabel`
    - No email address, phone number or URL in any mock row
    - The Dad row passes `trailing="none"`, which **drops the chevron the Reference draws** on that
      row (D24b): there is no caregiver detail screen in this phase and a chevron that opens nothing
      is a dead control. The Aarav, Diya and Grandma rows keep theirs. Record it for task 7.2
    - "+ Add Child" and "+ Invite Caregiver" use the kit `Button variant="secondary"`, a
      beige-filled hairline-bordered full-width control, while the Reference draws borderless
      centred rows inside the card. The kit may not be restyled (Req 1.3) and a bare `Pressable`
      with no fill would be a third button style. This is the **only** screen with in-card add
      controls; screen 10's "+ Add Routine" is a filled full-width button in the Reference and is
      not a deviation. Record this one for task 7.2
    - The Grandparents segment's Grandma row renders with its chevron but stays non-pressable until
      task 5.1 adds the `/grandma-mode` route; wiring it earlier would navigate to a route that does
      not exist yet
    - `src/features/shell/strings.ts`: set `SCREEN_HEADER_NAME.family = "Our Family"`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.6, 15.7, 15.8, 3.4_
  - [x] 4.4 Narrow the camera Repo_Check and add its compensating assertions
    - `tooling/test/placeholder.test.ts`, parent-app block: allow the `"Camera` literal only in
      `apps/parent-app/src/features/device/strings.ts` and
      `apps/parent-app/src/features/device/device-screen.tsx`; keep the check everywhere else
    - Add: `device/strings.ts` holds `"Camera"` and `"Not included on this model"`; at most two files
      in the app hold a `"Camera` literal â€” which holds only because no string outside the device
      feature begins with the word "Camera" (the shared rule above, and the two verbatim strings
      pinned in task 2.1); `device-screen.tsx` holds no `<Switch` element and no
      `accessibilityRole="switch"` literal, and its camera row is
      `<ListRow icon="camera-outline" title=â€¦ subtitle=â€¦ trailing="none" />` with no `onPress` and
      no `trailing={{ toggle`; no file imports `expo-camera`, `expo-video`,
      `expo-av`, `expo-image-picker`, `expo-media-library`, `react-native-vision-camera`,
      `@react-native-async-storage/async-storage`, `expo-secure-store` or `expo-file-system`; no file
      holds `<Camera`, `<Video`, `VideoView` or a `"Video` literal
    - Do **not** scan `device-screen.tsx` for the bare substring `Toggle`: Req 14.2's Movement row
      renders a `Toggle` through `ListRow`'s trailing object form, so that scan would fail a correct
      implementation. The "camera row is not a control" intent is carried by the JSX assertion above
      plus the Jest half in task 4.5 (exactly one `switch`-role element, labelled "Movement")
    - Every other Phase 2.1 scan in the block stays exactly as it is, and each new scan asserts a
      non-empty file list
    - **Property 13: The camera row is static text and no control**
    - _Requirements: 25.2, 25.3, 25.4, 23.2, 23.3, D3_
  - [x] 4.5 Write `test/routines-screen.test.tsx`, `test/device-screen.test.tsx` and extend `test/home-dashboard.test.tsx` and `test/segments.test.tsx`
    - `routines-screen.test.tsx`: one toggle flips one row only; add-routine appends the typed name
      and time; a blank name disables confirm; a blank time appends "Not set"
    - `device-screen.test.tsx`: the three battery tones and texts at 20, 19, 10 and 9 percent; the
      camera row's text with no switch or button role and no press handler, plus the positive half
      â€” exactly **one** element with the `switch` role renders and it is the one labelled
      "Movement"; the Movement state word
      flipping; the Volume stepper stepping by 5 and clamping; one panel open at a time
    - `home-dashboard.test.tsx`: Home's status pill at 20, 19, 10 and 9 percent, with the percentage
      in the text
    - `segments.test.tsx`: the Family panels, with exactly one option selected **inside**
      `within(screen.getByRole("tablist", { name: FAMILY_STRINGS.segmentsLabel }))` â€” a
      whole-screen count sees the selected Family tab too (round-4 finding 1). Also assert the
      Caregivers panel shows Dad's parent line and Meera's caregiver line, each on its own card
      (round-4 finding 3, Req 15.3)
    - `navigation.test.tsx`: `/routines`, `/device` and `/family` render their Built_Screens; a child
      card opens `/child-profile`
    - **Property 12: The battery tone follows the thresholds**, **Property 11: A local change
      touches exactly one row** (example-based)
    - _Requirements: 26.1, 26.8, 26.9, 26.10, 26.11, D15_
  - [x] 4.6 Wave 3 checkpoint
    - `corepack pnpm build`, `lint`, `format:check`, `test` all green; report for review

- [x] 5. Wave 4 â€” Grandma Mode, Privacy, Notifications and Settings (screens 13, 14, 16)
  - [x] 5.1 Build screen 13, add its route and update `layout.test.ts`
    - `src/features/shell/routes.ts` and `strings.ts`: add `grandma-mode` to `STACK_KEYS`,
      `ROUTE_PATH`, `ROUTE_TITLE` ("Grandma Mode") and `SCREEN_HEADER_NAME`
    - `src/features/grandma/{strings.ts,mock-grandma.ts,grandma-mode-screen.tsx}`: the header and
      subheader, the illustration hero, the four rows with "Voice Call with Xelulu" first opening
      `/voice-call`, the inert Festival row, the inline record panel with its later-phase line, the
      inline schedule panel with its mock confirmation, the consent note, and "Call Grandma Mode"
    - **All four rows pass `trailing="none"`.** The Reference draws no trailing chevron on any
      screen-13 row, and `ListRow`'s default is `trailing="chevron"`, so leaving the prop off would
      add three chevrons the frozen screen does not draw. The three live rows keep their `onPress`:
      a pressable row without a chevron is what the Reference draws here
    - In the hero well the `PersonFigure` is decorative (no `accessibilityLabel`) while the
      `CharacterPlaceholder` keeps its default `image` role and label "Xelulu robot" (round-4
      finding 10, applied here as well as on screens 2, 4, 7 and 11)
    - `app/grandma-mode.tsx`: the thin route file. `tooling/test/layout.test.ts`: add
      `grandma-mode.tsx`
    - `src/features/family/family-screen.tsx`: wire the Grandparents segment's Grandma row to
      `router.push(ROUTE_PATH["grandma-mode"])`, the piece task 4.3 deferred
    - No video, camera, clone-voice control or audio module anywhere
    - _Requirements: 3.1, 3.2, 3.4, 3.8, 15.5, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 25.1, D2, D5_
  - [x] 5.2 Build screen 14 and replace `app/privacy.tsx`
    - `src/features/privacy/{strings.ts,mock-privacy.ts,privacy-screen.tsx}`: `ScreenTitle back`,
      the three segments, the "What Xelulu Remembers" row, the three recent memory rows, "View All
      Memories" expanding to all fifteen in place, the always-visible danger row opening the
      `ConfirmDialog` with Cancel / "Delete everything" / "Export data", and the mock line that
      claims nothing
    - The danger row is the design's screen-local `DangerRow` composition, **not** a `ListRow`: a
      `Pressable` with `accessibilityRole="button"`, the label as its accessibility label, min
      height 56, content centred (`flex-row items-center justify-center gap-2`), holding
      `<Icon name="trash-outline" size="md" color="danger" decorative />` and
      `<AppText variant="heading" className="text-danger">`, with a pressed-state colour switch
      and no animation. The Reference draws a centred red line with a small inline red glyph and no
      icon tile, which `ListRow` cannot render â€” with `icon` set it draws a left-aligned 40 pt
      beige `IconTile`. It stays a screen-local composition, not a twelfth kit component: Req 2.1
      closes the kit at eleven additions and nothing else needs this shape
    - Recordings panel: adult-provided grandparent recordings with their consent statements and the
      no-child-audio line. Settings panel: the four mock toggles, the 30-day retention line and the
      withdrawal line
    - `strings.ts` carries `segmentsLabel: "Privacy sections"` for the `SegmentedTabs`
      `accessibilityLabel`
    - The memory rows drop the Reference's chevrons (`trailing="none"`), because nothing opens yet;
      that is a real deviation on screen 14 and is **not** one on screen 16, where the Reference
      draws no chevrons at all (round-4 finding 14)
    - `mock-privacy.ts` carries labels, counts, enums, ages and consent statements only â€” no
      transcript, storage path, audio reference or raw value
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 19.5, D13, D14_
  - [x] 5.3 Build screen 16a and replace `app/notifications.tsx`
    - `src/features/notifications/{strings.ts,mock-notifications.ts,notifications-screen.tsx}`:
      `ScreenHeader back`, the three segments, the five rows of the design's table as non-pressable
      `ListRow`s with `trailingText` times, and the empty line
    - `strings.ts` carries `segmentsLabel: "Notification kinds"` for the `SegmentedTabs`
      `accessibilityLabel`
    - The relative time moves from under the detail line into the row's trailing slot
      (`ListRow.trailingText`), which is a visible change to a frozen screen: record it for task
      7.2's deviation list (round-4 finding 14). No chevron is dropped here â€” the Reference draws
      none on a notification row
    - _Requirements: 18.1, 18.2, 18.3_
  - [x] 5.4 Build screen 16b and replace `app/settings.tsx`
    - `src/features/settings/{strings.ts,settings-screen.tsx}`: `ScreenHeader back`, the nine rows in
      Req 18.4's order, the five route rows opening their routes from `ROUTE_PATH`, and the four
      inert rows with the trailing text "Later phase". No secret, token, key name, endpoint or
      environment value
    - **Declare `SettingsRouteKey` beside the row table** in `src/features/settings/strings.ts`;
      it does not exist in the Route_Table, which exports only `TabKey`, `StackKey`,
      `ShellRouteKey`, `ROUTE_PATH` and `isStackRoute`, so without this the `open` helper below
      fails `tsc --noEmit` (review round-4 finding 6):

      ```ts
      export type SettingsRouteKey = Extract<
        ShellRouteKey,
        "child-profile" | "device" | "routines" | "privacy" | "notifications"
      >;

      export type SettingsRow = Readonly<{
        key: string;
        icon: IconName;
        title: string;
        route?: SettingsRouteKey;
      }>;
      ```

      The row table is typed `readonly SettingsRow[]`, so the five route rows and the four inert
      rows are distinguished by the presence of `route` and nothing else
    - Navigation **keeps Phase 2.1's split between tab routes and stack routes**:

      ```ts
      // Tab routes are reached with navigate so the tabs group is not pushed twice; stack routes push.
      const open = (key: SettingsRouteKey): void =>
        isStackRoute(key) ? router.push(ROUTE_PATH[key]) : router.navigate(ROUTE_PATH[key]);
      ```

      `isStackRoute` is the Route_Table's existing typed predicate, so no cast over `TAB_KEYS` is
      needed. `/routines` is the only tab route among the five rows. `router.push("/routines")` from
      `/settings` would push a **second** `(tabs)` instance and leave a back stack of
      `(tabs) â†’ /settings â†’ (tabs)`, because `app/_layout.tsx` is a root `Stack` with `(tabs)` as
      one screen. The navigation test asserts the pathname only, so it would pass either way â€”
      the comment is what keeps the choice from being re-broken. Round 2 chose a single
      unconditional `push` on the claim that Home does the same; `home-dashboard.tsx` in fact
      calls `router.navigate` for `/play` and `/routines`, so that claim is withdrawn
    - _Requirements: 18.4, 18.5, 18.6, 18.7, 1.5_
  - [x] 5.5 Remove the placeholder and audit the route files
    - Delete `src/components/placeholder-screen.tsx` and the `PLACEHOLDER_LINE` export in
      `src/features/shell/strings.ts`; remove every remaining import of either
    - Confirm `apps/parent-app/app` holds exactly the nineteen route files, and that every file
      **other than `app/_layout.tsx` and `app/(tabs)/_layout.tsx`** contains nothing but the
      import, the default export, exactly one JSX element (the screen component) and, for
      `device.tsx` and `voice-call.tsx`, its one-line C10 pointer. The two layout files are
      excluded because they are Phase 2.1 layouts: `_layout.tsx` renders `<StatusBar/>` and
      `<Stack â€¦/>`, and `(tabs)/_layout.tsx` renders `<Tabs>` with a `tabBar` render prop
    - This is review-plus-test: task 6.1 adds the scan that enforces the thinness half, so it is
      not left to a manual read
    - **Property 17: Every route file is thin and the placeholder is gone**
    - _Requirements: 1.6, 3.1, D22_
  - [x] 5.6 Write `test/privacy-screen.test.tsx`, `test/grandma-screen.test.tsx` and extend `test/segments.test.tsx` and `test/navigation.test.tsx`
    - `privacy-screen.test.tsx`: the dialog opens with the `alert` role; cancel changes nothing; each
      action shows the mock line and no text claims a deletion or an export; View All expands to
      fifteen rows and collapses; the recordings consent lines and the no-child-audio line
    - `grandma-screen.test.tsx`: the row reads "Voice Call with Xelulu"; it and the primary button
      open `/voice-call`; the schedule confirmation line; the record later-phase line; the consent
      note
    - `segments.test.tsx`: the Privacy and Notifications panels and filters, with the
      "exactly one option selected" assertion scoped inside
      `within(screen.getByRole("tablist", { name: <feature>.segmentsLabel }))` for both screens
      (round-4 finding 1). Neither is a Tab_Route, so the role count would be 3 rather than 0 under
      the old whole-screen assertion
    - `navigation.test.tsx`: every route in `TAB_KEYS` and `STACK_KEYS` now renders its Built_Screen
      with its `SCREEN_HEADER_NAME` and the Tab_Bar only on tabs; Family's Grandma row opens
      `/grandma-mode`; the five Settings rows open their routes
    - **Property 14: The DPDP surface changes nothing and claims nothing**, **Property 6: Every
      route renders its Built_Screen** (example-based)
    - _Requirements: 26.1, 26.2, 26.8, 26.12, 26.13_
  - [x] 5.7 Wave 4 checkpoint
    - `corepack pnpm build`, `lint`, `format:check`, `test` all green; report for review

- [x] 6. Wave 5 â€” cross-cutting checks and docs
  - [x] 6.1 Add the remaining Repo_Check scans to `tooling/test/placeholder.test.ts`
    - Route literals: no file under `app/` or `src/` other than `src/features/shell/routes.ts` holds
      a string literal equal to one of the sixteen route paths
    - Mock payloads: no `mock-*.ts` file holds `transcript`, `audio`, `storage_path`, `confidence`,
      `duration_s`, `.mp3`, `.wav`, `.opus`, an `@` inside a string, a ten-digit run or a currency
      symbol; the scan asserts it found at least ten `mock-*.ts` files
    - Route-file thinness: for every `.tsx` file under `apps/parent-app/app`, count `<[A-Z]`
      occurrences; it must be exactly 1, with `app/_layout.tsx` and `app/(tabs)/_layout.tsx`
      allow-listed. The scan asserts it found nineteen files, so it cannot pass vacuously. This is
      the enforcement half of Property 17 that task 5.5 only reviews
    - Illustration licence and no-raster scans, which close the one pair of SHALLs in the phase
      with no check behind them (Req 20.2, 20.3):

      ```ts
      // every illustration carries the licence line
      const art = sourceFiles("apps/parent-app/src/illustrations");
      expect(art.length).toBeGreaterThanOrEqual(5);
      for (const abs of art) expect(read(toRepoPath(abs))).toContain("Original work, Xelulu-owned");

      // no raster or third-party art anywhere in the app
      const RASTER = /\.(?:png|jpe?g|gif|webp|bmp|riv|lottie)$/i;
      expect(walk(join(ROOT, "apps/parent-app")).map(toRepoPath).filter((p) => RASTER.test(p)))
        .toEqual([]);
      ```

    - Keep every other scan in the block unchanged
    - **Property 15: The boundaries hold, statically**, **Property 17: Every route file is thin**
    - _Requirements: 1.5, 19.5, 20.2, 20.3, 22.1, 22.2, 22.3, 22.5, 22.7, 22.9, 23.2, 23.3, 3.1, D22_
  - [x] 6.2 Write `test/mock-consistency.test.ts`
    - Every Mock_Module's displayed names resolve to `MOCK_IDENTITY` values; `MOCK_PRIVACY.memories`
      has exactly fifteen entries; every Play category holds at least one item; `SCREEN_HEADER_NAME`
      has an entry for every non-Home route key
    - `MOCK_FAMILY.caregivers` holds exactly two members â€” `MOCK_IDENTITY.otherParent` with
      `role: "parent"` and `MOCK_IDENTITY.caregiver` with `role: "caregiver"` â€” each with a
      non-empty `permission_line`, and the two lines differ. This is what keeps every
      `MOCK_IDENTITY` key rendered somewhere (round-4 finding 3)
    - **Property 16: The mock world is one world** (example-based)
    - _Requirements: 19.6, 26.1_
  - [x] 6.3 Update `apps/parent-app/docs/design-system.md`
    - Add the eleven Kit_Additions with their full prop types and when to use each â€” including
      `CircleButton`'s `badge`/`lg` size variant, its discriminated union on
      `label`/`accessibilityLabel`, and the rule that its slop is
      `Math.max(0, (touchMin - DISC[size]) / 2)` so `badge` gets 2 pt and `lg` gets **none**
      (an unclamped negative `hitSlop` would shrink the touch box); `PageDots`' two modes and why
      interactive dots get a 44Ã—44 container instead of a `hitSlop`; that `MetricRow` and
      `MetricTile` each live in their own `Card` with no divider; and
      `TextField`'s decorative `trailingIcon`; the three additive
      `ListRow` props â€” including that `trailingText` joins the accessibility label only on a
      pressable row, and that `tone="danger"` does not tint the leading slot because `IconTile`
      may not be edited; the rule that **danger-toned text is `AppText` plus
      `className="text-danger"`**, never a new `TextTone` member; the Privacy screen's
      screen-local `DangerRow` composition and why it is not a kit component; the shell's
      `ScreenTitle` and `go-back.ts` with the reason they are not kit
      components, **including `ScreenTitle`'s `align` prop** (`"start"` default, `"center"` on
      screens 1â€“5, rendered as `flex-1` plus `items-start`/`items-center`); the rule that every
      `SegmentedTabs` takes its feature's `segmentsLabel` string as its required
      `accessibilityLabel`, and that this is also the `tablist` name every segment test scopes
      itself to, because the Tab_Bar and `SegmentedTabs` share the `tab` role; that
      `CharacterPlaceholder` always exposes the `image` role with the label "Xelulu robot" and so
      is never described as decorative; the two new colour tokens and the `opacity.scrim` token with their values and uses;
      the **seven** new Contrast_Pairs with the ratios **as corrected in task 1.1** (5.62, 5.01,
      3.52, 6.32, 3.69, 3.73, 4.04) and their minimums, why two `danger`/`surface`
      pairs coexist (graphic 3:1 and text 4.5:1), and the note that the `hairline` control border
      is decorative with no pair of its own and that WCAG 1.4.11 on those controls needs
      assistive-technology testing and expert review; the five Illustrations in the asset list
      with the licence line (and the Phase 2.1 `StoryThumbnail` noted where it lives); the D6
      age-stage ranges as the app's assumption; the note that Volume is stepped because this phase
      adds no dependency; the note that `PlaceholderScreen` is removed and why; the note that the
      font-cap allow-list is unchanged; and the documented Family-age mock inconsistency
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 20.2_
  - [x] 6.4 Correct the README's deep-link paragraph
    - Keep the `pnpm start:app` **table row** wording unchanged, including the words "expo go" and
      "home dashboard", and keep the `/--/` substring: `tooling/test/readme.test.ts` asserts both
      and must pass unchanged
    - In the deep-link paragraph, replace "The app itself opens on the Home dashboard" with "The
      app opens on the splash and then the Home dashboard", and **delete** the sentence "Every
      screen other than Home is a titled placeholder in this phase." â€” it is false after this
      phase and `readme.test.ts` does not catch it
    - Add that `/--/reports` and `/--/grandma-mode` are new routes. No non-local URL literal
    - _Requirements: 24.5, 25.7_
  - [x] 6.5 Wave 5 checkpoint
    - `corepack pnpm build`, `lint`, `format:check`, `test` all green; report for review

- [x] 7. Final verification and Done-when report
  - [x] 7.1 Run the full verification
    - `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`,
      `corepack pnpm format:check`, `corepack pnpm test` (which ends with the parent app's Jest run).
      Fix every failure before writing the report
    - Confirm `apps/parent-app/package.json` gained no dependency; confirm the **repo-root**
      `docs/` (`apps/parent-app/docs/design-system.md` is in scope and is edited by task 6.3),
      `packages/shared/src/`, `.env.example`, `tooling/fixtures/approved-panel.txt`,
      `.github/workflows/ci.yml`, `apps/admin/`, `services/` and the other spec folders are
      unchanged; confirm no file outside `src/theme/tokens.json` holds a colour literal; confirm
      `apps/parent-app/app` holds exactly nineteen route files
    - _Requirements: 22.5, 23.1, 23.2, 23.3, 26.14_
  - [x] 7.2 Write the Done-when report
    - For each of Omar's Done-when items â€” all fifteen remaining screens built on mock data with no
      backend call, no camera or video anywhere, the Phase 2.1 accessibility bar kept, and smoke and
      key-interaction tests only â€” name the covering test or file and its result
    - List: every FLAG and choice (D1 to D24, including all eight D24 deviations) as implemented;
      every entry in the design's "Decisions this design makes" (1 to 47, including 6a); the
      design's responses to all 26 round-1 findings, all 18 round-2 findings, all 17 round-3
      findings **and all 14 round-4 findings**, confirming each landed in the code;
      the two Repo_Checks changed and the two confirmed unchanged; that the
      font-cap allow-list was **not** extended; any Ionicons glyph swap; whether the splash's
      fake-timer router test needed the per-component fallback; whether the
      NativeWind-under-Jest fallback was needed; the manual phone checklist as **not run by the
      agent**; and the open items carried forward (DPDP s.9, the age-stage assumption, real
      consent/deletion/export, Rive and the dev build)
    - List every Reference deviation, in full:
      - **no tab bar on screens 11, 14, 15 and 16** (the Reference draws one on all four, but each
        is a Stack_Route here; it draws none on 7 and 13, and none was added)
      - back controls added to screens 2, 3, 5, 13, 14, 15 and 16
      - Speaker instead of Rotate (D4), and "Voice Call with Xelulu" instead of "Video Call with
        Xelulu" (D5)
      - screen 7's "Connected" status pill and static "0:42" duration are **additions**; the
        Reference draws neither
      - screen 2 shows **one value row per carousel page** instead of the Reference's three
        stacked rows
      - screen 5: the ISO `YYYY-MM-DD` date field instead of "15 Mar 2020" (D16); the chips carry a
        `close` remove glyph the Reference does not draw (Req 8.4); the photo badge keeps the
        Reference's `camera-outline` glyph on an inert, unavailable-labelled control
      - screen 13's "Festival Special" row is static with "Later phase"; the chevron is **not** a
        deviation on any screen-13 row, because the Reference draws none on any of the four
      - **screen 12's Dad row loses the Reference's chevron**, because this phase has no caregiver
        detail screen
      - **screen 9 gains a reports entry row the Reference does not draw** (Req 11.5, D2, D24c)
      - **screen 15's "Aarav's Interests" block is wrapped in a `Card`** (D24d); the Reference
        draws it on the page without one
      - **screen 11's Movement row carries a `Toggle` where the Reference draws a chevron** (D24a);
        the step brief specifies a movement toggle, and the Reference's one switch â€” on the Camera
        (Privacy) row â€” is removed with that row's control (D3)
      - **screen 2's page dots sit further apart than the Reference draws them** (D24g): each
        interactive dot is centred in its own 44Ã—44 pt touch target, so hit areas cannot overlap
      - **screen 5's interest chips all render unselected** (D24h); the language row's primary chip
        is filled, as the Reference draws it
      - **screen 12's in-card "+ Add Child" and "+ Invite Caregiver" controls are kit
        `Button variant="secondary"` controls**, while the Reference draws borderless centred rows
        inside the card. **Screen 10's "+ Add Routine" needs no deviation**: the Reference draws a
        filled full-width button and the kit `Button` matches it. Round 2 of the review recorded a
        deviation here on a misreading of the Reference; it is withdrawn
      - **screen 14's delete-or-export row** is drawn as the Reference draws it â€” a centred label
        with a small inline red glyph â€” by a screen-local `Pressable` rather than by `ListRow`
      - **screen 1's page indicator** draws three equal 8 pt dots with the current one recoloured,
        while the Reference draws the current dot as an elongated pill
      - **screen 16a's relative time moves from under the detail line to the row's trailing slot**
        (`ListRow.trailingText`)
      - **screens 2, 3 and 5 draw a centred title about 22 pt left of the Reference's optical
        centre**, because `ScreenTitle align="center"` shares the header row with the back control
        Req 3.5 adds and the Reference draws none on those three screens
      - beige `IconTile` instead of the Reference's pastel tiles; all four Grow numerals in the
        `info` tone, where the Reference draws `+12` in blue and the other three in red;
        non-pressable notification and memory rows; no photographic art anywhere
      - report also what is **not** a deviation, so the list cannot be read as longer than it is:
        screens 9, 11 and 15 draw one `Card` per row with a gap and **screen 10 draws one grouped
        card with hairline dividers**, which is what the Reference does in each case; screen 10's
        add control matches the kit `Button`; and screen 16's notification rows drop no chevron,
        because the Reference draws none there (only screen 14's memory rows do)
    - _Requirements: 26.14, 26.15, 27.1, 27.2, 27.3, 27.4_

## Notes

- Test sub-tasks are not optional: Omar's Done-when requires them. All are example-based; no
  fast-check runs in the app (Req 26.1).
- Each task references requirement clauses; properties map to the design's Correctness Properties.
- The step brief's "three new routes" are `app/reports.tsx`, `app/grandma-mode.tsx` and `/` itself,
  which becomes the Splash screen instead of a redirect.
- Screen 7 (Live View & Voice Call) is built in wave 2 alongside Play, Grow and Reports; the
  suggested wave list in the brief did not place it.
- Two ordering dependencies inside a wave: task 3.2 (Grow) needs `ROUTE_PATH.reports` from task 3.3,
  and task 5.1 (Grandma Mode) carries the Family row wiring that task 4.3 deferred. The dependency
  graph below reflects both.
- `tooling/test/contrast.test.ts` and `tooling/test/readme.test.ts` are **not** edited: the first is
  already data-driven over the Contrast_Pairs, and the second passes with the additive README line.
- If NativeWind's babel transform fails under Jest, apply the Jest-only override documented in
  `apps/parent-app/jest.config.js` and record it in the Done-when report.
- **Changed by design review round 1** (see the design's "Responses to the design review,
  round 1"): task 1.1 now adds seven Contrast_Pairs, not four, and rewrites one existing `use`
  string; task 1.2 forbids a duplicate `IconName` member; task 1.3 adds `CircleButton`'s size
  variant and `TextField`'s `trailingIcon`; task 1.8 names which task owns each differing
  `SCREEN_HEADER_NAME` entry; task 1.9 migrates the navigation-test cases that assume Home is at
  `/`, which is what keeps the wave 0 checkpoint green; tasks 3.1, 3.2, 4.1 and 4.3 each set their
  own `SCREEN_HEADER_NAME` entry; task 4.4's camera assertion no longer scans for the substring
  `Toggle`; task 5.5 excludes the two layout files from the thinness rule and task 6.1 enforces it
  with a scan; task 6.4 deletes the README's now-false "titled placeholder" sentence; and task
  7.2's deviation list is corrected and completed. `requirements.md` gained Req 26.16 and six
  clarified clauses (Glossary, Introduction, 4.1, 5.1, 5.2, 16.1, 18.4, 19.1, 22.10, 24.5) plus two
  superseded Phase 2.1 items.
- **Changed by design review round 2** (see the design's "Responses to the design review,
  round 2"): the shared rules above gain the `dense`-word trap and the danger-text mechanism; task
  1.1 carries the corrected ratios (`warning`/`hairline` **3.73**, `danger`/`hairline` **4.04**)
  and the no-pair-for-`hairline` decision; task 1.5 drops glyph tinting from `tone="danger"` and
  states `trailingText`'s two accessibility branches; task 1.9's migration count is corrected to
  **five call sites, nine cases â€” one replaced, eight migrated**; task 1.10 tests `trailingText` on
  both branches; tasks 2.1 and 2.5 pin screen 5's initial "Boy" chip; task 3.1 pins each Play
  item's `ContentKind` and task 3.3 pins both report sets to `"weekly"`; tasks 3.2, 3.3, 4.1 and
  4.3 record four more Reference differences; task 4.2 rewrites `app/device.tsx`'s stale camera
  comment and confirms `app/voice-call.tsx`'s is still true; task 5.1 passes `trailing="none"` to
  all four Grandma Mode rows; task 5.2 builds the delete-or-export row as a screen-local centred
  `Pressable` instead of a `ListRow`; task 5.4 used `router.push` for all five Settings route rows (reversed in round 3);
  task 6.3 documents the danger-text rule, the `DangerRow` and the decorative `hairline` border;
  and task 7.2's deviation list gains seven lines. `requirements.md` gained the **D23 FLAG** (the
  two `structure.md` extensions) and corrected Req 2.1/D21, 3.2, 3.4, 8.3, 16.1, 17.1 and 26.2.
- **Changed by design review round 3** (see the design's "Responses to the design review,
  round 3"): the shared rules above gain the no-string-begins-with-"Camera" rule and the
  Reference-reading rule; task 1.3 carries `CircleButton`'s discriminated union verbatim and the
  clamped `Math.max(0, â€¦)` slop with its own test case; task 1.4 gives `PageDots` two modes with
  different spacing and `MetricRow`/`MetricTile` no divider; task 1.8 makes `SCREEN_HEADER_NAME`
  the only place a header literal is written and restates the splash separator as a decision; task
  2.1 pins screen 5's two photo strings verbatim and replaces `ChildDraft`'s `languages` with
  `language_labels`, `primary_language` and `interest_labels`; task 2.2 records the wider dot
  spacing; tasks 3.2, 3.3 and 4.2 switch to one `Card` per row (**task 4.1 was in this list in
  round 3 and is not: round 4 established that screen 10 is one grouped card with hairline
  dividers**); task 3.2 pins all four Grow
  numerals to `info`; **task 4.1's "+ Add Routine" deviation is withdrawn** as a misreading; task
  4.2 records the Movement-toggle deviation; task 4.4 names why the at-most-two-"Camera"-files
  assertion holds; task 5.1 pins the Festival row's `sparkles-outline`; **task 5.4 restores Phase
  2.1's `navigate`-for-tab-routes split**; task 6.1 gains the illustration-licence and no-raster
  scans; task 7.1 says repo-root `docs/`; and task 7.2's deviation list gains five lines, loses
  one and gains a not-a-deviation line. `requirements.md` gained the **D24 FLAG** (eight further
  Reference deviations) and corrected Req 11.5, 12.1, 14.2, 15.2, 21.6 and 23.1.
- **Changed by design review round 4** (see the design's "Responses to the design review,
  round 4"; this was the last design round, so these are the instructions the build runs on): the
  shared rules above gain the **shared-`tab`-role trap** and the `segmentsLabel` rule, and the
  Overview's "every wave ends green" claim is replaced by the seven named verification points plus
  the warning that the dependency-graph **batches** (renamed from "waves") may leave the suite red
  between 3.1/3.3 and 3.5 and between 4.3 and 5.1; task 1.2 forbids adding an unrendered
  `IconName`; task 1.8 adds `ScreenTitle`'s `align` prop; **task 1.9 adds the `tabBarTabs()`
  helper and rescopes the tab-count and Play-tab selected-count assertions**; tasks 2.2 to 2.5 pass
  `align="center"` and task 2.2 pins the carousel's `PAGE_WIDTH`; task 2.3 states screen 3's single
  notice slot and task 2.6 asserts its precedence; tasks 3.1, 3.2, 3.3, 4.3, 5.2 and 5.3 each add
  their feature's `segmentsLabel`; task 3.2 pins the four Grow metric icons and task 4.2 pins
  `walk-outline` on Movement; tasks 2.2, 2.4, 3.4 and 4.2 state that `CharacterPlaceholder` keeps
  its `image` role and "Xelulu robot" label; **task 4.1 switches screen 10 back to one grouped
  `Card` with hairline dividers**; task 4.3 pins `MOCK_FAMILY.caregivers` to Dad and Meera with
  per-member permission lines; tasks 3.5, 4.5 and 5.6 scope every segment assertion inside
  `within(getByRole("tablist", { name }))`; task 5.4 declares `SettingsRouteKey` and `SettingsRow`;
  task 6.3 documents `align`, `segmentsLabel` and the `CharacterPlaceholder` role; and task 7.2's
  deviation list gains the screen-16a time relocation and the centred-title shift and extends its
  not-a-deviation note to screen 10 and screen 16's chevrons. `requirements.md` corrected Req 5.2,
  6.5, 15.3, 21.2, 21.6, 26.2 and 26.16.

## Task Dependency Graph

These fifteen entries are **batches**, not waves: they give execution order and nothing more. The
word "wave" in this document means one of the six build waves plus the verification wave, each
ending at a checkpoint that must be green. A batch boundary may leave the suite red (review round-4
finding 7).

```json
{
  "batches": [
    { "batch": 0, "tasks": ["1.1", "1.2", "1.6", "1.7", "1.8"] },
    { "batch": 1, "tasks": ["1.3", "1.4", "1.5", "1.9"] },
    { "batch": 2, "tasks": ["1.10", "1.11"] },
    { "batch": 3, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "batch": 4, "tasks": ["2.6", "2.7"] },
    { "batch": 5, "tasks": ["3.1", "3.3", "3.4"] },
    { "batch": 6, "tasks": ["3.2"] },
    { "batch": 7, "tasks": ["3.5", "3.6"] },
    { "batch": 8, "tasks": ["4.1", "4.2", "4.3"] },
    { "batch": 9, "tasks": ["4.4", "4.5", "4.6"] },
    { "batch": 10, "tasks": ["5.1", "5.2", "5.3", "5.4"] },
    { "batch": 11, "tasks": ["5.5", "5.6", "5.7"] },
    { "batch": 12, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "batch": 13, "tasks": ["7.1"] },
    { "batch": 14, "tasks": ["7.2"] }
  ]
}
```
