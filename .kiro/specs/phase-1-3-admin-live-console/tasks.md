# Implementation Plan: Phase 1.3 Admin Live Console

## Overview

Build order: shared stream types, the listen-host decision in both services, the Gateway's SSE route, Compose publishing, then the admin console (proxy, data layer, UI), docs, and a final verification and Done-when report. TypeScript strict throughout; kebab-case files; exact version pins; no URL literals except loopback ones built from parts; no git commits.

Toolchain for every command (PowerShell): `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...`. Never system Node 22 or a global pnpm.

## Tasks

- [x] 1. Shared stream types
  - [x] 1.1 Add `packages/shared/src/gateway-log/stream.ts`
    - `OPERATOR_STREAM_EVENTS`, `OperatorStreamEvent`, `DevicePresence`, `DeviceSummary`, `OperatorStreamDevices` exactly as in the design; export them from `gateway-log/index.ts` and `src/index.ts`
    - Leave every Log_Entry type and `GATEWAY_LOG_VERSION` unchanged
    - _Requirements: 2.2, 2.5_
  - [x] 1.2 Update `packages/shared/test/exports.test.ts`
    - Add `OPERATOR_STREAM_EVENTS` to `EXPECTED_RUNTIME_EXPORTS` (length 157 → 158) and the four types to the `import type` list
    - _Requirements: 9.3_

- [x] 2. Listen-host decision (C8)
  - [x] 2.1 Gateway: add `src/listen-host.ts` and wire it
    - `LISTEN_ALL_ARGUMENT`, `hasListenAllArgument`, `localSurfaceHost` as in the design
    - `GatewayDeps.listenAllInterfaces?: boolean`; `gateway.ts` passes `localSurfaceHost(config.localMode, ...)` to `listenOperator`; widen `OperatorListen`'s `host` type in `operator-routes.ts`; `index.ts` passes `hasListenAllArgument(process.argv.slice(2))`
    - Update the header comments that say "127.0.0.1 only"
    - _Requirements: 3.1_
  - [x] 2.2 Simulator: add the same `src/listen-host.ts` (copied) and wire it
    - Replace `CONTROL_HOST` in `simulator.ts`; `SimulatorDeps.listenAllInterfaces?: boolean`; widen `ControlListen`'s `host` type; `index.ts` passes the argument check
    - _Requirements: 3.2_
  - [x] 2.3 Write listen-host tests for both services
    - `services/gateway/test/listen-host.test.ts` and `services/simulator/test/listen-host.test.ts`: the four-case table, and the host each harness records with and without `listenAllInterfaces` (add the option to each harness)
    - **Property 4: Listen host decision** (example-based)
    - _Requirements: 3.1, 3.2, 10.3_

- [x] 3. Gateway Operator_Stream
  - [x] 3.1 Add `src/operator/device-summary.ts` and record status telemetry
    - `createStatusMemory`, `buildDeviceSummaries` as in the design
    - In `gateway.ts` `handleInbound`, call `status.record(...)` for a classified `status` just before `log.add(messageInEntry(d))`
    - _Requirements: 2.2, 2.3_
  - [x] 3.2 Add the pure hub `src/operator/operator-stream.ts`
    - `OPERATOR_STREAM_LIMITS`, `StreamSink`, `StreamOpen`, `createOperatorStreams`, `sseEvent`, `SSE_KEEP_ALIVE`
    - Open order: `devices`, then `log.subscribe` backlog and live `entry` events, `devices` after any entry that changes a summary (compared as JSON), keep-alive every 15 s via `clock.setTimer`, close on > 1 MiB pending, 4-stream cap, idempotent close, `closeAll`
    - No network import in this file
    - _Requirements: 1.2, 1.3, 1.4, 1.7, 1.8, 1.9, 1.10, 2.1_
  - [x] 3.3 Extend routes and guard types
    - `OPERATOR_STREAM_PATH`; `"/v1/stream": ["GET"]` in `OPERATOR_ROUTES`; `"too_many_streams"` in `OperatorErrorCode`; `checkStreamRequest` (any query key → 400 `invalid_fields` via `toSafeIssues`); `handleOperatorRequest` answers the stream path 404
    - Add the `openStream(request, sink)` option to `OperatorListen`
    - `checkRequest` itself stays unchanged
    - _Requirements: 1.5, 1.6_
  - [x] 3.4 Serve streams in `src/operator/transport/http-listener.ts`
    - After preflight and the capped body read, send `OPERATOR_STREAM_PATH` to `opts.openStream` with a sink over `res`: first write sends 200 and `OPERATOR_STREAM_HEADERS`; `pending()` is `res.writableLength`; the response's `close` event closes the stream; a refusal is sent like any other response
    - _Requirements: 1.1, 1.8, 1.9_
  - [x] 3.5 Wire the hub in `gateway.ts`
    - Create `streams = createOperatorStreams({ log, summaries, clock })`; `openStream` runs `fireDue()`, then `checkStreamRequest`, then `streams.open(sink)`; `stop()` calls `streams.closeAll()` before closing listeners
    - _Requirements: 1.1, 1.2, 1.9, 1.10_
  - [x] 3.6 Write `test/support/sse-reader.ts` and `test/operator-stream.test.ts`
    - Real loopback listener via the harness: headers; first `devices`; backlog then live `seq` order and stdout-line equality; status entry followed by a `devices` event with its battery, `auth` entry followed by none; 403 foreign `Origin`, 403 `Host` `gateway:<port>`, 405 POST, 400 query, 503 fifth stream, a closed client frees a slot; `stop()` ends open streams; the hub's overflow close with a fake sink; sentinel `DEVICE_TOKEN`, `MQTT_PASSWORD` and hello `auth` (≥ 8 chars) absent from the whole stream text
    - **Property 1: Stream order and fidelity**, **Property 2: Summaries follow device state**, **Property 3: No secret on the stream** (all example-based)
    - _Requirements: 10.1, 1.1–1.10, 2.1–2.4_
  - [x] 3.7 Write `test/stream-done-when.test.ts`
    - Fake device and Vitest fake timers, reading the stream: Online with `battery_pct` after hello + status; touch `belly` `event_accepted` with zone `belly`; `cry` `event_accepted`; `say` `message_out` then `ack_result` `done` for `say`; after 45 s of silence a `presence` `offline` (`silence`) entry and a `devices` event with `offline`
    - _Requirements: 10.2_

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Compose
  - [x] 5.1 Update `docker-compose.yml`
    - Gateway and simulator: `command: ["node", "dist/index.js", "--listen-all-interfaces"]` and exactly one `ports` entry each, `127.0.0.1:${GATEWAY_OPERATOR_PORT:-8090}:${GATEWAY_OPERATOR_PORT:-8090}` and `127.0.0.1:${SIMULATOR_PANEL_PORT:-8091}:${SIMULATOR_PANEL_PORT:-8091}`
    - Rewrite the comment that says they publish no ports; keep env_file, depends_on, restart; no `environment`
    - _Requirements: 3.3, 3.4, 3.6_
  - [x] 5.2 Update `tooling/test/compose-static.test.ts`
    - Replace "publishes no ports" for the two services with exact `ports` and `command` checks; keep the no-`environment`, no-`secrets` and credential-word assertions and every other test
    - _Requirements: 9.1_
  - [x] 5.3 Add the `stream` criterion to `tooling/compose/compose-acceptance.ts`
    - After `23.1`: `docker compose port` for both services prints `127.0.0.1:<port>`; `node:http` GET `127.0.0.1:P/v1/stream` with `Host: 127.0.0.1:P` gives 200 and a first `devices` event naming only `DEVICE_ID_VALUE`; GET `127.0.0.1:Q/` gives 200
    - PASSED line `PASSED 23.1–23.8 + stream`; update `tooling/test/compose-acceptance.test.ts` for the new criterion and line; Phase 1.2 steps unchanged
    - _Requirements: 10.5_

- [x] 6. Admin foundation
  - [x] 6.1 Dependencies and test wiring
    - `apps/admin/package.json`: dependency `@xelulu/shared` `workspace:*`; devDependencies `jsdom` `30.1.2`, `@testing-library/react` `16.3.3`, `@testing-library/dom` `10.4.2` (re-check each with `corepack pnpm view <pkg> version` and pin exactly); run `corepack pnpm install` to update the lockfile
    - Root `vitest.config.ts` include `apps/admin/test/**/*.test.{ts,tsx}`; `apps/admin/tsconfig.json` include `src`, `test`, `vite-proxy.ts`; `eslint.config.mjs` browser globals for `apps/admin/test/**`
    - _Requirements: 10.4, 8.1_
  - [x] 6.2 Add `apps/admin/vite-proxy.ts` and update `vite.config.ts`
    - `operatorProxy(rawPort)` with the `^/v1/stream(\?|$)` key, target built from parts, `changeOrigin`, `bypass` Origin rule, `proxyReq` Origin removal; null for a missing or invalid port
    - `vite.config.ts`: `defineConfig(({ command, mode }) => ...)`, one `loadEnv(mode, REPO_ROOT, "GATEWAY_OPERATOR_PORT")`, proxy for `serve` only, `server.cors: false`, one warning line naming the key when off; addresses and ports unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 6.3 Write `apps/admin/test/vite-proxy.test.ts`
    - Valid port → target and key; missing, empty, `0`, `65536`, `abc` → null; `bypass` refuses a foreign `Origin`, passes none and the console origin; `proxyReq` handler removes `origin`
    - _Requirements: 10.4, 4.2, 4.3, 4.4_
  - [x] 6.4 Update `tooling/test/env-reads.test.ts`
    - Keep `vite.config.ts` in the zero-findings scan and add `apps/admin/vite-proxy.ts`; new test: exactly one `loadEnv(` in `vite.config.ts` with the literal prefix `"GATEWAY_OPERATOR_PORT"` and only that key read from its result; no `loadEnv` under `apps/admin/src`
    - _Requirements: 9.2, 4.6, 4.7_

- [x] 7. Admin data layer
  - [x] 7.1 Add `src/stream/console-state.ts`
    - `StreamState`, `LIVE_LOG_CAP` 500, `ConsoleState`, `ConsoleAction`, `consoleReducer`, `newestFirst`, `filterByKind`, `tileCounts`
    - _Requirements: 5.1, 6.2, 6.3, 6.4, 6.6, 7.3_
  - [x] 7.2 Add `src/log/entry-label.ts`
    - `entryLabel` per the design table, Closed_Enum and ID fields only; no Panel_Key name in any string
    - _Requirements: 6.5, 8.3_
  - [x] 7.3 Add `src/stream/stream-client.ts`
    - `EventSourceLike`, `reconnectDelayMs`, `createStreamClient` with relative URL `/v1/stream`, own backoff (close on error), shape guards, `stop()`
    - _Requirements: 7.2, 7.4, 8.2_
  - [x] 7.4 Write `apps/admin/test/stream-client.test.ts`
    - `reconnectDelayMs` table; with fake timers and a fake EventSource: error → `reconnecting`, new source after 1 s, open → `live` with reset, malformed data ignored, `stop()` cancels the pending retry
    - **Property 7: Reconnect schedule** (example-based)
    - _Requirements: 10.4, 7.2, 7.4_

- [x] 8. Admin UI
  - [x] 8.1 Add `src/stream/use-console-stream.ts`, `src/routing/use-hash-page.ts`, `src/components/stream-status.tsx`
    - Hook wires client to reducer and stops it on cleanup; `#/` and `#/live` pages; `role="status"` text Connecting / Live / Reconnecting plus the out-of-date note
    - _Requirements: 7.1, 7.3, 7.4_
  - [x] 8.2 Add `src/components/device-health-table.tsx` and `src/pages/dashboard-page.tsx`
    - Three tiles and the Device Health table with presence and battery as text
    - _Requirements: 5.1, 5.2, 5.3, 8.4_
  - [x] 8.3 Add `src/components/live-log.tsx` and `src/pages/live-log-page.tsx`
    - Device table (ID, presence, battery, last heartbeat, counts); labelled filter over "All" + `GATEWAY_LOG_KINDS`; `<ol>` newest first with time, kind, device and label
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 8.4_
  - [x] 8.4 Replace the Phase 0 placeholder in `src/app.tsx` and extend `src/styles.css`
    - One `h1` ("Xelulu developer console"), `nav` with `aria-current`, header with stream status, page switch; optional `createSource` prop (default `new EventSource`); `main.tsx` unchanged or minimal
    - Keep `--xl-bg`, `--xl-title`, `--xl-body` and the dark block; add `:focus-visible` outlines; no animation, transition or keyframes
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6_
  - [x] 8.5 Write admin component tests
    - `test/support/fake-event-source.ts`, `test/support/entries.ts`; `test/dashboard-page.test.tsx` (tiles 1/1/0, health row text, update on a second `devices` event); `test/live-log.test.tsx` (newest first, 600 → 500 kept, filter to `ack_result`, touch row `touch belly (tap)`)
    - **Property 5: Live_Log window**, **Property 6: Filter** (example-based)
    - _Requirements: 10.4, 5.1–5.3, 6.2–6.5_

- [x] 9. Docs
  - [x] 9.1 Update the root README and `tooling/test/readme.test.ts`
    - New section per Requirement 9.5; `pnpm dev:admin` row names `http://127.0.0.1:5173` and "live console"; update the Phase 1.2 local-surfaces text that says they bind 127.0.0.1 inside their containers
    - `readme.test.ts`: the dev:admin row check requires a loopback URL and "live console"; every other check unchanged
    - _Requirements: 9.4, 9.5_

- [x] 10. Final verification and report
  - [x] 10.1 Run the full verification
    - `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm test`; fix any failure before continuing
    - If Docker is available: `docker compose build gateway simulator`, then `node tooling/compose/compose-acceptance.ts` (it writes and deletes its own `.env`; never leave a `.env` behind); otherwise state that it was not run and why
    - Confirm `.env.example`, `tooling/fixtures/approved-panel.txt`, `apps/parent-app` and the Phase 1.2 spec documents are unchanged
    - _Requirements: 10.5, 10.6, 9.6, 9.7, 8.6_
  - [x] 10.2 Write the Done-when report
    - For each of the five Done-when checks, name the automated test that covers it (3.6, 3.7, 5.3) and its result; list the manual browser checklist from the design as not run by the agent unless it was run; list each FLAG (C6, C8, C9, C13) and each superseded Phase 1.2 item; state anything not verified
    - _Requirements: 10.1–10.6_

## Notes

- Test sub-tasks are not marked optional: Omar's Done-when requires these smoke and key-interaction tests to pass. All are example-based (C15); no new fast-check runs.
- Each task references requirement clauses for traceability; properties map to the design's Correctness Properties.
- The Gateway's new network code lives only in `services/gateway/src/operator/transport/`, so the network-module check stays unchanged.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "2.3", "3.1", "3.2", "5.2", "6.2", "7.2"] },
    { "id": 2, "tasks": ["3.3", "6.3", "6.4", "7.1"] },
    { "id": 3, "tasks": ["3.4", "5.3", "7.3"] },
    { "id": 4, "tasks": ["3.5", "7.4", "8.1"] },
    { "id": 5, "tasks": ["3.6", "8.2", "8.3"] },
    { "id": 6, "tasks": ["3.7", "8.4"] },
    { "id": 7, "tasks": ["8.5", "9.1"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2"] }
  ]
}
```
