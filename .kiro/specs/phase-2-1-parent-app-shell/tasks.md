# Implementation Plan: Phase 2.1 Parent App Shell

## Overview

Build order: dependencies and test wiring, tokens, the component kit, the navigation shell, the character and Home Dashboard, the repo checks, docs, then a final verification and Done-when report. TypeScript strict throughout; kebab-case files; exact version pins; no colour literal outside `src/theme/tokens.json`; no non-local URL literal; no Panel_Key `KEY=value` or `KEY: value` line; no git commits. Do not edit `docs/`, `packages/shared/src/`, `.env.example`, `tooling/fixtures/approved-panel.txt`, `.github/workflows/ci.yml` or other specs.

Toolchain for every command (PowerShell): `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...` from `c:\xelulu`. Never system Node 22 or a global pnpm.

## Tasks

- [x] 1. Dependencies and test wiring
  - [x] 1.1 Add dependencies, Jest config and light theme
    - `apps/parent-app/package.json`: dependencies `react-native-svg` (15.15.4, from Expo's `bundledNativeModules.json`), `@expo/vector-icons` (the exact SDK 57 version), `@xelulu/shared` `workspace:*`; devDependencies `jest-expo` (57.0.x), `jest`, `@testing-library/react-native`, `@jest/globals`. Resolve each with `corepack pnpm view <pkg> version` or Expo's compatibility table and pin it exactly. Script `"test": "jest"`; `build` unchanged
    - Root `package.json` `test`: append `&& pnpm --filter @xelulu/parent-app test` after `vitest run`
    - `apps/parent-app/jest.config.js`: `preset: "jest-expo"`, `testMatch: ["<rootDir>/test/**/*.test.{ts,tsx}"]`
    - `app.json`: `userInterfaceStyle` `light`; typed routes stay off
    - Run `corepack pnpm install` to update the lockfile
    - _Requirements: 1.7, 8.5, 11.6_
  - [x] 1.2 Update `tooling/test/manifests.test.ts`
    - Add `@xelulu/parent-app -> @xelulu/shared` to the workspace-edge list; keep every other check, including `PARENT_APP_FORBIDDEN_DEPS`
    - _Requirements: 10.5_

- [x] 2. Design tokens
  - [x] 2.1 Add `src/theme/tokens.json` and `src/theme/theme.ts`, and rewrite `tailwind.config.js`
    - Every colour, typography, spacing, radius, shadow, size, `fontScale` token and every Contrast_Pair exactly as in the design's Data Models
    - `theme.ts`: `Tokens`, `ColorToken`, `TypographyToken`, `ContrastPair`, `tokens`, `color`, `cardShadow` as in the design
    - `tailwind.config.js`: require `tokens.json`; replace `theme.colors` (plus `transparent`), `theme.fontSize`, `theme.spacing` and `theme.borderRadius`; `content` covers `app/` and `src/`; no colour literal; remove the Phase 0 placeholder palette
    - Remove every `dark:` class from the app
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7_
  - [x] 2.2 Update `tooling/test/contrast.test.ts`
    - Parent-app part: load `tokens.json`; every Contrast_Pair's tokens exist and meet the pair's minimum; at least 20 pairs; every `text-*` colour is a foreground in some pair; every typography size is at least 12. Remove the parent-app dark palette check; keep the admin light/dark checks and the known-value tests unchanged
    - **Property 2: Every listed pair meets its minimum**
    - _Requirements: 1.5, 1.6, 10.3_

- [x] 3. Component kit
  - [x] 3.1 Add the primitives in `src/components/`
    - `app-text.tsx`, `icon.tsx`, `card.tsx`, `button.tsx`, `toggle.tsx`, `icon-tile.tsx`, `list-row.tsx`, `status-pill.tsx`, `segmented-tabs.tsx`, `section-title.tsx`, with the design's props, roles, labels, states and 44-pt minimum touch areas
    - Pressed state is a colour or opacity change only; raw values only from `theme.ts`
    - Kit strings (for example the default labels) in `src/components/strings.ts`
    - _Requirements: 2.1–2.8, 3.1, 3.2, 3.5, 8.4, 8.7_
  - [x] 3.2 Add the layout and dense components
    - `quick-action-tile.tsx`, `stat-tile.tsx`, `screen.tsx`, `tab-bar.tsx`, as in the design; only these three Dense_Components pass `dense` (and so `maxFontSizeMultiplier` 1.5)
    - Tab_Bar items: role `tab`, `selected` state, filled/brand when active, outline/muted when not
    - _Requirements: 2.1, 3.2, 3.3, 3.4, 4.3, 4.4_
  - [x] 3.3 Write `apps/parent-app/test/components.test.tsx`
    - Button calls `onPress` once and nothing while disabled (with the disabled state exposed); Toggle calls `onValueChange(!value)` and exposes checked; StatusPill shows its label; ListRow calls `onPress`; SegmentedTabs calls `onChange` with the key and only the selected option is `selected`; TabBar calls `onSelect` with the key
    - **Property 3: Controls report state and call handlers once**, **Property 4: Status is never colour alone** (example-based)
    - _Requirements: 11.1, 2.2–2.7, 3.3_

- [x] 4. Navigation shell
  - [x] 4.1 Add `src/features/shell/routes.ts` and `strings.ts`
    - `TAB_KEYS`, `STACK_KEYS`, `ShellRouteKey`, `ROUTE_PATH`, `isStackRoute`; the C10 titles, tab labels, "Coming in a later phase" and "Back"
    - _Requirements: 4.1, 4.6, 8.7_
  - [x] 4.2 Add `src/components/screen-header.tsx` and `placeholder-screen.tsx`
    - Back control: `router.back()` when `router.canGoBack()`, else `router.replace(ROUTE_PATH.home)`; title with the `header` role
    - _Requirements: 3.5, 4.6, 4.7_
  - [x] 4.3 Replace the route files
    - `app/_layout.tsx` (Stack, headers hidden, `StatusBar` dark, `global.css`); `app/index.tsx` (`Redirect` to `/home`, replacing the Phase 0 placeholder); `app/(tabs)/_layout.tsx` (Tabs with the TabBar adapter, as in the design); `app/(tabs)/play.tsx`, `grow.tsx`, `routines.tsx`, `family.tsx`; `app/(onboarding)/onboarding.tsx`, `auth.tsx`, `pair-device.tsx`, `child-profile.tsx`; `app/settings.tsx`, `device.tsx`, `privacy.tsx`, `notifications.tsx`, `voice-call.tsx`, each a `PlaceholderScreen`
    - The C10 notes as comments in `voice-call.tsx` and `device.tsx`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.8, 8.6_
  - [x] 4.4 Update `tooling/test/layout.test.ts`
    - Replace "holds only `_layout.tsx` and `index.tsx`" with the exact recursive C10 route file list; keep every other check
    - _Requirements: 10.1_

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Character and Home Dashboard
  - [x] 6.1 Add `src/character/character-placeholder.tsx`
    - The C2 SVG with token fills, props `size` and `accessibilityLabel` (default "Xelulu robot"), `image` role, licence comment, no animation
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 3.6_
  - [x] 6.2 Add `src/features/home/mock-home.ts`, `greeting.ts`, `strings.ts` and `story-thumbnail.tsx`
    - `HomeData` with `import type` `Pick`s of `User`, `ChildProfile` and `Device`; `MOCK_HOME` as in the design (mood is a static label only)
    - `greetingFor(date)` with the 05:00 / 12:00 / 17:00 boundaries and the three glyphs
    - Every Home string and builder ("<greeting>, <name>", "<child> is playing with Xelulu", "Battery <n>%", "<n> min", the robot-card label)
    - Story thumbnail: an original SVG with token fills, decorative, with a licence comment
    - _Requirements: 5.7, 5.9, 6.1, 6.2, 6.3, 7.3, 7.4, 8.3, 8.7_
  - [x] 6.3 Add `src/features/home/home-dashboard.tsx` and `app/(tabs)/home.tsx`
    - The screen 6 layout from the design table, with props `now` and `data`; gear → `/settings`, robot card → `/device`, quick actions → `/play`, `/routines`, `/voice-call`, `/settings`; today tiles and last-activity card not pressable; battery pill tone by the 20 % / 10 % thresholds
    - _Requirements: 5.1–5.8, 6.4, 6.5, 6.6_
  - [x] 6.4 Write `test/greeting.test.ts` and `test/home-dashboard.test.tsx`
    - Greeting at 04:59, 05:00, 11:59, 12:00, 16:59, 17:00; Home with `now` at 09:00 shows every mock value listed in the design, the character's `image` role, and no `button` role on the today tiles or last-activity card
    - **Property 8: Home shows the data it is given**, **Property 9: Greeting partitions the day** (example-based)
    - _Requirements: 11.4, 5.1–5.8, 6.1–6.3_
  - [x] 6.5 Write `test/navigation.test.tsx`
    - `renderRouter` with the real `app` directory: `/` → `/home`; 5 tabs with Home selected; press Play → "Play" title with Play selected; every `ROUTE_PATH` renders its title, with the Tab_Bar only on Tab_Routes; back on a directly opened `/privacy` → `/home`; each Home control reaches its route
    - **Property 6: Exactly one tab is selected**, **Property 7: Every route opens with its title**, **Property 10: Home controls reach their routes** (example-based)
    - _Requirements: 11.2, 11.3, 11.5, 4.2–4.8, 6.4–6.6_

- [x] 7. Repo checks
  - [x] 7.1 Replace the "parent app" block in `tooling/test/placeholder.test.ts`
    - Over `apps/parent-app/app`, `apps/parent-app/src` and the app's config files: no colour literal outside `tokens.json`, no `dark:` and no `text-[Npx]` class (Property 1); no `allowFontScaling`, and `maxFontSizeMultiplier`/`dense` only in `app-text.tsx` and the three Dense_Component files (Property 5); no `Animated`, `react-native-reanimated`, `moti`, `animate-` or `transition`; no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource` or import of `@supabase/`, `mqtt` or `ws`; zero env reads via `findEnvReads`; every `@xelulu/shared` import is `import type`; no `expo-camera`, `expo-video` or `expo-av` import, no `<Camera` element and no `"Camera` string literal
    - Each scan asserts it scanned a non-empty file list; the admin and boundary blocks are unchanged
    - **Property 1: Single token source**, **Property 5: Font scaling stays on outside Dense_Components**
    - _Requirements: 10.2, 1.4, 1.7, 3.4, 8.1, 8.2, 8.3, 8.4, 8.6_

- [x] 8. Docs
  - [x] 8.1 Write `apps/parent-app/docs/design-system.md`
    - Every token (name, value, use), every Contrast_Pair (ratio, minimum), the font-scaling cap rule, every kit component (props, when to use it) and the asset licence list (Character_Placeholder, story thumbnail: original work, Xelulu-owned; Ionicons via `@expo/vector-icons`, MIT)
    - _Requirements: 9.1, 9.2, 7.4_
  - [x] 8.2 Update the root README and `tooling/test/readme.test.ts`
    - `pnpm start:app` row: Expo Go shows the Home dashboard; the Expo Go prerequisite line says Phase 2.1 still runs in Expo Go and the dev build arrives with Rive later in Phase 2; a short deep-link note (append `/--/<route>`, for example `/--/privacy`, to the `exp://` URL Expo prints), with no non-local URL literal
    - `readme.test.ts`: the start:app row contains "expo go" and "home dashboard"; the README contains `/--/`; every other check unchanged
    - _Requirements: 9.3, 9.4, 10.4_

- [x] 9. Final verification and report
  - [x] 9.1 Run the full verification
    - `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm test` (which now ends with the parent app's Jest run); fix any failure before continuing
    - Confirm `.env.example`, `tooling/fixtures/approved-panel.txt`, `docs/`, `packages/shared/src/`, `.github/workflows/ci.yml` and the other specs are unchanged, and that no file outside `src/theme/tokens.json` holds a colour literal
    - _Requirements: 11.6, 10.6, 10.7_
  - [x] 9.2 Write the Done-when report
    - For each Done-when item (design system documented and used by Home; 5-tab nav and every route opens; Home matches screen 6 on a phone; build and lint pass; smoke and key-interaction tests), name the covering test or file and its result
    - List the manual phone checklist from the design as not run by the agent; list every FLAG (C1, C5, C8, C9, C13, C16, C18), the proposed `product.md` line from C1, every superseded Phase 0 item and Repo_Check, the open s.9 item (C13), and anything not verified
    - _Requirements: 11.1–11.6_

## Notes

- Test sub-tasks are not optional: Omar's Done-when requires them. All are example-based (C16); no fast-check runs.
- Each task references requirement clauses; properties map to the design's Correctness Properties.
- If NativeWind's babel transform fails under Jest, use the Jest-only fallback in the design's Testing Strategy and record it in the report.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "6.1"] },
    { "id": 3, "tasks": ["3.2", "6.2"] },
    { "id": 4, "tasks": ["3.3", "4.2"] },
    { "id": 5, "tasks": ["4.3", "6.3"] },
    { "id": 6, "tasks": ["4.4", "6.4", "7.1", "8.1"] },
    { "id": 7, "tasks": ["6.5", "8.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2"] }
  ]
}
```
