# Implementation Plan: Phase 0 Skeleton

## Overview

This plan builds the empty Xelulu monorepo in TypeScript (strict), in the order the design lays out. It starts by resolving pinned versions, then sets up the root workspace config, the shared package, the services, the admin console and the parent app, and then installs and builds. After that come the Supabase scaffold, the connection panel, and the pure repo checks in `tooling/checks` with their tests. The local ESLint boundary rule, the Compose stack, the README and the CI workflow follow, and the plan ends with lockfile and full verification.

Ground rules for every task:

- No Document B types, schemas, topics or fixtures. `packages/shared/src/gateway-contract/` holds only `.gitkeep`.
- No env reads in any package. No network connections from the gateway, simulator or parent app.
- The admin dev and preview servers and every EMQX port bind to `127.0.0.1` only.
- No secrets anywhere. Every Panel_Key stays empty, and Supabase secrets stay `env(NAME)`.
- Every dependency is pinned exactly. Any `~` or `^` a tool writes is rewritten to the exact version resolved in `pnpm-lock.yaml`.
- Every file name is kebab-case, except `README.md`, `Dockerfile` and `_layout.tsx`.
- No git commits are made without Omar's explicit request. Resolved versions, justifications and verification results are reported in the task result. If a git-based check needs a repository and none exists, run `git init` locally, but do not commit.

## Tasks

- [x] 1. Resolve pinned versions and the current stable Expo SDK
  - [x] 1.1 Resolve every "Verify" and "Resolved in Task 1" entry in the design's Pinned versions table
    - Resolve each one with the method listed in the table: `pnpm view …`, `npx expo install … --check`/`--fix`, nodejs.org releases, and Docker Hub tags. Expo-managed entries (including TypeScript and React) follow the SDK confirmed in task 1.2.
    - Node: take the newest `24.x.y (LTS)` patch for which `node:<ver>-bookworm-slim` exists, so `.nvmrc`, `engines.node` and the Dockerfile `FROM` match exactly.
    - EMQX: take the highest `emqx/emqx:5.8.x` tag and confirm it is Apache-2.0. If no Apache-2.0 5.8.x tag exists, stop and raise it with Omar.
    - Supabase CLI: resolve the version for the one-off `pnpm dlx` init.
    - Keep pnpm on 10.x and ESLint on 9.x. Don't jump majors. Use the NativeWind major officially supported by the SDK from task 1.2, with its matching Tailwind major.
    - Report the resolved list in the task result and flag every value that differs from the design table. Don't edit design.md.
    - _Requirements: 1.2, 1.3, 1.4, 1.8, 9.1, 10.2, 10.5_
  - [x] 1.2 Confirm the current stable Expo SDK and that the founder's installed Expo Go (iOS or Android) supports it; record the version
    - Resolve the current stable SDK with `npx create-expo-app` / `pnpm view expo version`, then `npx expo install --fix` for the Expo-managed packages.
    - Confirm that the Expo Go installed on the founder's phone, on iOS or Android, supports that SDK. Only the founder's phone is required.
    - If neither platform's Expo Go supports the current stable SDK, stop and raise it with Omar before task 6.
    - Report the resolved SDK version and the React, React Native and TypeScript versions it pairs with in the task result. Admin later pins the same `react`/`react-dom`/`@types/react` (design D3).
    - _Requirements: 4.2_

- [x] 2. Root workspace configuration
  - [x] 2.1 Create the root `package.json`, `pnpm-workspace.yaml`, `.npmrc` and `.nvmrc`
    - Use the root manifest from the design. It has `private`, `type: module`, an exact `packageManager` and `engines.node`, the scripts `build`, `lint`, `format:check`, `format`, `test`, `start:app`, `dev:admin`, `start:gateway --silent` and `start:simulator --silent`, and exact devDependencies taken from task 1.1.
    - `pnpm-workspace.yaml` lists exactly `apps/*`, `services/*` and `packages/*`, with `onlyBuiltDependencies: [esbuild]`.
    - `.npmrc` sets `node-linker=hoisted` and `save-exact=true`. `.nvmrc` holds one line with the resolved Node version.
    - Scripts use only `pnpm`, `eslint`, `prettier`, `tsc`, `vitest` and `&&`. No `rm`, `cp`, env-var prefixes or shell globs.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8, 2.8, 3.1, 3.2, 3.3, 3.4, 11.8_
  - [x] 2.2 Create `tsconfig.base.json`, `tsconfig.test.json` and `vitest.config.ts`
    - The base holds only strictness and hygiene options (`strict`, `noUncheckedIndexedAccess`, and the rest of the design's list). Each package sets its own `module`, `target`, `lib` and `jsx`.
    - `tsconfig.test.json` uses `noEmit`, `NodeNext`, `ES2023` and `types: ["node"]`. It includes `tooling/**/*.ts`, `services/*/test/**/*.ts`, `packages/*/test/**/*.ts` and `vitest.config.ts`.
    - `vitest.config.ts` covers the three test globs and sets `environment: "node"` and `testTimeout: 30000`.
    - _Requirements: 1.5, 1.6, 11.8_
  - [x] 2.3 Create `.gitignore` and `.dockerignore`
    - `.gitignore` uses the design's entries: `.env` and `.env.*` at any depth, with only `!/.env.example` re-included, plus `node_modules/`, `dist/`, `*.tsbuildinfo`, `coverage/`, `apps/parent-app/.expo/` and `apps/parent-app/expo-env.d.ts`.
    - `.dockerignore` excludes `**/node_modules`, `**/dist`, `.git`, `.env`, `.env.*`, `docs`, `.kiro` and `apps/parent-app/.expo`, so secrets never enter the build context.
    - _Requirements: 12.1, 12.2, 10.12_
  - [x] 2.4 Create `.prettierrc.json` and `.prettierignore`
    - `.prettierrc.json` sets `printWidth: 100`, `trailingComma: "all"` and `endOfLine: "auto"`.
    - `.prettierignore` lists `node_modules/`, `**/dist/`, the Expo-generated paths, `pnpm-lock.yaml`, `.env.example`, `tooling/fixtures/`, `docs/` and `.kiro/`.
    - _Requirements: 3.2, 3.4, 3.7_

- [x] 3. Shared package scaffold
  - [x] 3.1 Create `packages/shared`
    - `package.json` is `@xelulu/shared`, version `0.0.0`, `private`, `type: module`, with `main`, `types` and `exports` pointing at `dist`. Its `build` script is `tsc -p tsconfig.json`. It has no `dependencies`, and its devDependencies are only `typescript` and `@types/node`, both exact.
    - `tsconfig.json` extends the root base and sets `NodeNext`, `ES2023`, `rootDir: src`, `outDir: dist` and `declaration: true`.
    - `src/index.ts` is `export {};` plus a one-line comment saying the contract arrives with Prompt 0.3.
    - `src/gateway-contract/.gitkeep` and `src/domain/.gitkeep` are empty, zero-byte files. No Document B types and no domain types.
    - _Requirements: 2.3, 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 13.1, 13.2_
  - [x]* 3.2 Write `packages/shared/test/exports.test.ts`
    - Import `../dist/index.js`. Assert that `Object.keys(ns)` is empty and that `"default" in ns` is false.
    - _Requirements: 8.7_

- [x] 4. Gateway and simulator skeletons
  - [x] 4.1 Create `services/gateway`
    - `package.json` is `@xelulu/gateway`, `0.0.0`, `private`, `type: module`. Its `build` script is `tsc -p tsconfig.json` and its `start` script is `node dist/index.js`. It depends on `"@xelulu/shared": "workspace:*"`, and its devDependencies are `typescript` and `@types/node`, both exact.
    - `tsconfig.json` extends the root base and sets `NodeNext`, `ES2023`, `lib ["ES2023"]`, `types ["node"]`, `rootDir src`, `outDir dist` and `include ["src"]`.
    - `src/index.ts` only calls `process.stdout.write("ok\n")`. No `process.exit()`, no env reads, no imports from `node:net`, `http`, `https`, `dgram`, `tls`, `ws` or `mqtt`, and no import of `@xelulu/shared`.
    - _Requirements: 2.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 13.1, 13.2_
  - [x] 4.2 Create `services/simulator`
    - A mirror of task 4.1 with `@xelulu/simulator` as the name. It depends on nothing from `services/gateway` or `apps/*`.
    - _Requirements: 2.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 13.1, 13.2_
  - [x]* 4.3 Write `services/gateway/test/start.test.ts`
    - Spawn `node dist/index.js` and `pnpm --silent start`. Assert that stdout is exactly `ok\n`, stderr is empty, the exit code is 0 and the run takes under 5 s.
    - Run it again with every Panel_Key removed from the env, then with every Panel_Key set to a sentinel. The outcome must be identical each time.
    - Spawn `node dist/index.js` in a temp dir that has no `dist`. Assert a non-zero exit and no `ok` on stdout.
    - _Requirements: 6.4, 6.5, 6.8_
  - [x]* 4.4 Write `services/simulator/test/start.test.ts`
    - Same cases as task 4.3, for the simulator.
    - _Requirements: 7.3, 7.6, 7.7_

- [x] 5. Admin console placeholder
  - [x] 5.1 Create `apps/admin`
    - `package.json`:
      - `@xelulu/admin`, `0.0.0`, `private`, `type: module`.
      - `description`: "Xelulu admin console. Internal only; never shipped to consumers."
      - Scripts: `dev: vite`, `build: tsc --noEmit && vite build`, `preview: vite preview`.
      - `react` and `react-dom` at the exact React version the SDK from task 1.2 uses (design D3). devDependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react` and `@types/react-dom`, all exact.
    - `vite.config.ts`: `server` binds `127.0.0.1:5173` and `preview` binds `127.0.0.1:4173`, both with `strictPort: true`.
    - `tsconfig.json` extends the root base and sets `react-jsx`, `ESNext`/`Bundler`, `ES2022` + `DOM` and `noEmit`. It does not include `vite/client` types, so `import.meta.env` is a type error.
    - `index.html`:
      - `lang="en"`, the charset and viewport meta tags, and the title "Xelulu admin (internal only)".
      - `#root` and the module script for `/src/main.tsx`.
      - No external resources.
    - `src/main.tsx` renders `<StrictMode><App /></StrictMode>` and imports `./styles.css`.
    - `src/app.tsx` renders `<main><h1>Xelulu</h1><p>Phase 0 placeholder</p></main>`.
    - `src/styles.css`:
      - Custom properties for the light and dark palette from the design, with dark values in a `prefers-color-scheme: dark` block.
      - A system font stack, `h1` at 2rem and `p` at 1.125rem.
      - No `animation`, `transition` or `@keyframes`.
    - _Requirements: 2.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10_

- [x] 6. Parent app placeholder (Expo, Expo Router, NativeWind)
  - [x] 6.1 Create the `apps/parent-app` manifest and toolchain config
    - `package.json`:
      - `@xelulu/parent-app`, `0.0.0`, `private`, `main: expo-router/entry`.
      - Scripts: `start: expo start` and `build: tsc --noEmit`.
      - Add `expo` at the SDK resolved in Task 1, then run `npx expo install` for `expo-router`, `expo-linking`, `expo-constants`, `expo-status-bar`, `react`, `react-native`, `react-native-safe-area-context`, `react-native-screens`, `react-native-reanimated` and `react-native-worklets` (the last only if the resolved SDK uses it).
      - Add `nativewind` at the major officially supported by the SDK resolved in Task 1. devDependencies: `tailwindcss` at the matching major, `typescript` and `@types/react`.
      - If the supported NativeWind major differs from 4, follow its official setup for the config files below with the same intent (one palette source, text ≥ 16 pt, no animation).
      - Rewrite every `~`/`^` to the exact resolved version.
      - No `expo-dev-client`, Rive, Lottie, MQTT or WebSocket packages, and no dependency on `@xelulu/admin`.
    - `app.json`: `name: Xelulu`, `slug: xelulu`, `scheme: xelulu`, `userInterfaceStyle: automatic`, `plugins: ["expo-router"]` and `experiments.typedRoutes: false`. No `owner`, `updates`, `extra` or URLs.
    - `babel.config.js` uses `babel-preset-expo` with `jsxImportSource: "nativewind"` and `nativewind/babel`. If `babel-preset-expo` doesn't resolve, add it with `npx expo install` and pin it exactly.
    - `metro.config.js` wraps `getDefaultConfig(__dirname)` in `withNativeWind` with `input: "./global.css"`.
    - `global.css` holds the three `@tailwind` directives. `nativewind-env.d.ts` holds the types reference.
    - `tailwind.config.js` sets `content: ["./app/**/*.{ts,tsx}"]` and the `nativewind/preset` preset. The placeholder palette lives in `theme.extend.colors.placeholder`, with light and dark values for bg, title and body.
    - `tsconfig.json` sets `extends: ["expo/tsconfig.base", "../../tsconfig.base.json"]` and includes `**/*.ts`, `**/*.tsx` and `nativewind-env.d.ts`.
    - _Requirements: 1.8, 4.1, 4.2, 4.8, 4.9, 5.8, 12.5_
  - [x] 6.2 Create `app/_layout.tsx` and `app/index.tsx`
    - `_layout.tsx` imports `../global.css` and renders `<Slot />`. It contains nothing else.
    - `index.tsx` is one `View` with exactly two `Text` elements, using the design's NativeWind classes:
      - The title "Xelulu" with `accessibilityRole="header"` and `text-[28px]`.
      - The message "Phase 0 placeholder" with `text-[18px]`.
      - Dark variants on both.
    - No `allowFontScaling={false}`, no `maxFontSizeMultiplier`, no Animated, Reanimated or Moti, no `animate-*` or `transition-*` classes, and no env reads.
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11, 4.12, 12.5_

- [x] 7. Install and build the workspace
  - [x] 7.1 Generate the lockfile and make `pnpm build` pass
    - Run `pnpm install` with the `.nvmrc` Node and the pinned pnpm. Keep the generated `pnpm-lock.yaml` at the root (no git commit).
    - Rewrite any range left in a manifest to the exact version from the lockfile, then re-install.
    - If pnpm reports "Ignored build scripts" for anything other than esbuild, add the entry to `onlyBuiltDependencies` only if install actually needs it, and justify it in the task result.
    - Run `pnpm build` and fix errors until all five packages build with exit code 0. Check that shared builds before the gateway and simulator.
    - _Requirements: 1.12, 1.13, 2.1, 2.2, 2.6, 2.9, 2.10, 4.11, 5.9, 8.2_

- [x] 8. Checkpoint: build pipeline works
  - Ensure all tests pass, ask the user if questions arise. `pnpm install` and `pnpm build` must exit 0 from a clean state with no `.env`.

- [x] 9. Supabase scaffold
  - [x] 9.1 Generate and trim `supabase/`
    - Run `pnpm dlx --allow-build=supabase supabase@<ver> init` at the repo root. Answer "no" to the editor Deno prompts.
    - In `config.toml`, set line 1 to `# Generated by Supabase CLI <ver> (supabase init).` and set `project_id = "xelulu"`. Leave every other line as generated.
    - Confirm that every secret-bearing setting is commented out or written as `env(NAME)`, and that local URLs use `127.0.0.1`.
    - Keep the CLI's `supabase/.gitignore`.
    - Add `migrations/.gitkeep` and `functions/.gitkeep`, both empty. Write `seed.sql` as the single line `-- Xelulu seed data. Empty until Phase 1.`. No SQL statements and no Edge Function sources.
    - Don't add `supabase` as a dependency.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 12.6_

- [x] 10. Connection panel
  - [x] 10.1 Create `.env.example` and `tooling/fixtures/approved-panel.txt`
    - Copy Appendix A of requirements.md into both files, byte for byte, as UTF-8 with no BOM. The two copies are independent: the fixture is the Panel_Check reference.
    - Every comment stays on its own line directly above its key, and every `KEY=` line has nothing after `=`. Don't reformat anything or move any comment.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 11. Panel_Check
  - [x] 11.1 Implement `tooling/checks/panel.ts`
    - Write pure functions `normaliseText`, `parsePanel` and `checkPanel`, using the `PanelLine` and `PanelIssue` types and the parsing rules from the design. No filesystem access.
    - `normaliseText` turns CRLF into LF, drops one trailing EOL and splits into lines.
    - `checkPanel` returns:
      - `panel_missing` when the input is `null`.
      - `line_mismatch` with the first differing 1-based line.
      - `missing_key`, `unknown_key`, `duplicate_key`, `out_of_order` and `non_empty_value` issues.
    - No issue ever carries a value.
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.10, 11.11, 11.12_
  - [x]* 11.2 Write property test for panel line endings
    - **Property 1: Approved panel accepted under any line-ending variant**
    - Goes in `tooling/test/panel-check.test.ts`. Use `numRuns ≥ 100` and the tag comment `// Feature: phase-0-skeleton, Property 1: …`.
    - **Validates: Requirements 11.2, 11.12**
  - [x]* 11.3 Write property test for the declaration value rule
    - **Property 2: Panel declaration value rule**
    - Goes in `tooling/test/panel-check.test.ts`.
    - **Validates: Requirements 11.5, 11.6**
  - [x] 11.4 Write property test for panel mutations (required by Req 11.9)
    - **Property 3: Every panel mutation is rejected and names its keys**
    - Goes in `tooling/test/panel-check.test.ts`. Use `describe.each` over the five variant kinds, with ≥ 100 runs each. Exclude whitespace-only values from the non-empty generator.
    - **Validates: Requirements 11.3, 11.4, 11.7, 11.9**
  - [x]* 11.5 Write property test for first-differing-line reporting
    - **Property 4: First differing line is reported**
    - Goes in `tooling/test/panel-check.test.ts`.
    - **Validates: Requirements 11.10**
  - [x] 11.6 Write the real-repo Panel_Check tests (required)
    - Goes in `tooling/test/panel-check.test.ts`.
    - Load the root `.env.example` and the fixture, and assert `checkPanel(actual, approved)` returns `[]`.
    - Assert that `.env.example` has no BOM and is valid UTF-8, and that the reference path differs from the panel path.
    - Assert that `checkPanel(null, approved)` gives `panel_missing`.
    - _Requirements: 11.1, 11.3, 11.6, 11.8, 11.11_

- [x] 12. Secret_Check
  - [x] 12.1 Implement `tooling/checks/secret-scan.ts`
    - Write pure functions `scanText(path, text, keys)`, `isEmptyEquivalent(value)` and `formatFindings(findings)`.
    - Use the assignment regex from the design: `KEY=`/`KEY:`, optional `export ` or `- ` prefix, optional quoted key, with Secret_Check's own defensive inline-comment rule (the first whitespace followed by `#` starts a comment).
    - Empty-equivalent values are: empty, whitespace only, `""`, `''`, `${NAME}` and `env(NAME)`, optionally quoted.
    - `SecretFinding` has no value field, and nothing in the formatted output includes a value.
    - _Requirements: 12.3, 12.4_
  - [x] 12.2 Write property test for Secret_Check (required by Req 12.7)
    - **Property 5: Secret_Check flags exactly the non-empty assignments and never leaks them**
    - Goes in `tooling/test/secret-check.test.ts`.
    - **Validates: Requirements 12.3, 12.4, 12.7, 9.4, 9.9, 10.12, 14.9**
  - [x] 12.3 Write the real-repo Secret_Check test (required)
    - Goes in `tooling/test/secret-check.test.ts`.
    - List files with `git ls-files -z --cached --others --exclude-standard` and skip files with a NUL byte in their first 8 KiB.
    - Derive the Panel_Keys from the fixture with `parsePanel`. Don't hard-code them.
    - Assert zero findings. On failure, print every `path:line KEY`.
    - If git is unavailable, fail with "git is required for Secret_Check". Never skip silently.
    - If the workspace is not yet a git repository, run `git init` locally so `git ls-files` works. Do not commit.
    - _Requirements: 12.3, 12.4, 9.9, 10.12, 14.9_

- [x] 13. Version and naming checks
  - [x] 13.1 Implement `tooling/checks/exact-version.ts` and `tooling/checks/kebab-case.ts`
    - `isExactVersion` uses the design's regex, which allows a pre-release suffix and rejects build metadata.
    - `checkManifestDeps(manifest, workspaceNames)` covers `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`. It reports workspace names that don't use `workspace:` and non-workspace names whose spec is not exact.
    - `isKebabFileName` drops one leading dot, splits on `.` and checks each part against `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
    - `NAME_EXCEPTIONS` is `README.md`, `Dockerfile` and `_layout.tsx`.
    - _Requirements: 1.8, 1.11, 13.1_
  - [x]* 13.2 Write property test for the kebab-case validator, plus the real-repo name check
    - **Property 6: Kebab-case file-name validator**
    - Goes in `tooling/test/file-names.test.ts`. Also apply the check to every tracked file outside `docs/` and `.kiro/`.
    - **Validates: Requirements 1.11**
  - [x]* 13.3 Write property test for the exact-version validator
    - **Property 7: Exact-version validator**
    - Goes in `tooling/test/manifests.test.ts`.
    - **Validates: Requirements 1.2, 1.3, 1.8, 8.9, 13.1**
  - [x]* 13.4 Write the real-repo manifest checks
    - Goes in `tooling/test/manifests.test.ts`.
    - Workspace and versions:
      - Exactly five workspace packages.
      - `private` everywhere.
      - Exact `packageManager`, and `engines.node` equal to `.nvmrc`.
      - Every manifest passes `checkManifestDeps`.
    - Scripts and dependencies:
      - Every package has a `build` script with the expected command.
      - Scripts contain no `rm`, `cp`, `export` or `VAR=` prefixes.
      - No per-package ESLint or Prettier dependency or config.
      - The parent app has no dev-client, Rive, Lottie, MQTT, WS or admin dependency.
    - Boundaries:
      - The admin `description` contains "internal only".
      - The only workspace edges are gateway → shared and simulator → shared.
      - Shared has no runtime dependencies.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 1.9, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 4.1, 4.2, 4.8, 4.9, 5.7, 6.2, 6.3, 6.7, 7.2, 7.5, 8.8, 8.9, 13.1, 13.2_

- [x] 14. Env-read and URL checks
  - [x] 14.1 Implement `tooling/checks/env-reads.ts` and `tooling/checks/url-scan.ts`
    - `findEnvReads(source)` detects:
      - `process.env.NAME`, `process.env["NAME"]` and `process.env['NAME']`.
      - `import.meta.env.NAME`.
      - Destructuring or computed access of `process.env`, which returns `name: null`.
    - `findNonLocalUrls(path, text)` checks the schemes http, https, ws, wss, mqtt, mqtts, postgres and postgresql. It allows `localhost`, `127.0.0.1` and `[::1]`, skips comment lines and `$schema`, and reports only the host.
    - _Requirements: 12.5, 12.6, 12.8, 5.6, 5.10_
  - [x]* 14.2 Write property test for the env-read detector
    - **Property 8: Environment-read detector**
    - Goes in `tooling/test/env-reads.test.ts`.
    - **Validates: Requirements 12.5, 12.8, 5.6, 6.6, 7.4**
  - [x] 14.3 Write the real-repo env-read test (required)
    - Goes in `tooling/test/env-reads.test.ts`.
    - Scan the parent-app source and config files, excluding `node_modules`. Fail, reporting the file and name, on any read whose name doesn't start with `EXPO_PUBLIC_`, and on any `null`-name read.
    - Also assert that the admin, gateway, simulator and shared sources contain no env reads at all.
    - _Requirements: 12.5, 12.8, 5.6, 6.6, 7.4_
  - [x]* 14.4 Write property test for the URL detector, plus the real-repo URL scan
    - **Property 10: Non-local URL detector**
    - Goes in `tooling/test/url-scan.test.ts`. Also apply the detector to the tracked source, Dockerfile and config files, using the permitted exceptions in Req 12.6.
    - **Validates: Requirements 12.6, 5.10**

- [x] 15. Contrast check
  - [x] 15.1 Implement `tooling/checks/contrast.ts`
    - `contrastRatio(fgHex, bgHex)` uses the WCAG 2.x relative-luminance formula.
    - _Requirements: 4.7, 5.5_
  - [x]* 15.2 Write `tooling/test/contrast.test.ts`
    - Include known-value checks, for example black on white = 21.
    - Read the parent-app palette from `tailwind.config.js` and the admin palette from the `styles.css` custom properties. Assert every title/body-on-background pair is ≥ 4.5:1, in both light and dark.
    - _Requirements: 4.7, 5.5_

- [x] 16. ESLint flat config and dependency-direction rule
  - [x] 16.1 Implement `tooling/eslint/no-cross-package-import.mjs` and `tooling/eslint/xelulu-plugin.mjs`
    - Export a pure `classifyImport(fromFile, specifier, { rootDir, packages })`. Normalise path separators to `/`. Resolve relative specifiers by path prefix and bare specifiers by exact name or `name/` subpath.
    - Report the violation when the target is a different package whose kind is `app` or `service`.
    - The rule visits `ImportDeclaration`, `ExportNamedDeclaration`/`ExportAllDeclaration` with a source, `ImportExpression` with a literal or a template with no expressions, and `require("…")`. It reports with the design's message.
    - `xelulu-plugin.mjs` exposes the rule as `no-cross-package-import`.
    - _Requirements: 13.3, 13.5_
  - [x] 16.2 Create `eslint.config.mjs`
    - Use `defineConfig` with:
      - The design's ignores.
      - `js.configs.recommended`.
      - `tseslint.configs.recommended`, scoped to `**/*.{ts,tsx}`. No type-aware configs.
      - CommonJS `globals.node` for `**/*.{js,cjs}`, `globals.node` for `.mjs`/`.ts`, and `globals.browser` for `apps/admin/src/**`.
    - Enable `xelulu/no-cross-package-import: "error"` on all source extensions. Build the package table at load time from `apps/*`, `services/*` and `packages/*` `package.json` files.
    - _Requirements: 3.1, 3.3, 3.5, 3.7, 3.8, 13.3, 13.4_
  - [x]* 16.3 Write property test for the dependency-direction rule
    - **Property 9: Dependency-direction rule**
    - Goes in `tooling/test/no-cross-package-import.test.ts`. Use `Linter.verify` with synthetic package tables covering all four import forms, relative and named specifiers, and both separator styles. Add `RuleTester` examples.
    - **Validates: Requirements 13.3, 13.5, 5.8, 6.7, 7.5, 8.8**
  - [x]* 16.4 Write `tooling/test/lint-format.test.ts`
    - Use ESLint `isPathIgnored` and Prettier `getFileInfo` on every excluded path.
    - `lintText` on a deliberate error reports its path. `prettier.check` on unformatted text returns false and leaves the file content unchanged.
    - _Requirements: 3.7, 3.8, 3.9_

- [x] 17. Repo structure tests
  - [x]* 17.1 Write `tooling/test/tsconfig.test.ts`
    - Run `tsc --showConfig -p <pkg>` for each package. Assert that `strict` is true, that no strict-family option is false, and that the extends chain reaches `tsconfig.base.json`.
    - _Requirements: 1.5, 1.6, 4.1, 5.1, 6.1, 7.1, 8.1_
  - [x]* 17.2 Write `tooling/test/layout.test.ts`
    - Assert:
      - The required root files and folders exist.
      - There are no per-package ESLint or Prettier configs.
      - `apps/parent-app/app` holds only `_layout.tsx` and `index.tsx`.
      - The gateway and simulator each have `src/` and `test/`.
      - `gateway-contract` and `domain` each hold exactly one zero-byte `.gitkeep`.
      - `supabase/migrations` holds only `.gitkeep`, and `supabase/functions` holds no source files.
    - _Requirements: 1.7, 1.10, 3.1, 3.2, 4.4, 6.1, 7.1, 8.4, 8.5, 8.6, 9.5, 9.8_
  - [x]* 17.3 Write `tooling/test/gitignore.test.ts`
    - Use `git check-ignore --no-index` (run `git init` locally first if there is no repository; do not commit). Assert that `.env`, `.env.local`, `apps/parent-app/.env`, `apps/parent-app/.env.local`, `node_modules`, every `dist/` and `apps/parent-app/.expo/` are ignored, and that the root `.env.example` is not.
    - _Requirements: 12.1, 12.2_
  - [x]* 17.4 Write `tooling/test/placeholder.test.ts`
    - Parent app:
      - Exactly two `Text` elements, the title with `accessibilityRole="header"`, and NativeWind classes present.
      - Every `text-[Npx]` is ≥ 16, and there is no `text-xs`, `text-sm` or `text-base`.
      - No font-scaling overrides and no animation APIs or classes.
    - Admin:
      - Exactly one `h1` and `lang="en"`.
      - No `import.meta.env`, no animation or transition CSS, and no external resources in `index.html`.
      - The built `apps/admin/dist` contains no Panel_Key name.
    - Boundaries:
      - The parent app has no reference to `apps/admin` or `@xelulu/admin`.
      - The gateway and simulator have no network-module imports.
    - _Requirements: 4.5, 4.6, 4.7, 4.9, 4.10, 5.4, 5.6, 5.8, 5.10, 6.6, 7.4_
  - [x]* 17.5 Write `tooling/test/supabase.test.ts`
    - Parse `config.toml` with `smol-toml`.
    - Assert:
      - The top-level table set equals the pinned set taken from the generated file.
      - `project_id === "xelulu"`.
      - Secret-like keys are absent or `env(…)`.
      - `seed.sql` holds exactly one `--` line plus blank lines.
      - No file under `supabase/` contains SQL statements.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7_

- [x] 18. Checkpoint: tooling checks pass
  - Ensure all tests pass, ask the user if questions arise. `pnpm lint`, `pnpm format:check` and `pnpm test` must all exit 0. `pnpm lint` must pass without a prior build.

- [x] 19. Local Compose stack
  - [x] 19.1 Create `services/gateway/Dockerfile` and `services/simulator/Dockerfile`
    - Use the design's two-stage Dockerfile:
      - The base is `node:<.nvmrc>-bookworm-slim`, with `corepack enable`.
      - Copy all five manifests plus the root config, then run `pnpm install --frozen-lockfile --filter @xelulu/<svc>...` and `pnpm --filter @xelulu/<svc>... build`.
      - The runtime stage copies only `dist`, runs as `USER node` and uses `CMD ["node", "dist/index.js"]`.
    - No `ENV` or `ARG` for any Panel_Key, and no credentials.
    - _Requirements: 10.4, 10.5, 10.12_
  - [x] 19.2 Create `docker-compose.yml`
    - Use the design's file:
      - `name: xelulu` with exactly three services: `emqx`, `gateway` and `simulator`.
      - EMQX uses the resolved 5.8.x tag with a licence comment, the five ports bound to `127.0.0.1`, the `emqx ctl status` healthcheck and `restart: "no"`.
      - The gateway and simulator build from the repo root with their Dockerfiles. They use `env_file` long syntax with `required: false`, have no `ports`, no `depends_on` and `restart: "no"`.
    - Add the header comment saying the default dashboard credentials are for local development only. No `environment:` entries, no credentials and no `version:` key.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14_
  - [x]* 19.3 Write `tooling/test/compose-static.test.ts`
    - Parse the compose file with `yaml` and assert:
      - The service set is exactly the three services.
      - The EMQX image is an exact `major.minor.patch` tag.
      - Exactly the five ports, each bound to `127.0.0.1`, and no ports on the gateway or simulator.
      - The Dockerfile paths, `env_file` `required: false`, and the credentials comment.
      - No `environment:` entries.
    - Read the Dockerfile `FROM` lines and assert their major matches `.nvmrc`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.11, 10.12, 10.13_

- [x] 20. Root README
  - [x] 20.1 Write `README.md`
    - Follow the design's outline:
      - What this is.
      - Prerequisites: Node from `.nvmrc` with `nvm use`/`fnm use`, the exact pnpm version via `corepack enable`, Docker Compose ≥ 2.24, and Expo Go on the founder's phone (iOS or Android) for the current stable Expo SDK resolved in Task 1, naming the SDK number. Note that Expo Go is a Phase 0 convenience only and Phase 2 moves to a dev build.
      - Setup, with the `Copy-Item .env.example .env` and `cp .env.example .env` forms. Say that `.env` is git-ignored, must never be committed, and is optional for Compose.
      - Commands, and each start command with its expected result.
    - Notes:
      - The admin console is internal only, never shipped, and localhost only.
      - The EMQX default credentials are local-dev only and the five ports are on `127.0.0.1` only. Don't print the credentials; link to the EMQX docs.
      - The gateway-contract folder is empty on purpose until the Document B revision is approved.
      - The EMQX 5.8.x licence, and the Supabase CLI version used for `init`.
    - Add a short repo layout section linking to `.kiro/steering/structure.md`.
    - _Requirements: 5.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_
  - [x]* 20.2 Write `tooling/test/readme.test.ts`
    - Assert the required phrases are present.
    - Every `pnpm <script>` named in the README exists in the root or target manifest.
    - The pnpm version and SDK number match the manifests, and both copy commands are present.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

- [x] 21. CI workflow
  - [x] 21.1 Create `.github/workflows/ci.yml`
    - `checks` job, on a matrix of `ubuntu-latest`, `macos-latest` and `windows-latest`:
      - `setup-node` with `node-version-file: .nvmrc`, then `corepack enable`.
      - `pnpm install --frozen-lockfile`, then `git diff --exit-code pnpm-lock.yaml`.
      - `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm start:gateway` and `pnpm start:simulator`.
    - `compose` job (Ubuntu):
      - `docker compose config` with no `.env`.
      - Req 10.6 check: copy `.env.example` to `.env`, run `docker compose config --format json`, assert every Panel_Key is present in the gateway and simulator environments, then delete the `.env`.
      - `up -d --build`, then poll `http://127.0.0.1:18083` for up to 120 s.
      - The gateway and simulator exit within 60 s with logs exactly `ok`, `ExitCode` 0 and `RestartCount` 0.
      - After a 30 s wait, both are still exited and EMQX is still running.
      - `ss -ltn` shows the five ports on `127.0.0.1` only.
    - Pin every action to a full commit SHA. No secrets are used.
    - _Requirements: 1.13, 2.1, 2.6, 2.8, 2.9, 3.5, 3.6, 4.11, 5.9, 7.8, 8.2, 10.6, 10.7, 10.8, 10.9, 10.10, 13.4_

- [x] 22. Lockfile and full verification
  - [x] 22.1 Refresh the lockfile and run the full command set
    - Run `pnpm install` and confirm that every manifest is exact and that `pnpm-lock.yaml` matches them. Keep the lockfile at the root (no git commit).
    - From a clean state with no `node_modules` or `dist` and no `.env`, run `pnpm install --frozen-lockfile` and confirm `pnpm-lock.yaml` is unchanged (`git status` if a local repository exists). Then run `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm start:gateway` and `pnpm start:simulator`, and fix any failure.
    - If CI isn't available yet, run the same commands by hand on Windows, macOS and Linux, and report the results in the task result.
    - _Requirements: 1.12, 1.13, 2.1, 2.6, 2.9, 3.5, 3.6, 6.4, 7.3, 7.8, 13.4_
  - [x] 22.2 Run the Compose smoke test locally (required)
    - Run the same steps as the CI `compose` job: config with no `.env`, then the Req 10.6 `docker compose config --format json` presence check with `.env` copied from `.env.example`, then `up`, the health poll, the `ok` and exit-code checks, the 30 s wait and the loopback-port check.
    - Delete the temporary `.env` afterwards. Report the results in the task result.
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 10.10, 10.13_
  - [x] 22.3 Run the one-off failure-path verifications and report them in the task result
    - Req 1.14: a stale lockfile makes the frozen install fail and stays unchanged.
    - Req 2.7 and 8.3: an injected type error in shared fails `pnpm build`, and the output names the package.
    - Req 2.10: in `pnpm -r build` output, shared builds before the gateway and simulator.
    - Req 10.14: overriding the gateway command to exit 1 makes Compose report the code and leaves EMQX up.
    - Revert every injected change afterwards.
    - _Requirements: 1.14, 2.7, 2.10, 8.3, 10.14_

- [x] 23. Final checkpoint: ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [~] 24. Manual verification: the six "Done when" checks
  - Done when 1, `pnpm install` and `pnpm build` pass: in a fresh clone with the `.nvmrc` Node and no `.env`, both exit 0 and `git status` is clean. _Requirements: 1.1–1.14, 2.1–2.10, 8.1–8.3_
  - Done when 2, Expo Go on the founder's phone: run `pnpm start:app` and scan the QR code with Expo Go on the founder's phone (iOS or Android), using the current stable Expo SDK resolved in Task 1.
    - Within 60 s, "Xelulu" and "Phase 0 placeholder" appear, with no red or yellow box.
    - Check dark mode is readable, the text scales at the largest system font, and the title is announced as a heading by VoiceOver and TalkBack.
    - _Requirements: 4.1–4.12_
  - Done when 3, admin in a browser: run `pnpm dev:admin` and open `http://127.0.0.1:5173`.
    - Only the title and message are shown, and DevTools shows same-origin requests only.
    - The host's LAN IP on port 5173 refuses the connection.
    - _Requirements: 5.1–5.10_
  - Done when 4, gateway and simulator log "ok": `pnpm start:gateway` and `pnpm start:simulator` each print `ok` and exit with code 0 (check `$LASTEXITCODE` or `$?`). _Requirements: 6.1–6.8, 7.1–7.8_
  - Done when 5, `docker compose up` starts EMQX: with no `.env`, EMQX becomes healthy and `http://127.0.0.1:18083` loads. The gateway and simulator print `ok` and exit with code 0. Repeat with `.env` present. _Requirements: 10.1–10.14_
  - Done when 6, `.env.example` is complete and empty: `pnpm test` passes (Panel_Check, Secret_Check), and a visual diff against Appendix A shows no change. _Requirements: 11.1–11.12, 12.1–12.4_
  - Full WCAG validation needs manual testing with assistive technologies and expert review. That is out of scope for the placeholder.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Exceptions that are required and not marked optional:
  - The property-based tests that the requirements themselves mandate: task 11.4 (Property 3, Req 11.9) and task 12.2 (Property 5, Req 12.7).
  - The deterministic real-repo checks that the requirements mandate as tests: Panel_Check (11.6), Secret_Check (12.3), the parent-app env-read test (14.3) and the Compose smoke test (22.2).
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property tests validate universal correctness properties. Unit tests validate specific examples and edge cases.
- OP-1 is resolved: every panel comment sits on its own line above its key, so no parser-agreement test is needed.
- Expo Go is a Phase 0 convenience only. The SDK is the current stable one, confirmed against the founder's installed Expo Go (iOS or Android) in task 1.2, which blocks task 6 if neither platform supports it. Phase 2 moves the parent app to an Expo dev build for Rive.
- No git commits are made without Omar's explicit request. Results are reported in the task result.
- Production broker licence (EMQX 5.9+ is BSL 1.1) is flagged for Omar before Phase 3. It is out of scope here.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.2"] },
    { "id": 1, "tasks": ["1.1"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["3.1", "4.1", "4.2", "5.1", "6.1"] },
    { "id": 4, "tasks": ["6.2"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["3.2", "4.3", "4.4", "9.1", "10.1"] },
    { "id": 7, "tasks": ["11.1", "12.1", "13.1", "14.1", "15.1", "16.1"] },
    { "id": 8, "tasks": ["11.6", "12.3", "13.4", "14.3", "16.2", "17.1", "17.2", "17.3", "17.4", "17.5"] },
    { "id": 9, "tasks": ["11.2", "12.2", "13.2", "13.3", "14.2", "14.4", "15.2", "16.3"] },
    { "id": 10, "tasks": ["11.3", "16.4", "19.1", "19.2", "20.1"] },
    { "id": 11, "tasks": ["11.4", "19.3", "20.2", "21.1"] },
    { "id": 12, "tasks": ["11.5"] },
    { "id": 13, "tasks": ["22.1"] },
    { "id": 14, "tasks": ["22.2"] },
    { "id": 15, "tasks": ["22.3"] }
  ]
}
```
