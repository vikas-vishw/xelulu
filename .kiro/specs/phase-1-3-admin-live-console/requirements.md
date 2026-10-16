# Requirements Document

## Introduction

Phase 1.3 wires the Phase 0 admin console (`apps/admin`, Vite + React) to the live Gateway, so the team can watch the Simulator from a browser. The Gateway gains one read-only Server-Sent Events route on its existing Operator_Surface. The console gains two pages from the admin design (`docs/design/Xelulu Developer Console Dashboard (1).png`): a Dashboard and a Devices + Live Log page.

This is a low-risk phase. Nothing new leaves the Gateway: the stream carries the Log_Entries the Gateway already builds (already Safe under Phase 1.2 G21) and a small per-device summary. The Document B v2 contract (`proto_ver` 2) does not change, and neither do the Gateway_Log entry types (`GATEWAY_LOG_VERSION` stays 1).

### Out of scope

- The API-config page, the feature test-matrix page and every other page in the admin design (later phases).
- Any write action from the admin console. The console is read-only.
- Authentication on the Operator_Surface, the Control_Surface or the admin console.
- The parent app (untouched).
- Any change to Document B, the Gateway_Log entry types or the Panel (`.env.example`).

### Choices made

Each choice below was made without asking, except C8, which is Omar's ruling. Items marked FLAG need Omar's explicit approval; approving this spec approves them as written.

- **C1. Transport: SSE.** The stream is Server-Sent Events at `GET /v1/stream` on the existing Operator_Surface (`GATEWAY_OPERATOR_PORT`). SSE is one-way and read-only, works through the Vite dev proxy, and needs only `node:http`, so the Gateway gains no dependency. WebSocket was rejected: it is two-way and would need an upgrade path through the guard and the proxy.
- **C2. Stream events.** On connect the Gateway sends one `devices` event, then every retained Log_Entry (the last 1,000, with `GatewayLog.subscribe` semantics) as `entry` events in `seq` order, then every later Log_Entry as it is added. After any Log_Entry that changes a Device_Summary, it sends a fresh `devices` event. A comment line every 15 s keeps idle proxies from closing the stream. There is no resume: on every (re)connect the console clears its view and rebuilds from the new snapshot and backlog, which is also correct across a Gateway restart (when `seq` starts again at 1).
- **C3. Battery source: the Device_Summary.** The Gateway remembers the `battery_pct` and `charging` of each device's latest accepted `status` (the values already logged on that `message_in` entry) and puts them in the Device_Summary. The console never has to find a status entry in its log window. The Device_Summary is a new stream-only type: `device_id`, `presence`, `last_heartbeat_at`, `battery_pct`, `charging`, `events_accepted` and `events_duplicate`. It is not part of the contract or the Gateway_Log, so no `proto_ver` or `GATEWAY_LOG_VERSION` change. `GET /v1/devices` (Phase 1.2 Req 13.4) is unchanged. The stream types live in `packages/shared/src/gateway-log/` because apps may not import from services.
- **C4. No new values leave the Gateway.** `entry` events are the Log_Entries exactly as built, serialised the same way as their stdout line. The Device_Summary holds IDs, presence, a time, counts, `battery_pct` and `charging` only. No token, password, `auth` value or env value except the `device_id` value of `DEVICE_ID` ever appears on the stream.
- **C5. Browser origin: the dev proxy strips it; the Gateway guard is unchanged.** The admin console opens the stream at its own origin (`/v1/stream`). The Vite dev server proxies only that path to `127.0.0.1:<GATEWAY_OPERATOR_PORT>`, rewrites `Host` to the target and removes any `Origin` header, so the Phase 1.2 guard (any `Origin` refused) needs no change. The Gateway does not additionally allow the console's own origin: it would need to learn the console's port, and refusing every `Origin` is the more conservative rule. Only `/v1/stream` is proxied, so `POST /v1/commands` cannot be reached from the console's origin. Because the proxy removes `Origin`, the dev server itself takes over the cross-origin rule: it forwards a request only when it has no `Origin` or exactly the console's own loopback origin (same-origin `EventSource` GETs send none), and it sends no CORS headers (`server.cors: false`), so no other web page can read the stream through it. Vite's default `allowedHosts` check (DNS rebinding) stays on.
- **C6. FLAG: how `vite.config.ts` learns the port.** `vite.config.ts` calls Vite's `loadEnv` once, with the repo root as the directory and the literal prefix `GATEWAY_OPERATOR_PORT`, and reads only that key from the result. The value is a non-secret local port. This needs one change to the Phase 1.2 env-read Repo_Check (Req 22.1(c)), which today requires zero env reads in `vite.config.ts`: the check keeps zero `process.env` and `import.meta.env` reads there, and gains a test that the file's only env access is that one `loadEnv` call with that literal prefix, and that `loadEnv` appears nowhere in `apps/admin/src`. Rejected: a Vite CLI argument (Vite rejects unknown options and the user would type the port twice) and a new Panel key (a Panel change for a value that already exists).
- **C7. Admin dev server address.** Unchanged from Phase 0: `127.0.0.1:5173`, `strictPort`. Preview stays `127.0.0.1:4173` with no proxy.
- **C8. FLAG (Omar's ruling): publish both local surfaces to host loopback only.** In Compose only, the gateway publishes `127.0.0.1:P:P` for `P = GATEWAY_OPERATOR_PORT` and the simulator publishes `127.0.0.1:Q:Q` for `Q = SIMULATOR_PANEL_PORT`, never `0.0.0.0`. So that a published port reaches the process, each service binds `0.0.0.0` inside its container when, and only when, it is in Local_Mode and was started with the `--listen-all-interfaces` argument; Compose adds that argument through each service's `command`. Without the argument (`pnpm start:*`, the image's default `CMD`, every test harness) both surfaces still bind `127.0.0.1` only. The host port must equal the container port, because both guards check `Host` against the port they listen on. The `Host` and `Origin` checks stay as they are, so a request from another container that uses a Compose service name as `Host` is still refused. This supersedes, exactly:
  - Phase 1.2 **Requirement 13.1** ("listen on `127.0.0.1` ... and on no other address"): replaced by Requirement 3.1 below. Why: Docker can forward a published port only to a non-loopback container address.
  - Phase 1.2 **Requirement 20.1** ("listen on `127.0.0.1` ... only", in every mode): replaced by Requirement 3.2 below. Outside Local_Mode, or without the argument, it is unchanged.
  - Phase 1.2 **G36** and the Compose static check (`tooling/test/compose-static.test.ts`, test "publishes no ports and carries no environment or credentials"): each of the gateway and simulator services now publishes exactly one port, bound to `127.0.0.1`, and carries a `command` that adds the argument. The no-`environment`, no-`secrets` and no-credential-word assertions stay.
- **C9. FLAG: Compose port fallback.** The published ports use Compose interpolation from the root `.env` with a fallback: `${GATEWAY_OPERATOR_PORT:-8090}` and `${SIMULATOR_PANEL_PORT:-8091}` (the values the Compose_Acceptance_Check already writes). Without the fallback, the Phase 0 and 1.2 CI steps "Config resolves with no .env" and "Every Panel_Key reaches gateway and simulator" (which copies the empty `.env.example`) would fail. With no `.env` the services refuse to start anyway (Phase 1.2 Req 1.3), so the fallback only keeps the Compose file valid. The user's `.env` must set both keys for the browser checks.
- **C10. Simulator panel from the host.** The panel is reached at `http://127.0.0.1:Q` on the host. The browser then sends `Host: 127.0.0.1:Q` and, on the panel's own POSTs, `Origin: http://127.0.0.1:Q`, both of which the existing Control_Surface guard already allows because the container listens on the same port `Q`. No simulator guard or panel change is needed. The README says to use `127.0.0.1`, not `localhost`, because `localhost` can resolve to `::1`, which the loopback-only publish does not serve.
- **C11. Live log rendering.** Newest first. The console keeps at most the last 500 entries (by `seq`) and drops older ones. A type filter offers "All" plus each kind in `GATEWAY_LOG_KINDS`, imported from `@xelulu/shared`. Each entry shows its time, kind, device and a human label built from Closed_Enum fields only (for example, touch shows its zone and gesture). Reconnect uses backoff of 1, 2, 4, 8, then 10 s (capped), reset after a successful open.
- **C12. Stream limits.** At most 4 streams at once (a fifth is refused with 503 `too_many_streams`), and a stream whose unsent output passes 1 MiB is closed (the console reconnects). Both bound memory on a loopback-only tool.
- **C13. FLAG: new admin devDependencies.** Admin component tests need a DOM. `apps/admin` gains exact-pinned devDependencies `jsdom` 30.1.2, `@testing-library/react` 16.3.3 and `@testing-library/dom` 10.4.2 (its required peer). No `user-event` or `jest-dom`. `apps/admin` also gains the dependency `@xelulu/shared` (`workspace:*`), for types and `GATEWAY_LOG_KINDS`. The root Vitest config gains `apps/admin/test/**/*.test.{ts,tsx}`; DOM tests opt in per file with `// @vitest-environment jsdom`.
- **C14. Compose_Acceptance_Check gains one small step.** It checks from the CI host that `127.0.0.1:P/v1/stream` answers and that its first event is a `devices` event naming the device, and that `docker compose port` reports both published ports on `127.0.0.1`. This is the only automated check that the published port and the `Host` check work together.
- **C15. Testing depth (Omar).** Smoke and key-interaction tests only, all example-based. No new property-based tests in this phase.

## Glossary

- **Gateway**: the Node.js service in `services/gateway`.
- **Simulator**: the Node.js fake robot in `services/simulator`.
- **Local_Mode**: `APP_ENV` equal to `local` (Phase 1.2).
- **Operator_Surface**: the Gateway's local-only HTTP JSON surface on `GATEWAY_OPERATOR_PORT` (Phase 1.2 G24), with its request guard.
- **Operator_Stream**: the new SSE route `GET /v1/stream` on the Operator_Surface.
- **Control_Surface**: the Simulator's local web panel and JSON API on `SIMULATOR_PANEL_PORT` (Phase 1.2 G25).
- **Shared_Package**: `packages/shared` (`@xelulu/shared`).
- **Registered_Device**: a device the Gateway knows from `DEVICE_ID` and `DEVICE_TOKEN` (Phase 1.2 G5).
- **Log_Entry**: one `GatewayLogEntry` from `packages/shared/src/gateway-log/`.
- **Device_Summary**: the per-device record sent in a `devices` event (C3).
- **Listen_All_Argument**: the command-line argument `--listen-all-interfaces` (C8).
- **Admin_Console**: the internal web app in `apps/admin`.
- **Dev_Proxy**: the Vite dev server's proxy for `/v1/stream` (C5).
- **Live_Log**: the Admin_Console's list of received Log_Entries.
- **Stream_Client**: the Admin_Console module that opens the Operator_Stream and reconnects it.
- **Compose_Acceptance_Check**: `tooling/compose/compose-acceptance.ts` (Phase 1.2 Req 23).
- **Repo_Check**: a test under `tooling/test/`.

## Requirements

### Requirement 1: Operator_Stream

**User Story:** As the implementation engineer, I want a read-only live feed of the Gateway_Log and device state, so that a browser can watch the Simulator.

#### Acceptance Criteria

1. WHILE the Gateway is in Local_Mode, THE Operator_Surface SHALL answer `GET /v1/stream` with status 200, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and keep the response open.
2. WHEN an Operator_Stream opens, THE Gateway SHALL send one `devices` event first, then each retained Log_Entry (at most 1,000) as an `entry` event in `seq` order, then each later Log_Entry as an `entry` event in `seq` order, with no entry missed or repeated between the backlog and the later entries.
3. WHEN a Log_Entry is added that changes any field of any Device_Summary, THE Gateway SHALL send, on each open Operator_Stream, a `devices` event right after that Log_Entry's `entry` event.
4. WHILE an Operator_Stream is open, THE Gateway SHALL send one SSE comment line every 15 s.
5. THE Operator_Surface SHALL apply its Phase 1.2 request guard to `/v1/stream` unchanged: a `Host` other than `127.0.0.1` or `localhost` at the listening port is refused with 403 `forbidden_host`, any `Origin` header is refused with 403 `forbidden_origin`, and any method other than GET is refused with 405 `method_not_allowed`.
6. IF a `/v1/stream` request carries any query parameter, THEN THE Operator_Surface SHALL refuse it with 400 `invalid_fields` without echoing the parameter's value.
7. IF 4 Operator_Streams are already open, THEN THE Operator_Surface SHALL refuse a new `/v1/stream` request with 503 `too_many_streams`.
8. IF an Operator_Stream's unsent output exceeds 1 MiB, THEN THE Gateway SHALL close that stream and keep serving other streams and requests.
9. WHEN a client closes an Operator_Stream, or the Gateway stops, THE Gateway SHALL unsubscribe that stream from the Gateway_Log and stop its 15 s comment timer, and `stop()` SHALL complete with every stream closed.
10. THE Operator_Stream SHALL change no Gateway state and publish nothing.

### Requirement 2: Stream content and redaction

**User Story:** As Omar, I want the stream to carry only what the Gateway already logs safely, so that no token or raw value reaches a browser.

#### Acceptance Criteria

1. THE Gateway SHALL send each `entry` event's data as exactly the JSON text of that Log_Entry's stdout line.
2. THE Gateway SHALL send each `devices` event's data as a JSON object with exactly one field, `devices`, listing one Device_Summary per Registered_Device, each with exactly the fields `device_id`, `presence` (`unknown`, `online` or `offline`), `last_heartbeat_at` (ISO 8601 UTC or null), `battery_pct` (number or null), `charging` (boolean or null), `events_accepted` and `events_duplicate`.
3. THE Gateway SHALL set a Device_Summary's `battery_pct` and `charging` to the values of that device's latest accepted `status` message since the Gateway process started, and to null before the first one.
4. THE Operator_Stream SHALL contain no `DEVICE_TOKEN`, `MQTT_PASSWORD`, hello `auth` value or other env value except the `device_id` value of `DEVICE_ID`.
5. THE Shared_Package SHALL export the Device_Summary type, the `devices` event payload type and a frozen `OPERATOR_STREAM_EVENTS` constant (`devices`, `entry`) from `packages/shared/src/gateway-log/`, and SHALL leave every Log_Entry type and `GATEWAY_LOG_VERSION` (1) unchanged.

### Requirement 3: Reaching the local surfaces from the host (Omar's ruling, C8)

**User Story:** As the implementation engineer, I want the browser on my machine to reach the Gateway and Simulator running in Compose, without exposing them beyond my machine.

#### Acceptance Criteria

1. WHILE the Gateway is in Local_Mode, THE Operator_Surface SHALL listen at `GATEWAY_OPERATOR_PORT` on `0.0.0.0` when the Gateway was started with the Listen_All_Argument, and on `127.0.0.1` only otherwise. (Supersedes Phase 1.2 Req 13.1.)
2. THE Control_Surface SHALL listen at `SIMULATOR_PANEL_PORT` on `0.0.0.0` when the Simulator is in Local_Mode and was started with the Listen_All_Argument, and on `127.0.0.1` only otherwise, in every mode. (Supersedes Phase 1.2 Req 20.1.)
3. THE `docker-compose.yml` gateway service SHALL publish exactly one port, `127.0.0.1:${GATEWAY_OPERATOR_PORT:-8090}:${GATEWAY_OPERATOR_PORT:-8090}`, and SHALL set `command` to its image's default command plus the Listen_All_Argument.
4. THE `docker-compose.yml` simulator service SHALL publish exactly one port, `127.0.0.1:${SIMULATOR_PANEL_PORT:-8091}:${SIMULATOR_PANEL_PORT:-8091}`, and SHALL set `command` to its image's default command plus the Listen_All_Argument.
5. THE Operator_Surface and Control_Surface request guards SHALL stay as Phase 1.2 defines them, so that a request whose `Host` names a Compose service is refused with 403 `forbidden_host`.
6. WHEN `docker compose config` runs with no `.env`, or with `.env` copied from `.env.example`, THE Compose file SHALL resolve without error.

### Requirement 4: Dev proxy

**User Story:** As the implementation engineer, I want `pnpm dev:admin` to reach the Gateway without weakening its origin rule.

#### Acceptance Criteria

1. THE Admin_Console dev server SHALL listen on `127.0.0.1:5173` with `strictPort`, as in Phase 0.
2. WHEN the dev server starts and the root `.env` (or the process environment) gives `GATEWAY_OPERATOR_PORT` as an integer from 1 to 65535, THE Dev_Proxy SHALL forward requests for `/v1/stream` only to `127.0.0.1` at that port, with `Host` rewritten to the target and any `Origin` header removed.
3. IF `GATEWAY_OPERATOR_PORT` is missing or is not an integer from 1 to 65535 when the dev server starts, THEN THE Admin_Console dev server SHALL start without the Dev_Proxy and print one line that names `GATEWAY_OPERATOR_PORT` and no value.
4. IF a `/v1/stream` request to the dev server has an `Origin` header other than `http://127.0.0.1:5173` or `http://localhost:5173`, THEN THE Dev_Proxy SHALL not forward it and THE dev server SHALL answer it with 404.
5. THE Admin_Console dev server SHALL send no CORS headers and SHALL keep Vite's default `allowedHosts` check.
6. THE `apps/admin/vite.config.ts` file SHALL read the environment only through one `loadEnv` call whose prefix argument is the literal `GATEWAY_OPERATOR_PORT`, and SHALL read no other key from its result.
7. THE files under `apps/admin/src`, `apps/admin/index.html` and the proxy helper `apps/admin/vite-proxy.ts` SHALL contain no env read and no `loadEnv` call.

### Requirement 5: Dashboard page

**User Story:** As the intern, I want a dashboard of device health, so that I can see at a glance which devices are online and charged.

#### Acceptance Criteria

1. THE Dashboard SHALL show three tiles, "Devices", "Online" and "Offline", with the count of Device_Summaries in total, with `presence` `online`, and with `presence` `offline`, from the latest `devices` event.
2. THE Dashboard SHALL show a Device Health table with one row per Device_Summary giving its `device_id`, its presence as text ("Online", "Offline" or "Not seen yet") and its battery as `<battery_pct>%` (or "—" when null), with "charging" added when `charging` is true.
3. WHEN a `devices` event arrives, THE Dashboard SHALL show its values in place of the previous ones.

### Requirement 6: Devices + Live Log page

**User Story:** As the intern, I want a live, filterable list of every message in and out, so that I can follow what the Simulator and Gateway are doing.

#### Acceptance Criteria

1. THE Devices + Live Log page SHALL list each Device_Summary's `device_id`, presence, battery, last heartbeat time and event counts.
2. THE Live_Log SHALL show received Log_Entries newest first (highest `seq` at the top), each with its `at` time, its kind and its `device_id` (when it has one).
3. THE Admin_Console SHALL keep at most the 500 highest-`seq` Log_Entries received on the current connection, ignore an `entry` whose `seq` it already holds, and drop older entries.
4. THE Live_Log SHALL offer a labelled type filter with "All" and one option per kind in `GATEWAY_LOG_KINDS`, imported from `@xelulu/shared`; WHEN a kind is selected, THE Live_Log SHALL show only entries of that kind.
5. THE Live_Log SHALL show a human label per entry built only from its Closed_Enum and ID fields: for `event_accepted` and `event_duplicate` the event kind plus its `data` (touch zone and gesture, wake source, motion event, button and action); for `ack_result` the outcome, the action (or "unknown command") and a non-empty `reason`; for `message_out` the variant and `cmd_id`; for `message_in` the variant and, for `status`, battery and charging; for `presence` the new state and cause.
6. WHEN an Operator_Stream (re)opens, THE Admin_Console SHALL clear its Live_Log and Device_Summaries and rebuild them from that stream's events.

### Requirement 7: Connection state and reconnect

**User Story:** As the intern, I want to see whether the console is live, and have it recover when the Gateway restarts.

#### Acceptance Criteria

1. THE Admin_Console SHALL show the stream state as text in a polite live region: "Connecting", "Live" or "Reconnecting".
2. IF the Operator_Stream reports an error or closes, THEN THE Stream_Client SHALL close it and open a new one after 1 s, then 2 s, 4 s, 8 s and 10 s for each further consecutive failure (10 s thereafter), and SHALL return to 1 s after a stream opens.
3. WHILE the state is "Reconnecting", THE Admin_Console SHALL keep showing the last received values with a note that they may be out of date.
4. WHEN the Admin_Console page is closed or reloaded, THE Stream_Client SHALL close its stream and cancel any pending reconnect.

### Requirement 8: Boundaries, privacy and accessibility

**User Story:** As Omar, I want the console to stay internal, read-only and accessible, and to show no secrets.

#### Acceptance Criteria

1. THE Admin_Console SHALL import from `@xelulu/shared` only types and frozen constants, and SHALL import nothing from `apps/parent-app` or `services/*`.
2. THE Admin_Console SHALL send no request other than `GET /v1/stream` to its own origin.
3. THE Admin_Console SHALL show no secret, token, env value or Panel_Key name, and its built bundle in `apps/admin/dist` SHALL contain no Panel_Key name (the Phase 0 check, unchanged).
4. THE Admin_Console SHALL use a semantic table for the Device Health and device lists, an ordered list for the Live_Log, a `<label>` tied to the filter control, one `h1`, a visible focus indicator on every focusable control, and presence and stream state as text, never colour alone.
5. THE Admin_Console SHALL contain no animation, transition or flashing, and its title and body text SHALL keep at least 4.5:1 contrast in light and dark mode (Phase 0 checks, unchanged).
6. THE parent app SHALL stay unchanged.

Note: these checks cover the basics only. Full WCAG validation needs manual testing with assistive technologies and an expert accessibility review.

### Requirement 9: Repo checks and docs

**User Story:** As the implementation engineer, I want the existing checks updated only where this phase changes what they guard.

#### Acceptance Criteria

1. THE Compose static Repo_Check SHALL replace "publishes no ports" for the gateway and simulator with checks of Requirement 3.3 and 3.4, and SHALL keep every other assertion in that file.
2. THE env-read Repo_Check SHALL keep zero `process.env` and `import.meta.env` reads in `apps/admin/vite.config.ts`, and SHALL add checks of Requirement 4.6 and 4.7.
3. THE Phase 1 export test `packages/shared/test/exports.test.ts` SHALL add `OPERATOR_STREAM_EVENTS` to the runtime exports, raising its length assertion by exactly 1 (the one runtime name added), and SHALL add the new stream types to its type list.
4. THE README check "admin console: a localhost URL shows the placeholder" SHALL change to require that the `pnpm dev:admin` row names a loopback URL and the words "live console".
5. THE root README SHALL gain a short section on watching the Simulator in the Admin_Console: set both port keys in `.env`, run `docker compose up`, run `pnpm build` then `pnpm dev:admin`, open the console and the Simulator panel at `127.0.0.1`, and a statement that both surfaces stay unauthenticated, are published on host loopback only, and that the console is read-only.
6. THE network-module Repo_Check SHALL pass unchanged, with all new Gateway network code inside `services/gateway/src/operator/transport/`.
7. THE `.env.example` and `tooling/fixtures/approved-panel.txt` files SHALL stay unchanged.

### Requirement 10: Verification

**User Story:** As Omar, I want the Done-when checks backed by tests where that is cheap, and a short manual checklist for the browser.

#### Acceptance Criteria

1. THE gateway tests SHALL include an Operator_Stream test over a real loopback listener that shows: backlog then live `entry` events in `seq` order after a first `devices` event; 403 for a foreign `Origin` and for a foreign `Host`; 405 for POST; 503 for a fifth stream; and no sentinel `DEVICE_TOKEN`, `MQTT_PASSWORD` or hello `auth` value of at least 8 characters anywhere in the stream text.
2. THE gateway tests SHALL include an in-process Done-when test with the fake device and Vitest fake timers that reads the Operator_Stream and shows: the device Online with its `battery_pct` after hello and status; a touch on `belly` as an `event_accepted` entry with zone `belly`; a `cry` `event_accepted` entry; a `say` `message_out` followed by its `ack_result` with outcome `done`; and a `presence` `offline` entry with cause `silence`, plus a `devices` event with `presence` `offline`, once 45 s pass with no Heartbeat.
3. THE gateway and simulator tests SHALL show that each surface listens on `0.0.0.0` only with Local_Mode and the Listen_All_Argument, and on `127.0.0.1` in every other case.
4. THE Admin_Console tests SHALL, with a fake EventSource, show: the three tiles and the Device Health row; Live_Log order newest first; the 500-entry cap; the filter; the touch label with its zone; and the "Live" and "Reconnecting" states with the 1 s first retry. A test of the Dev_Proxy builder SHALL show the target, the `Origin` rule of Requirement 4.4 and the no-proxy result for a missing or invalid port.
5. WHEN the Compose_Acceptance_Check runs, THE Compose_Acceptance_Check SHALL also check C14 and SHALL keep every Phase 1.2 step.
6. WHEN `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test` run, each SHALL succeed.
