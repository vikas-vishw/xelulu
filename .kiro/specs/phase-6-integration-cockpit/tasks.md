# Implementation Plan: Phase 6 Integration Cockpit

## Overview

Five waves in order: Document C plus the Gateway's pairing/session modules; the Devices tab; the Test Matrix; the Device Control route and tab; the Intern Guide. Each wave ends green, then is committed and pushed to `origin/master` before the next begins. File-level detail is in `design.md`; this list is the order and the proof.

TypeScript strict. Files kebab-case, types PascalCase, wire and log fields snake_case. No new dependency in any manifest. No `fetch`, HTTP or network import under `services/gateway/src/brain/`. No change to `packages/shared/src/gateway-contract/`, `.env.example` or `tooling/fixtures/approved-panel.txt`. No Repo_Check assertion deleted or weakened.

Toolchain (PowerShell): `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...` with cwd `c:\xelulu`. Never system Node 22 or a global pnpm.

Baseline that must not regress: `corepack pnpm test` = 119 Vitest files / 2,452 tests plus 16 parent-app Jest suites / 275 tests; `lint` and `format:check` clean; `node tooling/compose/compose-acceptance.ts` printing `PASSED 23.1-23.8 + stream + conversation + content`. Counts only go up.

## Tasks

- [x] 1. Wave 1 — Document C and the shared types
  - [x] 1.1 Write `docs/C-pairing-and-device-session.md` (status/scope, Part 1 reserved, Part 2 as designed) and add its `docs/README.md` row and precedence entry — _Req 1.1–1.5_
  - [x] 1.2 Extend `packages/shared/src/gateway-log/stream.ts` with `DEVICE_SESSION_STATES`, `DeviceSessionState`, `DeviceLastAck` and the four new `DeviceSummary` fields; export from `gateway-log/index.ts` — _Req 2.5, 2.6, 7.1_
  - [x] 1.3 Update `packages/shared/test/exports.test.ts` by exactly the names added; leave the `GATEWAY_LOG_VERSION` assertion alone — _Req 2.6_

- [x] 2. Wave 1 — Gateway pairing and session
  - [x] 2.1 Add `services/gateway/src/devices/pairing-code.ts` — _Req 2.1_
  - [x] 2.2 Add `services/gateway/src/devices/device-session.ts` (`DeviceSessionInput`, `nextSession`, `createDeviceSessions`) — _Req 2.2, 2.3, 2.4_
  - [x] 2.3 Wire both in `services/gateway/src/gateway.ts` at the existing hello, status, audio-turn, `error` event, `message_rejected`, presence-offline and ack-tracker points. No new handler, subscription or log kind — _Req 2.2, 2.6, 7.7_
  - [x] 2.4 Extend `services/gateway/src/operator/device-summary.ts` with the `sessions` source and the four fields; `snapshot.ts` and `GET /v1/devices` untouched — _Req 2.5, 2.6_
  - [x] 2.5 Write `services/gateway/test/device-session.test.ts`: **Property 1**, **Property 2**, the transition table example by example, offline → `hello` → `connected` with the code unchanged — _Req 8.1_
  - [x] 2.6 Extend `services/gateway/test/device-summary.test.ts` with the four fields and their nulls — _Req 2.5_
  - [x] 2.7 Full check (`build`, `lint`, `format:check`, `test`), then commit and push Wave 1 — _Req 8.7_

- [x] 3. Checkpoint — all tests pass; surface any FLAG before continuing

- [x] 4. Wave 2 — Devices tab
  - [x] 4.1 Add `apps/admin/src/devices/zone-activity.ts` (pure: entries → per-zone last touch, zones from `TOUCH_ZONES`) — _Req 3.3_
  - [x] 4.2 Add `apps/admin/src/pages/devices-page.tsx` with every cell of Req 3.2 and 3.3; text-only states, no animation — _Req 3.2–3.5_
  - [x] 4.3 Add the page to `routing/use-hash-page.ts` and `app.tsx`; existing pages unchanged — _Req 3.1_
  - [x] 4.4 Write `apps/admin/test/devices-page.test.tsx` (RTL + fake EventSource): the row with session, pairing code and a zone cell; a session change; offline clearing in-turn; nothing secret rendered — _Req 3.5, 8.5_
  - [x] 4.5 Browser walkthrough, then commit and push Wave 2: device appears paired with a code, a touch on each zone lands, offline shows — screenshots recorded — _Req 3.4, 8.8_

- [ ] 5. Wave 3 — Test Matrix
  - [ ] 5.1 Add `apps/admin/src/matrix/test-matrix.ts`: `buildMatrix(lists?)` over the three contract lists plus `FIXED_ROWS`; `expectRefusal` from an exhaustive `Record<CmdAction, boolean>`; no wire value as a literal — _Req 4.1, 4.2, 4.3, 4.6, 7.10_
  - [ ] 5.2 Add `apps/admin/src/matrix/matrix-state.ts`: the pure reducer, observed matching by entry shape, driven by `cmd_id`, `pending` on no match, evidence of ids/enums/counts/times — _Req 4.4, 4.8, 4.9_
  - [ ] 5.3 Add `apps/admin/src/pages/matrix-page.tsx` plus its route and nav: run controls on driven rows only, the "originates at the device" line on observed rows, totals, reset — _Req 4.5, 4.7, 4.9_
  - [ ] 5.4 Write `apps/admin/test/test-matrix.test.ts` (**Property 4**, the substituted extra action), `matrix-state.test.ts` (**Property 5**, each observed match, driven pass/fail, `expectRefusal`), `matrix-page.test.tsx` (an observed row has no run control and greens on a matching entry) — _Req 8.4, 8.5_
  - [ ] 5.5 Add `tooling/test/matrix-derivation.test.ts` reusing `findContractMisuse` — _Req 7.10, 8.6_
  - [ ] 5.6 Full check and browser walkthrough, then commit and push Wave 3: every observed row fired from the simulator panel (wake, 7 zones, cry, motion, button, nfc, interrupt, error, an audio turn, an ack-policy `rejected`) and seen green — _Req 4.8, 8.7, 8.8_

- [ ] 6. Checkpoint — all tests pass; surface any FLAG before continuing

- [ ] 7. Wave 4 — the Device_Control_Route
  - [ ] 7.1 Extend `services/gateway/src/listen-host.ts` with `DEVICE_CONTROL_ARGUMENT` and `deviceControlEnabled`, plus its `listen-host.test.ts` cases — _Req 5.2_
  - [ ] 7.2 Extend `services/gateway/src/brain/tools/device-action.ts` with `send()`, refactoring `request()` to call it; allow-list unchanged — _Req 5.3, 5.4, 5.6, 7.8_
  - [ ] 7.3 Add the route: `request-guard.ts` gains `device_control_disabled` and `action_refused`; `operator-routes.ts` gains the POST route, its two deps and the handler; `/v1/commands` untouched — _Req 5.1–5.6_
  - [ ] 7.4 Wire it in `index.ts`/`gateway.ts` and add `--device-control` to the gateway service in `docker-compose.yml`, extending `tooling/test/compose-static.test.ts` — _Req 5.2, 8.6_
  - [ ] 7.5 Write `services/gateway/test/device-control-route.test.ts`: **Property 3**; `move` → `action_not_allowed` with nothing sent; `say` in quiet hours → `quiet_hours` with nothing sent; the two 403 cases; `invalid_fields`; `/v1/commands` unchanged — _Req 8.2, 8.3_

- [ ] 8. Wave 4 — Device Control tab
  - [ ] 8.1 Add `apps/admin/src/control/control-client.ts` (own origin, the shape-based `proxy_disabled` refusal) — _Req 5.7, 7.5_
  - [ ] 8.2 Add `apps/admin/src/pages/control-page.tsx` plus route and nav: derived controls, the frozen minimal-`data` table, `cmd_id` then ack, the disabled notice, no `move` — _Req 5.7_
  - [ ] 8.3 Extend `vite-proxy.ts`, `vite.config.ts`, the root `package.json` (`dev:admin:device`) and `apps/admin/test/vite-proxy.test.ts` — _Req 5.8_
  - [ ] 8.4 Write `apps/admin/test/control-page.test.tsx`: a send showing its `cmd_id`, the ack from the stream, a refusal shown as its `PolicyRefusal`, no `move` control — _Req 8.5_
  - [ ] 8.5 Full check and browser walkthrough, then commit and push Wave 4: all five allow-listed commands acked, driven rows green, `move` refused — _Req 4.5, 4.6, 8.7, 8.8_

- [ ] 9. Wave 5 — Intern Integration Guide
  - [ ] 9.1 Write `docs/intern-integration-guide.md` as designed, and link it from `README.md` with one new `tooling/test/readme.test.ts` assertion — _Req 6.1–6.6_

- [ ] 10. Final verification and live run
  - [ ] 10.1 Repo-wide green: `install --frozen-lockfile`, `build`, `lint`, `format:check`, `test`, and compose-acceptance still PASSED; confirm no manifest, `.env.example` or panel-fixture change and no weakened Repo_Check — _Req 7.4, 7.9, 7.10, 8.6, 8.7_
  - [ ] 10.2 Live run: simulator paired and shown with its code; every matrix row green; each allow-listed command acked; `move` refused; the session states observed in order (`connected` → `idle` → `in_turn` → `idle` → `offline` → `connected`) — _Req 8.8_
  - [ ] 10.3 Done-when report with the live run, the walkthroughs, the test counts and the FLAG list (C4, C17, plus anything surfaced), then commit and push Wave 5 — _Req 7.2, 8.8_
