# Xelulu

Monorepo for Xelulu, a screen-free AI companion robot for children. This is the Phase 0 skeleton: every package builds, starts and passes its checks, but there is no product behaviour yet.

## Prerequisites

- Node.js 24.21.0, from `.nvmrc`. Run `nvm use` or `fnm use` in the repo root. pnpm refuses to install on any other Node version. A portable Node in a git-ignored `.tools/` folder also works if you put it first on your `PATH`.
- pnpm 10.34.6 (the `packageManager` field). Run `corepack enable`, or `npm install -g pnpm@10.34.6`.
- Docker with `docker compose` 2.24 or later.
- Expo Go on the founder's phone (iOS or Android) for Expo SDK 57. On iOS, Expo Go for SDK 57 needs `npx expo login` with the same account you use in Expo Go. The parent app still runs in Expo Go through Phase 2: the design system, the navigation shell and all sixteen screens need nothing native. The Expo dev build arrives with Rive later in Phase 2.

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

`.env` is ignored by git and must never be committed. It is optional: `docker compose up` needs no `.env` at all, because `docker-compose.yml` carries local defaults for every value the gateway and simulator need. Copy `.env.local.example` instead of `.env.example` to get those same local values in your shell for `pnpm start:gateway`, `pnpm start:simulator` and `pnpm dev:admin`:

```powershell
Copy-Item .env.local.example .env
```

```sh
cp .env.local.example .env
```

`.env.local.example` is tracked by git and holds dev placeholders only. `.env.example` stays the one connection panel; never put a real value in either tracked file.

One caveat if you copy it: `MQTT_BROKER_URL` and `AUDIO_WSS_URL` name the Compose service hosts `emqx` and `gateway`, which resolve on the Compose network only. They are right for `docker compose` and for `pnpm dev:admin` (which reads only `GATEWAY_OPERATOR_PORT`), but if you run `pnpm start:gateway` or `pnpm start:simulator` on the host, outside Compose, change both hosts to `127.0.0.1` first.

On Windows, run the console and both CLIs with the repo's portable Node 24 first on `PATH`, not system Node 22:

```powershell
$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path
```

## Commands

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `pnpm build`        | Builds every workspace package.                   |
| `pnpm lint`         | Runs ESLint, including the package-boundary rule. |
| `pnpm format:check` | Checks formatting with Prettier.                  |
| `pnpm test`         | Builds, type-checks the tests and runs Vitest.    |

## Run each piece

| Command                  | Expected result                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm start:app`         | Scan the QR code with Expo Go. The phone shows the Home dashboard. Run `pnpm build` first.                               |
| `pnpm dev:admin`         | `http://127.0.0.1:5173` shows the live console (see "Watch the simulator in the admin console").                         |
| `pnpm dev:admin:content` | The same console with the Content page's writes proxied (see "Content, stories, Grandma and routines locally").          |
| `pnpm start:gateway`     | Starts the service; it keeps running until stopped (needs a configured `.env`, loaded into the shell environment).       |
| `pnpm start:simulator`   | Starts the service; it keeps running until stopped (needs a configured `.env`, loaded into the shell environment).       |
| `docker compose up`      | The EMQX, gateway and simulator containers start and go healthy, with no `.env` needed; they keep running until stopped. |

Without a valid configuration the gateway and simulator write one config error line naming the offending keys (never their values) and exit with a non-zero code.

Deep links into the parent app: `pnpm start:app` prints an `exp://` URL next to its QR code. The app opens on the splash and then the Home dashboard; to open another screen directly, append `/--/<route>` to that printed URL, for example `/--/privacy` or `/--/pair-device`, and open the result in Expo Go. `/--/reports` and `/--/grandma-mode` are the two newest routes.

## Gateway and simulator locally

The gateway and simulator speak Document B v2 over the local EMQX. `docker compose up --build` needs **no** root `.env`: `docker-compose.yml` gives each service its own `environment:` block with the Local_Mode defaults below. Every value is written `${VAR:-default}`, and `environment:` overrides `env_file:`, so a root `.env` still wins — Compose reads that file both for interpolation and as the env_file, and `:-` also replaces an empty value, so even a `.env` copied straight from `.env.example` falls back to these defaults.

The defaults, which are also what `.env.local.example` holds:

- `APP_ENV` is `local`. Only Local_Mode accepts the plain `mqtt` and `ws` schemes and empty broker credentials.
- `MQTT_BROKER_URL` is the `mqtt` scheme, the `emqx` service host and port 1883.
- `MQTT_USERNAME` and `MQTT_PASSWORD` are empty. EMQX 5.8.9 with no authenticator configured accepts anonymous connections, and Local_Mode maps an empty broker credential to null.
- `AUDIO_WSS_URL` is the `ws` scheme, the `gateway` service host and port 8081. The audio listen port is that URL's port, and a non-loopback host makes the gateway bind all interfaces inside its container, so the simulator can dial it. It is not published to the host.
- `DEVICE_ID` is `xlu_000123` and `DEVICE_TOKEN` is an obvious dev placeholder. Set your own for anything that is not this loopback-only stack.
- `GATEWAY_OPERATOR_PORT` is 8090 and `SIMULATOR_PANEL_PORT` is 8091, the two local control surfaces.

The gateway uses `DEVICE_ID` and `DEVICE_TOKEN` as a one-device prototype registry: the only registered device is `DEVICE_ID`, and its token is `DEVICE_TOKEN`. The simulator connects as that device. A later spec moves the registry to Supabase.

Both services carry a healthcheck that runs their own CLI against their own surface, so `docker compose ps` shows `Up (healthy)` once each is really answering, and the simulator starts only after the gateway is healthy.

Every `docker compose` command prints one `"MQTT_USERNAME" variable is not set. Defaulting to a blank string.` warning, and the same for `MQTT_PASSWORD`. That is expected and correct: those two are the only keys written as a bare `${VAR}` with no default, because empty is the right Local_Mode value and Compose must never hand a broker credential to a service. Set them in a root `.env` to silence the warning.

Then start the stack with `docker compose up` and drive it from a second terminal:

```sh
docker compose exec gateway node dist/cli.js devices
docker compose exec gateway node dist/cli.js log --after 0
docker compose exec gateway node dist/cli.js send xlu_000123 animate '{"expression":"happy","eyes":"open","loop":false}'
docker compose exec simulator node dist/cli.js state
docker compose exec simulator node dist/cli.js event touch '{"zone":"belly","gesture":"tap"}'
docker compose exec simulator node dist/cli.js audio-turn
docker compose exec simulator node dist/cli.js offline
docker compose exec simulator node dist/cli.js online
```

Each CLI prints one JSON line. Other simulator commands: `duplicate-replay on|off`, `ack-policy set|clear …` and `battery <pct> <true|false>`.

- The gateway Operator_Surface listens at `GATEWAY_OPERATOR_PORT`, and only in Local_Mode.
- The simulator Control_Surface (its web panel and API) listens at `SIMULATOR_PANEL_PORT`.
- In Compose, each service runs with `--listen-all-interfaces`, so in Local_Mode its surface binds `0.0.0.0` inside its container. Compose publishes each surface on host `127.0.0.1` only, at the same port. Without that argument (for example `pnpm start:simulator`), or outside Local_Mode, a surface binds `127.0.0.1`.
- Both surfaces are unauthenticated. They are reachable from the host on loopback only, and the CLIs still work through `docker compose exec`.
- MQTT.js uses the `debug` package, which writes to stderr when a `DEBUG` env var is set. `DEBUG` is not a Panel_Key and Compose never sets it; leave it unset in your shell when running `pnpm start:gateway` or `pnpm start:simulator`.

## Local run: from a clean checkout to watching a turn

Copy-paste, from the repo root, with no root `.env` anywhere. On Windows put the portable Node 24 first on `PATH` in **every** terminal that runs `pnpm` (system Node 22 and a global pnpm both fail here); Docker does not care which Node the shell has.

Terminal 1 — the stack:

```powershell
docker compose up --build -d
docker compose ps
```

Both `xelulu-gateway-1` and `xelulu-simulator-1` reach `Up (healthy)`, as does `xelulu-emqx-1`. Give it up to a minute: the healthcheck interval is 10 s.

Terminal 2 — the console:

```powershell
$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path
corepack pnpm install
corepack pnpm build
corepack pnpm dev:admin
```

`pnpm dev:admin` prints one info line saying `GATEWAY_OPERATOR_PORT` is unset and that it is using the local Compose default 8090, then serves the console.

Then, in the browser:

1. Open `http://127.0.0.1:5173`. The status line reads "Stream: Live". Use `127.0.0.1`, not `localhost`: `localhost` can resolve to `::1`, which the loopback-only publish does not serve.
2. The Dashboard shows Devices 1, Online 1, Offline 0, and the health row for `xlu_000123` reads "Online" with a battery %.
3. Open the simulator panel at `http://127.0.0.1:8091`. Beside "Start audio turn", pick `story` from the **Utterance** list and start the turn.
4. Open the Conversation page at `http://127.0.0.1:5173/#/conversation`. Within a couple of seconds the turn appears with the safety decision per stage, the tools called, the reply out and the latency in ms.

With no active child the gateway applies its most restrictive context, so a story request is refused at the input stage and you see the safe redirect instead of a story. To watch the allow path, set an active child first and wait for the next 15 s heartbeat to carry it:

```sh
docker compose exec gateway node dist/cli.js send xlu_000123 config '{"active_child_id":"child_mock_1"}'
```

Stop everything with `docker compose down` and Ctrl-C in terminal 2.

## Watch the simulator in the admin console

The admin console reads the gateway's live stream (`/v1/stream`) through its dev server's proxy, which reads only `GATEWAY_OPERATOR_PORT`, from the root `.env` if there is one and otherwise from the local Compose default. Use `127.0.0.1` in the browser, not `localhost`: `localhost` can resolve to `::1`, which the loopback-only publish does not serve.

1. Run `docker compose up --build`. No `.env` is needed; to use other ports, set `GATEWAY_OPERATOR_PORT` and `SIMULATOR_PANEL_PORT` in a root `.env`.
2. In a second terminal, run `pnpm build`, then `pnpm dev:admin`. Open `http://127.0.0.1:5173`. The status line reads "Stream: Live".
3. The Dashboard shows Devices 1, Online 1, Offline 0, and the device's health row shows "Online" with a battery %.
4. Open the simulator panel at `http://127.0.0.1:8091` (or your own `SIMULATOR_PANEL_PORT`) and fire a touch on `belly`. Within about 1 s the live log shows `touch belly (...)` at the top.
5. Fire `cry`: a `cry` row appears. Start an audio turn: `sent say ...` and `ack done for say ...` rows appear.
6. Toggle the simulator offline. Within about 45 s the device shows "Offline" and an `offline (silence)` row appears.
7. Search the live log and the browser's network view of `/v1/stream` for your `DEVICE_TOKEN` value: it does not appear.

If `GATEWAY_OPERATOR_PORT` is set to something that is not a port, `pnpm dev:admin` prints one warning line and the console stays on "Reconnecting". Unset or empty is not an error: the proxy then uses the same 8090 the Compose stack defaults to.

Security: the console is internal only. `pnpm dev:admin` is read-only — it proxies the stream and the four content reads and nothing else — and writes exist only in content-admin mode (see "Content, stories, Grandma and routines locally"). The gateway stream, the simulator panel and the admin dev server stay unauthenticated. Both surfaces are published on host loopback only, guarded by their unchanged Host and Origin checks, and the stream carries only IDs, enums, counts and times — with one exception: when the gateway runs with `--operator-transcripts`, its `turn` events also carry that turn's transcript and reply text (see the next section). No log entry carries either, under any argument.

## Run a conversation turn locally

A turn runs through the gateway's voice brain: speech to text, the safety layer on the way in, a mocked language model behind the tool router, the safety layer on the way out, then speech streamed back as a `say`. The admin console's Conversation page shows what happened.

1. Bring the stack up as above (`docker compose up --build`), then run `pnpm dev:admin` and open the console at `http://127.0.0.1:5173`.
2. Open the simulator panel at `http://127.0.0.1:8091`. Beside "Start audio turn" there is an **Utterance** list of named test utterances (`story`, `where-did-grandpa-go`, `sad`, `hindi-hello` and more). Pick one and start the turn; leave the list on "synthetic frames" for the plain upload with no words in it.
3. Open the Conversation page at `#/conversation`. Within a couple of seconds the turn appears, newest first: the safety decision and rule for each stage, the tools called with their outcomes, the latency in milliseconds, whether the "let me think" filler was spoken, the frames sent, and the turn's state.

Transcript and reply text is off by default. The gateway shows it only when it is started with `--operator-transcripts`, which it accepts in Local_Mode on loopback only; local Compose passes that argument to the gateway service, so a `docker compose up` stack has it on. Without it the page still shows every decision, tool and timing, plus the text lengths and a note that text is off.

Transcripts live in the gateway's memory only. They are never written to a log line, a file or a database, they are capped per device, and they are gone when the gateway restarts.

## Content, stories, Grandma and routines locally

The gateway holds a curated starter library — original retellings from the Panchatantra, Jataka, Tenali Raman and Akbar-Birbal traditions, plus songs and learning activities — the six routine templates, the word of the day, the Grandma records and the activity a report is counted from. The console's **Content** page lists and edits all of it.

Writes are off by default and are Local_Mode only. The gateway accepts them only when it is started with `--content-admin`, which it ignores outside Local_Mode; local Compose passes that argument to the gateway service, so a `docker compose up` stack has it on. The console's dev server proxies the write routes only in content-admin mode:

```sh
pnpm dev:admin          # the stream and the four content reads; no write is proxied
pnpm dev:admin:content  # the same, plus the eight write routes
```

1. Bring the stack up (`docker compose up --build`), then run `pnpm build` and `pnpm dev:admin:content`.
2. Open `http://127.0.0.1:5173/#/content`. The five sections — Stories, Games, Songs, Learning and Grandma — list what the gateway holds, each item with its status and its gate verdict.
3. Add or edit an item. Every write lands as a **draft**: an item becomes Active only when the output safety guard passes its title, every step text and every choice prompt at each age stage and language it declares. A refused activation shows the rule, the age stage and the language as text, and the item stays a draft.
4. In the Grandma section, record a consent record first, then add a recording against it and schedule it. A recording cannot exist without a live consent record. **That control records the _shape_ of a consent record for development. It is not verifiable parental consent under the DPDP Act, which arrives in Phase 5.** No Grandma audio exists anywhere in this phase: a recording is metadata, a consent id and an opaque handle nothing dereferences, and text-to-speech stands in for playback.
5. Run a routine with the Run control. Every command it sends goes through the same device policy gate a turn's commands do, so quiet hours, the play limit and the movement toggle are checked before anything is published, and an ack reason is final. During quiet hours the answer is a refusal with nothing sent, which is the gate working rather than a failure.

The same twelve routes are reachable from the CLI with no browser: `docker compose exec gateway node dist/cli.js content`, `grandma`, `routines`, `reports`, and the write operations `content-create`, `content-update`, `content-status`, `grandma-consent`, `grandma-recording`, `grandma-schedule`, `grandma-call` and `routine-run`.

Known limits of this phase, all of them in-memory:

- Content, consent records, Grandma records, routine state and activity live in the gateway's memory. They are gone when it restarts; the starter library is re-seeded, nothing else is. Supabase arrives in Phase 5.
- A report counts only the activity records still held under the store's capacity, so an older one has been dropped rather than summarised.
- A draft submitted over a route is bounded by the operator surface's unchanged 8 KiB body cap, so the console's editor takes few, short steps.
- Content titles are `en-IN` only until Phase 5: a title is one string, not a localised map, and it shows unchanged in either app language.
- The word of the day is one entry per language, so the day's index is shared across children and the entry is shared per language.
- `pnpm build` must run before `pnpm start:app`. The parent app's Play, Grow, Reports and Routines screens read the shared starter library and the report arithmetic at runtime, and resolve `@xelulu/shared` through its built output; `pnpm start:app` does not build.

## Notes

- The admin console (`apps/admin`) is internal only. It is never shipped to consumers, and its dev server listens on localhost only.
- The EMQX default dashboard credentials are for local development only. See the [EMQX docs](https://docs.emqx.com/) for them. EMQX ports 1883, 8883, 8083, 8084 and 18083 are bound to `127.0.0.1` only. If one is busy, Compose fails with a bind error.
- `packages/shared/src/gateway-contract/` holds the Document B v2 contract (`proto_ver` 2): types, Zod schemas, codecs and golden fixtures copied from `docs/B-gateway-and-hardware-seam.docx`.
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
