---
inclusion: always
---
# Xelulu: Repo structure

```
xelulu/
├─ .kiro/
│  ├─ steering/          product.md, tech.md, structure.md, safety.md
│  └─ specs/             one folder per spec, one active at a time
├─ apps/
│  ├─ parent-app/        Expo (TS) app, Expo Router
│  │  ├─ app/            routes: (onboarding), (tabs)/home|play|grow|routines|family, device, privacy
│  │  ├─ src/components/ UI kit (NativeWind)
│  │  ├─ src/character/  Rive/Lottie wrappers and expression mapping
│  │  ├─ src/features/   setup, controls, grandma, reports, talk, content, privacy, support
│  │  ├─ src/lib/        supabase client, env access, i18n
│  │  └─ assets/         fonts, .riv, .json (licence noted per file)
│  └─ admin/             Vite + React (TS) web console: intern's hardware-connection
│     │                  and per-feature test surface (internal only)
│     ├─ src/            connection panel, raw device logs, feature test matrix
│     └─ index.html
├─ services/
│  ├─ gateway/           Node TS: MQTT + WSS bridge, brain, safety
│  │  ├─ src/mqtt/       broker client, topic routing, ack tracking
│  │  ├─ src/audio/      per-turn WSS, Opus framing
│  │  ├─ src/brain/      providers (stt/llm/tts), persona, memory, why-chains
│  │  ├─ src/safety/     guardrails, deferral, age policies, output filters
│  │  ├─ src/devices/    registry, provisioning, presence (45 s offline rule)
│  │  └─ test/
│  └─ simulator/         Node TS fake robot + local web control panel
│     ├─ src/            hello, heartbeat, events, cmd/ack, fake audio turn, offline queue
│     ├─ panel/          control panel UI (zone buttons, cry, say-this, offline toggle)
│     └─ test/
├─ supabase/
│  ├─ migrations/        SQL, RLS on every table
│  ├─ functions/         Edge Functions (Deno TS)
│  ├─ seed.sql
│  └─ config.toml
├─ packages/
│  └─ shared/
│     ├─ src/gateway-contract/  Document B types + Zod schemas + fixtures (frozen)
│     ├─ src/domain/            Household, User, ChildProfile, Device, Session, Event,
│     │                         ContentItem, GrandmaAsset, Consent, Report
│     ├─ src/gateway-log/       Gateway_Log types, constants and Safe_Issue helper (not the contract)
│     ├─ src/mock-audio/        Mock_Audio_Codec for test utterances (not the contract, deleted with the mocks)
│     ├─ src/starter-content/   curated starter library: original retellings, songs, learning, words, routines
│     └─ src/index.ts
├─ docs/                 source documents (see docs/README.md)
├─ tooling/              repo-wide checks, local ESLint rule, fixtures (infrastructure, not a package)
├─ .github/workflows/    CI workflow (infrastructure, not a package)
├─ .env.example          the single connection panel
├─ docker-compose.yml    EMQX + gateway + simulator for local dev
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc
└─ README.md
```

## Rules
- **The contract has a single home.** Document B types exist only in `packages/shared/src/gateway-contract`. Changing them requires a `proto_ver` bump and sign-off.
- **Dependencies point one way.** The apps, gateway and simulator may import `packages/shared`. Nothing imports from `apps/` or `services/`, and services never import each other.
- **Repo infrastructure is not a package.** `tooling/` (repo-wide checks, the local ESLint rule, fixtures) and the CI workflow (`.github/workflows/`) live at the repo root and are infrastructure, not workspace packages.
- **The parent app never talks MQTT.** The parent app only talks to Supabase (HTTPS and Realtime). Device commands go app → Supabase → gateway → MQTT.
- **The admin console is internal only.** `apps/admin` is a web tool for the intern and the team, separate from the parent app because it exposes connection secrets, raw device logs and the per-feature test matrix. None of that may ever appear in `apps/parent-app`, and the admin console is never shipped to consumers.
- **The simulator is a peer of the robot.** It uses only the Document B wire format, with no shortcuts into gateway internals.
- **Naming.**
  - Files use kebab-case. Types use PascalCase. Wire fields use snake_case, exactly as in Document B.
  - DB tables use snake_case plurals.
- **Domain model notes.**
  - `ChildProfile.age_stage` is `tiny|little|explorer|maker`.
  - `GrandmaAsset` requires a `consent_record_id`.
  - Household-scoped rows carry `household_id` and are protected by RLS by household and role.
  - Global curated content rows have `household_id` null, are a read-only reference for every household, and are written only by admins (service role or the admin console).
- **Tests sit next to their package** in `test/`. Contract fixtures live in `packages/shared/src/gateway-contract/fixtures`.