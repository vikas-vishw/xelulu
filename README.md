# Xelulu

Monorepo for Xelulu, a screen-free AI companion robot for children. This is the Phase 0 skeleton: every package builds, starts and passes its checks, but there is no product behaviour yet.

## Prerequisites

- Node.js 24.21.0, from `.nvmrc`. Run `nvm use` or `fnm use` in the repo root. pnpm refuses to install on any other Node version. A portable Node in a git-ignored `.tools/` folder also works if you put it first on your `PATH`.
- pnpm 10.34.6 (the `packageManager` field). Run `corepack enable`, or `npm install -g pnpm@10.34.6`.
- Docker with `docker compose` 2.24 or later.
- Expo Go on the founder's phone (iOS or Android) for Expo SDK 57. On iOS, Expo Go for SDK 57 needs `npx expo login` with the same account you use in Expo Go. Expo Go is a Phase 0 convenience only. Phase 2 moves the parent app to an Expo dev build for Rive.

## Setup

Run everything from the repo root.

```sh
pnpm install
```

Copy the connection panel to a local `.env`:

```powershell
Copy-Item .env.example .env
```

```sh
cp .env.example .env
```

`.env` is ignored by git and must never be committed. It is optional for starting the Compose stack.

## Commands

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `pnpm build`        | Builds every workspace package.                   |
| `pnpm lint`         | Runs ESLint, including the package-boundary rule. |
| `pnpm format:check` | Checks formatting with Prettier.                  |
| `pnpm test`         | Builds, type-checks the tests and runs Vitest.    |

## Run each piece

| Command                | Expected result                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm start:app`       | Scan the QR code with Expo Go. The phone shows the Phase 0 placeholder.                      |
| `pnpm dev:admin`       | `http://127.0.0.1:5173` shows the Phase 0 placeholder.                                       |
| `pnpm start:gateway`   | Prints `ok` and exits with code 0.                                                           |
| `pnpm start:simulator` | Prints `ok` and exits with code 0.                                                           |
| `docker compose up`    | The EMQX, gateway and simulator containers start. Gateway and simulator print `ok` and exit. |

## Notes

- The admin console (`apps/admin`) is internal only. It is never shipped to consumers, and its dev server listens on localhost only.
- The EMQX default dashboard credentials are for local development only. See the [EMQX docs](https://docs.emqx.com/) for them. EMQX ports 1883, 8883, 8083, 8084 and 18083 are bound to `127.0.0.1` only. If one is busy, Compose fails with a bind error.
- `packages/shared/src/gateway-contract/` is empty on purpose until the Document B contract revision is approved.
- Licences and tool versions: EMQX 5.8.9 is Apache-2.0 (EMQX 5.9 and later is BSL 1.1). `supabase/` was generated with Supabase CLI 2.120.0 (`supabase init`).

## Repo layout

```text
apps/parent-app      Expo parent app (Expo Router, NativeWind)
apps/admin           Vite + React admin console (internal only)
services/gateway     Node gateway
services/simulator   Node robot simulator
packages/shared      Shared types (gateway contract arrives later)
supabase/            Supabase CLI project
tooling/             Repo-wide checks and the local ESLint rule
```

See [`.kiro/steering/structure.md`](.kiro/steering/structure.md) for the full layout and rules.
