# Implementation Plan: Phase 1.2 gateway and simulator

## Overview

Turn the Phase 0 stubs `services/gateway` and `services/simulator` into running services that speak Document B v2 (`proto_ver` 2) over EMQX, in TypeScript (strict), using MQTT.js 5.16.0, `ws` 8.22.0 and the existing Vitest 5.0.3 + fast-check 4.10.2 setup. Work goes bottom-up: dependencies, the shared `gateway-log` module and its tests, per-service foundations, gateway pure cores, gateway transports and composition, gateway tests, simulator pure cores, transports, panel and composition, simulator tests, then the Phase 0/1 repo-check updates, the new repo checks, Dockerfiles and Compose, the Compose_Acceptance_Check, CI, and the final verification and Done-when report.

## Ground rules

- No git commits, branches or pushes. Report every task's results (commands run, exit codes, notable output) in the task result.
- Toolchain prefix for every command on this machine (PowerShell):
  `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...`. Never use the system Node 22 or a global pnpm.
- Exact version pins only: `mqtt` 5.16.0, `ws` 8.22.0, `@types/ws` 8.18.2 (design D1). Verify each with `corepack pnpm view <pkg> version` before adding it; if any differs, stop and report instead of changing the pin.
- C:\ disk is tight (about 4 GB free). Install only those three packages. No extra packages, global tools, browsers or caches.
- File names are kebab-case. Wire fields are snake_case exactly as in Document B.
- Import every contract type, schema-backed codec, enum constant, topic helper and parser from `@xelulu/shared`. Never redefine a wire shape, restate a wire value list or import `zod` in a service (Req 2). The contract in `packages/shared/src/gateway-contract/` is frozen: do not edit it.
- Env vars are read only in `services/gateway/src/env.ts` and `services/simulator/src/env.ts`, by static names from G3. Every other module receives the frozen Config.
- No non-local URL literals and no `KEY=value` (or `KEY: value`) Panel_Key lines in tracked sources or tests: build env records from `[key, value]` tuples and URLs as `scheme + "://" + host`.
- No file writes anywhere under `services/*/src` (Req 21.1). Only `log/logger.ts`, `config-error-writer.ts` and `cli.ts` may use `console` or `process.stdout/stderr.write`. Logs carry IDs, Closed_Enum values, booleans and counts only.
- Do not edit `requirements.md`, `design.md`, `.config.kiro`, earlier spec documents or anything in `docs/`.
- Docker may not be available on this Windows machine. The Compose_Acceptance_Check is written and its pure helpers unit-tested locally; its real run happens in the CI `compose` job. `corepack pnpm test` must never need Docker or any network beyond loopback.
- Intern intervention starts only at Phase 6. No task waits on or asks the intern. Hardware-facing choices (G8 Bearer header, G11 `/cmd`-only, G18 downstream framing, R10 `ts` on hello and ack, ruling 2 and 3 shapes and ranges, OP7, OP8) are final for Phases 1.2–5 and confirmed at Phase 6 (G52).
- Tests: property tests are one `it` with one `fc.assert`/`fc.asyncProperty`, `numRuns` at least 100, tagged `// Feature: phase-1-2-gateway-simulator, Property N: <title>`. No `it.skip`, `it.todo` or `.only`. Service tests import `../src/*.js` (D12); start, CLI and crash tests spawn the built `dist/` files. Sockets bind `127.0.0.1` port 0 only. Fake timers use `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })`.
- Expected interim failures: Phase 0/1 checks that this phase supersedes fail until the task that updates them runs: the gateway and simulator start tests (from tasks 16.2 and 28.2 until 32.3 and 32.4), `tooling/test/env-reads.test.ts` (from 5.3 until 32.1), the placeholder network-module check (from 15.1 until 32.2), the panel key count (until 32.5), the README start rows (until 32.6), the `exports.test.ts` length (from 2.5 until 3.1), and the `ci.yml` start steps (CI only, until 36.1). Report these failures; do not work around them early.

## Tasks

- [x] 1. Add the runtime dependencies
  - [x] 1.1 Pin `mqtt`, `ws` and `@types/ws` in both services
    - Run `corepack pnpm view mqtt version`, `corepack pnpm view ws version` and `corepack pnpm view @types/ws version` (plus `license`). If any is not `5.16.0`, `8.22.0` or `8.18.2`, stop and report.
    - Run `corepack pnpm --filter @xelulu/gateway add mqtt@5.16.0 ws@8.22.0 --save-exact` and `corepack pnpm --filter @xelulu/gateway add -D @types/ws@8.18.2 --save-exact`, then the same for `@xelulu/simulator`.
    - Confirm each `package.json` has `dependencies` of exactly `@xelulu/shared` (`workspace:*`), `mqtt` `5.16.0`, `ws` `8.22.0`, and `@types/ws` `8.18.2` added to `devDependencies`; `pnpm-lock.yaml` records the three; `corepack pnpm install --frozen-lockfile` exits 0.
    - _Requirements: 14.3, 22.10_

- [x] 2. Shared `gateway-log` module (`packages/shared/src/gateway-log/`)
  - [x] 2.1 Create `constants.ts`
    - `GATEWAY_LOG_VERSION = 1 as const`, and the frozen `GATEWAY_LOG_KINDS`, `GATEWAY_STATES`, `GATEWAY_ISSUE_KINDS`, `ABORT_CAUSES`, `INTERRUPT_CAUSES`, `AUDIO_TURN_PHASES`, `ACK_RESULT_OUTCOMES` (spreading `ACK_STATUSES` from the contract), `TIMEOUT_CAUSES`, `PRESENCE_CAUSES`, `SAFE_ISSUE_LIMITS` and their derived types, exactly as in the design.
    - _Requirements: 12.1, 12.2, 4.5_
  - [x] 2.2 Create `entries.ts`
    - `LogTransport`, `LogTopicSuffix`, `MessageVariantName`, `AuthOutcome`, `EventOrdering`, `SafeIssueKind`, `SafeIssue`, the `LogEntryBase` and one entry type per kind, `LoggedEvent`, `GatewayLogEntry` and `GatewayLogEntryOf<K>`, exactly as in the design, using `import type` from the contract. No field for `auth`, tokens, passwords, `fw_ver`, Open_Vocabulary values, `code`, `detail`, `card_id`, `active_child_id`, `manifest_url`, `quiet_hours`, audio bytes, transcripts or names.
    - _Requirements: 12.1, 12.3, 12.4, 12.5_
  - [x] 2.3 Create `contract-field-names.ts`
    - `CONTRACT_FIELD_NAMES`: sorted, frozen, derived at module load by walking every exported contract schema (`ZodObject` shape keys, `ZodOptional`/`ZodNullable` unwrap, union and discriminated-union options, array element; anything else a leaf). Never restate the names. Zod stays shared-package internal (D5).
    - _Requirements: 4.5_
  - [x] 2.4 Create `safe-issues.ts`
    - `toSafeIssues(issues)`: pure, never throws; keeps `path` and `kind` only, the first 20 in order; numeric segments unchanged; names in `CONTRACT_FIELD_NAMES` unchanged; any other string segment cut to its first 32 code points, then every code point outside U+0020–U+007E replaced with one `?`. Idempotent on its own output.
    - _Requirements: 4.5, 4.8, 21.4_
  - [x] 2.5 Create `gateway-log/index.ts` and export it from the shared entry
    - Explicit named exports of the 13 runtime names and 29 type names listed in the design. Add `export * from "./gateway-log/index.js";` to `packages/shared/src/index.ts`. Confirm no name collision with Phase 1 exports and no default export; `corepack pnpm --filter @xelulu/shared build` exits 0.
    - _Requirements: 12.1, 22.6_

- [x] 3. Shared tests
  - [x] 3.1 Update `packages/shared/test/exports.test.ts`
    - Add the 13 runtime names to `EXPECTED_RUNTIME_EXPORTS` under a `// Gateway_Log.` comment, change `toHaveLength(144)` to `toHaveLength(157)`, and add the 29 type names to the `import type` block and `ListedTypes` (`GatewayLogEntryOf<"gateway">` for the generic). Keep every Phase 1 name in both lists.
    - _Requirements: 22.6_
  - [x] 3.2 Write `packages/shared/test/gateway-log.test.ts`: field names and entry shapes
    - `CONTRACT_FIELD_NAMES` equals a hand-written 58-name oracle from the Document B field tables, is sorted and frozen, and contains every key at every depth of every golden fixture.
    - `GATEWAY_LOG_VERSION === 1`; `GATEWAY_LOG_KINDS` is exactly the ten kinds of Req 12.2.
    - Compile-time checks: each entry type's keys equal the Req 12.4 list for its kind (plus `log_ver`, `seq`, `at`, `kind`), and no entry type has a forbidden field (Req 12.5).
    - _Requirements: 4.5, 12.1, 12.2, 12.4, 12.5_
  - [x] 3.3 Write property test for Safe_Issue rules in `gateway-log.test.ts`
    - **Property 3: Safe_Issue segment rules are bounded and idempotent**
    - Segments: non-negative integers and strings of 0 to 200 code points from all of Unicode (lone surrogates, control characters, declared field names).
    - **Validates: Requirements 4.5, 4.8**
  - [x]* 3.4 Write constant list and freezing tests in `gateway-log.test.ts`
    - Exact contents and order of every new constant, `Object.isFrozen`, and a `// @ts-expect-error` mutation that throws and leaves contents unchanged.
    - _Requirements: 12.1_

- [x] 4. Checkpoint: shared module builds and its tests pass
  - Run `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, then `corepack pnpm exec vitest run packages/shared/test`. Ensure all tests pass, ask the user if questions arise. Report any expected interim failures (Ground rules).
  - _Requirements: 12.1, 22.6, 23.9_

- [x] 5. Gateway foundations (`services/gateway/src/`)
  - [x] 5.1 Create `clock.ts` and `deadlines.ts`
    - `Clock`, `TimerHandle`, `systemClock` (monotonic `now`, looks up `globalThis.setTimeout` and `Date.now` per call), `isoAt`, `unixSeconds`; `createDeadlines(clock)` with `schedule`, `cancel`, `fireDue(now)` (in dueAt then scheduling order, synchronously) and `nextDue`, keeping one real timer armed for the earliest deadline (D3, G49).
    - _Requirements: 6.2, 6.5, 8.5, 8.6_
  - [x] 5.2 Create `ids.ts` and `backoff.ts`
    - `IdSource` / `randomIds` (`prefix + randomBytes(16).toString("base64url")`, a process-local issued set that redraws on collision); `backoffDelayMs(failedAttempts)` giving 1, 2, 4, 8, 16, 30, 30 … s.
    - _Requirements: 3.4, 8.1_
  - [x] 5.3 Create `config.ts` and `env.ts`
    - Pure `parseGatewayConfig(raw)` returning `ConfigResult<GatewayConfig>` with the design's nine parsing rules (Local_Mode exactly `local`; required keys; URL parse and scheme rules; credentials outside Local_Mode; `DEVICE_ID` via `buildTopic`; port digits and range; `listenHost` per G7; empty credentials to `null`; deep freeze). Offending keys in G3 order, each once, never a value. No TLS option fields.
    - `env.ts` reads only the eight G3 gateway keys by static name and passes them to the parser.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x] 5.4 Create `config-error-writer.ts` and `log/logger.ts`
    - The one stderr line `gateway config error: <keys>` and `gateway listen error: GATEWAY_OPERATOR_PORT` (key names only). `LineSink` and `stdoutSink` (the only `process.stdout.write`).
    - _Requirements: 1.3, 1.7, 12.8, 13.8, 21.3_
  - [x] 5.5 Create `crash.ts`
    - `installProcessHandlers(proc, onFatal, onStop)`: `uncaughtException` and `unhandledRejection` write one `gateway` `stopping` entry with no error text and exit 1 within 5 s; never read `err.message` or `err.stack`; `SIGTERM`/`SIGINT` call `onStop` then exit 0.
    - _Requirements: 21.3, 21.6_
  - [x] 5.6 Write property test for gateway config in `services/gateway/test/config.test.ts`
    - **Property 1: Config acceptance matches the transport rules**
    - Generate `APP_ENV` (unset, `""`, `local`, case and whitespace variants, other), both schemes and both credentials; assert acceptance iff the transport rules allow it, deep freeze, and exact offending keys in G3 order with no value.
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.8**
  - [x]* 5.7 Write config edge examples in `config.test.ts`
    - Port `0`, `65536`, `+1`, ` 80`; URLs with no host; `DEVICE_ID` `a/b`, `""`, `+`; `listenHost` for `localhost`, `127.0.0.1`, `[::1]` and other hosts; default ports.
    - _Requirements: 1.3, 1.5_

- [x] 6. Simulator foundations (`services/simulator/src/`)
  - [x] 6.1 Create `clock.ts`, `deadlines.ts`, `ids.ts` and `backoff.ts`
    - Copies of the gateway modules (services never import each other); `ids` used with prefixes `ev_` and `t_`.
    - _Requirements: 15.4, 16.3, 18.2_
  - [x] 6.2 Create `config.ts` and `env.ts`
    - `parseSimulatorConfig(raw)` with the same rules as the gateway, `SIMULATOR_PANEL_PORT` in place of `GATEWAY_OPERATOR_PORT`; `env.ts` reads only the eight G3 simulator keys by static name.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x] 6.3 Create `config-error-writer.ts` and `log/logger.ts`
    - `simulator config error: <keys>`; `SimLogEntry` union exactly as in the design's Data Models (with `seq`, `at`, fields always present, null when empty) and its one-JSON-line stdout writer. No entry field for forbidden values (G21).
    - _Requirements: 1.3, 1.7, 21.3, 21.4_
  - [x] 6.4 Create `crash.ts`
    - Same handler shape as the gateway; the fatal entry is `simulator` `crashed`; exit 1 within 5 s with nothing on stderr.
    - _Requirements: 21.3, 21.6_
  - [x] 6.5 Write property test for simulator config in `services/simulator/test/config.test.ts`
    - **Property 1: Config acceptance matches the transport rules**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.8**
  - [x]* 6.6 Write config edge examples in the simulator `config.test.ts`
    - The same port, URL and `DEVICE_ID` edge cases as task 5.7.
    - _Requirements: 1.3, 1.5_

- [x] 7. Gateway test support (part 1, `services/gateway/test/support/`)
  - [x] 7.1 Create `test-clock.ts` and `capture-sink.ts`
    - Manual `Clock` (variable `now`, recorded timers) for model tests; `LineSink` that keeps lines for leak scans.
    - _Requirements: 6.5, 8.10, 12.8_
  - [x] 7.2 Create `memory-broker.ts`
    - The `MemoryBroker` double from the design: exact-topic routing, microtask delivery, `published` with `retain: false`, `subscriptions`, `failNextConnects`, `drop`, `holdPubacks`/`releasePubacks`, `connectAttempts`, and `peer(clientId)`. Implements the `MqttConnector` shape (declared in task 10.1; write the matching local types here or import them once 10.1 exists).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 23.10_
  - [x] 7.3 Create `arbitraries.ts`
    - fast-check generators built from the contract constants: sentinels (`§`-prefixed, at least 8 characters), unknown keys (33 to 200 code points, non-printable characters), valid messages per variant via `@xelulu/shared` serialisers, invalid mutations, generated Log_Entries of every kind.
    - _Requirements: 4.7, 12.10, 12.11_

- [x] 8. Gateway_Log core
  - [x] 8.1 Create `services/gateway/src/log/gateway-log.ts`
    - `createGatewayLog(clock, sink)`: `seq` from 1, `at = isoAt(clock.now())`, `log_ver`; freeze, write `JSON.stringify(entry)` to the sink, deliver to subscribers in order inside `try/catch` (a thrower is removed silently); 1,000-entry ring; `subscribe` delivers the backlog then registers and returns an idempotent unsubscribe; `since(after)`.
    - _Requirements: 12.3, 12.6, 12.7, 12.8, 12.11_
  - [x] 8.2 Write property test for subscriber streams in `services/gateway/test/gateway-log.test.ts`
    - **Property 9: Subscribers see a contiguous seq stream**
    - **Validates: Requirements 12.6, 12.9**
  - [x] 8.3 Write property test for JSON safety in `gateway-log.test.ts`
    - **Property 11: Log entries are JSON-safe and round-trip through stdout**
    - **Validates: Requirements 12.3, 12.4, 12.8, 12.11**
  - [x] 8.4 Write the throwing-subscriber test in `gateway-log.test.ts`
    - A subscriber that throws is removed, the same entry still reaches the others, and the line is still written to the sink.
    - _Requirements: 12.7_

- [x] 9. Device registry, presence and dedupe (`services/gateway/src/devices/`)
  - [x] 9.1 Create `registry.ts`
    - One-device registry (G5); `checkHello` and `deviceForToken` compare `sha256` digests with `timingSafeEqual` plus a length check, always computing both digests; `auth_failed` mark in memory, starting clear; `helloSeen`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 9.2_
  - [x] 9.2 Create `presence.ts`
    - State machine `unknown` → `online` ↔ `offline` with `heartbeat(deviceId, at, cause)` and `expire(deviceId)` returning a `PresenceChange` or null; silence deadline `presence:<device_id>` at `lastHeartbeatAt + 45_000`; no deadline before the first Heartbeat.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7_
  - [x] 9.3 Write model-based property test for presence in `services/gateway/test/presence.test.ts`
    - **Property 5: Presence agrees with the silence-window model**
    - Drive `presence.ts` with the test clock and `createDeadlines`, calling `fireDue(t)` before every input; include exact 45,000 ms gaps and interleaved non-Heartbeat inputs.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**
  - [x] 9.4 Create `dedupe-store.ts` and `event-log-data.ts`
    - `observeEvent(d, eventId, ts, now)` per the design's three-step algorithm (7-day head expiry, duplicate check, `backDated` against `highestTs`, 10,000-pair head eviction); `event-log-data.ts` projects `data` to `LoggedEvent` (touch `zone`/`gesture`, wake `source`, motion `event`, button `button`/`action`, otherwise `{}`).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.11, 12.4_
  - [x] 9.5 Write property test for dedupe in `services/gateway/test/dedupe-store.test.ts`
    - **Property 6: Dedupe agrees with the set model**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.11**
  - [x] 9.6 Write property test for reprocessing in `dedupe-store.test.ts`
    - **Property 7: Reprocessing a sequence only adds duplicates**
    - **Validates: Requirements 7.10**
  - [x] 9.7 Write eviction and expiry examples in `dedupe-store.test.ts`
    - The 10,001st pair evicts the earliest and leaves counts unchanged; the 7-day boundary at 604,799,999 ms (duplicate) and 604,800,000 ms (accepted as new); `highestTs` unaffected by eviction.
    - _Requirements: 7.4, 7.7, 7.8_

- [x] 10. Broker session and inbound pipeline (`services/gateway/src/mqtt/`)
  - [x] 10.1 Create `mqtt-transport.ts` and `broker-session.ts`
    - Types-only `MqttConnectOptions`, `MqttConnection`, `MqttConnector`. Broker session: client id `xelulu-gw-` + id; on connect subscribe once to the three `buildTopic` topics per Registered_Device at QoS 1 then `broker_connected`; failed subscribe ends the attempt; on close `broker_disconnected` and backoff reconnect on the Clock; no entry for failed attempts; `connected` flag; `publishCmd(deviceId, payload)` as the only publish (QoS 1, never retained).
    - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 10.2 Write `services/gateway/test/broker-session.test.ts`
    - Connect options (MQTT 5, clean start, unique id, credentials or none), exactly three subscriptions with no wildcard, backoff 1/2/4/8/16/30/30 s with `failNextConnects`, reset after success, resubscribe after reconnect, one entry per established connect and drop, publish only on `cmd` at QoS 1 unretained, nothing on `status`/`event`/`ack`/`ota`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 10.3 Create `inbound-pipeline.ts`
    - Pure `classifyInbound(topic, payload, registry)` running the six ordered steps of the design (`parseTopic`, registered, size over 8,192, `parseDeviceMessage` with `toSafeIssues`, hello `device_id` mismatch, `auth_failed`), each reject entry built only from the parsed topic, constants and Safe_Issues; `device_id` null for `invalid_topic` and `unknown_device`.
    - _Requirements: 2.1, 2.2, 4.1, 4.2, 4.3, 4.4, 4.9, 4.10, 5.6_
  - [x] 10.4 Write classifier examples in `services/gateway/test/inbound-pipeline.test.ts`
    - 8,192 bytes go to parsing and 8,193 are `payload_too_large`; hello `device_id` mismatch gives one `device_id_mismatch` issue and no hello value; `invalid_topic` entry holds no part of the topic; `unknown_device` entry has `device_id` null; `auth_failed` drop for status, event and ack.
    - _Requirements: 4.2, 4.4, 4.9, 4.10, 5.6_

- [x] 11. Commands and ack tracking (`services/gateway/src/mqtt/`)
  - [x] 11.1 Create `ack-tracker.ts`
    - Per-device `Map<cmd_id, RetainedCommand>` in publish order, at most 1,000 (eviction cancels deadlines, no entry); deadlines `ack:<device>:<cmd_id>:10` and `:60` armed at publish; the state machine of the design producing `ack_result` entries (`accepted`, terminal statuses, `timed_out` with `no_ack`/`no_completion`, `duplicate`, `late`, `unmatched` with `action` null); `reason` recorded unchanged; no publish path at all.
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.12, 8.13_
  - [x] 11.2 Create `command-sender.ts`
    - `CommandRequest`, `CommandError`, `CommandResult`; `sendCommand` checks in order registered, presence `online`, broker `connected`, then draws a `cmd_id` and calls `serialiseCmdMessage` in `try` (`invalid_command` with `toSafeIssues`); on success `publishCmd`, record in the tracker, add `message_out`. Nothing queued or published on refusal.
    - _Requirements: 2.6, 3.7, 8.1, 8.2, 8.11, 13.3_
  - [x] 11.3 Write model-based property test for ack tracking in `services/gateway/test/ack-tracker.test.ts`
    - **Property 8: Ack tracking agrees with the timeout model**
    - Drive `command-sender.ts` and `ack-tracker.ts` with the test clock, a recording publish function and `fireDue(t)` before every input; include arrivals at exactly 10,000 and 60,000 ms and acks for another device's commands.
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12**
  - [x] 11.4 Write the refusal-order table in `ack-tracker.test.ts`
    - The 16 combinations of unregistered, not online (`unknown`/`offline`), broker disconnected and invalid data: the first applicable Command_Error in the order of Req 8.2, nothing published, no Pending_Command, no `message_out`, no `cmd_id` drawn; a refused command is not published after a reconnect.
    - _Requirements: 3.7, 8.2_
  - [x]* 11.5 Write the 1,000-command retention example in `ack-tracker.test.ts`
    - The 1,001st command evicts the oldest with its deadlines and no entry; a later ack for it is `unmatched`.
    - _Requirements: 8.13_

- [x] 12. Audio and brain cores (`services/gateway/src/audio/`, `src/brain/`)
  - [x] 12.1 Create `audio/audio-transport.ts` and `audio/synthetic-frame.ts`
    - Types-only `AudioInbound` (binary carries `byteLength` only), `AudioSocket`, `AudioListen`; the 40-byte ASCII pattern `XLU-SYNTHETIC-PLACEHOLDER-FRAME-NOTAUDIO`, returning a fresh `Uint8Array` per call.
    - _Requirements: 9.6, 10.4, 21.2_
  - [x] 12.2 Create `audio/audio-turn.ts`
    - Per-socket stage machine `awaiting_start` → `uploading` → `replying` with every row of the design's inbound table: 4,096-byte text and 1,500-byte frame limits, 3,000-frame cap, 5,000 ms start timeout, 10,000 ms idle timeout, each Abort_Cause, `parseAudioControlMessage` before reading any field, counts only (bytes never kept), reply-stage traffic ignored except oversize, `message_in` (ws) for valid `audio_start`/`audio_end`, close codes 1008/1009/1001 with `terminate()` after 1,000 ms.
    - _Requirements: 2.1, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.11, 9.12, 21.2_
  - [x] 12.3 Create the brain seams
    - `provider-declaration.ts` (`DataHandlingDeclaration`), `stt-provider.ts`, `llm-provider.ts`, `tts-provider.ts` (each with a read-only `dataHandling`), `stub-providers.ts` (three stubs declaring no retention and no training, every method throwing `not implemented` without touching arguments, env or network), `turn-responder.ts` (`TurnResponder`, `ReplyTarget`). Placeholder input types carry no audio or transcript fields.
    - _Requirements: 14.1, 14.5, 14.6_
  - [x] 12.4 Create `audio/audio-server.ts`
    - `Map<device_id, AudioTurn>`; an accepted upgrade for a device with an open turn aborts the old one with `replaced` first; one `audio_turn` entry per phase; after `ended`, calls the TurnResponder exactly once through a `ReplyTarget`; `bargeIn(deviceId)` per the design (cancel frame deadline, `audio_end` serialised, `message_out` ws, close 1000, `stop_audio` via `sendCommand`, then `interrupted` with real `frames_out` and refusal cause); no-op when no reply is in flight; at most one `audio_end` per turn.
    - _Requirements: 9.7, 9.8, 9.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [x] 12.5 Create `brain/fake-reply.ts`
    - `createFakeReply(deps)`: `say` with exactly `{ expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 1000 }`; on `device_offline`/`broker_disconnected` abort with that cause and send nothing; else `reply_started`, frame 1 immediately and frame n at `t0 + 20 ms × n` via anchored deadlines, without waiting for any ack; after frame 50 `serialiseAudioEndMessage`, `message_out` (ws), close 1000, `reply_ended` with `frames_out` 50; stop cleanly on close or `replaced`. No downstream `audio_start`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 14.2_

- [x] 13. Operator cores (`services/gateway/src/operator/`)
  - [x] 13.1 Create `request-guard.ts`
    - Ordered checks: `Host` exactly `127.0.0.1:<port>` or `localhost:<port>` (case-insensitive), no `Origin`, known route, allowed method, POST with `application/json` (optional `; charset=utf-8`); error codes and statuses from the design table; no echo of submitted values.
    - _Requirements: 13.7, 13.10_
  - [x] 13.2 Create `snapshot.ts` and `operator-routes.ts`
    - `DeviceSnapshot` builder (presence, last Heartbeat ISO or null, `auth_failed`, counts, last 100 Retained_Commands oldest first). Pure route handler for `GET /v1/devices`, `GET /v1/log?after=`, `POST /v1/commands` with `HttpRequestIn`/`HttpResponseOut` and the `OperatorListen` type; body checks (`invalid_json`, `not_object`, `invalid_fields` with Safe_Issues); Command_Error mapping to 404/409/503/422; response headers; synchronous `sendCommand`, never waiting for an ack.
    - _Requirements: 13.3, 13.4, 13.5, 13.7, 13.9_

- [x] 14. Checkpoint: gateway cores build and their tests pass
  - Run `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, then `corepack pnpm exec vitest run services/gateway/test packages/shared/test`. Ensure all tests pass, ask the user if questions arise. Report the expected interim failures (Ground rules).
  - _Requirements: 23.9_

- [x] 15. Gateway transports (the only network-module importers)
  - [x] 15.1 Create `src/mqtt/transport/mqtt-js-connector.ts`
    - `MqttConnector` over MQTT.js with `protocolVersion: 5`, `clean: true`, `sessionExpiryInterval: 0`, `reconnectPeriod: 0`, `connectTimeout: 10_000`, `keepalive: 30`, `queueQoSZero: false`, `resubscribe: false`; resolve on first `connect`, reject with no detail on `error`/`close` before it; `publish` always `{ qos, retain: false }`; first `close` maps to `onClose`; never logs; default TLS verification (no `rejectUnauthorized`, `checkServerIdentity`).
    - _Requirements: 1.6, 1.9, 3.1, 3.3, 3.4_
  - [x] 15.2 Create `src/audio/transport/ws-audio-listener.ts`
    - `node:http` server (plain HTTP answered 426) plus `ws` in `noServer` mode, `perMessageDeflate: false`, `maxPayload: 65536`; upgrade auth reads exactly `Bearer <non-empty token>`, else writes `HTTP/1.1 401 Unauthorized` with `Connection: close`, destroys the socket and calls `onAuthFailed`; binds the given host and port; `message` converted to `AudioInbound` with frame bytes dropped before return; `maxPayload` errors become `too_large` (D7).
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 21.2_
  - [x] 15.3 Create `src/operator/transport/http-listener.ts` and `http-client.ts`
    - Listener on `127.0.0.1` only with an 8 KiB body cap (413 with `Connection: close`, stop reading, keep serving) feeding `operator-routes.ts`; client used only by `cli.ts`, calling `127.0.0.1:<port>` with a 5 s timeout.
    - _Requirements: 13.1, 13.6, 13.7_

- [x] 16. Gateway composition and entry points
  - [x] 16.1 Create `services/gateway/src/gateway.ts`
    - `createGateway(config, deps)` and the `Gateway` interface from the design: `start()` order (`starting`, audio listen then `audio_listening`, operator listen in Local_Mode only, broker session); per inbound message `fireDue(clock.now())` then `classifyInbound`, `message_in` first, hello auth (`auth` entry, Heartbeat on ok), status Heartbeat, events through the Dedupe_Store with `event_accepted`/`event_duplicate` and barge-in on a new `interrupt`, acks to the tracker; audio upgrade auth failure gives `auth` `failed` (ws, null); the Fake_Reply as the only TurnResponder; `sendCommand`, `snapshot`, `audioPort`, `operatorPort`, `stop()` cancelling all deadlines; `listenPorts` test override.
    - _Requirements: 3.1, 4.1, 4.6, 5.3, 5.4, 5.6, 5.7, 6.1, 6.4, 7.1, 7.2, 7.12, 9.1, 9.3, 11.1, 13.1, 13.2, 14.1, 14.2, 14.4, 21.5_
  - [x] 16.2 Replace `services/gateway/src/index.ts`
    - First statement `process.removeAllListeners("warning")`; read config through `env.ts` (config error line, exit 2, no socket opened); install crash and signal handlers; build real deps (system clock, MQTT.js connector, `ws` listener, HTTP listener, stdout sink, random ids); start; operator listen failure in Local_Mode writes the listen error line and exits 3. Keep the file at this path.
    - _Requirements: 1.3, 13.8, 21.3, 21.6, 22.9_
  - [x] 16.3 Create `services/gateway/src/cli.ts` (operator CLI)
    - `devices`, `log [--after <seq>]`, `send <device_id> <action> <data-json>`; config via `env.ts`; exit codes 0/1/2/3/4/5 and stderr lines exactly as in the design table; prints only the response JSON; never prints env values, request values or tokens.
    - _Requirements: 13.2, 13.6, 13.9_

- [x] 17. Gateway test support (part 2)
  - [x] 17.1 Create `services/gateway/test/support/fake-device.ts`
    - MQTT peer on the memory broker plus a `ws` client (with `Authorization: Bearer`) built only from `@xelulu/shared` codecs: hello, status, events, acks (auto-ack policies), a 50-frame audio turn, and reply capture.
    - _Requirements: 23.10_
  - [x] 17.2 Create `services/gateway/test/support/self-signed.ts`
    - Build throwaway self-signed certificates at test time with `node:crypto` (`generateKeyPairSync` and a minimal DER encoder): untrusted, expired and wrong-host variants. Nothing is committed.
    - _Requirements: 1.6, 1.9_
  - [x] 17.3 Create `services/gateway/test/support/env-cases.ts`
    - Pinned base env (inherited env with every Panel_Key removed case-insensitively, then known values), the G3 key table, the valid non-Local_Mode base pointing at `127.0.0.1` port 1, and the per-key cases of the design's start-test table, all as `[key, value]` tuples.
    - _Requirements: 1.3, 1.7, 22.3_

- [x] 18. Gateway inbound, auth and log-leak tests
  - [x] 18.1 Write property test for rejected inbound messages in `inbound-pipeline.test.ts`
    - **Property 2: Rejected inbound messages are inert and leak nothing**
    - Run through `createGateway` with the memory broker, the fake device and a capture sink; assert one `message_rejected` only, first issue kind per step order, state unchanged, no sentinel, topic text, long key or non-printable path character in entries or stdout lines.
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7, 4.9, 4.10, 7.12**
  - [x] 18.2 Write property test for token secrecy in `services/gateway/test/auth.test.ts`
    - **Property 4: Hello auth and device tokens never appear in output**
    - Matching and non-matching hellos and Bearer upgrades; scan entries, stdout, stderr and Operator_Surface responses for any 8-character substring of the token or `auth`.
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**
  - [x] 18.3 Write auth examples in `auth.test.ts`
    - Only `DEVICE_ID` is registered; wrong `auth` marks `auth_failed` (also when already marked) and is no Heartbeat; right `auth` clears it; while marked, status, event and ack are dropped with one `auth_failed` rejection and no side effect; before any hello, messages are processed normally; the mark starts clear.
    - _Requirements: 5.1, 5.3, 5.4, 5.6, 5.7_
  - [x] 18.4 Write property test for log redaction in `services/gateway/test/log-redaction.test.ts`
    - **Property 10: Forbidden wire values never reach the log**
    - **Validates: Requirements 12.5, 12.10**

- [x] 19. Gateway audio, operator and process tests
  - [x] 19.1 Write `services/gateway/test/audio-server.test.ts`
    - Real loopback `ws`: `audio_listening` entry; 401 cases (no header, other scheme, empty token, unknown token) with `auth` `failed` (ws, null) and no turn; every Abort_Cause in a table with close within 1,000 ms and no `audio_end`; `replaced`; reply-stage traffic ignored except oversize; invalid reply-stage text gives `message_rejected` (ws); D7 over-64 KiB gives `frame_too_large`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12_
  - [x] 19.2 Write `services/gateway/test/fake-reply.test.ts`
    - Exact `say` data; first frame no later than 20 ms after publish and frame n at 20 ms × n under fake timers; every frame the 40-byte constant; `audio_end` then close 1000 and `reply_ended` (50); no text other than `audio_end`, no downstream `audio_start`; `device_offline`/`broker_disconnected` refusal aborts with no frames; mid-reply close or `replaced` gives one `aborted` entry with frames sent and leaves the `say` tracked.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 19.3 Write `services/gateway/test/barge-in.test.ts`
    - New `interrupt` during the reply: no frame more than 100 ms after acceptance, `audio_end` before `stop_audio`, one `interrupted` entry with real `frames_out` and no `reply_ended`; duplicate `interrupt`, interrupt while uploading or after the reply's `audio_end` change nothing; refused `stop_audio` (offline or disconnected) is not retried and sets the cause.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [x] 19.4 Write property test for operator leaks in `services/gateway/test/operator-surface.test.ts`
    - **Property 12: Operator responses and CLI output leak nothing**
    - Includes spawning the built `dist/cli.js` for a sample of requests and scanning its stdout and stderr.
    - **Validates: Requirements 13.7, 13.9**
  - [x] 19.5 Write operator surface tables in `operator-surface.test.ts`
    - Listens on `127.0.0.1` only and only in Local_Mode; send returns `cmd_id` or the Command_Error within 1,000 ms without waiting for an ack; devices response fields exactly; log `after` semantics; every guard and body error code (Host, Origin, unknown route, method, content type, 8 KiB cap, JSON, object, fields) changes no state and publishes nothing, and later requests still work.
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.7, 13.10_
  - [x] 19.6 Write `services/gateway/test/operator-cli.test.ts`
    - Spawn `dist/cli.js` against a loopback listener and a closed port: exit 0 with JSON on success, 1 on an error response, 2 on usage, 3 with `operator surface not reachable` within 5 s, 4 with `operator surface is local-only` outside Local_Mode, 5 on a config error.
    - _Requirements: 13.2, 13.6_
  - [x] 19.7 Write `services/gateway/test/brain.test.ts`
    - Every stub method throws `not implemented`; every `dataHandling` declares no retention and no training; the Fake_Reply is the Audio_Server's only TurnResponder and is called exactly once per ended upload.
    - _Requirements: 14.1, 14.2, 14.5, 14.6_
  - [x] 19.8 Write `services/gateway/test/crash.test.ts`
    - Fake process emitter: `uncaughtException` and `unhandledRejection` write exactly one `gateway` `stopping` entry with no error text and exit 1; child process: an emitted warning prints nothing on stderr (K13).
    - _Requirements: 21.3, 21.6_
  - [x] 19.9 Write `services/gateway/test/tls.test.ts`
    - Source scan of `services/gateway/src` for `rejectUnauthorized`, `checkServerIdentity` and `NODE_TLS_REJECT_UNAUTHORIZED`; the connector passes no TLS-weakening option; loopback TLS server with the untrusted, expired and wrong-host certificates (trust hook through deps, never Config): the attempt fails and the server receives no application data.
    - _Requirements: 1.6, 1.9_

- [x] 20. Gateway Done-when in-process test
  - [x] 20.1 Write `services/gateway/test/done-when.test.ts`
    - With the memory broker, the fake device, loopback `ws` and fake timers: Done-when 2 (14 events, one `message_in` and `event_accepted` each, no rejection, duplicate or `stop_audio`); 3 (`say` and `animate` with `accepted` then `done ""`; `animate` rejected `picked_up` once and nothing more for 15 s); 4 (`started`, `ended` 50, `say` `message_out`, `reply_started`, `reply_ended` 50, `done` for the `say`); 5 (replayed event accepted with `time_uncertain`/`approximate`, 5 duplicates, counts +1 and +5); 6 (`offline` `silence` at exactly 45,000 ms after the last Heartbeat, `online` `hello` after the next hello).
    - _Requirements: 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 23.10_

- [x] 21. Checkpoint: gateway service tests pass
  - Run `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, then `corepack pnpm exec vitest run services/gateway/test`. Ensure all tests pass, ask the user if questions arise. Report the expected interim failures (Ground rules).
  - _Requirements: 23.9, 23.10_

- [x] 22. Simulator test support (part 1, `services/simulator/test/support/`)
  - [x] 22.1 Create `test-clock.ts` and `capture-sink.ts`
    - Copies of the gateway support files.
    - _Requirements: 15.4, 21.8_
  - [x] 22.2 Create `memory-broker.ts`
    - Copy of the gateway double (services and their tests never import each other).
    - _Requirements: 15.1, 15.2, 19.4, 19.7, 23.10_
  - [x] 22.3 Create `arbitraries.ts`
    - Generators from the contract constants: event requests per kind with random omitted fields, valid and invalid commands (unknown keys of 33 to 200 code points, sentinel string values), Ack_Policies, Control_Surface requests, sentinels.
    - _Requirements: 16.6, 17.11, 21.8_

- [x] 23. Simulator device cores (`services/simulator/src/device/`)
  - [x] 23.1 Create `device-state.ts` and `heartbeat.ts`
    - G26 start state (battery 100, charging false, mode `idle`, rssi −50, `fault` [], `active_child_id` null, `temp_c` 30, volume 50, `fw_ver` `sim-0.1.0`); status built with exactly the contract status fields and `serialiseStatusMessage`; schedule anchored on the first status (`t1 + 15,000 × n`).
    - _Requirements: 15.3, 15.4, 15.6_
  - [x] 23.2 Create `event-factory.ts`
    - `buildEvent(req, eventId, ts)`: kind must be in `EVENT_KINDS`; fill only omitted `data` fields with the Req 16.7 defaults (list members taken from the contract constants); no `time_uncertain`; `serialiseEventMessage` in `try`, `toSafeIssues` (at most 20) on failure.
    - _Requirements: 2.4, 2.6, 16.1, 16.2, 16.3, 16.4, 16.7_
  - [x] 23.3 Write event-factory examples in `services/simulator/test/event-factory.test.ts`
    - Unknown kind and contract-rejected data are refused with Safe_Issues and nothing published or queued; each default is a member of its contract constant; supplied values are kept unchanged.
    - _Requirements: 2.4, 16.4, 16.7_
  - [x] 23.4 Create `outbox.ts`
    - Offline_Queue (500, head dropped with one `queue_dropped` entry), single in-flight event leaving only on PUBACK, `recentPublished` ring of the last 5 PUBACKed events, sequential replay with `time_uncertain: true` and the original `event_id`/`event`/`data`/`ts`, unacknowledged head kept on drop or toggle, `duplicate_replay` re-publication after the queue empties.
    - _Requirements: 15.5, 19.2, 19.3, 19.4, 19.5, 19.7_
  - [x] 23.5 Create `ack-policy.ts`
    - `AckOverride`, `AckPolicy`, `resolveOverride` (per-action over all-actions), `ackPlan` per the design table; override validation against `ACK_REASONS` and `CMD_ACTIONS` (`reject` needs a reason; `fail` reason `""` or an Ack_Reason).
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_
  - [x] 23.6 Create `command-handler.ts`
    - `parseCmdMessage` first (failure: `message_rejected` with Safe_Issues and `proto_ver_mismatch`, no ack, nothing recorded); 1,000-entry idempotency memory re-sending only already-sent acks, any still-due ack sent once; plan fixed at receipt; apply per G27 (`set_mode`, `volume`, `config`, `ota` fetches nothing, others logged by action and `cmd_id`); acks via `serialiseAckMessage` on `buildTopic(deviceId, "ack")` at QoS 1 with `ts` at publish; `say` during a turn waits for the reply `audio_end` (or `failed ""`); `stop_audio` during a turn stops reply counting first; last 50 received commands view.
    - _Requirements: 2.1, 2.6, 17.1, 17.2, 17.8, 17.9, 17.10, 18.4, 18.5, 21.5_
  - [x] 23.7 Write property test for acks in `services/simulator/test/command-handler.test.ts`
    - **Property 14: Acks follow the Ack_Policy and repeats change nothing**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8, 17.10, 17.11**
  - [x] 23.8 Write command-handler examples in `command-handler.test.ts`
    - A `reject` override without a reason or with a reason outside `ACK_REASONS` is refused and the policy is unchanged; an invalid command (including a wrong `proto_ver`) gets no ack, applies nothing, records nothing and logs Safe_Issues only.
    - _Requirements: 17.7, 17.9_

- [x] 24. Simulator link and audio cores
  - [x] 24.1 Create `src/mqtt/mqtt-transport.ts` and `src/mqtt/device-link.ts`
    - Copied transport types. Device link: client id `DEVICE_ID`, MQTT 5, clean start; subscribe `buildTopic(deviceId, "cmd")` only; after SUBACK the hello (exact keys, QoS 1); after its PUBACK the Outbox replay, then the first status at once and the 15 s heartbeat; on unplanned drop stop heartbeats and reconnect with backoff; offline toggle aborts any turn, stops heartbeats, disables reconnect and ends the connection within 1 s; online toggle reconnects; same-state toggles are no-ops; inbound `cmd` passed to the command handler.
    - _Requirements: 2.2, 15.1, 15.2, 15.3, 15.4, 15.5, 15.7, 19.1, 19.4, 19.8_
  - [x] 24.2 Write `services/simulator/test/device-link.test.ts`
    - Subscribe `/cmd` only; hello after SUBACK with exact keys; status within 1,000 ms and every 15,000 ms on fake timers; timer restarts on a new hello; drop stops status and reconnects with backoff, then hello, replay, status; offline toggle publishes nothing; same-state toggles change nothing.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.7, 19.1, 19.8_
  - [x] 24.3 Write property test for replay in `services/simulator/test/outbox.test.ts`
    - **Property 15: Offline events replay once, in order, with original ids**
    - Drive the device link and Outbox with the memory broker (`holdPubacks`, `drop`) for 0 to 600 offline events and generated drop points.
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.6, 19.7**
  - [x] 24.4 Write the `duplicate_replay` example in `outbox.test.ts`
    - After an offline-to-online toggle with `duplicate_replay` on: hello, the queued event, then the last 5 pre-offline events in publish order with original ids and `time_uncertain: true`, then the first status.
    - _Requirements: 19.5_
  - [x] 24.5 Create `src/audio/audio-transport.ts`, `synthetic-frame.ts` and `audio-turn-client.ts`
    - `ClientAudioSocket`/`OpenAudioSocket` types; the copied 40-byte constant; turn client per the design (refuse `offline` or `turn_in_progress`; `audio_start` with a new `t_` id; 50 frames at 20 ms on the clock; `audio_end`; count reply frames, discard bytes, latency from own `audio_end` to first reply frame; `complete`, `interrupted` or `failed` with the cause list; 10,000 ms reply timeout; `parseAudioControlMessage` on every text message).
    - _Requirements: 2.1, 18.1, 18.2, 18.3, 18.5, 18.6, 18.7, 18.8, 18.9_

- [x] 25. Simulator control cores (`services/simulator/src/control/`)
  - [x] 25.1 Create `request-guard.ts`
    - Same guard as the gateway with a 16 KiB cap; allows `Origin` equal to the Control_Surface's own loopback origin (built from parts at start-up, never a literal) and refuses any other.
    - _Requirements: 20.6, 20.7_
  - [x] 25.2 Create `control-routes.ts`
    - Pure handler for every route in the design table (`/`, assets, `/api/state`, `/api/events`, `/api/audio-turn`, `/api/connection`, `/api/duplicate-replay`, `/api/ack-policy`, `/api/ack-policy/clear`, `/api/battery`); `SimulatorState` with `choices` copied from the contract constants; error codes (`unknown_operation`, `invalid_event`, `battery_out_of_range` via `serialiseStatusMessage`, `reason_required`, `invalid_reason`, `offline`, `turn_in_progress`) with no echo; `control_rejected` log entries; no env value except `DEVICE_ID`.
    - _Requirements: 16.1, 16.2, 16.4, 17.7, 18.8, 19.8, 20.2, 20.5, 20.6_
  - [x] 25.3 Create `panel-assets.ts`
    - Read `panel/index.html`, `panel.css` and `panel.js` once at start with `readFileSync` from `new URL("../../panel/", import.meta.url)`; serve with the design's CSP and security headers.
    - _Requirements: 20.3, 21.1_

- [x] 26. Simulator transports
  - [x] 26.1 Create `src/mqtt/transport/mqtt-js-connector.ts`
    - Same MQTT.js adapter as the gateway (copied).
    - _Requirements: 1.6, 1.9, 15.1_
  - [x] 26.2 Create `src/audio/transport/ws-audio-client.ts`
    - `new WebSocket(url, { headers: { Authorization: "Bearer " + token }, perMessageDeflate: false, maxPayload: 65536, handshakeTimeout: 5000 })`; `unexpected-response` rejects `upgrade_refused`, other failures `connect_failed`; reply bytes dropped in the handler; default TLS verification.
    - _Requirements: 1.6, 1.9, 18.1, 18.3, 18.6_
  - [x] 26.3 Create `src/control/transport/http-listener.ts` and `http-client.ts`
    - Listener on `127.0.0.1:SIMULATOR_PANEL_PORT` only with the 16 KiB cap feeding `control-routes.ts`; client used only by `cli.ts` with a 5 s timeout.
    - _Requirements: 20.1, 20.4, 20.6_

- [x] 27. Simulator panel
  - [x] 27.1 Create `services/simulator/panel/index.html`, `panel.css` and `panel.js`
    - One `<form>` per group (events with one button per touch zone from `/api/state` `choices`, audio turn, connection, duplicate replay, Ack_Policy, battery); native controls each with a `<label for>`; DOM order equals visual order; no positive `tabindex`; `:focus-visible` outline of at least 2 px; no `animation`, `transition` or `@keyframes`; `<output aria-live="polite">`; same-origin relative `fetch` to `/api/*` only; no external resource and no URL literal; no restated wire list.
    - _Requirements: 20.2, 20.3, 20.5_
  - [x] 27.2 Add the panel block to `eslint.config.mjs`
    - `files: ["services/simulator/panel/**/*.js"]`, `languageOptions: { sourceType: "module", globals: globals.browser }` (D11). No other ESLint change.
    - _Requirements: 20.3, 23.9_

- [x] 28. Simulator composition and entry points
  - [x] 28.1 Create `services/simulator/src/simulator.ts`
    - `createSimulator(config, deps)` wiring state, heartbeat, event factory, Outbox, Ack_Policy, command handler, device link, audio turn client and control routes; `fireDue(clock.now())` before each inbound message or request; event publish on `buildTopic(deviceId, "event")` at QoS 1 unretained; Control_Surface listening in every mode; outbound connections only to the broker and `AUDIO_WSS_URL`.
    - _Requirements: 15.1, 16.3, 16.5, 18.1, 19.2, 20.1, 21.5_
  - [x] 28.2 Replace `services/simulator/src/index.ts`
    - Silence warnings first; config via `env.ts` (config error line, exit 2, no socket); crash and signal handlers (pass `flushStdout` from `log/logger.ts` as the fourth `installProcessHandlers` argument, as the gateway's `index.ts` does, so the `crashed` line is flushed before exit 1); real deps; start. A Control_Surface bind failure is treated as a crash (exit 1, one `crashed` entry). Keep the file at this path.
    - _Requirements: 1.3, 21.3, 21.6, 22.9_
  - [x] 28.3 Create `services/simulator/src/cli.ts`
    - Commands `state`, `event <kind> [<data-json>]`, `audio-turn`, `online`, `offline`, `duplicate-replay on|off`, `ack-policy set|clear …`, `battery <pct> <true|false>`; exit 0 with JSON on stdout, 1 with the error JSON on stderr, 2 usage, 3 no answer within 5 s, 5 config error; never prints env values except `DEVICE_ID`.
    - _Requirements: 20.4, 20.5_

- [x] 29. Simulator test support (part 2)
  - [x] 29.1 Create `services/simulator/test/support/fake-gateway.ts`
    - MQTT peer on the memory broker plus a loopback `ws` server checking the Bearer header, built only from `@xelulu/shared` codecs: sends commands, records acks and events, answers an audio turn with frames and `audio_end`.
    - _Requirements: 23.10_
  - [x] 29.2 Create `services/simulator/test/support/self-signed.ts` and `env-cases.ts`
    - Copies of the gateway support files, with the simulator's G3 key table.
    - _Requirements: 1.3, 1.6, 1.9, 22.3_

- [x] 30. Simulator tests
  - [x] 30.1 Write property test for fired events in `event-factory.test.ts`
    - **Property 13: Fired events round-trip with defaults**
    - Fire through `createSimulator` and the Control_Surface routes with the memory broker; parse the published payload with `parseEventMessage`.
    - **Validates: Requirements 15.6, 16.1, 16.2, 16.3, 16.6, 16.7**
  - [x] 30.2 Write property test for simulator leaks in `services/simulator/test/sim-log.test.ts`
    - **Property 16: Simulator output leaks nothing**
    - **Validates: Requirements 20.5, 21.4, 21.8**
  - [x] 30.3 Write `services/simulator/test/audio-turn-client.test.ts`
    - Against the loopback fake gateway with fake timers: Bearer header; `audio_start`, 50 frames at 20 ms, `audio_end`; `complete` with frames and latency; `say` acked `accepted` then `done` on the reply `audio_end` (or `failed ""`); `stop_audio` stops counting; every failure cause (refused upgrade, connect failure, early close, invalid text, other `turn_id`, 10,000 ms timeout, toggled offline); refusal when offline or a turn is in progress; `interrupted` result.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_
  - [x] 30.4 Write `services/simulator/test/control-surface.test.ts`
    - Listens on `127.0.0.1` only in every mode; every operation of Req 20.2; the CLI per operation (spawn `dist/cli.js`) with exit codes; every error case of Req 20.6 changes no state and publishes nothing; Host, foreign Origin, GET state change and missing JSON content type refused.
    - _Requirements: 20.1, 20.2, 20.4, 20.6, 20.7_
  - [x]* 30.5 Write `services/simulator/test/panel.test.ts`
    - Static checks: every `input`, `select` and `button` has an associated visible label; no `src`/`href` to another origin; no `animation`, `transition` or `@keyframes`; a `:focus-visible` rule; `tabindex` never positive.
    - _Requirements: 20.3_
  - [x] 30.6 Write `services/simulator/test/crash.test.ts`
    - One `simulator` `crashed` entry with no error text, exit 1, empty stderr; a warning prints nothing.
    - _Requirements: 21.3, 21.6_
  - [x] 30.7 Write `services/simulator/test/tls.test.ts`
    - Source scan for TLS-weakening options; `mqtts` and `wss` attempts against loopback TLS servers with the three bad certificates fail before any credential, token or Document B message is sent.
    - _Requirements: 1.6, 1.9_
  - [x] 30.8 Write `services/simulator/test/done-when.test.ts`
    - With the fake gateway: Done-when 2 (14 control requests publish 14 valid events with distinct ids); 3 (default plan `accepted` then `done`; `reject picked_up` for `animate` only gives one `rejected`); 4 (turn completes with 50 frames and a latency); 5 (offline toggle, one queued event, online: hello, replay, 5 re-publications, then status); 6 (offline toggle stops all publishing; online sends hello).
    - _Requirements: 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 23.10_

- [x] 31. Checkpoint: simulator tests pass
  - Run `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, then `corepack pnpm exec vitest run services/simulator/test services/gateway/test packages/shared/test`. Ensure all tests pass, ask the user if questions arise. Report the expected interim failures (Ground rules).
  - _Requirements: 23.9, 23.10_

- [x] 32. Phase 0/1 repo-check, panel, README and steering updates
  - [x] 32.1 Update `tooling/test/env-reads.test.ts`
    - Replace "admin, gateway, simulator and shared sources contain no env reads at all" with the three tests (a) each `env.ts` reads only static names from its service's G3 list (two arrays in the test), (b) both `env.ts` files are in the scan, (c) zero env reads in `apps/admin/src`, `apps/admin/vite.config.ts`, `apps/admin/index.html`, `packages/shared/src` and every other file in both service `src` trees. Leave the parent-app and Property 8 detector tests unchanged.
    - _Requirements: 1.1, 22.1_
  - [x] 32.2 Update `tooling/test/placeholder.test.ts`
    - "%s imports no network modules" becomes "%s imports network modules only in its transport folders": keep `NETWORK_MODULE_RE` and `moduleSpecifiers`, add `TRANSPORT_DIRS` with the six folders, fail naming the file for any match outside them, and assert each folder exists with at least one `.ts` file. Leave "detector sanity" and the rest unchanged.
    - _Requirements: 22.2_
  - [x] 32.3 Replace the start tests in `services/gateway/test/start.test.ts`
    - Keep "without a build"; replace the rest with the design's case table under both `node dist/index.js` and `pnpm --silent start`: non-zero exit within 5 s, the config error line naming exactly the expected keys (from the test's own G3 table), no sentinel in stdout or stderr, empty stdout.
    - _Requirements: 1.3, 1.4, 1.7, 22.3_
  - [x] 32.4 Replace the start tests in `services/simulator/test/start.test.ts`
    - Same as 32.3 for the simulator.
    - _Requirements: 1.3, 1.4, 1.7, 22.3_
  - [x] 32.5 Add the two panel keys
    - Append the design's final section (`# --- Local control surfaces (Phase 1.2) ---`, `# [cloud] …` + `GATEWAY_OPERATOR_PORT=`, `# [device] …` + `SIMULATOR_PANEL_PORT=`) after one blank line to both `.env.example` and `tooling/fixtures/approved-panel.txt`, changing no existing line; set `EXPECTED_KEY_COUNT` in `tooling/test/panel-check.test.ts` from 21 to 23; confirm `checkPanel` reports no issues.
    - _Requirements: 22.4_
  - [x] 32.6 Update `README.md` and `tooling/test/readme.test.ts`
    - Start rows say the service keeps running (needs a configured `.env`); the `docker compose up` row says both keep running; new section "Gateway and simulator locally" with the Local_Mode `.env` keys by name only, the `docker compose exec gateway node dist/cli.js …` and `docker compose exec simulator node dist/cli.js …` commands, both port keys, unauthenticated loopback-only surfaces (Operator_Surface Local_Mode-only), the G5 prototype registry, and the `DEBUG` note (K9). No Panel_Key assignment lines. The "%s prints ok and exits with code 0" test becomes "%s keeps running"; no other README check changes.
    - _Requirements: 22.8_
  - [x] 32.7 Add one line to `.kiro/steering/structure.md`
    - Inside the `packages/shared/` block after the `src/domain/` lines: `│     ├─ src/gateway-log/       Gateway_Log types, constants and Safe_Issue helper (not the contract)`. Confirm with `git diff -- .kiro/steering/structure.md` that exactly one line was added.
    - _Requirements: 22.7_

- [x] 33. New repo checks (`tooling/checks/`, `tooling/test/`, `tooling/fixtures/`)
  - [x] 33.1 Create `tooling/checks/contract-use.ts` and its fixtures
    - Pure detectors reporting `{ path, lineNo, rule }`: `zod_import`, `topic_literal`, `contract_type_name` (names collected from the `export { … }` / `export type { … }` lists of `packages/shared/src/gateway-contract/index.ts`), `wire_value_list` (array or union of two or more string literals all in one contract list, lists imported from `packages/shared/dist/index.js`). Fixtures `contract-use-banned.txt` (one example per rule) and `contract-use-clean.txt`.
    - _Requirements: 2.3, 2.4, 2.5, 2.7_
  - [x] 33.2 Write `tooling/test/contract-use.test.ts`
    - Real-repo scan of both service `src` trees fails with `path:line rule` per breach; banned fixture yields exactly one finding per rule (four); clean fixture yields none.
    - _Requirements: 2.3, 2.4, 2.5, 2.7_
  - [x] 33.3 Create `tooling/checks/service-sources.ts` and its fixtures
    - `findFileWrites` (the 15 names as bare or member calls and any import of them, even aliased, from `fs`, `node:fs`, `fs/promises`, `node:fs/promises`), `findStdioUse`, `findModuleSpecifiers`, `findFetchCalls`, `findProviderStubUse`. Fixtures `gateway-boundaries-banned.txt`, `gateway-boundaries-clean.txt`, `service-sources-banned.txt`, `service-sources-clean.txt`.
    - _Requirements: 14.2, 14.3, 21.1, 21.7_
  - [x] 33.4 Write `tooling/test/gateway-boundaries.test.ts`
    - Gateway sources import only `node:` built-ins, relative paths, `@xelulu/shared`, `mqtt` and `ws`; manifest `dependencies` exactly those three and `devDependencies` exactly `@types/node`, `@types/ws`, `typescript`, no `@supabase/`; no global `fetch`; no stub-provider use outside `src/brain/`; fixture self-tests.
    - _Requirements: 14.2, 14.3, 14.4_
  - [x] 33.5 Write `tooling/test/service-sources.test.ts`
    - No file-writing call in either service `src`; `console`/`process.stdout.write`/`process.stderr.write` only in `src/log/logger.ts`, `src/config-error-writer.ts` and `src/cli.ts`; fixture self-tests.
    - _Requirements: 21.1, 21.3, 21.7_

- [x] 34. Dockerfiles and Compose
  - [x] 34.1 Update `services/gateway/Dockerfile`
    - Production-only `deps` stage (`pnpm install --frozen-lockfile --prod --filter @xelulu/gateway...`), the Phase 0 build stage, and a runtime stage keeping the workspace layout, the `RUN node --input-type=module -e "…import('mqtt'), import('ws'), import('@xelulu/shared')…"` resolve check, `USER node`, `CMD ["node", "dist/index.js"]`; every `FROM` on `node:24.21.0-bookworm-slim`; no Panel_Key or secret baked in.
    - _Requirements: 22.9, 23.1_
  - [x] 34.2 Update `services/simulator/Dockerfile`
    - Same pattern for `@xelulu/simulator`, also copying `panel/` into `services/simulator/panel`.
    - _Requirements: 20.3, 22.9, 23.1_
  - [x] 34.3 Update `docker-compose.yml`
    - Gateway and simulator long-running with `depends_on` `emqx` `service_healthy` (simulator also `gateway` `service_started`); keep `build`, optional `./.env` `env_file`, `restart: "no"`, no `ports`, no `environment`; `emqx` unchanged. `tooling/test/compose-static.test.ts` passes unchanged.
    - _Requirements: 22.9, 23.1_

- [x] 35. Compose_Acceptance_Check
  - [x] 35.1 Create `tooling/compose/compose-acceptance.ts`
    - Self-contained, `node:` imports only, erasable syntax only, CLI entry guarded by `process.argv[1]`; exported pure helpers. Fails at once if `.env` exists; writes the temporary Local_Mode `.env` from `[key, value]` tuples with URLs built from parts (`emqx:1883`, `gateway:8081`, `DEVICE_ID` `xlu_ci_sim`, a random per-run base64url `DEVICE_TOKEN`, empty broker credentials, ports 8090 and 8091); `docker compose up -d`; 600 s budget; parses every gateway log line as JSON; drives both CLIs with `docker compose exec -T … node dist/cli.js …` via `spawnSync` argument arrays; steps 23.1–23.8 in order with 500 ms polling; `FAILED <criterion>` or `FAILED budget` with token-redacted logs and exit 1, else `PASSED 23.1–23.8`; cleanup in `finally` and on signals (`docker compose down -v`, delete `.env`); prints no env value except `DEVICE_ID`.
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 23.11, 23.12, 23.13_
  - [x] 35.2 Write `tooling/test/compose-acceptance.test.ts`
    - Unit tests of the pure helpers with no Docker: each step predicate over sample log arrays (pass and fail cases, including the 45.0–46.0 s window and the 15 s no-extra-outcome window), budget arithmetic, first-failure naming, token redaction, `.env` line building from tuples, and that the source holds no `scheme://` literal or Panel_Key assignment line.
    - _Requirements: 23.11, 23.12, 23.13_

- [x] 36. CI workflow
  - [x] 36.1 Update `.github/workflows/ci.yml`
    - `checks` job: remove the `pnpm start:gateway` and `pnpm start:simulator` steps. `compose` job (renamed "compose acceptance", `timeout-minutes` 30): keep "Config resolves with no .env", "Every Panel_Key reaches gateway and simulator", "EMQX dashboard answers within 120 s", "EMQX ports listen on 127.0.0.1 only", "Compose logs on failure" and "Compose down" (`if: always()`) with unchanged assertions; add "Build gateway and simulator images", "Start EMQX with no .env" (`test ! -e .env` then `docker compose up -d emqx`), "Compose_Acceptance_Check (Done-when 1–6)" (`node tooling/compose/compose-acceptance.ts`, `timeout-minutes: 12`) and "Remove temporary .env" (`if: always()`); remove "Compose up", "Gateway and simulator print ok and exit 0 within 60 s" and "After 30 s, both are still exited and EMQX is still running".
    - _Requirements: 22.5, 23.11, 23.12_

- [x] 37. Final verification and Done-when report
  - [x] 37.1 Run the full workspace verification
    - Run, in order: `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm test`. All must exit 0 with zero TypeScript errors, lint errors, unformatted files and failed tests, and no skipped or todo tests in the new gateway and simulator test files. Confirm the Repo_Checks of Req 22.9 pass with their test files unchanged. Fix failures in code under this spec, never by weakening a check. If Docker is available, optionally run `node tooling/compose/compose-acceptance.ts` locally; otherwise state that its real run happens in the CI `compose` job.
    - _Requirements: 22.9, 23.9, 23.10_
  - [x] 37.2 Report the Done-when checks in the task result
    - Check 1: Compose_Acceptance_Check step 23.1 (CI), plus `broker-session.test.ts` and `device-link.test.ts`.
    - Checks 2–6: the gateway and simulator `done-when.test.ts` in-process tests (with Properties 2, 5, 6, 7, 8, 13, 14, 15 as supporting evidence), and Compose_Acceptance_Check steps 23.2–23.8 in CI. Note if the Compose_Acceptance_Check could not run locally.
    - Check 7: the task 37.1 command results, the updated and new Repo_Checks, and Properties 1–16.
    - List any optional tasks skipped; the items flagged for Omar (D5 shared `toSafeIssues`, D7/K8 over-64 KiB messages logged as `frame_too_large`, and the G-FLAGs G4, G5, G6, G8, G22, G24, G25, G37, G41, G45, G46, G47, G48); and the Phase 6 confirmation items (G8 Bearer header, G11 `/cmd`-only, G18/OP-G3 downstream framing, OP-G4 mismatch reporting, R10 `ts` on hello and ack, ruling 2 and 3 shapes and ranges, OP7 `max_dist_mm` on stop, OP8).
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 23.9, 23.10_

- [x] 38. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster pass: 3.4 (constant lists and freezing), 5.7 and 6.6 (config edge examples, also covered per key by the start tests), 11.5 (1,000-command retention) and 30.5 (panel static accessibility checks). Everything needed for the seven Done-when checks, every repo-check update, every correctness property (1–16, including the leak and safety Properties 2, 4, 10, 12, 16 and the model-based Properties 5 and 8) is required.
- Each task references requirement clauses for traceability; property tasks name their design property.
- The panel's keyboard order and focus visibility also need a manual check during review; full WCAG validation needs manual testing with assistive technologies.
- Tasks that write the same file sit in different waves of the dependency graph below. Tasks 32.5 and 32.7 have no code dependencies and are scheduled early.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "32.5", "32.7"] },
    { "id": 1, "tasks": ["2.2"] },
    { "id": 2, "tasks": ["2.4"] },
    { "id": 3, "tasks": ["2.5"] },
    { "id": 4, "tasks": ["3.1", "3.2", "5.1", "5.2", "6.1", "7.1"] },
    { "id": 5, "tasks": ["3.3", "5.3", "5.4", "6.2", "6.3", "7.2"] },
    { "id": 6, "tasks": ["3.4", "5.5", "5.6", "6.4", "6.5", "7.3", "8.1"] },
    { "id": 7, "tasks": ["5.7", "6.6", "8.2", "9.1", "9.2", "9.4", "10.1"] },
    { "id": 8, "tasks": ["8.3", "9.3", "9.5", "10.2", "10.3", "11.1", "12.1"] },
    { "id": 9, "tasks": ["8.4", "9.6", "10.4", "11.2", "12.2", "12.3", "13.1"] },
    { "id": 10, "tasks": ["9.7", "11.3", "12.4", "13.2"] },
    { "id": 11, "tasks": ["11.4", "12.5", "15.1", "15.2", "15.3"] },
    { "id": 12, "tasks": ["11.5", "16.1"] },
    { "id": 13, "tasks": ["16.2", "16.3", "17.1", "17.2", "17.3", "22.1"] },
    { "id": 14, "tasks": ["18.1", "18.2", "18.4", "19.1", "19.2", "19.3", "19.4", "19.6", "19.7", "19.8", "19.9", "22.2", "23.1"] },
    { "id": 15, "tasks": ["18.3", "19.5", "20.1", "22.3", "23.2", "23.4", "23.5"] },
    { "id": 16, "tasks": ["23.3", "23.6", "24.5", "25.1"] },
    { "id": 17, "tasks": ["23.7", "24.1", "25.2", "26.1", "26.2"] },
    { "id": 18, "tasks": ["23.8", "24.2", "24.3", "25.3", "26.3", "27.1", "27.2"] },
    { "id": 19, "tasks": ["24.4", "28.1"] },
    { "id": 20, "tasks": ["28.2", "28.3", "29.1", "29.2"] },
    { "id": 21, "tasks": ["30.1", "30.2", "30.3", "30.4", "30.5", "30.6", "30.7", "32.1", "33.1", "33.3", "34.1", "34.2"] },
    { "id": 22, "tasks": ["30.8", "32.2", "32.3", "32.4", "32.6", "33.2", "33.4", "33.5", "34.3", "35.1"] },
    { "id": 23, "tasks": ["35.2", "36.1"] },
    { "id": 24, "tasks": ["37.1"] },
    { "id": 25, "tasks": ["37.2"] }
  ]
}
```
