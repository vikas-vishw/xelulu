# Requirements Document

## Introduction

Phase 0 creates the empty Xelulu monorepo so every later phase has a place to land. It delivers a pnpm workspace with strict TypeScript, lint and format tooling, empty packages for the parent app, the admin console, the gateway, the simulator and the shared package, a Supabase local-dev scaffold, a Docker Compose file that brings up EMQX with the gateway and simulator, and the root `.env.example` connection panel exactly as approved.

Phase 0 contains no product behaviour. Every package starts, builds and shows or logs a placeholder, and nothing more.

### Out of scope

- Document B message types, Zod schemas and fixtures (Prompt 0.3, on hold pending a contract revision).
- Any MQTT or WebSocket logic, including connecting to EMQX from the gateway or simulator.
- Supabase tables, RLS policies and migration content.
- Rive, Lottie and `expo-dev-client` (Phase 2).
- Authentication, consent flows and any feature screens.
- Hosted deployment (Supabase cloud, Fly.io, EMQX Cloud).
- Firmware.

### Assumptions and choices

These choices were made without further questions. Each one is reflected in the requirements below.

1. **Node.js**: an exact version from the current Active LTS line, pinned in `.nvmrc`. The design phase records the exact version.
2. **pnpm**: pinned to an exact version through the root `package.json` `packageManager` field.
3. **Dependency versions**: every dependency in every `package.json` uses an exact version (no `^`, `~`, `*`, `x` or ranges).
4. **Expo SDK**: the current stable Expo SDK, whichever matches the Expo Go installed on the founder's phone (iOS or Android). The SDK is not fixed in this spec. It is confirmed and recorded in Task 1 at implementation time. Expo Go is a Phase 0 convenience only; from Phase 2 the parent app moves to an Expo dev build for Rive.
5. **pnpm and Metro**: the root `.npmrc` sets `node-linker=hoisted` so Metro resolves modules in the monorepo.
6. **Meaning of `pnpm build`**: every workspace package has a `build` script. Gateway, simulator and shared compile with TypeScript. Admin runs `vite build`. Parent app runs a type-check (`tsc --noEmit`), because Expo apps have no conventional build output. The root `build` script runs every package's `build` recursively.
7. **Gateway and simulator start behaviour**: each logs exactly `ok` and exits with code 0. The brief allowed "exit 0 or stay idle". Exit 0 was chosen because it is simpler to test in CI and in Compose. Neither opens a network connection in Phase 0.
8. **Docker Compose**: the official EMQX image pinned to an exact version tag. Gateway and simulator are built from per-service Dockerfiles. EMQX ports 1883 (MQTT), 8883 (MQTTS), 8083 (WS), 8084 (WSS) and 18083 (dashboard) are bound to `127.0.0.1` only. Compose reads the root `.env` when present and still starts when it is absent, so a fresh clone can run `docker compose up`.
9. **EMQX dashboard credentials**: the EMQX default dashboard credentials are for local dev only. The README and a comment in `docker-compose.yml` say so.
10. **Lint and format**: ESLint flat config and Prettier at the root, exposed as `pnpm lint` and `pnpm format:check`.
11. **Secrets**: `.gitignore` ignores `.env` and `.env.*`, with `.env.example` as the single exception.
12. **Accessibility**: both placeholder screens use readable text and mark their title as a heading (an accessibility role on mobile, a semantic heading on web).
13. **Admin console**: the dev server listens on localhost only. The placeholder shows no secret values, connection values or device data.
14. **Supabase**: `config.toml` follows Supabase CLI local-dev conventions (the shape `supabase init` produces). `migrations/` is empty apart from a `.gitkeep`. `seed.sql` holds a single comment.
15. **Shared package**: `src/gateway-contract/` and `src/domain/` are placeholder folders only. No Document B types are written.
16. **Cross-platform scripts**: root and package scripts run on Windows, macOS and Linux, because the founder's machine runs Windows.
17. **Expo Go compatibility**: the parent app contains no native modules outside the Expo Go runtime in Phase 0. `expo-dev-client` arrives in Phase 2 with Rive.

### Open points (flagged, not changed now)

- **OP-1: inline comments in `.env.example` (RESOLVED).** The earlier panel put `# comment` text after an empty value on the same line, which dotenv parsers read differently. Per Omar's amendment, every comment now sits on its own line directly above its key, keeping every key, label, section header and key order (Appendix A). The panel has no inline comments, so no inline-comment parsing rule or parser-agreement check is needed.
- **OP-2: where Expo reads `EXPO_PUBLIC_*` values.** Expo loads `.env` from the app's project directory (`apps/parent-app`), not the monorepo root. Phase 0 needs no env values in the app. The design phase must choose how the parent app will read the root panel without copying secrets into the app folder.
- **OP-3: `xelulu/{device_id}/ota` ambiguity.** This is untouched in Phase 0. It is noted here because the contract is on hold.

## Glossary

- **Workspace**: the pnpm workspace monorepo rooted at `c:\xelulu`, defined by `pnpm-workspace.yaml`.
- **Workspace_Package**: any package listed by the Workspace: `apps/parent-app`, `apps/admin`, `services/gateway`, `services/simulator` and `packages/shared`.
- **Root_Manifest**: the root `package.json`.
- **Base_TSConfig**: the root `tsconfig.base.json`, which every Workspace_Package's TypeScript config extends.
- **Build_Pipeline**: the root `pnpm build` script, which runs each Workspace_Package's `build` script.
- **Lint_Tooling**: the root ESLint flat config and Prettier config, with the `pnpm lint` and `pnpm format:check` scripts.
- **Parent_App**: the Expo (TypeScript, Expo Router, NativeWind) app at `apps/parent-app`.
- **Expo_Go**: the Expo Go client app for iOS or Android, as installed on the founder's phone.
- **Admin_Console**: the internal Vite + React (TypeScript) web console at `apps/admin`. It is internal only and never shipped to consumers.
- **Gateway**: the Node.js + TypeScript service at `services/gateway`.
- **Simulator**: the Node.js + TypeScript fake-robot service at `services/simulator`.
- **Shared_Package**: the TypeScript package at `packages/shared`.
- **Gateway_Contract_Folder**: `packages/shared/src/gateway-contract/`, the future single home of the Document B types.
- **Domain_Folder**: `packages/shared/src/domain/`.
- **Supabase_Scaffold**: the `supabase/` folder containing `config.toml`, `migrations/` and `seed.sql`.
- **Compose_Stack**: the root `docker-compose.yml` and the per-service Dockerfiles it references.
- **EMQX**: the EMQX MQTT broker container defined in the Compose_Stack.
- **Connection_Panel**: the root `.env.example` file.
- **Approved_Panel**: the `.env.example` content reproduced in Appendix A, approved by Omar.
- **Panel_Key**: a variable name declared on a `KEY=` line in the Approved_Panel.
- **Panel_Check**: an automated test that parses the Connection_Panel and compares it with the Approved_Panel.
- **Secret_Check**: an automated test that scans git-tracked files for non-empty assignments to Panel_Keys.
- **Ok_Line**: a single stdout line whose entire content is the two characters `ok`.
- **Placeholder_Screen**: a single screen showing the product name and a short "Phase 0 placeholder" message, with no other content.
- **Root_README**: the root `README.md`.

## Requirements

### Requirement 1: Workspace foundation

**User Story:** As the implementation engineer, I want a pinned, strict pnpm monorepo, so that every package builds the same way on every machine.

#### Acceptance Criteria

1. THE Workspace SHALL declare exactly the package globs `apps/*`, `services/*` and `packages/*` in `pnpm-workspace.yaml`, and those globs SHALL resolve to exactly the five Workspace_Packages (`apps/parent-app`, `apps/admin`, `services/gateway`, `services/simulator`, `packages/shared`) and no other package.
2. THE Root_Manifest SHALL set `"private": true` and SHALL set the `packageManager` field to `pnpm@` followed by one exact `MAJOR.MINOR.PATCH` version, with no range operator, tag or partial version.
3. THE Workspace SHALL contain a `.nvmrc` file holding one line with one exact Node.js `MAJOR.MINOR.PATCH` version (an optional leading `v` is allowed). The major version SHALL be the one listed as Active LTS on the Node.js release schedule on the date the design phase records it. Aliases (such as `lts/*` or `node`) and partial versions (such as `22` or `22.11`) are not allowed.
4. THE Root_Manifest SHALL set `engines.node` to the same exact `MAJOR.MINOR.PATCH` version as `.nvmrc` (ignoring any leading `v`).
5. THE Base_TSConfig SHALL set `compilerOptions.strict` to `true`.
6. THE `tsconfig.json` of each Workspace_Package SHALL extend the Base_TSConfig, directly or through a chain of configs that ends at it, and SHALL NOT set `strict` or any individual strict-family option (such as `noImplicitAny` or `strictNullChecks`) to `false`.
7. THE Workspace SHALL contain a root `.npmrc` that sets `node-linker=hoisted`.
8. THE `package.json` of each Workspace_Package and the Root_Manifest SHALL give every entry in `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies` one exact `MAJOR.MINOR.PATCH` version (with an optional pre-release suffix), and SHALL NOT use `^`, `~`, `*`, `x`, `X`, `latest`, other dist-tags, `>`, `<`, `=` comparators, `||`, hyphen ranges, git URLs, file paths or tarball URLs. The only exception is references between Workspace_Packages, which SHALL use the `workspace:` protocol.
9. THE `package.json` of each Workspace_Package SHALL set `"private": true`.
10. THE Workspace SHALL contain the Phase 0 folders from `structure.md` (`apps/parent-app`, `apps/admin`, `services/gateway`, `services/simulator`, `packages/shared`, `supabase`), each Workspace_Package folder SHALL contain a `package.json` and a `tsconfig.json`, and the Workspace root SHALL contain `.env.example`, `docker-compose.yml`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.npmrc` and `README.md`.
11. THE Workspace SHALL name every git-tracked file it introduces in kebab-case, meaning each dot-separated part of the file name (ignoring one leading dot) uses only lowercase letters `a-z`, digits `0-9` and single hyphens, and does not start or end with a hyphen. The only exceptions SHALL be `README.md`, `Dockerfile` and Expo Router's `_layout.tsx`.
12. THE Workspace SHALL commit one `pnpm-lock.yaml` at the root, and that lockfile SHALL match every `package.json` in the Workspace.
13. WHEN `pnpm install --frozen-lockfile` is run in a fresh clone of the Workspace using the Node.js version in `.nvmrc` and the pnpm version in `packageManager`, THE Workspace SHALL install every Workspace_Package's dependencies and exit with code 0 on each of Windows, macOS and Linux, without changing `pnpm-lock.yaml`.
14. IF `pnpm-lock.yaml` does not match a `package.json` in the Workspace, THEN `pnpm install --frozen-lockfile` SHALL exit with a non-zero code and SHALL leave `pnpm-lock.yaml` unchanged.

### Requirement 2: Install and build

**User Story:** As the implementation engineer, I want `pnpm install` and `pnpm build` to pass from a clean clone, so that every later phase starts from a green baseline.

#### Acceptance Criteria

1. WHEN `pnpm install` runs in a clean clone (a fresh checkout with no `node_modules` folders, no build output and no `.env` file) using the Node.js version pinned in `.nvmrc` and the pnpm version pinned in the Root_Manifest `packageManager` field, THE Workspace SHALL complete with exit code 0.
2. THE `package.json` of each of the five Workspace_Packages SHALL define a script named exactly `build`.
3. THE `build` script of the Gateway, the Simulator and the Shared_Package SHALL compile TypeScript with `tsc` using that package's TypeScript config, which extends the Base_TSConfig.
4. THE `build` script of the Admin_Console SHALL run `vite build`.
5. THE `build` script of the Parent_App SHALL run a TypeScript type-check with `tsc --noEmit`.
6. WHEN `pnpm build` runs at the Workspace root after a successful `pnpm install` in a clean clone with no `.env` file present, THE Build_Pipeline SHALL run the `build` script of each of the five Workspace_Packages exactly once and finish with exit code 0 and zero TypeScript errors reported.
7. IF the `build` script of any Workspace_Package exits with a non-zero exit code, THEN THE Build_Pipeline SHALL exit with a non-zero exit code and its output SHALL name the Workspace_Package whose build failed.
8. THE Root_Manifest scripts and the scripts of each Workspace_Package SHALL produce the same exit code when run on Windows (PowerShell and Command Prompt), macOS and Linux shells, without relying on shell syntax or command-line utilities that exist on only some of those platforms.
9. WHEN `pnpm install` runs in a clean clone, THE Workspace SHALL leave the committed pnpm lockfile unmodified, so that `git status` reports no change to it after the install.
10. WHEN `pnpm build` runs at the Workspace root, THE Build_Pipeline SHALL finish the Shared_Package `build` script before starting the `build` script of any Workspace_Package that declares the Shared_Package as a dependency.

### Requirement 3: Lint and format

**User Story:** As the implementation engineer, I want one lint and format setup at the root, so that every package follows the same style.

#### Acceptance Criteria

1. THE Lint_Tooling SHALL provide a single ESLint flat config file at the Workspace root that applies to every `.ts` and `.tsx` file in every Workspace_Package. No Workspace_Package SHALL contain its own ESLint config file. ESLint SHALL be declared in the Root_Manifest `devDependencies` with an exact version.
2. THE Lint_Tooling SHALL provide one Prettier config file and one Prettier ignore file at the Workspace root. No Workspace_Package SHALL contain its own Prettier config file. Prettier SHALL be declared in the Root_Manifest `devDependencies` with an exact version.
3. THE Root_Manifest SHALL define a `lint` script that runs ESLint once from the Workspace root across all Workspace_Packages. The script SHALL run unchanged on Windows, macOS and Linux.
4. THE Root_Manifest SHALL define a `format:check` script that runs Prettier in check mode from the Workspace root across the Workspace. The script SHALL leave every file's content unchanged and SHALL run unchanged on Windows, macOS and Linux.
5. WHEN `pnpm lint` runs from the Workspace root on the Phase 0 sources in a fresh clone after `pnpm install`, without `pnpm build` having been run first, THE Lint_Tooling SHALL report zero errors and exit with code 0.
6. WHEN `pnpm format:check` runs from the Workspace root on the Phase 0 sources in a fresh clone after `pnpm install`, THE Lint_Tooling SHALL report zero unformatted files and exit with code 0.
7. THE Lint_Tooling SHALL exclude all of the following from both `pnpm lint` and `pnpm format:check`, so that a deliberately non-conforming file placed in any of them does not change either script's exit code:
   - `node_modules` at any depth.
   - The TypeScript compile output folders of the Gateway, Simulator and Shared_Package.
   - The Admin_Console Vite build output folder.
   - Expo-generated folders and files in the Parent_App.
   - The pnpm lockfile.
   - The Connection_Panel.
8. IF any linted `.ts` or `.tsx` file in a Workspace_Package contains at least one ESLint error, THEN THE Lint_Tooling SHALL report each offending file path in `pnpm lint` output and exit with a non-zero code.
9. IF any file covered by `pnpm format:check` does not match the Prettier config, THEN THE Lint_Tooling SHALL report each offending file path, exit with a non-zero code and leave the file's content unchanged.

### Requirement 4: Parent app placeholder

**User Story:** As Omar, I want an empty parent app that opens on my phone through Expo Go, so that the mobile toolchain is proven before any feature work.

#### Acceptance Criteria

1. THE Parent_App SHALL be a TypeScript Expo project that uses Expo Router for navigation and NativeWind for styling, with a TypeScript config that extends the Base_TSConfig and keeps strict mode enabled.
2. THE Parent_App SHALL open on the founder's phone in Expo_Go using the current stable Expo SDK (whichever matches the installed Expo_Go on iOS or Android), with the resolved SDK version recorded at implementation time in Task 1. Expo_Go is a Phase 0 convenience only; from Phase 2 the Parent_App moves to an Expo dev build for Rive.
3. WHEN a developer runs the Parent_App start script and scans the QR code with Expo_Go on the founder's phone (iOS or Android) on the same local network, THE Parent_App SHALL render the Placeholder_Screen within 60 seconds of the scan without showing an error screen, a red-box error or a yellow-box warning.
4. THE Parent_App SHALL expose exactly one Expo Router route, the root route (`/`), and that route SHALL render the Placeholder_Screen.
5. THE Placeholder_Screen of the Parent_App SHALL show exactly two text elements: a title with the product name "Xelulu" and a message containing the phrase "Phase 0 placeholder". At least one element SHALL be styled with a NativeWind class, so that the NativeWind toolchain is exercised.
6. THE Placeholder_Screen of the Parent_App SHALL mark its title text with the `header` accessibility role and SHALL leave system font scaling enabled on every text element.
7. THE Placeholder_Screen of the Parent_App SHALL render every text element at a font size of at least 16 points, with a contrast ratio of at least 4.5:1 against its background. The ratio is computed from the declared text and background colours and SHALL hold in both the light and dark system appearance.
8. THE Parent_App SHALL declare only dependencies that are pinned to exact versions and that are either Expo SDK modules bundled in Expo_Go or pure JavaScript packages. `expo-dev-client`, Rive and Lottie SHALL be absent from its `package.json`.
9. THE Parent_App SHALL contain no MQTT or WebSocket client dependency and SHALL make no network request beyond those Expo_Go makes to the local development server.
10. THE Placeholder_Screen of the Parent_App SHALL contain no animated, blinking or flashing element, so no content can flash in the 3 to 30 Hz range.
11. WHEN the Build_Pipeline runs the Parent_App `build` script, THE Parent_App SHALL complete the TypeScript type-check (`tsc --noEmit`) with zero errors and exit with code 0.
12. IF a `.env` file exists neither at the Workspace root nor in `apps/parent-app`, THEN THE Parent_App SHALL still start and render the Placeholder_Screen, because the Parent_App reads no environment values in Phase 0.

### Requirement 5: Admin console placeholder

**User Story:** As the intern, I want an empty internal web console that runs locally, so that the hardware-connection and test surface has a home separate from the consumer app.

#### Acceptance Criteria

1. THE Admin_Console SHALL be a Workspace_Package at `apps/admin` that is written in TypeScript under the Base_TSConfig strict settings, uses Vite + React, and has a single `index.html` entry at the package root.
2. WHEN a developer runs the Admin_Console `dev` script on a machine where Workspace dependencies are installed, THE Admin_Console SHALL, within 30 seconds of the script starting, serve the Placeholder_Screen at a printed localhost URL that, when opened in a current desktop Chrome, Edge, Firefox or Safari, shows the product name "Xelulu" and the "Phase 0 placeholder" message and no other visible content.
3. WHILE the Admin_Console dev server is running, THE Admin_Console dev server SHALL accept connections only on the loopback interface (`127.0.0.1` or `localhost`), and a request to the same port on any non-loopback address of the host SHALL fail to connect.
4. THE Placeholder_Screen of the Admin_Console SHALL contain exactly one `h1` element whose text is the Placeholder_Screen title, inside a document whose root `html` element declares a non-empty `lang` attribute set to `en`.
5. THE Placeholder_Screen of the Admin_Console SHALL render every text element with a contrast ratio of at least 4.5:1 against its background, measured with the WCAG 2.x relative-luminance contrast formula.
6. THE Admin_Console Phase 0 source and built output SHALL read no environment variables, SHALL contain no value assigned to any Panel_Key, and the Placeholder_Screen SHALL display no environment values, secrets, connection values or device data.
7. THE Admin_Console `package.json` SHALL set `private` to `true` and SHALL contain the phrase "internal only" in its `description`, and THE Root_README SHALL describe the Admin_Console with the phrase "internal only" and state that it is never shipped to consumers.
8. THE Parent_App SHALL contain no import, `package.json` dependency, path reference or asset reference to `apps/admin` or to the Admin_Console package name.
9. WHEN the Build_Pipeline runs, THE Admin_Console `build` script SHALL run `vite build` and exit with code 0 with no TypeScript errors.
10. WHILE the Placeholder_Screen is open in a browser, THE Admin_Console SHALL make no network request other than loading its own page assets from the dev server origin.

### Requirement 6: Gateway skeleton

**User Story:** As the implementation engineer, I want an empty gateway service that starts cleanly, so that the bridge has a buildable, runnable home.

#### Acceptance Criteria

1. THE Gateway SHALL be a Workspace_Package at `services/gateway` written in Node.js + TypeScript, containing a `src/` folder and a `test/` folder, with a TypeScript config that extends the Base_TSConfig and keeps strict mode enabled.
2. THE Gateway SHALL define a `build` script that compiles the `src/` TypeScript with the TypeScript compiler into build output, and that the Build_Pipeline runs.
3. THE Gateway SHALL define a `start` script that runs the compiled build output with Node.js and runs unchanged on Windows, macOS and Linux.
4. WHEN the Gateway `start` script runs after a successful `pnpm build`, THE Gateway SHALL write exactly one Ok_Line to stdout, write zero bytes to stderr, and exit with code 0 within 5 seconds of the process starting.
5. WHEN the Gateway `start` script runs with no root `.env` file present and with no Panel_Key set in the environment, THE Gateway SHALL produce the same stdout output, the same empty stderr and the same exit code 0 as in criterion 4.
6. WHILE the Gateway runs in Phase 0, THE Gateway SHALL open zero outbound network connections, open zero listening ports, and read zero Panel_Key values from the environment or from any `.env` file.
7. THE Gateway SHALL import no code from any path under `apps/` or from the Simulator, and SHALL list no Workspace_Package other than the Shared_Package as a dependency.
8. IF the Gateway `start` script runs while the compiled build output is absent, THEN THE Gateway SHALL exit with a non-zero exit code and SHALL NOT write an Ok_Line to stdout.

### Requirement 7: Simulator skeleton

**User Story:** As the implementation engineer, I want an empty simulator service that starts cleanly, so that the fake robot has a buildable, runnable home.

#### Acceptance Criteria

1. THE Simulator SHALL be a Workspace_Package at `services/simulator`, written in TypeScript for Node.js, containing a `src/` folder with at least one TypeScript entry file, a `test/` folder, and a TypeScript config that extends the Base_TSConfig with strict mode enabled.
2. THE Simulator SHALL define a `build` script that compiles `src/` with TypeScript, and a `start` script that runs the compiled build output with Node.js without compiling any TypeScript at start time.
3. WHEN the Simulator `start` script runs after `pnpm build` has exited with code 0, THE Simulator process SHALL write exactly one Ok_Line to stdout, write no other output to stdout or stderr (not counting banner lines printed by pnpm itself), and exit with code 0 within 5 seconds of launch.
4. WHILE the Simulator runs in Phase 0, THE Simulator SHALL open zero network connections (no outbound connections and no listening sockets) and SHALL read no Panel_Key from the environment.
5. THE Simulator's source files, test files and `package.json` SHALL reference no module from `apps/*` or from `services/gateway`, and the Shared_Package SHALL be the only Workspace_Package the Simulator may declare as a dependency.
6. WHEN the Simulator `start` script runs after a successful `pnpm build` with no root `.env` file present and no Panel_Key set in the environment, THE Simulator SHALL produce the same outcome as criterion 3.
7. IF the Simulator `start` script runs while the compiled build output is absent, THEN THE Simulator SHALL exit with a non-zero code and SHALL write no Ok_Line to stdout.
8. WHEN the Simulator `build` and `start` scripts run on Windows, macOS or Linux, THE Simulator SHALL produce the outcome defined in criterion 3 on each platform, without needing a platform-specific script variant.

### Requirement 8: Shared package scaffold

**User Story:** As the implementation engineer, I want the shared package to exist with its contract and domain folders, so that later prompts have a single home for the types without anything being written early.

#### Acceptance Criteria

1. THE Shared_Package SHALL be a TypeScript package at `packages/shared` with a `src/index.ts` entry and a TypeScript config that extends the Base_TSConfig with strict mode enabled.
2. WHEN the Shared_Package `build` script is run, either directly or through the Build_Pipeline, on a fresh clone after dependency install, THE Shared_Package SHALL compile with `tsc`, exit with code 0 and report zero TypeScript errors.
3. IF the Shared_Package `build` script hits a TypeScript compile error, THEN THE Shared_Package SHALL exit with a non-zero code, and THE Build_Pipeline SHALL exit with a non-zero code.
4. THE Shared_Package SHALL contain the Gateway_Contract_Folder and the Domain_Folder as two separate directories under its `src/` folder.
5. WHILE Prompt 0.3 is on hold, THE Gateway_Contract_Folder SHALL contain exactly one placeholder marker file with no TypeScript, JavaScript or JSON content, and SHALL contain no TypeScript types, Zod schemas, constants, enums, topic strings or fixtures for Document B messages.
6. WHILE Phase 0 is in progress, THE Domain_Folder SHALL contain exactly one placeholder marker file with no TypeScript, JavaScript or JSON content, and SHALL contain no type, interface or schema for any domain entity.
7. WHILE Phase 0 is in progress, THE `src/index.ts` of the Shared_Package SHALL export zero symbols, so that importing the built entry exposes zero named exports and no default export.
8. THE Shared_Package SHALL contain no import, re-export or path alias that resolves to a file under `apps/*` or `services/*`, and SHALL list no other Workspace_Package in any dependency field of its `package.json`.
9. WHILE Phase 0 is in progress, THE Shared_Package SHALL declare zero runtime dependencies (including no Zod), and every development dependency it declares SHALL use an exact version with no `^`, `~`, `*`, `x` or range specifier.

### Requirement 9: Supabase scaffold

**User Story:** As the implementation engineer, I want the Supabase folder laid out for the CLI, so that Phase 1 can add migrations without restructuring.

#### Acceptance Criteria

1. THE Supabase_Scaffold SHALL contain a `config.toml` whose set of top-level TOML tables matches the set in a `config.toml` that `supabase init` generates with the Supabase CLI version recorded in the design phase. No table may be missing and none may be added.
2. THE `config.toml` SHALL set `project_id` to exactly the string `xelulu` (lowercase, with no surrounding whitespace).
3. THE `config.toml` SHALL parse without errors in a TOML 1.0 compliant parser, and any parse error SHALL count as a failure of this criterion.
4. THE `config.toml` SHALL contain no literal secret values. Every secret-bearing setting SHALL either be left out or reference an environment variable, and no Panel_Key SHALL be assigned a non-empty literal value.
5. THE Supabase_Scaffold SHALL contain a `migrations/` folder holding exactly one entry, a `.gitkeep` file, with no `.sql` files and no subfolders.
6. THE Supabase_Scaffold SHALL contain a `seed.sql` file holding exactly one SQL comment line (a line that starts with `--`) and nothing else apart from blank lines.
7. THE Supabase_Scaffold SHALL contain no SQL statements, including table definitions, RLS policies and SQL function definitions, in any file.
8. THE Supabase_Scaffold SHALL contain no Edge Function source files.
9. WHEN the Secret_Check runs over the git-tracked files under the Supabase_Scaffold, THE Secret_Check SHALL report zero non-empty Panel_Key assignments.

### Requirement 10: Local dev Compose stack

**User Story:** As the intern, I want `docker compose up` to start EMQX alongside the gateway and simulator, so that I have a local broker to point hardware at.

#### Acceptance Criteria

1. THE Compose_Stack SHALL define exactly three services in the root `docker-compose.yml`, named `emqx`, `gateway` and `simulator`, and no other services.
2. THE `emqx` service SHALL use the official EMQX image with an exact version tag of the form major.minor.patch (for example `5.x.y`), and SHALL NOT use the `latest` tag, a major-only tag or a major.minor-only tag.
3. THE `emqx` service SHALL publish exactly the host ports 1883 (MQTT), 8883 (MQTTS), 8083 (WS), 8084 (WSS) and 18083 (dashboard), each bound to host address `127.0.0.1` and to no other host address (including `0.0.0.0` and `::`).
4. THE `gateway` service SHALL build from the Dockerfile at `services/gateway/Dockerfile`, and THE `simulator` service SHALL build from the Dockerfile at `services/simulator/Dockerfile`.
5. THE Dockerfiles of the Gateway and the Simulator SHALL each use a Node.js base image whose tag begins with the same major version number as the leading integer of the version in `.nvmrc`.
6. WHILE a root `.env` file is present, THE Compose_Stack SHALL pass every variable defined in that file into the `gateway` and `simulator` containers as environment variables.
7. WHEN `docker compose up` runs at the Workspace root with no root `.env` file present, THE Compose_Stack SHALL start all three services without reporting an error about the missing `.env` file.
8. WHEN `docker compose up` runs at the Workspace root, THE `emqx` service SHALL reach the running state within 120 seconds and SHALL answer an HTTP request to `http://127.0.0.1:18083` from the host within the same 120 seconds.
9. WHEN `docker compose up` runs at the Workspace root, THE `gateway` container and THE `simulator` container SHALL each write exactly one Ok_Line to their logs and exit with code 0 within 60 seconds of starting.
10. WHEN the `gateway` or `simulator` container exits with code 0, THE Compose_Stack SHALL leave that container in the exited state with no restart for at least 30 seconds, and THE `emqx` service SHALL still be running at the end of those 30 seconds.
11. THE `docker-compose.yml` SHALL carry a comment stating that the EMQX default dashboard credentials are for local development only.
12. THE `docker-compose.yml` and the Gateway and Simulator Dockerfiles SHALL contain no non-empty literal value assigned to any Panel_Key and no literal EMQX dashboard username or password, so that the Secret_Check passes on these files.
13. THE `gateway` and `simulator` services SHALL publish no host ports.
14. IF the `gateway` or `simulator` container exits with a non-zero code during `docker compose up`, THEN THE Compose_Stack SHALL report that container's exit code in its output and SHALL leave the `emqx` service running.

### Requirement 11: Connection panel

**User Story:** As Omar, I want the root `.env.example` to match the approved connection panel exactly, so that every key and address has one documented, empty slot.

#### Acceptance Criteria

1. THE Connection_Panel SHALL exist at the Workspace root as a git-tracked file named `.env.example`, encoded as UTF-8 without a byte-order mark.
2. THE Connection_Panel SHALL be identical, character for character on every line, to the Approved_Panel in Appendix A. This covers section headers, comment lines, blank lines, Panel_Keys, side labels and line order. Only two differences are allowed: LF or CRLF line endings, and one trailing line ending at end of file being present or absent.
3. THE Connection_Panel SHALL declare each of the 21 Panel_Keys in the Approved_Panel exactly once, in Approved_Panel order.
4. THE Connection_Panel SHALL declare no key that is absent from the Approved_Panel.
5. THE Connection_Panel SHALL assign an empty value to every Panel_Key. The value is all text after `=` to the end of the line, with surrounding whitespace removed. The Connection_Panel has no inline comments, so any trailing text after `=` on a declaration line, including `#` text, counts as a non-empty value.
6. WHEN the Panel_Check runs, THE Panel_Check SHALL parse the Connection_Panel and pass only if the declared keys, as an ordered list, equal the 21 Panel_Keys in Approved_Panel order and every value is empty under the rule in criterion 5. Parsing rules: a blank line or a line whose first non-whitespace character is `#` is not a declaration; any other line of the form `NAME=` is a key declaration whose value is defined by criterion 5. The check compares against a reference copy of the Approved_Panel stored separately from the Connection_Panel.
7. IF the Connection_Panel is missing a Panel_Key, declares a key absent from the Approved_Panel, declares a key more than once, declares keys out of Approved_Panel order or assigns a non-empty value to a key, THEN THE Panel_Check SHALL fail and report the name of every offending key.
8. THE Panel_Check SHALL run with Vitest as part of the Workspace test suite, and a Panel_Check failure SHALL make the test suite exit with a non-zero exit code.
9. FOR ALL generated variants of the Connection_Panel that drop one Panel_Key line, duplicate one Panel_Key line, add one key line whose name is absent from the Approved_Panel, assign a non-empty value of 1 to 64 printable characters (none of them `#`) to one Panel_Key, or swap two Panel_Key lines, THE Panel_Check SHALL report failure and name the affected key or keys. This is a property-based test with fast-check, run for at least 100 generated cases per kind of variant.
10. IF any line of the Connection_Panel differs from the matching Approved_Panel line in a way not allowed by criterion 2, or the two files have different line counts, THEN THE Panel_Check SHALL fail and report the 1-based line number of the first line that differs.
11. IF no `.env.example` file exists at the Workspace root, THEN THE Panel_Check SHALL fail with an error indicating that the Connection_Panel is missing.
12. WHEN the Panel_Check runs against a Connection_Panel identical to the Approved_Panel, with either LF or CRLF line endings, THE Panel_Check SHALL pass.

### Requirement 12: Secret hygiene

**User Story:** As Omar, I want the repo to make committing secrets hard, so that no real key ever lands in git.

#### Acceptance Criteria

1. THE Workspace `.gitignore` SHALL ignore `.env` and every file whose name starts with `.env.`, at the Workspace root and in every subfolder (including `apps/parent-app/.env` and `apps/parent-app/.env.local`), with the root `.env.example` as the only exception, so that `git check-ignore` reports each of those files as ignored and reports the root `.env.example` as not ignored.
2. THE Workspace `.gitignore` SHALL ignore `node_modules` folders at any depth, the output folder written by each Workspace_Package's `build` script, and the Parent_App's `.expo/` local state folder, so that `git check-ignore` reports each of those paths as ignored.
3. WHEN the Secret_Check runs as part of the Workspace test suite with Vitest, THE Secret_Check SHALL scan every file listed by `git ls-files` for lines that assign a value to a Panel_Key in `KEY=value` or `KEY: value` form (allowing leading whitespace, an `export ` prefix or a `- ` list prefix), treat text from the first whitespace character followed by `#` to the end of the line as a comment that is not part of the value, and treat a value as empty only if it is empty, whitespace-only, `""`, `''`, or a single environment-variable reference of the form `${NAME}` or `env(NAME)`, and SHALL pass on the Phase 0 Workspace.
4. IF the Secret_Check finds one or more non-empty assignments to a Panel_Key in git-tracked files, THEN THE Secret_Check SHALL fail and report the file path, line number and key name of every finding (not only the first), and its output SHALL contain no part of any assigned value.
5. THE Parent_App source and config files (excluding `node_modules`) SHALL read environment variables only by names that start with `EXPO_PUBLIC_`; a Parent_App that reads no environment variables satisfies this criterion.
6. THE Workspace SHALL contain no hard-coded key, token, password or non-local connection URL in any git-tracked source file, Dockerfile or config file, where a connection URL is a URL the Parent_App, Admin_Console, Gateway or Simulator would connect to at runtime (Supabase, broker, audio socket or provider endpoints) and a local URL has host `localhost`, `127.0.0.1` or `::1`. Local-dev loopback addresses and port bindings in the Compose_Stack and Root_README, environment-variable references (`${NAME}`, `env(NAME)`), package registry URLs in the pnpm lockfile, JSON `$schema` references and documentation links inside comments are permitted.
7. FOR ALL generated git-tracked file contents that assign a non-empty literal value to one randomly chosen Panel_Key in any of the forms in criterion 3, THE Secret_Check SHALL report failure naming that key and SHALL not include the generated value in its output (property-based test with fast-check).
8. IF any Parent_App source or config file reads an environment variable whose name does not start with `EXPO_PUBLIC_`, THEN an automated test in the Workspace test suite SHALL fail and report the file path and the variable name.

### Requirement 13: Dependency direction

**User Story:** As the implementation engineer, I want package boundaries enforced from day one, so that the one-way dependency rule never erodes.

#### Acceptance Criteria

1. THE Workspace SHALL contain no Workspace_Package manifest that declares the Shared_Package in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies` with a version specifier that does not begin with `workspace:`.
2. THE Workspace SHALL contain no Workspace_Package manifest that declares the Parent_App, the Admin_Console, the Gateway or the Simulator in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`. This covers the Gateway and the Simulator declaring each other, and the Shared_Package declaring any other Workspace_Package.
3. IF a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` source file in one Workspace_Package contains a static `import`, an `export ... from`, a dynamic `import()` or a `require()` whose target is inside a different Workspace_Package's folder under `apps/*` or `services/*`, whether reached by relative path or by package name, THEN THE Lint_Tooling SHALL report an error that identifies the offending file and line, and `pnpm lint` SHALL exit with a non-zero code.
4. WHEN `pnpm lint` runs on the Phase 0 Workspace as delivered, THE Lint_Tooling SHALL report zero dependency-direction errors and exit with code 0.
5. WHEN a source file imports another file inside its own Workspace_Package, or imports the Shared_Package by its package name, THE Lint_Tooling SHALL report no dependency-direction error for that import.

### Requirement 14: Root README

**User Story:** As a new contributor, I want a short root README, so that I can install, build and run each piece without asking.

#### Acceptance Criteria

1. THE Root_README SHALL list these prerequisites: the Node.js version, naming `.nvmrc` as its source; pnpm, with the exact version from the Root_Manifest `packageManager` field and the Corepack command that enables it; Docker with the `docker compose` command; and Expo_Go on a phone, with the Expo SDK number used by the Parent_App.
2. THE Root_README SHALL give the commands for install, build, lint, format check and test as `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test`. Each one runs from the Workspace root, and each script name except `install` matches a script in the Root_Manifest.
3. THE Root_README SHALL give one start command each for the Parent_App, the Admin_Console, the Gateway, the Simulator and the Compose_Stack. Each command runs from the Workspace root and calls a script that exists in the Root_Manifest or the target Workspace_Package's `package.json`, or for the Compose_Stack is `docker compose up`.
4. THE Root_README SHALL tell contributors to copy `.env.example` to `.env`, with one copy command for PowerShell and one for POSIX shells. It SHALL also state that `.env` is ignored by git, must never be committed, and is optional for starting the Compose_Stack.
5. THE Root_README SHALL state that the Admin_Console is internal only, is never shipped to consumers, and has a dev server that listens on localhost only.
6. THE Root_README SHALL state that the EMQX default dashboard credentials are for local development only, and that the EMQX ports 1883, 8883, 8083, 8084 and 18083 are bound to `127.0.0.1` only.
7. THE Root_README SHALL state that the Gateway_Contract_Folder is empty on purpose until the Document B contract revision is approved.
8. THE Root_README SHALL state the expected result of each start command in criterion 3:
   - Parent_App: Expo_Go shows the Placeholder_Screen.
   - Admin_Console: a localhost URL shows the Placeholder_Screen.
   - Gateway and Simulator: each prints one Ok_Line and exits with code 0.
   - Compose_Stack: the EMQX, Gateway and Simulator containers start.
9. THE Root_README SHALL contain no non-empty assignment to any Panel_Key and no API key, token or service key value, so that the Secret_Check passes on the Root_README.
10. THE Root_README SHALL give only commands that run without changes on Windows, macOS and Linux. The one exception is the copy step in criterion 4, which has separate PowerShell and POSIX forms.

## Done when

Phase 0 is done when all six checks pass.

| # | Done when | Requirements |
|---|---|---|
| 1 | `pnpm install` and `pnpm build` pass with no errors. | 1.1–1.14, 2.1–2.10, 8.1–8.3 |
| 2 | The empty Expo app opens on the founder's phone in Expo Go using the current stable Expo SDK. | 4.1–4.12 |
| 3 | The empty admin console opens in a browser locally. | 5.1–5.10 |
| 4 | `gateway` and `simulator` each start and log "ok". | 6.1–6.8, 7.1–7.8 |
| 5 | `docker-compose up` starts EMQX. | 10.1–10.14 |
| 6 | `.env.example` exists with every box present and empty. | 11.1–11.12, 12.1–12.4 |

Requirements 3, 8, 9, 12, 13 and 14 support these checks: tooling, boundaries, scaffolding and docs. They are verified during review and by the automated checks (`pnpm lint`, `pnpm format:check`, Panel_Check, Secret_Check).

## Appendix A: Approved connection panel

The Connection_Panel must reproduce this content exactly. Every comment sits on its own line directly above its key (OP-1, resolved).

```
# ===================================================================
# XELULU CONNECTION PANEL. Never commit real values. Copy to .env.
# Side legend: [cloud]=gateway/edge fns  [app]=parent app  [device]=robot/simulator
# ===================================================================

# --- Supabase (Doc A §10) ---
# [cloud] Project URL
SUPABASE_URL=
# [cloud] Public anon key (RLS-limited)
SUPABASE_ANON_KEY=
# [cloud] BACKEND ONLY. Bypasses RLS. Never in app or device.
SUPABASE_SERVICE_KEY=

# --- Parent app (Expo only bundles EXPO_PUBLIC_*) [proposed] ---
# [app] Same value as SUPABASE_URL
EXPO_PUBLIC_SUPABASE_URL=
# [app] Same value as SUPABASE_ANON_KEY
EXPO_PUBLIC_SUPABASE_ANON_KEY=

# --- AI providers (Doc A §10) ---
# [cloud] Hosted LLM key
LLM_API_KEY=
# [cloud] Speech-to-text key (default Sarvam)
STT_API_KEY=
# [cloud] Text-to-speech key (Sarvam / ElevenLabs)
TTS_API_KEY=
# [cloud] [proposed] Adapter name
LLM_PROVIDER=
# [cloud] [proposed] Model id
LLM_MODEL=
# [cloud] [proposed] sarvam | faster-whisper
STT_PROVIDER=
# [cloud] [proposed] sarvam | elevenlabs | indic-parler
TTS_PROVIDER=

# --- Device seam (Doc B / Doc A §10) ---
# [cloud][device] EMQX URL incl. scheme+port, e.g. mqtts://host:8883
MQTT_BROKER_URL=
# [cloud][device] Broker username
MQTT_USERNAME=
# [cloud][device] Broker password
MQTT_PASSWORD=
# [cloud][device] Per-turn audio WebSocket (wss://...)
AUDIO_WSS_URL=
# [cloud] BACKEND ONLY. Signs/issues device_id + token at provisioning.
DEVICE_PROVISION_SECRET=

# --- Device identity (Doc B firmware side; simulator uses these too) ---
# [device] Cloud-issued, permanent, e.g. xlu_000123
DEVICE_ID=
# [device] Prototype auth token (production: cert/key in secure storage)
DEVICE_TOKEN=

# --- Environment / OTA [proposed] ---
# [cloud][app] local | staging | production
APP_ENV=
# [cloud] Base URL for signed OTA manifests
OTA_MANIFEST_BASE_URL=
```
